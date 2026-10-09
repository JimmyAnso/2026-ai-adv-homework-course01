# DEVELOPMENT — 開發規範

## 1. 環境需求與啟動

- Node.js 20 以上（`better-sqlite3` 12 的 engines 為 `20.x || 22.x || 23.x || 24.x || 25.x`；它與 `bcrypt` 6 都是原生模組，安裝時需能取得預編譯檔或具備編譯工具鏈）
- npm

開發時需要**兩個終端機**：

```bash
npm run dev:css      # 終端機 1：Tailwind watch，持續輸出 public/css/output.css
npm run dev:server   # 終端機 2：node server.js（沒有 nodemon，改後端程式需手動重啟）
```

> `public/css/output.css` 是建置產物且被 `.gitignore` 忽略。只跑 `npm run dev:server` 而沒有先建置 CSS，頁面會完全沒有樣式。`npm start` 會先自動執行 `css:build`。
>
> Tailwind v4 會自動掃描專案內的檔案產生 class。在 EJS 或前端 JS 中新增的 class 需要 `dev:css` 正在執行（或重新 `css:build`）才會生效。

## 2. 環境變數

由 `dotenv` 在 `app.js` 第一行載入專案根目錄的 `.env`。請從 `.env.example` 複製。

| 變數 | 用途 | 必要性 | 預設值（未設定時） |
| --- | --- | --- | --- |
| `JWT_SECRET` | JWT 簽章 / 驗證密鑰 | **必要**。`node server.js` 啟動時未設定會直接結束（exit 1）；測試時未設定會造成註冊 / 登入回 500 | 無 |
| `PORT` | 伺服器監聽 port | 選填（`.env.example` 未列出） | `3001` |
| `FRONTEND_URL` | CORS 允許的單一來源 | 選填 | `http://localhost:3001` |
| `ADMIN_EMAIL` | Seed 管理員帳號 | 選填 | `admin@hexschool.com` |
| `ADMIN_PASSWORD` | Seed 管理員密碼 | 選填 | `12345678` |
| `NODE_ENV` | 僅影響 seed 管理員的 bcrypt salt rounds（`test` 時為 1，否則 10）。Vitest 會自動設為 `test` | 選填 | 無 |
| `BASE_URL` | 預留（金流回呼網址用） | **目前未被程式讀取** | — |
| `ECPAY_MERCHANT_ID` | 預留（綠界特店編號） | **目前未被程式讀取** | — |
| `ECPAY_HASH_KEY` | 預留（綠界 HashKey） | **目前未被程式讀取** | — |
| `ECPAY_HASH_IV` | 預留（綠界 HashIV） | **目前未被程式讀取** | — |
| `ECPAY_ENV` | 預留（`staging` / `production`） | **目前未被程式讀取** | — |

注意事項：

- `ADMIN_EMAIL` / `ADMIN_PASSWORD` 只在「該 email 的使用者不存在」時用來建立帳號。**之後再改 `.env` 的密碼不會更新既有帳號**；改 email 則會多建立一個管理員。
- 測試檔寫死使用 `admin@hexschool.com` / `12345678` 登入；若 `.env` 改了這兩個值且資料庫是新建的，測試會失敗（見 TESTING.md）。
- 新增環境變數時：加進 `.env.example`、更新本表，並在程式中提供合理預設值或啟動時檢查。

## 3. 模組系統

| 範圍 | 模組系統 | 說明 |
| --- | --- | --- |
| 後端（`app.js`、`server.js`、`src/**`、`tests/**`、`swagger-config.js`、`generate-openapi.js`） | **CommonJS** | `require` / `module.exports`。`package.json` 沒有 `"type": "module"` |
| `vitest.config.js` | **ESM** | 唯一使用 `import` / `export default` 的檔案（由 Vite 轉譯載入） |
| 前端（`public/js/**`） | **無模組，傳統 `<script>`** | 沒有打包工具。所有檔案共用瀏覽器全域作用域，靠 layout 中 `<script>` 的順序決定相依 |

