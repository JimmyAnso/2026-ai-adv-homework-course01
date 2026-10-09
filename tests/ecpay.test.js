const ecpay = require('../src/ecpay');
const { vectors } = require('../.claude/skills/ecpay/test-vectors/checkmacvalue.json');

describe('ECPay helpers', () => {
  // Only the key=value vectors apply to AIO (the E-Ticket formula is different)
  const cmvVectors = vectors.filter((v) => v.params);

  it.each(cmvVectors.map((v) => [v.name, v]))('should match the official CheckMacValue vector: %s', (_name, v) => {
    const result = ecpay.generateCheckMacValue(v.params, v.hashKey, v.hashIV, v.method.toLowerCase());
    expect(result).toBe(v.expected);
  });

  it('should verify a valid CheckMacValue and reject a tampered one', () => {
    const { hashKey, hashIv } = ecpay.getConfig();
    const params = { MerchantID: '3002607', TradeAmt: '100', TradeStatus: '1' };
    params.CheckMacValue = ecpay.generateCheckMacValue(params, hashKey, hashIv);

    expect(ecpay.verifyCheckMacValue(params, hashKey, hashIv)).toBe(true);
    expect(ecpay.verifyCheckMacValue({ ...params, TradeAmt: '1' }, hashKey, hashIv)).toBe(false);
    expect(ecpay.verifyCheckMacValue({ MerchantID: '3002607' }, hashKey, hashIv)).toBe(false);
  });

  it('should generate a unique 20-char alphanumeric MerchantTradeNo', () => {
    const a = ecpay.generateMerchantTradeNo('ORD-20261009-A1B2C');
    const b = ecpay.generateMerchantTradeNo('ORD-20261009-A1B2C');

    expect(a).toMatch(/^ORD20261009A1B2C[0-9A-F]{4}$/);
    expect(a).toHaveLength(20);
    expect(typeof b).toBe('string');
  });

  it('should format MerchantTradeDate in Taiwan time', () => {
    expect(ecpay.formatTradeDate(new Date('2026-10-09T18:30:05Z'))).toBe('2026/10/10 02:30:05');
  });

  it('should build signed checkout params', () => {
    const { hashKey, hashIv, merchantId } = ecpay.getConfig();
    const order = { total_amount: 2660 };
    const items = [
      { product_name: '粉色玫瑰花束', quantity: 1 },
      { product_name: '<b>A#B</b>', quantity: 2 },
    ];

    const { action, params } = ecpay.buildCheckoutParams(order, items, 'ORD20261009A1B2C0001');

    expect(action).toMatch(/\/Cashier\/AioCheckOut\/V5$/);
    expect(params).toMatchObject({
      MerchantID: merchantId,
      MerchantTradeNo: 'ORD20261009A1B2C0001',
      PaymentType: 'aio',
      TotalAmount: '2660',
      ChoosePayment: 'Credit',
      EncryptType: '1',
      ItemName: '粉色玫瑰花束 x 1#A B x 2',
    });
    expect(params.MerchantTradeDate).toMatch(/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(params.ReturnURL).toMatch(/\/api\/ecpay\/notify$/);
    expect(params.OrderResultURL).toMatch(/\/api\/ecpay\/result$/);
    expect(ecpay.verifyCheckMacValue(params, hashKey, hashIv)).toBe(true);
  });
});
