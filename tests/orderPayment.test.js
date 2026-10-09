const { app, request, getAdminToken, registerUser } = require('./setup');
const ecpay = require('../src/ecpay');

/**
 * Mock the next ECPay QueryTradeInfo call with a signed (or deliberately unsigned) response.
 */
function mockQueryTradeInfo(fields, { signed = true } = {}) {
  const { hashKey, hashIv, merchantId } = ecpay.getConfig();
  const body = {
    HandlingCharge: '0',
    ItemName: '',
    MerchantID: merchantId,
    PaymentDate: '',
    PaymentType: '',
    PaymentTypeChargeFee: '0',
    TradeAmt: '0',
    TradeDate: '',
    TradeNo: '',
    ...fields,
  };
  body.CheckMacValue = signed ? ecpay.generateCheckMacValue(body, hashKey, hashIv) : 'INVALID';

  return vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
    new Response(new URLSearchParams(body).toString(), { status: 200 })
  );
}

describe('Order ECPay Payment API', () => {
  let adminToken;
  let userToken;
  let productId;
  let orderId;
  let totalAmount;
  let merchantTradeNo;

  beforeAll(async () => {
    adminToken = await getAdminToken();

    // Use a dedicated product so seed stock is not consumed
    const productRes = await request(app)
      .post('/api/admin/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: `綠界付款測試商品-${Date.now()}`, price: 100, stock: 5 });
    productId = productRes.body.data.id;

    const { token } = await registerUser();
    userToken = token;

    await request(app)
      .post('/api/cart')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ productId, quantity: 2 });

    const orderRes = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        recipientName: '付款測試',
        recipientEmail: 'pay-test@example.com',
        recipientAddress: '台北市測試路 1 號',
      });
    orderId = orderRes.body.data.id;
    totalAmount = orderRes.body.data.total_amount;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should reject verification before a payment is started', async () => {
    const res = await request(app)
      .post(`/api/orders/${orderId}/ecpay/verify`)
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('data', null);
    expect(res.body).toHaveProperty('error', 'INVALID_STATUS');
  });

  it('should return signed ECPay checkout params', async () => {
    const res = await request(app)
      .post(`/api/orders/${orderId}/ecpay`)
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('error', null);
    expect(res.body).toHaveProperty('message');
    expect(res.body.data.action).toMatch(/\/Cashier\/AioCheckOut\/V5$/);

    const { params } = res.body.data;
    const { hashKey, hashIv } = ecpay.getConfig();
    expect(params).toHaveProperty('TotalAmount', String(totalAmount));
    expect(params).toHaveProperty('ChoosePayment', 'Credit');
    expect(params.MerchantTradeNo).toMatch(/^[A-Za-z0-9]{1,20}$/);
    expect(ecpay.verifyCheckMacValue(params, hashKey, hashIv)).toBe(true);

    merchantTradeNo = params.MerchantTradeNo;
  });

  it('should require authentication and hide other users\' orders', async () => {
    const unauth = await request(app).post(`/api/orders/${orderId}/ecpay`);
    expect(unauth.status).toBe(401);

    const other = await registerUser();
    const res = await request(app)
      .post(`/api/orders/${orderId}/ecpay/verify`)
      .set('Authorization', `Bearer ${other.token}`);

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error', 'NOT_FOUND');
  });

  it('should redirect the ECPay browser return to the order page', async () => {
    const res = await request(app)
      .post('/api/ecpay/result')
      .type('form')
      .send({ MerchantTradeNo: merchantTradeNo, RtnCode: '1' });

    expect(res.status).toBe(303);
    expect(res.headers.location).toBe(`/orders/${orderId}`);

    const unknown = await request(app)
      .post('/api/ecpay/result')
      .type('form')
      .send({ MerchantTradeNo: 'UNKNOWN' });
    expect(unknown.status).toBe(303);
    expect(unknown.headers.location).toBe('/orders');

    // The browser return alone must never mark the order as paid
    const order = await request(app)
      .get(`/api/orders/${orderId}`)
      .set('Authorization', `Bearer ${userToken}`);
    expect(order.body.data).toHaveProperty('status', 'pending');
  });

  it('should answer the ECPay server notify with 1|OK', async () => {
    const res = await request(app).post('/api/ecpay/notify').type('form').send({ RtnCode: '1' });

    expect(res.status).toBe(200);
    expect(res.text).toBe('1|OK');
  });

  it('should keep the order pending when ECPay reports it as unpaid', async () => {
    const fetchSpy = mockQueryTradeInfo({ MerchantTradeNo: merchantTradeNo, TradeStatus: '0' });

    const res = await request(app)
      .post(`/api/orders/${orderId}/ecpay/verify`)
      .set('Authorization', `Bearer ${userToken}`);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toMatch(/\/Cashier\/QueryTradeInfo\/V5$/);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('error', null);
    expect(res.body.data).toHaveProperty('status', 'pending');
    expect(res.body.data).toHaveProperty('trade_status', '0');
  });

  it('should reject an ECPay response with an invalid CheckMacValue', async () => {
    mockQueryTradeInfo(
      { MerchantTradeNo: merchantTradeNo, TradeStatus: '1', TradeAmt: String(totalAmount) },
      { signed: false }
    );

    const res = await request(app)
      .post(`/api/orders/${orderId}/ecpay/verify`)
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(502);
    expect(res.body).toHaveProperty('data', null);
  });

  it('should reject a paid trade whose amount does not match the order', async () => {
    mockQueryTradeInfo({ MerchantTradeNo: merchantTradeNo, TradeStatus: '1', TradeAmt: String(totalAmount - 1) });

    const res = await request(app)
      .post(`/api/orders/${orderId}/ecpay/verify`)
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error', 'PAYMENT_MISMATCH');
  });

  it('should mark the order as paid when ECPay confirms the payment', async () => {
    mockQueryTradeInfo({
      MerchantTradeNo: merchantTradeNo,
      TradeStatus: '1',
      TradeAmt: String(totalAmount),
      TradeNo: '2610091234567890',
      PaymentType: 'Credit_CreditCard',
      PaymentDate: '2026/10/09 12:00:00',
    });

    const res = await request(app)
      .post(`/api/orders/${orderId}/ecpay/verify`)
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('error', null);
    expect(res.body.data).toHaveProperty('status', 'paid');
    expect(res.body.data).toHaveProperty('ecpay_trade_no', '2610091234567890');
    expect(res.body.data).toHaveProperty('payment_type', 'Credit_CreditCard');
    expect(res.body.data).toHaveProperty('paid_at', '2026/10/09 12:00:00');
    expect(Array.isArray(res.body.data.items)).toBe(true);
  });

  it('should be idempotent and not query ECPay again once paid', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const res = await request(app)
      .post(`/api/orders/${orderId}/ecpay/verify`)
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('status', 'paid');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('should not start a new payment for a paid order', async () => {
    const res = await request(app)
      .post(`/api/orders/${orderId}/ecpay`)
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error', 'INVALID_STATUS');
  });

  it('should no longer expose the simulated payment endpoint', async () => {
    const res = await request(app)
      .patch(`/api/orders/${orderId}/pay`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ action: 'success' });

    expect(res.status).toBe(404);
  });

  it('should allow deleting the product once the order is paid', async () => {
    const res = await request(app)
      .delete(`/api/admin/products/${productId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
  });
});