前端全域變數慣例：

- `Vue`（CDN）、`Auth`、`apiFetch`、`Notification` 是全域可用的。
- 每支頁面 script 開頭都有 `const { createApp, ref, ... } = Vue;`。因為是頂層 `const`，**一個頁面只能載入一支頁面 script**，否則會重複宣告而報錯。共用邏輯請放到 `public/js/` 下並在 layout 中以 `<script>` 引入，不要在頁面 script 之間互相依賴。
- `public/js/notification.js` 宣告的 `Notification` 會遮蔽瀏覽器原生的 Web Notifications API；本專案不使用原生通知，如需使用請改以 `window.Notification` 以外的方式處理或重新命名。

後端慣例：

- `src/database.js` 匯出單一 `db` 連線（Node 模組快取保證單例）。所有路由直接 `require('../database')` 並撰寫 SQL，**沒有 model / service / repository 層**。
- 所有路由處理函式都是**同步**的（better-sqlite3 與 `bcrypt.*Sync`）。Express 版本為 4.16，**不會自動捕捉 async 函式的 rejection**。若新增 `async` handler，必須自行 `try/catch` 並呼叫 `next(err)`，否則錯誤不會進入 `errorHandler`，請求會懸置。

## 4. 命名規則

| 對象 | 規則 | 範例 |
| --- | --- | --- |
| 路由檔 | camelCase + `Routes.js`；後台加 `admin` 前綴 | `cartRoutes.js`、`adminProductRoutes.js` |
| Middleware 檔 | camelCase + `Middleware.js`（錯誤處理例外） | `authMiddleware.js`、`errorHandler.js` |
| 測試檔 | 與路由對應的 camelCase + `.test.js` | `adminOrders.test.js` |
| EJS 模板 / partial | kebab-case | `order-detail.ejs`、`admin-sidebar.ejs` |
| 前端頁面 script | kebab-case，**必須等於 `pageRoutes.js` 中的 `pageScript` 值** | `admin-products.js` |
| JS 變數 / 函式 | camelCase | `getOwnerCondition`、`createdProductId` |
| 資料表 | snake_case、複數 | `cart_items`、`order_items` |
| 資料表欄位 | snake_case | `password_hash`、`total_amount` |
| API URL | 小寫複數名詞；後台以 `/api/admin/` 開頭 | `/api/admin/orders/:id` |
| URL 路徑參數 | camelCase | `:id`、`:itemId` |
| **Request body 欄位** | **不一致，依模組而定**（見下方） | — |
| Response 欄位 | 資料列直接輸出，故為 snake_case；外層結構與分頁為 camelCase | `order_no`、`totalPages` |
| 錯誤碼（`error`） | SCREAMING_SNAKE_CASE | `STOCK_INSUFFICIENT` |
| 使用者訊息（`message`） | 繁體中文 | `商品不存在` |
| 環境變數 | SCREAMING_SNAKE_CASE | `JWT_SECRET` |
| localStorage key | `flower_` 前綴 + snake_case | `flower_session_id` |
| 自訂 header | `X-` 前綴 | `X-Session-Id` |
| Tailwind 自訂色 | kebab-case，定義於 `input.css` 的 `@theme` | `rose-primary`、`text-muted` |
| OpenAPI tag | 英文、首字大寫 | `Admin Products` |

### Request body 命名現況（重要）

現有 API 的 request body 命名**並不統一**，整合時請以此表為準，不要假設：

| 端點 | Body 欄位 | 風格 |
| --- | --- | --- |
| `POST /api/cart` | `productId`、`quantity` | camelCase |
| `POST /api/orders` | `recipientName`、`recipientEmail`、`recipientAddress` | camelCase |
| `POST` / `PUT /api/admin/products` | `name`、`description`、`price`、`stock`、`image_url` | **snake_case**（與資料表欄位相同） |

