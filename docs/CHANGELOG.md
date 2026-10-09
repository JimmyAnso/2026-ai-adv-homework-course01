# CHANGELOG — 更新日誌

格式參考 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.1.0/)。最新的紀錄放在最上面。

每筆紀錄使用以下分類（沒有內容的分類可省略）：

- **新增**：新功能
- **變更**：既有功能的行為改變
- **修正**：錯誤修正
- **移除**：移除的功能
- **文件**：僅文件異動

功能完成並歸檔計畫時（見 [DEVELOPMENT.md](./DEVELOPMENT.md#8-計畫歸檔流程)），在「未發布」區段新增條目；發布版本時再把該區段改為版本號與日期。

---

## [未發布]

### 新增

- 2026-10-09：**綠界 ECPay AIO 金流**（信用卡）。`POST /api/orders/:id/ecpay` 產生付款表單參數、`POST /api/orders/:id/ecpay/verify` 由伺服器主動呼叫綠界 `QueryTradeInfo` 驗證並更新訂單（本地端收不到 Server Notify）；`POST /api/ecpay/result` 處理瀏覽器導回、`POST /api/ecpay/notify` 回應 `1|OK`。新增 `src/ecpay.js`（CheckMacValue SHA256、付款參數、查詢）。
- `orders` 新增 `merchant_trade_no`、`ecpay_trade_no`、`payment_type`、`paid_at` 欄位，啟動時自動補到既有資料庫。
- 測試：`tests/ecpay.test.js`、`tests/orderPayment.test.js`（共 8 個檔案、56 個案例）。
- `openapi.json` 與 `.claude/skills/ecpay`（ECPay 整合用的 skill，以 gitlink 形式）納入版本控制。

### 變更

- 結帳成功後導向 `/orders/<id>?payment=start` 並自動前往綠界付款頁；訂單詳情頁改為「前往綠界付款」「查詢付款結果」，並顯示付款時間與綠界交易編號。
- `BASE_URL`、`ECPAY_*` 環境變數開始生效。
- 付款未成立的訂單維持 `pending`（可重新付款），不再出現 `failed`。

### 移除

- 模擬付款：`PATCH /api/orders/:id/pay` 與訂單詳情頁的「付款成功 / 付款失敗」按鈕。

### 文件

- 2026-10-09：更新各文件的金流說明；補充後台訂單頁在金流串接後的行為、`openapi.json` 需隨 API 異動提交、測試對 ECPay skill 目錄的依賴與尚未涵蓋的金流情境。計畫歸檔於 `docs/plans/archive/2026-10-09-ecpay-aio-payment.md`。
- 2026-10-09：建立專案文件結構——`CLAUDE.md`、`docs/README.md`、`ARCHITECTURE.md`、`DEVELOPMENT.md`、`FEATURES.md`、`TESTING.md`、`CHANGELOG.md`，以及 `docs/plans/` 與 `docs/plans/archive/` 目錄。

---

## [1.0.0] - 2026-04-07

專案初始版本（commit `004e507`）。

### 新增

- **基礎架構**：Express 4 應用程式（`app.js` / `server.js` 分離）、EJS 兩段式版型渲染、Tailwind CSS v4 建置流程、統一的 `{ data, error, message }` 回應格式、全域錯誤處理與 404 處理。
- **資料庫**：SQLite（better-sqlite3，WAL、外鍵啟用），五張資料表 `users`、`products`、`cart_items`、`orders`、`order_items`；啟動時自動建表並 seed 管理員帳號與 8 筆花卉商品。
- **會員認證**：註冊、登入、個人資料 API；JWT（HS256，7 天有效）；`authMiddleware`、`adminMiddleware`。
- **商品**：公開的商品列表（分頁）與詳情 API。
- **購物車**：查看、加入（同商品累加）、修改數量、移除；JWT / `X-Session-Id` 雙模式認證；庫存檢查。
- **訂單**：從購物車建立訂單（transaction 內建立訂單與明細快照、扣庫存、清空購物車）、訂單列表、訂單詳情。
- **付款**：模擬付款 API（`PATCH /api/orders/:id/pay`），將 pending 訂單標記為 paid 或 failed。
- **後台**：商品 CRUD API（存在 pending 訂單的商品不可刪除）、訂單列表（狀態篩選、分頁）與詳情 API。
- **前台頁面**：首頁、商品詳情、購物車、結帳、登入 / 註冊、我的訂單、訂單詳情、404（Vue 3 CDN）。
- **後台頁面**：商品管理、訂單管理。
- **API 文件**：所有 API 路由的 `@openapi` JSDoc，`npm run openapi` 產生 `openapi.json`。
- **測試**：Vitest + supertest 的 API 整合測試，6 個檔案共 32 個案例。

### 已知問題

- 訪客購物車在登入後不會合併到會員購物車。
- 運費（未滿 NT$ 500 收 NT$ 150）只在前端顯示，未計入訂單 `total_amount`。
- 前端 `apiFetch` 對所有 401 都會導向 `/login`，導致登入失敗時不顯示「Email 或密碼錯誤」。
- 刪除仍存在於任何購物車中的商品會因外鍵約束回傳 500。
- 付款失敗的訂單無法重新付款，且不會回補庫存。
- `.env.example` 中的 `ECPAY_*` 與 `BASE_URL` 尚未被任何程式使用。
- `vitest.config.js` 的 `sequence.files` 不是有效選項，測試檔執行順序實際上未被固定。
- 測試與開發共用同一個 `database.sqlite`。
