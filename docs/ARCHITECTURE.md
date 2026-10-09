# ARCHITECTURE — 架構、目錄結構、資料流

本專案是一個「單體式」花卉電商網站：同一個 Express 行程同時提供 **REST API**（`/api/*`）與 **伺服器端渲染的頁面外殼**（EJS），頁面內的互動則由瀏覽器端的 Vue 3（CDN 全域版）呼叫 API 完成。資料儲存於單一 SQLite 檔案。

```
瀏覽器
 ├─ GET /、/cart、/admin/products ...  ──►  pageRoutes ──► EJS（只輸出外殼，不含資料）
 │                                                          └─ 載入 Vue 3 CDN + /js/pages/<page>.js
 └─ fetch /api/*（apiFetch）            ──►  API routes ──► better-sqlite3（同步）──► database.sqlite
        Authorization: Bearer <JWT>
        X-Session-Id: <uuid>
```

---

## 1. 目錄結構

```
.
├── app.js                     # Express app 組裝：view engine、靜態檔、全域 middleware、掛載路由、404、錯誤處理。匯出 app（不 listen）
├── server.js                  # 行程進入點：檢查 JWT_SECRET 後 app.listen(PORT)。被 require 時不會 listen
├── swagger-config.js          # swagger-jsdoc 設定（OpenAPI 3.0.3、securitySchemes、掃描 src/routes/*.js）
├── generate-openapi.js        # 由路由檔的 @openapi JSDoc 產生 openapi.json（npm run openapi）
├── vitest.config.js           # Vitest 設定（globals、關閉檔案平行、hookTimeout）
├── package.json               # scripts 與相依套件
├── .env.example               # 環境變數範本（複製為 .env）
├── database.sqlite            # SQLite 資料庫檔（執行時自動建立，已被 .gitignore 忽略；另有 -shm / -wal）
│
├── src/
│   ├── ecpay.js               # 綠界 ECPay AIO：CheckMacValue、付款表單參數、QueryTradeInfo 查詢
│   ├── database.js            # 開啟 DB、設定 PRAGMA、建表（IF NOT EXISTS）、seed 管理員與 8 筆商品。匯出 db 單例
│   ├── middleware/
│   │   ├── authMiddleware.js      # 驗證 Bearer JWT → 設定 req.user；失敗回 401
│   │   ├── adminMiddleware.js     # 檢查 req.user.role === 'admin'；否則回 403（必須接在 authMiddleware 之後）
│   │   ├── sessionMiddleware.js   # 讀取 X-Session-Id header → 設定 req.sessionId（全域掛載，永不擋請求）
│   │   └── errorHandler.js        # 全域錯誤處理：統一回傳 JSON，隱藏內部錯誤訊息
│   └── routes/
│       ├── authRoutes.js          # /api/auth：註冊、登入、個人資料
│       ├── productRoutes.js       # /api/products：公開的商品列表與詳情
│       ├── cartRoutes.js          # /api/cart：購物車 CRUD，內含 dualAuth（JWT 或 Session 雙模式認證）
│       ├── orderRoutes.js         # /api/orders：建立訂單（transaction）、列表、詳情、綠界付款參數與付款結果查詢
│       ├── ecpayRoutes.js         # /api/ecpay：綠界的瀏覽器導回（OrderResultURL）與通知（ReturnURL）
│       ├── adminProductRoutes.js  # /api/admin/products：後台商品 CRUD
│       ├── adminOrderRoutes.js    # /api/admin/orders：後台訂單列表（可依狀態篩選）與詳情
│       └── pageRoutes.js          # 頁面路由：renderFront / renderAdmin 兩段式渲染 EJS
│
├── views/
│   ├── layouts/
│   │   ├── front.ejs          # 前台版型：head + header + <main> + footer + toast，載入共用 JS 與頁面 JS
│   │   └── admin.ejs          # 後台版型：admin-header + sidebar，內嵌 Auth.requireAdmin() 守衛
│   ├── partials/
│   │   ├── head.ejs           # <head>：title、Google Fonts、/css/output.css
│   │   ├── header.ejs         # 前台導覽列（#cart-badge、#orders-link、#auth-nav 由 header-init.js 動態填入）
│   │   ├── admin-header.ejs   # 後台頂欄（#admin-username、登出）
│   │   ├── admin-sidebar.ejs  # 後台側欄，依 currentPath 標示目前頁面
│   │   ├── footer.ejs         # 頁尾
│   │   └── notification.ejs   # Toast 容器 #notification-toast
│   └── pages/
│       ├── index.ejs          # 首頁：Hero、精選商品、商品列表（分頁）
│       ├── product-detail.ejs # 商品詳情（data-product-id）
│       ├── cart.ejs           # 購物車（含免運門檻提示）
│       ├── checkout.ejs       # 結帳表單
│       ├── login.ejs          # 登入 / 註冊分頁
│       ├── orders.ejs         # 我的訂單
│       ├── order-detail.ejs   # 訂單詳情 + 綠界付款 / 查詢付款結果按鈕（data-order-id、data-payment-result）
│       ├── 404.ejs            # 找不到頁面
│       └── admin/
│           ├── products.ejs   # 後台商品管理（列表、新增/編輯 Modal、刪除確認）
│           └── orders.ejs     # 後台訂單管理（狀態篩選、詳情 Modal）
│
├── public/                    # express.static 根目錄
│   ├── css/
│   │   ├── input.css          # Tailwind v4 進入點 + @theme 自訂色票
│   │   └── output.css         # 建置產物（被 .gitignore 忽略，必須先 build 才有樣式）
│   ├── stylesheets/style.css  # express-generator 遺留檔，未被任何頁面引用
│   └── js/
│       ├── auth.js            # 全域 Auth 物件：localStorage 的 token / user / session id 管理、頁面守衛
│       ├── api.js             # 全域 apiFetch()：自動帶認證 header、401 自動登出並導向 /login
│       ├── notification.js    # 全域 Notification.show() Toast
│       ├── header-init.js     # 前台導覽列初始化（登入狀態、購物車徽章）
│       └── pages/             # 每個頁面一支 Vue app（檔名 = pageRoutes 的 pageScript）
│           ├── index.js / product-detail.js / cart.js / checkout.js
│           ├── login.js / orders.js / order-detail.js
│           └── admin-products.js / admin-orders.js
│
├── tests/
│   ├── setup.js               # 測試輔助：匯出 app、request、getAdminToken、registerUser
│   └── *.test.js              # 8 個測試檔（見 TESTING.md）
│
└── docs/                      # 專案文件與開發計畫
```