新增 API 時：**前台面向使用者的操作用 camelCase**；**直接對應資料表做 CRUD 的後台端點沿用該資源既有的欄位名稱**。回應一律維持資料庫的 snake_case，不要做轉換。

## 5. 程式風格

專案沒有設定 ESLint / Prettier，請比照既有程式碼：

- 2 空白縮排、單引號、句尾分號、物件尾端不加逗號（測試檔中有加，兩者皆可接受，跟隨所在檔案）。
- 後端路由 handler 使用箭頭函式；`pageRoutes.js` 與前端 Vue 的 callback 使用 `function` 寫法。跟隨所在檔案。
- SQL 一律用 `db.prepare(...).get/all/run(...)` 與 `?` 參數綁定。**不得**把使用者輸入串接進 SQL 字串。唯一允許插入的是程式內寫死的識別字（如 `getOwnerCondition` 的 `field`）。
- 多步驟寫入必須包在 `db.transaction(() => { ... })()` 中。
- 提早回傳（early return）處理錯誤：每個驗證失敗都 `return res.status(...).json(...)`。
- 回應永遠是 `{ data, error, message }` 三個欄位都要有。
- 程式碼註解使用英文、簡短；`message` 與 OpenAPI 的 `summary` / `description` 使用繁體中文。

## 6. JSDoc（OpenAPI）格式

每個 API 路由 handler 的正上方都必須有一個以 `@openapi` 開頭的 JSDoc 區塊，內容是 **YAML 格式的 OpenAPI 3.0 Path Item**。`npm run openapi` 會掃描 `src/routes/*.js` 產生 `openapi.json`。

規則：

- 路徑寫完整路徑（含 `/api/...` 前綴），路徑參數用 `{id}`（不是 `:id`）。
- `tags` 使用既有分類：`Auth`、`Products`、`Cart`、`Orders`、`Admin Products`、`Admin Orders`。
- 需要認證的端點加 `security`。可用的 scheme（定義於 `swagger-config.js`）：`bearerAuth`、`sessionId`。購物車類端點兩者並列，代表「擇一即可」。
- `responses` 中的成功回應要描述完整的 `{ data, error, message }` 結構；錯誤回應只需狀態碼與 `description`。
- YAML 對縮排敏感：每行以 ` * ` 開頭後，內容以 2 空白逐層縮排。縮排錯誤會讓該端點從產出檔中消失而不報錯，改完請執行 `npm run openapi` 確認。
- `pageRoutes.js` 的頁面路由不寫 `@openapi`。

範例（需認證、有路徑參數與 body 的端點）：

```js
/**
 * @openapi
 * /api/cart/{itemId}:
 *   patch:
 *     summary: 修改購物車商品數量
 *     tags: [Cart]
 *     security:
 *       - bearerAuth: []
 *       - sessionId: []
 *     parameters:
 *       - in: path
 *         name: itemId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [quantity]
 *             properties:
 *               quantity:
 *                 type: integer
 *                 minimum: 1
 *     responses:
 *       200:
 *         description: 數量已更新
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
 *                     product_id:
 *                       type: string
 *                     quantity:
 *                       type: integer
 *                 error:
 *                   type: string
 *                   nullable: true
 *                 message:
 *                   type: string
 *       400:
 *         description: 數量不合法或庫存不足
 *       404:
 *         description: 購物車項目不存在
 */
router.patch('/:itemId', dualAuth, (req, res) => {
  // ...
});
```

一般輔助函式的 JSDoc 用簡短的英文敘述即可（參考 `tests/setup.js`）：

```js
/**
 * Register a new user and return { token, user }.
 */
async function registerUser(overrides = {}) { /* ... */ }
```

## 7. 常見開發步驟

### 7.1 新增 API 端點

