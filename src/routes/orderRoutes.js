const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../database');
const authMiddleware = require('../middleware/authMiddleware');
const ecpay = require('../ecpay');

const router = express.Router();

router.use(authMiddleware);

function generateOrderNo() {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
  const random = uuidv4().slice(0, 5).toUpperCase();
  return `ORD-${dateStr}-${random}`;
}

/**
 * @openapi
 * /api/orders:
 *   post:
 *     summary: 從購物車建立訂單
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [recipientName, recipientEmail, recipientAddress]
 *             properties:
 *               recipientName:
 *                 type: string
 *               recipientEmail:
 *                 type: string
 *                 format: email
 *               recipientAddress:
 *                 type: string
 *     responses:
 *       201:
 *         description: 訂單建立成功
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     order_no:
 *                       type: string
 *                     total_amount:
 *                       type: integer
 *                     status:
 *                       type: string
 *                     items:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           product_name:
 *                             type: string
 *                           product_price:
 *                             type: integer
 *                           quantity:
 *                             type: integer
 *                     created_at:
 *                       type: string
 *                 error:
 *                   type: string
 *                   nullable: true
 *                 message:
 *                   type: string
 *       400:
 *         description: 購物車為空或庫存不足或收件資訊缺失
 */
router.post('/', (req, res) => {
  const { recipientName, recipientEmail, recipientAddress } = req.body;
  const userId = req.user.userId;

  if (!recipientName || !recipientEmail || !recipientAddress) {
    return res.status(400).json({
      data: null,
      error: 'VALIDATION_ERROR',
      message: '收件人姓名、Email 和地址為必填欄位'
    });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(recipientEmail)) {
    return res.status(400).json({
      data: null,
      error: 'VALIDATION_ERROR',
      message: 'Email 格式不正確'
    });
  }

  // Get cart items with product info
  const cartItems = db.prepare(
    `SELECT ci.id, ci.product_id, ci.quantity,
            p.name as product_name, p.price as product_price, p.stock as product_stock
     FROM cart_items ci
     JOIN products p ON ci.product_id = p.id
     WHERE ci.user_id = ?`
  ).all(userId);

  if (cartItems.length === 0) {
    return res.status(400).json({
      data: null,
      error: 'CART_EMPTY',
      message: '購物車為空'
    });
  }

  // Check stock
  const insufficientItems = cartItems.filter(item => item.quantity > item.product_stock);
  if (insufficientItems.length > 0) {
    const names = insufficientItems.map(i => i.product_name).join(', ');
    return res.status(400).json({
      data: null,
      error: 'STOCK_INSUFFICIENT',
      message: `以下商品庫存不足：${names}`
    });
  }

  // Calculate total
  const totalAmount = cartItems.reduce(
    (sum, item) => sum + item.product_price * item.quantity, 0
  );

  const orderId = uuidv4();
  const orderNo = generateOrderNo();

  // Transaction: create order, order items, deduct stock, clear cart
  const createOrder = db.transaction(() => {
    db.prepare(
      `INSERT INTO orders (id, order_no, user_id, recipient_name, recipient_email, recipient_address, total_amount)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(orderId, orderNo, userId, recipientName, recipientEmail, recipientAddress, totalAmount);

    const insertItem = db.prepare(
      `INSERT INTO order_items (id, order_id, product_id, product_name, product_price, quantity)
       VALUES (?, ?, ?, ?, ?, ?)`
    );

    const updateStock = db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?');

    for (const item of cartItems) {
      insertItem.run(uuidv4(), orderId, item.product_id, item.product_name, item.product_price, item.quantity);
      updateStock.run(item.quantity, item.product_id);
    }

    db.prepare('DELETE FROM cart_items WHERE user_id = ?').run(userId);
  });

  createOrder();

  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  const orderItems = db.prepare(
    'SELECT product_name, product_price, quantity FROM order_items WHERE order_id = ?'
  ).all(orderId);

  res.status(201).json({
    data: {
      id: order.id,
      order_no: order.order_no,
      total_amount: order.total_amount,
      status: order.status,
      items: orderItems,
      created_at: order.created_at
    },
    error: null,
    message: '訂單建立成功'
  });
});

/**
 * @openapi
 * /api/orders:
 *   get:
 *     summary: 自己的訂單列表
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 成功
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     orders:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: string
 *                           order_no:
 *                             type: string
 *                           total_amount:
 *                             type: integer
 *                           status:
 *                             type: string
 *                           created_at:
 *                             type: string
 *                 error:
 *                   type: string
 *                   nullable: true
 *                 message:
 *                   type: string
 */
router.get('/', (req, res) => {
  const orders = db.prepare(
    'SELECT id, order_no, total_amount, status, created_at FROM orders WHERE user_id = ? ORDER BY created_at DESC'
  ).all(req.user.userId);

  res.json({
    data: { orders },
    error: null,
    message: '成功'
  });
});

/**
 * @openapi
 * /api/orders/{id}:
 *   get:
 *     summary: 訂單詳情
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: 成功
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     order_no:
 *                       type: string
 *                     recipient_name:
 *                       type: string
 *                     recipient_email:
 *                       type: string
 *                     recipient_address:
 *                       type: string
 *                     total_amount:
 *                       type: integer
 *                     status:
 *                       type: string
 *                     created_at:
 *                       type: string
 *                     items:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: string
 *                           product_id:
 *                             type: string
 *                           product_name:
 *                             type: string
 *                           product_price:
 *                             type: integer
 *                           quantity:
 *                             type: integer
 *                 error:
 *                   type: string
 *                   nullable: true
 *                 message:
 *                   type: string
 *       404:
 *         description: 訂單不存在
 */
router.get('/:id', (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(req.params.id, req.user.userId);

  if (!order) {
    return res.status(404).json({ data: null, error: 'NOT_FOUND', message: '訂單不存在' });
  }

  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);

  res.json({
    data: { ...order, items },
    error: null,
    message: '成功'
  });
});


const PAID_TRADE_STATUS = '1';

/**
 * Query ECPay for the order's latest payment attempt and mark the order as paid
 * when ECPay confirms it. Returns { order, tradeStatus, mismatch }.
 */
async function syncPaymentStatus(order) {
  const trade = await ecpay.queryTradeInfo(order.merchant_trade_no);
  const tradeStatus = trade.TradeStatus;

  if (trade.MerchantTradeNo !== order.merchant_trade_no) {
    return { order, tradeStatus, mismatch: true };
  }
  if (tradeStatus !== PAID_TRADE_STATUS) {
    return { order, tradeStatus, mismatch: false };
  }
  if (Number(trade.TradeAmt) !== order.total_amount) {
    return { order, tradeStatus, mismatch: true };
  }

  // Guard on status so repeated verifications stay idempotent
  db.prepare(
    `UPDATE orders SET status = 'paid', ecpay_trade_no = ?, payment_type = ?, paid_at = ?
     WHERE id = ? AND status = 'pending'`
  ).run(trade.TradeNo, trade.PaymentType, trade.PaymentDate, order.id);

  const updated = db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
  return { order: updated, tradeStatus, mismatch: false };
}

/**
 * @openapi
 * /api/orders/{id}/ecpay:
 *   post:
 *     summary: 產生綠界 ECPay 付款表單參數
 *     description: 回傳要以 form POST 送往綠界付款頁的網址與欄位（含 CheckMacValue）。每次呼叫都會產生新的 MerchantTradeNo。
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: 成功
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     action:
 *                       type: string
 *                       description: 綠界付款頁網址（form 的 action）
 *                     params:
 *                       type: object
 *                       description: 要送出的表單欄位
 *                       additionalProperties:
 *                         type: string
 *                 error:
 *                   type: string
 *                   nullable: true
 *                 message:
 *                   type: string
 *       400:
 *         description: 訂單狀態不是 pending（含查詢後發現已付款）
 *       404:
 *         description: 訂單不存在
 *       502:
 *         description: 無法向綠界確認前一次付款的結果
 */
router.post('/:id/ecpay', async (req, res, next) => {
  try {
    let order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(req.params.id, req.user.userId);
    if (!order) {
      return res.status(404).json({ data: null, error: 'NOT_FOUND', message: '訂單不存在' });
    }

    // A previous attempt may already be paid; confirm before starting a new one
    if (order.status === 'pending' && order.merchant_trade_no) {
      order = (await syncPaymentStatus(order)).order;
    }

    if (order.status !== 'pending') {
      return res.status(400).json({
        data: null,
        error: 'INVALID_STATUS',
        message: '訂單狀態不是 pending，無法付款'
      });
    }

    const merchantTradeNo = ecpay.generateMerchantTradeNo(order.order_no);
    db.prepare('UPDATE orders SET merchant_trade_no = ? WHERE id = ?').run(merchantTradeNo, order.id);

    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);

    res.json({
      data: ecpay.buildCheckoutParams(order, items, merchantTradeNo),
      error: null,
      message: '成功'
    });
  } catch (err) {
    next(err);
  }
});

/**
 * @openapi
 * /api/orders/{id}/ecpay/verify:
 *   post:
 *     summary: 向綠界查詢付款結果並更新訂單
 *     description: 伺服器主動呼叫綠界 QueryTradeInfo 驗證付款結果；確認已付款且金額相符時將訂單更新為 paid。
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: 查詢完成（訂單可能仍為 pending，請看 data.status）
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     order_no:
 *                       type: string
 *                     total_amount:
 *                       type: integer
 *                     status:
 *                       type: string
 *                     merchant_trade_no:
 *                       type: string
 *                       nullable: true
 *                     ecpay_trade_no:
 *                       type: string
 *                       nullable: true
 *                     payment_type:
 *                       type: string
 *                       nullable: true
 *                     paid_at:
 *                       type: string
 *                       nullable: true
 *                     created_at:
 *                       type: string
 *                     trade_status:
 *                       type: string
 *                       nullable: true
 *                       description: 綠界回傳的 TradeStatus（訂單原本就已付款時為 null）
 *                     items:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           product_name:
 *                             type: string
 *                           product_price:
 *                             type: integer
 *                           quantity:
 *                             type: integer
 *                 error:
 *                   type: string
 *                   nullable: true
 *                 message:
 *                   type: string
 *       400:
 *         description: 訂單尚未發起付款、狀態不可付款，或綠界回傳的交易與訂單不符
 *       404:
 *         description: 訂單不存在
 *       502:
 *         description: 無法連線至綠界或回應驗證失敗
 */
router.post('/:id/ecpay/verify', async (req, res, next) => {
  try {
    const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(req.params.id, req.user.userId);
    if (!order) {
      return res.status(404).json({ data: null, error: 'NOT_FOUND', message: '訂單不存在' });
    }

    const getItems = () => db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);

    if (order.status === 'paid') {
      return res.json({
        data: { ...order, items: getItems(), trade_status: null },
        error: null,
        message: '付款成功'
      });
    }

    if (order.status !== 'pending' || !order.merchant_trade_no) {
      return res.status(400).json({
        data: null,
        error: 'INVALID_STATUS',
        message: order.status === 'pending' ? '訂單尚未發起付款' : '訂單狀態不是 pending，無法付款'
      });
    }

    const result = await syncPaymentStatus(order);
    if (result.mismatch) {
      return res.status(400).json({
        data: null,
        error: 'PAYMENT_MISMATCH',
        message: '綠界回傳的交易資料與訂單不符'
      });
    }

    res.json({
      data: { ...result.order, items: getItems(), trade_status: result.tradeStatus },
      error: null,
      message: result.order.status === 'paid' ? '付款成功' : '尚未完成付款'
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