---

## 2. 啟動流程

`npm start` → `npm run css:build`（產生 `public/css/output.css`）→ `node server.js`

1. `server.js` `require('./app')`。
2. `app.js` 第一行 `require('dotenv').config()` 載入 `.env`。
3. `require('./src/database')` —— **模組載入時就立即執行** `initializeDatabase()`：
   - 開啟（或建立）專案根目錄的 `database.sqlite`
   - `PRAGMA journal_mode = WAL`、`PRAGMA foreign_keys = ON`
   - `CREATE TABLE IF NOT EXISTS` 五張表
   - 以 `PRAGMA table_info(orders)` 檢查，缺少付款欄位時 `ALTER TABLE ADD COLUMN`（冪等）
   - `seedAdminUser()`：若 `ADMIN_EMAIL` 對應的使用者不存在才建立（bcrypt，`NODE_ENV === 'test'` 時 salt rounds = 1，否則 10）
   - `seedProducts()`：**僅在 products 表為空時**寫入 8 筆花卉商品
4. 設定 view engine（EJS）、靜態檔（`public/`）。
5. 全域 middleware，依序：`cors` → `express.json()` → `express.urlencoded({ extended: false })` → `sessionMiddleware`。
6. 掛載 API 路由（見下表），再掛載 `pageRoutes`（`/`）。
7. 404 handler：路徑以 `/api` 開頭回 JSON，否則渲染 `pages/404` 套入前台版型。
8. `errorHandler`（最後）。
9. 回到 `server.js`：`require.main === module` 時才檢查 `JWT_SECRET`（未設定則 `process.exit(1)`）並 `listen`。

> **重要**：`JWT_SECRET` 的檢查只存在於 `server.js` 的直接執行路徑。測試是 `require('../app')`，**不會經過這個檢查**；若測試環境沒有 `.env`，`jwt.sign` 會拋錯並變成 500。

> **重要**：`app.js` 與 `server.js` 分離是為了讓 supertest 能直接載入 `app` 而不佔用 port。新增全域設定請寫在 `app.js`。

---

## 3. API 路由總覽