1. **選擇位置**：屬於既有資源就加到對應的 `src/routes/*Routes.js`；新資源則新增 `src/routes/<name>Routes.js`：

   ```js
   const express = require('express');
   const db = require('../database');
   const authMiddleware = require('../middleware/authMiddleware');

   const router = express.Router();

   router.use(authMiddleware);          // 整個 router 都需登入時

   /**
    * @openapi
    * ...（見第 6 節）
    */
   router.get('/', (req, res) => {
     const rows = db.prepare('SELECT * FROM things WHERE user_id = ?').all(req.user.userId);
     res.json({ data: { things: rows }, error: null, message: '成功' });
   });

   module.exports = router;
   ```

2. **掛載**：在 `app.js` 的「API Routes」區塊加上 `app.use('/api/<name>', require('./src/routes/<name>Routes'));`。必須在 `pageRoutes` 與 404 handler **之前**。
3. **選擇認證方式**：

   | 需求 | 作法 |
   | --- | --- |
   | 公開 | 不加 middleware |
   | 需登入 | `authMiddleware`（整個 router 用 `router.use`，單一路由則放在 handler 前） |
   | 僅管理員 | `router.use(authMiddleware, adminMiddleware)`，順序不可顛倒 |
   | 訪客也可用 | 參考 `cartRoutes.js` 的 `dualAuth`（目前定義在該檔內；若第二個模組需要，請先抽到 `src/middleware/`） |

4. **實作**：驗證輸入 → 查詢 / 寫入 → 回傳統一格式。使用 `req.user.userId`（不是 `req.user.id`）。會員資源的查詢務必加上 `AND user_id = ?`，查無資料回 404。
5. **路由順序**：同一 router 內，固定路徑（如 `/summary`）要寫在 `/:id` 之前。
6. **文件與測試**：寫 `@openapi` 區塊、執行 `npm run openapi` 確認；在 `tests/` 新增或擴充測試；更新 `docs/FEATURES.md`、`docs/ARCHITECTURE.md` 的路由表與 `docs/CHANGELOG.md`。

### 7.2 新增 Middleware

1. 建立 `src/middleware/<name>Middleware.js`，匯出單一函式：

   ```js
   function exampleMiddleware(req, res, next) {
     if (/* 不通過 */ false) {
       return res.status(400).json({ data: null, error: 'SOME_CODE', message: '說明' });
     }
     next();
   }

   module.exports = exampleMiddleware;
   ```

2. 掛載位置：
   - 全域：`app.js` 的「Global middleware」區塊。需讀取 body 的要放在 `express.json()` 之後。
   - 特定資源：路由檔內 `router.use(...)` 或個別路由。
3. 失敗時**自行回應統一格式的 JSON**（這樣才能有自訂的 `error` 碼）。若改用 `next(err)`，回應的 `error` 一律會是 `INTERNAL_ERROR`；此時要讓自訂訊息顯示，需設定 `err.status` 與 `err.isOperational = true`。
4. 錯誤處理型 middleware（四個參數）必須在 `app.js` 最後、`errorHandler` 附近註冊。

### 7.3 修改資料庫

Schema 與 seed 全部在 `src/database.js` 的 `initializeDatabase()`。**沒有 migration 工具。**

- **新增資料表**：在 `db.exec` 的字串中加上 `CREATE TABLE IF NOT EXISTS ...`。重啟後自動建立，既有資料不受影響。
- **修改既有資料表**（加欄位、改約束、改 CHECK 的允許值）：修改 `CREATE TABLE` 語句**不會**影響已存在的資料庫。擇一處理：
  - 開發階段：停止伺服器，刪除 `database.sqlite`、`database.sqlite-shm`、`database.sqlite-wal` 三個檔案後重啟，會重建並重新 seed（所有資料遺失）。
  - 需保留資料：在 `initializeDatabase()` 建表之後加入冪等的 `ALTER TABLE`（先以 `PRAGMA table_info(<table>)` 檢查欄位是否存在）。
