// ECPay AIO helpers (CheckMacValue SHA256, checkout params, QueryTradeInfo).
// Source: ECPay skill guides/13-checkmacvalue.md (Node.js) and
// web_fetch developers.ecpay.com.tw/2862.md, 2890.md, 2858.md (2026-10-09).
const crypto = require('crypto');

const HOSTS = {
  staging: 'https://payment-stage.ecpay.com.tw',
  production: 'https://payment.ecpay.com.tw'
};

const QUERY_TIMEOUT_MS = 10000;
// ECPay truncates ItemName at 400 chars, which breaks CheckMacValue
const ITEM_NAME_MAX_LENGTH = 200;

function getConfig() {
  const env = process.env.ECPAY_ENV === 'production' ? 'production' : 'staging';
  return {
    merchantId: process.env.ECPAY_MERCHANT_ID || '3002607',
    hashKey: process.env.ECPAY_HASH_KEY || 'pwFHCqoQZGmho4w6',
    hashIv: process.env.ECPAY_HASH_IV || 'EkRm7iFT261dpevs',
    host: HOSTS[env],
    baseUrl: (process.env.BASE_URL || 'http://localhost:3001').replace(/\/+$/, '')
  };
}

function ecpayUrlEncode(source) {
  // Match PHP urlencode: space -> +, and encode ~ and '
  let encoded = encodeURIComponent(source).replace(/%20/g, '+').replace(/~/g, '%7e').replace(/'/g, '%27');
  encoded = encoded.toLowerCase();
  // .NET-style replacements
  const replacements = {
    '%2d': '-', '%5f': '_', '%2e': '.', '%21': '!',
    '%2a': '*', '%28': '(', '%29': ')'
  };
  for (const [old, char] of Object.entries(replacements)) {
    encoded = encoded.split(old).join(char);
  }
  return encoded;
}

function generateCheckMacValue(params, hashKey, hashIv, method = 'sha256') {
  const keys = Object.keys(params)
    .filter(k => k !== 'CheckMacValue')
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  const paramStr = keys.map(k => `${k}=${params[k]}`).join('&');
  const raw = `HashKey=${hashKey}&${paramStr}&HashIV=${hashIv}`;
  return crypto.createHash(method).update(ecpayUrlEncode(raw), 'utf8').digest('hex').toUpperCase();
}

function verifyCheckMacValue(params, hashKey, hashIv, method = 'sha256') {
  const received = Buffer.from(String(params.CheckMacValue || ''));
  const calculated = Buffer.from(generateCheckMacValue(params, hashKey, hashIv, method));
  if (received.length !== calculated.length) return false;
  return crypto.timingSafeEqual(received, calculated);
}

/**
 * Build a MerchantTradeNo (20 alphanumeric chars) that is unique per payment attempt.
 */
function generateMerchantTradeNo(orderNo) {
  const base = orderNo.replace(/[^A-Za-z0-9]/g, '').slice(0, 16);
  const suffix = crypto.randomBytes(2).toString('hex').toUpperCase();
  return base + suffix;
}

// MerchantTradeDate must be Taiwan time (UTC+8), yyyy/MM/dd HH:mm:ss
function formatTradeDate(date) {
  const taipei = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return taipei.toISOString().slice(0, 19).replace('T', ' ').replace(/-/g, '/');
}

function buildItemName(items) {
  const name = items
    .map(item => `${item.product_name} x ${item.quantity}`.replace(/<[^>]*>/g, '').replace(/[\x00-\x1F#&<>]/g, ' '))
    .join('#');
  return name.length > ITEM_NAME_MAX_LENGTH ? name.slice(0, ITEM_NAME_MAX_LENGTH - 3) + '...' : name;
}

/**
 * Build the form target and fields for redirecting the browser to the ECPay payment page.
 */
function buildCheckoutParams(order, items, merchantTradeNo) {
  const config = getConfig();
  const params = {
    MerchantID: config.merchantId,
    MerchantTradeNo: merchantTradeNo,
    MerchantTradeDate: formatTradeDate(new Date()),
    PaymentType: 'aio',
    TotalAmount: String(order.total_amount),
    TradeDesc: 'Flower Life Order',
    ItemName: buildItemName(items),
    // Server notify cannot reach a local machine; payment is confirmed via queryTradeInfo instead
    ReturnURL: `${config.baseUrl}/api/ecpay/notify`,
    OrderResultURL: `${config.baseUrl}/api/ecpay/result`,
    ChoosePayment: 'Credit',
    EncryptType: '1'
  };
  params.CheckMacValue = generateCheckMacValue(params, config.hashKey, config.hashIv);

  return { action: `${config.host}/Cashier/AioCheckOut/V5`, params };
}

function gatewayError(message) {
  const err = new Error(message);
  err.status = 502;
  err.isOperational = true;
  return err;
}

/**
 * Query ECPay for the trade and return the verified response fields.
 */
async function queryTradeInfo(merchantTradeNo) {
  const config = getConfig();
  const params = {
    MerchantID: config.merchantId,
    MerchantTradeNo: merchantTradeNo,
    // Unix seconds; ECPay only accepts it within 3 minutes
    TimeStamp: String(Math.floor(Date.now() / 1000))
  };
  params.CheckMacValue = generateCheckMacValue(params, config.hashKey, config.hashIv);

  let text;
  try {
    const response = await fetch(`${config.host}/Cashier/QueryTradeInfo/V5`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
      signal: AbortSignal.timeout(QUERY_TIMEOUT_MS)
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    text = await response.text();
  } catch (err) {
    console.error('ECPay QueryTradeInfo failed:', err.message);
    throw gatewayError('無法連線至綠界查詢付款結果，請稍後再試');
  }

  const result = Object.fromEntries(new URLSearchParams(text));
  if (!verifyCheckMacValue(result, config.hashKey, config.hashIv)) {
    console.error('ECPay QueryTradeInfo returned an invalid CheckMacValue');
    throw gatewayError('綠界回應驗證失敗，請稍後再試');
  }
  return result;
}

module.exports = {
  getConfig,
  ecpayUrlEncode,
  generateCheckMacValue,
  verifyCheckMacValue,
  generateMerchantTradeNo,
  formatTradeDate,
  buildCheckoutParams,
  queryTradeInfo
};