| 前綴 | 檔案 | 認證 | 說明 |
| --- | --- | --- | --- |
| `/api/auth` | `src/routes/authRoutes.js` | `register`、`login` 公開；`profile` 需 JWT | 註冊、登入、取得個人資料 |
| `/api/products` | `src/routes/productRoutes.js` | 公開 | 商品列表（分頁）、商品詳情 |
| `/api/cart` | `src/routes/cartRoutes.js` | `dualAuth`：JWT **或** `X-Session-Id` | 購物車查詢、加入、改數量、移除 |
| `/api/orders` | `src/routes/orderRoutes.js` | JWT（`router.use(authMiddleware)`） | 建立訂單、我的訂單、詳情、綠界付款參數、付款結果查詢 |
| `/api/ecpay` | `src/routes/ecpayRoutes.js` | 無（由綠界 / 瀏覽器導轉呼叫） | 付款完成導回、付款通知 |
| `/api/admin/products` | `src/routes/adminProductRoutes.js` | JWT + admin（`router.use(authMiddleware, adminMiddleware)`） | 後台商品 CRUD |
| `/api/admin/orders` | `src/routes/adminOrderRoutes.js` | JWT + admin | 後台訂單列表、詳情 |
| `/` | `src/routes/pageRoutes.js` | 無（伺服器端不驗證） | EJS 頁面 |

### 端點清單

| Method | Path | 認證 | 成功狀態碼 |
| --- | --- | --- | --- |
| POST | `/api/auth/register` | 無 | 201 |
| POST | `/api/auth/login` | 無 | 200 |
| GET | `/api/auth/profile` | JWT | 200 |
| GET | `/api/products` | 無 | 200 |
| GET | `/api/products/:id` | 無 | 200 |
| GET | `/api/cart` | JWT 或 Session | 200 |
| POST | `/api/cart` | JWT 或 Session | 200（不是 201） |
| PATCH | `/api/cart/:itemId` | JWT 或 Session | 200 |
| DELETE | `/api/cart/:itemId` | JWT 或 Session | 200 |
| POST | `/api/orders` | JWT | 201 |
| GET | `/api/orders` | JWT | 200 |
| GET | `/api/orders/:id` | JWT | 200 |
| POST | `/api/orders/:id/ecpay` | JWT | 200 |
| POST | `/api/orders/:id/ecpay/verify` | JWT | 200 |
| POST | `/api/ecpay/result` | 無 | 303（導向，非 JSON） |
| POST | `/api/ecpay/notify` | 無 | 200（純文字 `1|OK`） |
| GET | `/api/admin/products` | JWT + admin | 200 |
| POST | `/api/admin/products` | JWT + admin | 201 |
| PUT | `/api/admin/products/:id` | JWT + admin | 200 |
| DELETE | `/api/admin/products/:id` | JWT + admin | 200 |
| GET | `/api/admin/orders` | JWT + admin | 200 |
| GET | `/api/admin/orders/:id` | JWT + admin | 200 |

### 頁面路由

| Path | 模板 | 版型 | `pageScript` | 額外 locals | 前端守衛 |
| --- | --- | --- | --- | --- | --- |
| `/` | `pages/index` | front | `index` | — | 無 |
| `/products/:id` | `pages/product-detail` | front | `product-detail` | `productId` | 無 |
| `/cart` | `pages/cart` | front | `cart` | — | 無（訪客可用） |
| `/checkout` | `pages/checkout` | front | `checkout` | — | `Auth.requireAuth()` |
| `/login` | `pages/login` | front | `login` | — | 無 |
| `/orders` | `pages/orders` | front | `orders` | — | `Auth.requireAuth()` |
| `/orders/:id` | `pages/order-detail` | front | `order-detail` | `orderId`、`paymentResult`（來自 `?payment=`；`start` 表示載入後自動前往綠界付款，見第 8.1 節） | `Auth.requireAuth()` |
| `/admin/products` | `pages/admin/products` | admin | `admin-products` | `currentPath` | `Auth.requireAdmin()` |
| `/admin/orders` | `pages/admin/orders` | admin | `admin-orders` | `currentPath` | `Auth.requireAdmin()` |

> **重要**：頁面路由在伺服器端**完全不做認證**，任何人都能取得 `/admin/*` 的 HTML 外殼。保護來自兩處：(1) 瀏覽器端 `Auth.requireAuth()` / `Auth.requireAdmin()` 只檢查 localStorage 後導向 `/login`；(2) 真正的資料都要經 `/api/admin/*`，由 `authMiddleware + adminMiddleware` 把關。**不要把任何敏感資料直接渲染進 EJS。**

