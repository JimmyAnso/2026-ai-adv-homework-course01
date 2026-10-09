# 綠界 ECPay AIO 金流串接（本地端主動查詢驗證）

## User Story

身為會員，我想要在結帳後透過綠界以信用卡付款，以便實際完成訂單付款，而不是手動標記付款結果。

身為開發者，專案只跑在 `localhost`、收不到綠界的 Server Notify（ReturnURL），我想要由本地端主動呼叫綠界查詢 API 驗證付款結果，以便在沒有公開網址的情況下仍能正確更新訂單狀態。

## Spec

規格來源：ECPay skill `guides/01-payment-aio.md`、`guides/13-checkmacvalue.md`，以及官方頁面 `developers.ecpay.com.tw/2862.md`（產生訂單）、`2890.md`（查詢訂單）、`2858.md`（介接注意事項），取得日期 2026-10-09。

### 流程

```
/checkout 送出 → POST /api/orders（不變）→ 導向 /orders/:id?payment=start
/orders/:id  → POST /api/orders/:id/ecpay         取得 { action, params }（含 CheckMacValue）
             → 前端動態建立 <form method=POST> 全頁跳轉到綠界付款頁（不可用 iframe）
綠界付款完成 → 瀏覽器 POST OrderResultURL = BASE_URL/api/ecpay/result
             → 伺服器不採信內容，只用 MerchantTradeNo 找到訂單 → 303 導向 /orders/:id
/orders/:id  → 訂單為 pending 且有 merchant_trade_no 時自動 POST /api/orders/:id/ecpay/verify
             → 伺服器呼叫 QueryTradeInfo/V5 → 驗 CheckMacValue、金額 → 更新為 paid
```

- 訂單狀態**只**由伺服器主動查詢 `QueryTradeInfo/V5` 並驗證後更新，不信任瀏覽器帶回的任何資料。
- `OrderResultURL` 是瀏覽器端導向，`http://localhost:3001` 可用；`ReturnURL` 為必填，填 `BASE_URL/api/ecpay/notify`（本地收不到，端點只回 `1|OK`、不改狀態）。兩者路徑不同（官方要求）。
- 付款方式：僅信用卡（`ChoosePayment=Credit`）。

### API

| 端點 | 認證 | 說明 |
| --- | --- | --- |
| `POST /api/orders/:id/ecpay` | JWT（限本人） | 產生綠界付款表單參數 `{ action, params }`。404 `NOT_FOUND`；非 pending → 400 `INVALID_STATUS`。已有前一次付款嘗試時先查詢一次，若已付款則直接結案並回 `INVALID_STATUS` |
| `POST /api/orders/:id/ecpay/verify` | JWT（限本人） | 主動查詢綠界並更新訂單。回應 `data`：訂單 + `items` + `trade_status`。已 paid 直接回傳（冪等）；無付款嘗試 → 400 `INVALID_STATUS`；金額不符 → 400 `PAYMENT_MISMATCH`；綠界連線 / 驗證失敗 → 502 |
| `POST /api/ecpay/result` | 無 | OrderResultURL：303 導向 `/orders/<id>`（查不到訂單導向 `/orders`），不更新狀態 |
| `POST /api/ecpay/notify` | 無 | ReturnURL：回純文字 `1|OK`，不更新狀態 |
| ~~`PATCH /api/orders/:id/pay`~~ | — | **移除**（模擬付款） |

`TradeStatus` 處理：`1` 且 `TradeAmt === total_amount` → `paid`；`0`（未付款 / 銀行處理中）或 `10200095`（交易未成立）→ 維持 `pending`，可重新付款。

`MerchantTradeNo`：`order_no` 去連字號（16 碼）＋ 4 碼隨機英數，共 20 碼；每次付款嘗試都重新產生（綠界不允許重複使用）。

### 資料庫

`orders` 新增欄位（皆 TEXT、可為 NULL）：`merchant_trade_no`、`ecpay_trade_no`、`payment_type`、`paid_at`。以 `PRAGMA table_info` 檢查後冪等 `ALTER TABLE ADD COLUMN`，既有資料庫不必重建。

### 前端

- `checkout.js`：建立訂單後導向 `/orders/<id>?payment=start`，訂單頁自動跳轉綠界。
- 訂單詳情頁：移除模擬付款按鈕；pending 時顯示「前往綠界付款」與「查詢付款結果」；載入時若 pending 且已有付款嘗試則自動查詢一次；paid 時顯示付款方式與付款時間。

### 邊界情況與不做的範圍

- 不做 ATM / 超商等離線付款、退款、發票。
- `failed` 狀態保留在 schema，但本次不會被寫入；庫存回補不在範圍內。
- 信用卡銀行回覆可能延遲，剛導回時查詢為未付款屬正常，可手動重查；查詢過於頻繁綠界會回 403。

## Tasks

- [x] `src/ecpay.js`：CheckMacValue、付款參數、QueryTradeInfo
- [x] `src/database.js`：`orders` 新增四個欄位（含冪等 ALTER）
- [x] `src/routes/orderRoutes.js`：新增 `/ecpay`、`/ecpay/verify`，移除 `/pay`
- [x] `src/routes/ecpayRoutes.js` 並掛載到 `app.js`
- [x] 前端：`checkout.js`、`order-detail.js`、`order-detail.ejs`
- [x] 撰寫 / 更新測試（`ecpay.test.js`、`orderPayment.test.js`）
- [x] 實際對綠界測試環境驗證簽章與查詢
- [x] 更新文件（FEATURES、ARCHITECTURE、DEVELOPMENT、TESTING、CHANGELOG、README、CLAUDE.md）與 `openapi.json`
