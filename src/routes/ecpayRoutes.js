const express = require('express');
const db = require('../database');

const router = express.Router();

/**
 * @openapi
 * /api/ecpay/result:
 *   post:
 *     summary: 綠界付款完成後的瀏覽器導回（OrderResultURL）
 *     description: 由綠界付款頁以 form POST 將消費者導回。不採信內容、不更新訂單狀態，只導向訂單詳情頁，再由該頁呼叫 /api/orders/{id}/ecpay/verify 驗證。回應不是統一的 JSON 格式。
 *     tags: [Orders]
 *     requestBody:
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               MerchantTradeNo:
 *                 type: string
 *     responses:
 *       303:
 *         description: 導向 /orders/{id}；找不到對應訂單時導向 /orders
 */
router.post('/result', (req, res) => {
  const merchantTradeNo = req.body && req.body.MerchantTradeNo;
  const order = typeof merchantTradeNo === 'string'
    ? db.prepare('SELECT id FROM orders WHERE merchant_trade_no = ?').get(merchantTradeNo)
    : null;

  res.redirect(303, order ? `/orders/${order.id}` : '/orders');
});

/**
 * @openapi
 * /api/ecpay/notify:
 *   post:
 *     summary: 綠界付款結果通知（ReturnURL）
 *     description: 綠界要求必填的 Server 端通知網址。本專案僅於本地端執行、收不到此通知，付款結果改由 /api/orders/{id}/ecpay/verify 主動查詢，因此這裡只回應 1|OK、不更新訂單狀態。回應為純文字。
 *     tags: [Orders]
 *     responses:
 *       200:
 *         description: 純文字 1|OK
 *         content:
 *           text/plain:
 *             schema:
 *               type: string
 *               example: 1|OK
 */
router.post('/notify', (req, res) => {
  res.type('text/plain').send('1|OK');
});

module.exports = router;