---

## 4. 統一回應格式

所有 API（含 404 與錯誤處理）都回傳相同的三欄位外層結構（唯一例外是給綠界使用的 `/api/ecpay/result` 與 `/api/ecpay/notify`，見第 8 節）：

```jsonc
// 成功
{
  "data": { "...": "..." },   // 物件；刪除類操作為 null
  "error": null,
  "message": "成功"            // 給使用者看的中文訊息
}

// 失敗
{
  "data": null,
  "error": "VALIDATION_ERROR",   // 機器可讀的錯誤碼（大寫蛇形）
  "message": "email、password、name 為必填欄位"
}
```

分頁列表的 `data` 固定帶有 `pagination`：

```json
{
  "data": {
    "products": [],
    "pagination": { "total": 8, "page": 1, "limit": 10, "totalPages": 1 }
  },
  "error": null,
  "message": "成功"
}
```

### 錯誤碼總表

| `error` | HTTP | 來源 | 情境 |
| --- | --- | --- | --- |
| `VALIDATION_ERROR` | 400 | 各路由 | 必填欄位缺失、格式錯誤、數值不合法 |
| `CART_EMPTY` | 400 | `POST /api/orders` | 購物車沒有任何項目 |
| `STOCK_INSUFFICIENT` | 400 | 購物車、建立訂單 | 數量超過庫存 |
| `INVALID_STATUS` | 400 | `POST /api/orders/:id/ecpay`、`/ecpay/verify` | 訂單不是 `pending`，或尚未發起付款就查詢 |
| `PAYMENT_MISMATCH` | 400 | `POST /api/orders/:id/ecpay/verify` | 綠界回傳的交易編號或金額與訂單不符 |
| `UNAUTHORIZED` | 401 | `authMiddleware`、`dualAuth`、登入 | 未帶 / 無效 / 過期 token、帳密錯誤、使用者已不存在 |
| `FORBIDDEN` | 403 | `adminMiddleware` | 非管理員 |
| `NOT_FOUND` | 404 | 各路由、`app.js` 404 handler | 資源不存在、未知 `/api` 路徑 |
| `CONFLICT` | 409 | 註冊、刪除商品 | Email 已註冊；商品存在於 pending 訂單 |
| `INTERNAL_ERROR` | 依 `err.status`，預設 500 | `errorHandler` | 任何未被路由自行處理、拋到 Express 的錯誤。連不上綠界或綠界回應的 CheckMacValue 驗證失敗時為 502 |

> **注意**：`errorHandler` 不論狀態碼為何，`error` 一律是 `INTERNAL_ERROR`。例如送出格式錯誤的 JSON body，`express.json()` 會拋出 status 400 的錯誤，回應為 `400 { error: "INTERNAL_ERROR", message: "請求格式錯誤" }`。前端若要判斷錯誤類型，請同時看 HTTP 狀態碼。
>
> `errorHandler` 的訊息規則：500 一律回「伺服器內部錯誤」；其他狀態碼若 `err.isOperational === true` 才回 `err.message`，否則回 `SAFE_MESSAGES[statusCode]`（400/401/403/404/409/422/429 各有固定字串），再不然回「請求處理失敗」。目的是避免洩漏 SQL 錯誤等內部細節。

---

## 5. 認證與授權機制

### 5.1 JWT 參數

| 項目 | 值 |
| --- | --- |
| 套件 | `jsonwebtoken` |
| 簽章演算法 | HS256（`sign` 預設；`verify` 明確限定 `algorithms: ['HS256']`） |
| 密鑰 | `process.env.JWT_SECRET` |
| 有效期 | `7d` |
| Payload | `{ userId, email, role }`（外加 `iat`、`exp`） |
| 傳遞方式 | `Authorization: Bearer <token>` |
| 簽發時機 | 註冊成功、登入成功（兩處程式碼各自呼叫 `jwt.sign`） |
| Refresh / 登出 | 無。沒有 refresh token，也沒有伺服器端黑名單；登出只是前端清除 localStorage |

### 5.2 Middleware 行為

**`authMiddleware`**（`src/middleware/authMiddleware.js`）

1. 沒有 `Authorization` header 或不以 `Bearer ` 開頭 → `401 UNAUTHORIZED「請先登入」`
2. `jwt.verify` 失敗（簽章錯、過期、格式錯）→ `401 UNAUTHORIZED「Token 無效或已過期」`
3. 驗證通過後**會查一次資料庫**確認 `decoded.userId` 仍存在；不存在 → `401 UNAUTHORIZED「使用者不存在，請重新登入」`
4. 設定 `req.user = { userId, email, role }` → `next()`