- **慣例**：主鍵 `id TEXT PRIMARY KEY`，由應用層 `uuidv4()` 產生；時間欄位 `TEXT NOT NULL DEFAULT (datetime('now'))`；金額用 `INTEGER`；列舉值用 `CHECK(col IN (...))`。
- **外鍵**：`foreign_keys = ON` 且現有外鍵都沒有 `ON DELETE`，刪除被參考的列會拋錯。新增外鍵時請明確決定刪除行為，並在對應的刪除端點處理衝突（回 409，而不是讓它變成 500）。
- **新增訂單狀態**：需同時修改 `orders.status` 的 CHECK（需重建表）、`adminOrderRoutes.js` 的狀態白名單、`orderRoutes.js` 的 `actionMap`，以及前端三處 `statusMap`（`orders.js`、`order-detail.js`、`admin-orders.js`）與 `admin/orders.ejs` 的下拉選單。
- 更新 `docs/ARCHITECTURE.md` 的 schema 表。

### 7.4 新增頁面

1. `views/pages/<name>.ejs`（後台放 `views/pages/admin/`）：最外層為 `<div id="app">`；需要伺服器傳值時用 `data-*` 屬性。
2. `public/js/pages/<name>.js`：

   ```js
   const { createApp, ref, onMounted } = Vue;

   createApp({
     setup() {
       if (!Auth.requireAuth()) return {};   // 需登入的頁面

       const loading = ref(true);
       onMounted(async function () {
         try {
           const res = await apiFetch('/api/...');
           // ...
         } catch (e) {
           Notification.show(e?.data?.message || '載入失敗', 'error');
         } finally {
           loading.value = false;
         }
       });
       return { loading };
     }
   }).mount('#app');
   ```

3. `src/routes/pageRoutes.js`：加上路由，呼叫 `renderFront(res, '<name>', { title, pageScript: '<name>' })` 或 `renderAdmin(...)`（後台需另傳 `currentPath`）。
4. 後台頁面：在 `views/partials/admin-sidebar.ejs` 加上選單項目。後台 layout 已內建 `Auth.requireAdmin()`，頁面 script 不需再呼叫。
5. `apiFetch` 在 401 時回傳 `undefined`（並已觸發導向），取用 `res.data` 前若有需要請先判斷。

## 8. 計畫歸檔流程

1. 計畫檔案命名格式：`YYYY-MM-DD-<feature-name>.md`（日期為開始規劃的日期，feature-name 用 kebab-case），放在 `docs/plans/`。例如 `docs/plans/2026-10-09-guest-cart-merge.md`。
2. 計畫文件結構：**User Story → Spec → Tasks**

   ```markdown
   # <功能名稱>

   ## User Story
   身為 <角色>，我想要 <行為>，以便 <價值>。

   ## Spec
   - API：端點、認證、request / response、錯誤碼
   - 資料庫：新增或異動的表與欄位
   - 前端：頁面與互動行為
   - 邊界情況與不做的範圍

   ## Tasks
   - [ ] 任務 1
   - [ ] 任務 2
   - [ ] 撰寫 / 更新測試
   - [ ] 更新文件
   ```

3. 功能完成後：將計畫檔移至 `docs/plans/archive/`（使用 `git mv` 保留歷史）。
4. 更新 `docs/FEATURES.md`（完成狀態與行為描述）和 `docs/CHANGELOG.md`（新增一筆紀錄）。若涉及路由、schema、環境變數或測試，同步更新 `ARCHITECTURE.md`、本文件與 `TESTING.md`。

`docs/plans/` 中只保留**進行中**的計畫；已歸檔的計畫不再修改。

## 9. 提交前檢查清單

- [ ] `npm test` 全數通過
- [ ] 新增 / 異動的 API 有 `@openapi` 區塊，`npm run openapi` 可成功產生
- [ ] 回應符合 `{ data, error, message }`
- [ ] SQL 皆使用參數綁定；多步驟寫入使用 transaction
- [ ] 沒有提交 `.env`、`database.sqlite*`、`public/css/output.css`
- [ ] 相關文件已更新