> **注意**：`req.user` 的欄位名稱是 **`userId`**（不是 `id`），且 `email`、`role` 來自 **token payload 而非資料庫**。若日後加入「變更角色」功能，舊 token 在過期前仍保有舊角色。

**`adminMiddleware`**（`src/middleware/adminMiddleware.js`）

- `!req.user || req.user.role !== 'admin'` → `403 FORBIDDEN「權限不足」`
- 自己不驗證 token，**必須排在 `authMiddleware` 之後**。

**`sessionMiddleware`**（`src/middleware/sessionMiddleware.js`，全域）

- 若有 `X-Session-Id` header 就設定 `req.sessionId`，沒有也直接 `next()`。不驗證格式、不產生 id、不設 cookie。Session id 完全由前端 `crypto.randomUUID()` 產生並存在 localStorage。

**`dualAuth`**（定義在 `src/routes/cartRoutes.js` 內，僅購物車使用）

```
有 Authorization: Bearer ?
 ├─ 是 → 驗證 JWT
 │        ├─ 成功且使用者存在 → req.user 設定 → 以 user_id 操作購物車
 │        └─ 失敗 → 401（不會退回使用 session，即使同時帶了 X-Session-Id）
 └─ 否 → 有 req.sessionId ?
          ├─ 是 → 以 session_id 操作購物車（訪客模式）
          └─ 否 → 401「請提供有效的登入 Token 或 X-Session-Id」
```

`getOwnerCondition(req)` 回傳 `{ field: 'user_id' | 'session_id', value }`，所有購物車 SQL 都以此組出擁有者條件。`field` 只會是這兩個寫死的字串，因此以樣板字串插入 SQL 是安全的；**值一律走 `?` 參數綁定**。

### 5.3 前端認證狀態（`public/js/auth.js`）

| localStorage key | 內容 |
| --- | --- |
| `flower_token` | JWT 字串 |
| `flower_user` | `{ id, email, name, role }` 的 JSON |
| `flower_session_id` | 訪客 session id（`crypto.randomUUID()`，首次呼叫 `getSessionId()` 時產生，登出後**不會**清除） |

`Auth.getAuthHeaders()` **永遠**帶上 `X-Session-Id`，有 token 時再加 `Authorization`。`apiFetch()` 會自動合併這些 header 與 `Content-Type: application/json`。

`apiFetch()` 收到 **任何 401** 都會清除 `flower_token` / `flower_user` 並導向 `/login`，然後回傳 `undefined`（不拋錯）。非 2xx 的其他狀態則 `throw { status, data }`。

---

## 6. 資料庫 Schema

SQLite（`better-sqlite3`，同步 API）。檔案：專案根目錄 `database.sqlite`。`journal_mode = WAL`、`foreign_keys = ON`。所有主鍵都是應用層以 `uuid` v4 產生的 TEXT。時間欄位為 `datetime('now')`，即 **UTC、格式 `YYYY-MM-DD HH:MM:SS`、不帶時區標記**。金額皆為整數（新台幣元）。

### users

| 欄位 | 型別 | 約束 |
| --- | --- | --- |
| `id` | TEXT | PRIMARY KEY |
| `email` | TEXT | UNIQUE NOT NULL |
| `password_hash` | TEXT | NOT NULL（bcrypt） |
| `name` | TEXT | NOT NULL |
| `role` | TEXT | NOT NULL DEFAULT `'user'`，CHECK IN (`'user'`, `'admin'`) |
| `created_at` | TEXT | NOT NULL DEFAULT `datetime('now')` |

### products

| 欄位 | 型別 | 約束 |
| --- | --- | --- |
| `id` | TEXT | PRIMARY KEY |
| `name` | TEXT | NOT NULL |
| `description` | TEXT | 可為 NULL |
| `price` | INTEGER | NOT NULL，CHECK `price > 0` |
| `stock` | INTEGER | NOT NULL DEFAULT 0，CHECK `stock >= 0` |
| `image_url` | TEXT | 可為 NULL |
| `created_at` | TEXT | NOT NULL DEFAULT `datetime('now')` |
| `updated_at` | TEXT | NOT NULL DEFAULT `datetime('now')`（沒有 trigger，需由 UPDATE 語句手動設定） |

### cart_items

| 欄位 | 型別 | 約束 |
| --- | --- | --- |
| `id` | TEXT | PRIMARY KEY |
| `session_id` | TEXT | 可為 NULL（訪客購物車） |
| `user_id` | TEXT | 可為 NULL，FK → `users(id)`（會員購物車） |
| `product_id` | TEXT | NOT NULL，FK → `products(id)` |
| `quantity` | INTEGER | NOT NULL DEFAULT 1，CHECK `quantity > 0` |

`session_id` 與 `user_id` 二擇一填入（由應用層保證，資料庫沒有 CHECK）。沒有 `(owner, product_id)` 的 UNIQUE 約束，「同商品只有一列」是由 `POST /api/cart` 的「先查再累加」邏輯維持。

### orders

| 欄位 | 型別 | 約束 |
| --- | --- | --- |
| `id` | TEXT | PRIMARY KEY |
| `order_no` | TEXT | UNIQUE NOT NULL（格式 `ORD-YYYYMMDD-XXXXX`） |
| `user_id` | TEXT | NOT NULL，FK → `users(id)` |
| `recipient_name` | TEXT | NOT NULL |
| `recipient_email` | TEXT | NOT NULL |
| `recipient_address` | TEXT | NOT NULL |
| `total_amount` | INTEGER | NOT NULL（商品小計總和，**不含運費**） |
| `status` | TEXT | NOT NULL DEFAULT `'pending'`，CHECK IN (`'pending'`, `'paid'`, `'failed'`) |
| `merchant_trade_no` | TEXT | 可為 NULL。最近一次送往綠界的 MerchantTradeNo（每次付款嘗試重新產生） |
| `ecpay_trade_no` | TEXT | 可為 NULL。付款成功後綠界的交易編號（TradeNo） |
| `payment_type` | TEXT | 可為 NULL。綠界回傳的付款方式，例如 `Credit_CreditCard` |
| `paid_at` | TEXT | 可為 NULL。綠界回傳的付款時間，**台灣時間**、格式 `yyyy/MM/dd HH:mm:ss`（與其他 UTC 時間欄位不同） |
| `created_at` | TEXT | NOT NULL DEFAULT `datetime('now')` |

### order_items

| 欄位 | 型別 | 約束 |
| --- | --- | --- |
| `id` | TEXT | PRIMARY KEY |
| `order_id` | TEXT | NOT NULL，FK → `orders(id)` |
| `product_id` | TEXT | NOT NULL（**刻意沒有 FK**） |
| `product_name` | TEXT | NOT NULL（下單當下的快照） |
| `product_price` | INTEGER | NOT NULL（下單當下的快照） |
| `quantity` | INTEGER | NOT NULL |

### 關聯與設計決策

```
users 1 ──< cart_items >── 1 products
users 1 ──< orders 1 ──< order_items ··(無 FK，僅存 id)·· products
```

- **訂單明細是快照**：`order_items` 複製了商品名稱與單價，且 `product_id` 沒有外鍵。因此商品日後改價、改名、甚至被刪除，都不影響歷史訂單的顯示。
- **所有外鍵都沒有 `ON DELETE` 子句**（預設 RESTRICT），且 `foreign_keys = ON`。後果：被任何 `cart_items` 參考的商品**無法刪除**——`DELETE FROM products` 會拋出 `SQLITE_CONSTRAINT_FOREIGNKEY`，目前 `DELETE /api/admin/products/:id` 沒有處理這個情況，會落到 `errorHandler` 回 500。
- **沒有 migration 機制**：建表只有 `CREATE TABLE IF NOT EXISTS`。修改既有表的欄位或約束不會套用到已存在的 `database.sqlite`，必須手動 `ALTER TABLE` 或刪除資料庫檔重建（見 DEVELOPMENT.md）。
- **沒有索引**（除了 PRIMARY KEY / UNIQUE 自動建立的）。
- **開發與測試共用同一個資料庫檔**，沒有隔離（見 TESTING.md）。

### Seed 資料

- 管理員：`ADMIN_EMAIL` / `ADMIN_PASSWORD`（預設 `admin@hexschool.com` / `12345678`），`name = 'Admin'`、`role = 'admin'`。以 email 判斷是否已存在。
- 商品：8 筆花卉商品（價格 580–3980，庫存 15–100，圖片為 Unsplash URL），在單一 transaction 中寫入。8 筆的 `created_at` 相同（同一秒），因此 `ORDER BY created_at DESC` 對它們的相對順序沒有保證。

---

## 7. 核心資料流

### 7.1 訪客加入購物車 → 登入 → 結帳 → 付款

```
1. 訪客在首頁按「加入購物車」
   POST /api/cart  { productId, quantity: 1 }   headers: X-Session-Id
   → cart_items 寫入一列（session_id = <sid>, user_id = NULL）

2. 訪客到 /cart → 按「前往結帳」
   未登入 → 導向 /login?redirect=/checkout

3. 登入成功 → Auth.login() 寫入 localStorage → 導向 /checkout

4. /checkout 載入時 GET /api/cart   headers: Authorization + X-Session-Id
   → dualAuth 優先使用 JWT → 以 user_id 查詢
   → ⚠ 訪客時期（session_id）加入的項目「不會」出現（見下方限制）
   → 若購物車為空，前端導回 /cart

5. 送出結帳表單
   POST /api/orders  { recipientName, recipientEmail, recipientAddress }
   → 單一 transaction：建立 orders → 逐項建立 order_items + 扣庫存 → 清空該使用者 cart_items
   → 201，前端導向 /orders/<id>?payment=start

6. 訂單詳情頁自動（或按「前往綠界付款」）
   POST /api/orders/<id>/ecpay → { action, params }
   → 前端以隱藏表單全頁 POST 到綠界付款頁，使用者刷卡

7. 綠界把瀏覽器導回 POST /api/ecpay/result → 303 → /orders/<id>
   訂單詳情頁自動 POST /api/orders/<id>/ecpay/verify
   → 伺服器呼叫綠界 QueryTradeInfo 驗證 → status: pending → paid
```

> **已知限制：訪客購物車不會合併到會員購物車。** 專案中沒有任何把 `session_id` 項目轉移到 `user_id` 的程式碼。由於前端在登入後同時送出兩種 header、而 `dualAuth` 以 JWT 優先，登入後就看不到登入前加入的商品（那些列仍留在資料庫，登出後又會再出現）。這是整合購物車相關功能時最容易踩到的坑。

### 7.2 EJS 兩段式渲染

`pageRoutes.js` 沒有使用 layout 套件，而是手動渲染兩次：

```js
res.render('pages/' + page, locals, (err, body) => {   // 第一段：頁面內容 → HTML 字串
  res.render('layouts/front', { body, ...locals });     // 第二段：把 body 塞進版型
});
```

版型以 `<%- body %>` 輸出內容，並依 `pageScript` 載入 `/js/pages/<pageScript>.js`。Script 載入順序固定為：
`Vue 3 CDN` → `auth.js` → `api.js` → `notification.js` → `header-init.js`（僅前台）→ 頁面 script。
後面的檔案依賴前面宣告的全域變數（`Vue`、`Auth`、`apiFetch`、`Notification`）。

伺服器傳值給頁面 Vue app 的方式是 **`#app` 元素上的 `data-*` 屬性**（例如 `data-product-id`、`data-order-id`、`data-payment-result`），頁面 script 再以 `el.dataset` 讀取。EJS 用 `<%= %>` 輸出（會跳脫），Vue 用 `{{ }}`，兩者語法不衝突。

---

## 8. 金流 / 第三方整合

### 8.1 付款：綠界 ECPay AIO（信用卡），以主動查詢確認結果

實作集中在 `src/ecpay.js`，協議為 CheckMacValue SHA256（form-urlencoded），不使用任何 ECPay SDK 套件。

| 項目 | 值 |
| --- | --- |
| 環境 | `ECPAY_ENV=production` 用 `payment.ecpay.com.tw`，其餘（預設 `staging`）用 `payment-stage.ecpay.com.tw` |
| 建立付款 | 瀏覽器 form POST `/Cashier/AioCheckOut/V5`（`ChoosePayment=Credit`） |
| 查詢付款 | 伺服器 POST `/Cashier/QueryTradeInfo/V5`（Node 內建 `fetch`，10 秒逾時） |
| `MerchantTradeNo` | `order_no` 去連字號（16 碼）＋ 4 碼隨機 16 進位，共 20 碼；每次付款嘗試重新產生並存入 `orders.merchant_trade_no` |
| `ReturnURL` | `BASE_URL/api/ecpay/notify` |
| `OrderResultURL` | `BASE_URL/api/ecpay/result` |

**為什麼用主動查詢**：專案只在本地端執行，綠界的 Server Notify（ReturnURL，僅支援 80 / 443 的公開網址）打不進來。因此訂單狀態**只**在伺服器呼叫 `QueryTradeInfo` 並通過驗證後才更新：

```
訂單詳情頁（status = pending）
  ├─「前往綠界付款」→ POST /api/orders/:id/ecpay → { action, params } → 表單 POST 到綠界
  │        綠界付款完成 → 瀏覽器 POST /api/ecpay/result → 303 → /orders/:id
  └─ 載入時自動 /「查詢付款結果」→ POST /api/orders/:id/ecpay/verify
           → QueryTradeInfo → 驗 CheckMacValue → MerchantTradeNo 相符 → TradeStatus
```

| 綠界 `TradeStatus` | 處理 |
| --- | --- |
| `1` 且 `TradeAmt === total_amount` | `status = paid`，寫入 `ecpay_trade_no`、`payment_type`、`paid_at` |
| `1` 但金額不符，或 `MerchantTradeNo` 不符 | 不更新，回 `400 PAYMENT_MISMATCH` |
| `0`（未付款 / 銀行尚未回覆）、`10200095`（交易未成立）、`10200047`（綠界查無此單，使用者沒走到付款頁） | 維持 `pending`，可再次付款或稍後重查 |

狀態機：

```
pending ──綠界確認已付款──► paid   （終態）
```

`failed` 仍保留在 `orders.status` 的 CHECK 中，但目前沒有任何程式會寫入；付款未成立的訂單維持 `pending` 以便重新付款。庫存不會回補。

注意事項：

- **不信任瀏覽器帶回的資料**：`/api/ecpay/result` 收到的是瀏覽器轉送的表單，只用其中的 `MerchantTradeNo` 找出訂單並導向，不更新狀態。`/api/ecpay/notify` 只回 `1|OK`、同樣不更新狀態。這兩支是唯二不回傳 `{ data, error, message }` 的 `/api` 端點。
- **重複付款防護**：`POST /:id/ecpay` 在產生新的 `MerchantTradeNo` 前，會先查詢上一次嘗試；若已付款就直接把訂單標為 `paid` 並回 `INVALID_STATUS`。
- `QueryTradeInfo` 的 `TimeStamp` 只有 3 分鐘有效，每次查詢重新產生；查詢過於頻繁綠界會回 HTTP 403 並需等待 30 分鐘。信用卡銀行回覆可能延遲，官方建議付款後稍候再查。
- `MerchantTradeDate` 必須是台灣時間（UTC+8）；`ItemName` 會去除 HTML 標籤、控制字元與 `#&<>` 並截到 200 字，避免綠界截斷造成 CheckMacValue 不符。
- 部署到有公開網址的環境時，應把 `/api/ecpay/notify` 改為驗證 CheckMacValue 後更新訂單（或沿用查詢），並改用專屬的正式特店資料。
- `GET /orders/:id?payment=<值>`：`start` 會讓訂單頁自動前往綠界付款（結帳後使用）；`success` / `failed` / `cancel` 只顯示對應橫幅，不改變訂單狀態。

### 8.2 其他外部資源

| 資源 | 用途 | 載入位置 |
| --- | --- | --- |
| Vue 3（`https://unpkg.com/vue@3/dist/vue.global.prod.js`） | 前端互動 | 兩個 layout |
| Google Fonts（Noto Sans TC / Noto Serif TC） | 字型 | `partials/head.ejs` |
| Unsplash 圖片 | 商品圖、首頁精選圖 | seed 資料、`index.js` |

皆為瀏覽器端直接請求，離線環境下頁面會失去互動與圖片。

### 8.3 CORS

`cors({ origin: process.env.FRONTEND_URL || 'http://localhost:3001' })`。只允許單一來源。`.env.example` 將 `FRONTEND_URL` 設為 `http://localhost:5173`（預留給獨立前端開發伺服器）；本專案自帶的 EJS 頁面與 API 同源，不受 CORS 影響。

### 8.4 OpenAPI

每個 API 路由上方都有 `@openapi` JSDoc 區塊。`npm run openapi` 會以 `swagger-jsdoc` 掃描 `src/routes/*.js`，在專案根目錄產生 `openapi.json`。這個檔案**有納入版本控制**，異動 API 後要重新產生並一併提交。專案**沒有**掛載 Swagger UI，該檔案需自行匯入 Postman / Swagger Editor 等工具檢視。
