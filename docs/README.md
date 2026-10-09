# 花漾生活 Flower Life — 花卉電商網站

一個以 Node.js + Express 打造的花卉電商示範專案。單一伺服器同時提供 REST API 與 EJS 頁面，涵蓋會員註冊登入、商品瀏覽、訪客 / 會員雙模式購物車、下單扣庫存、綠界 ECPay 信用卡付款，以及後台的商品與訂單管理。

## 功能一覽

- **會員**：註冊、登入（JWT，7 天有效）、個人資料
- **商品**：公開的分頁列表與詳情，預設內建 8 筆花卉商品
- **購物車**：未登入以 `X-Session-Id` 識別、登入後以 JWT 識別的雙模式購物車
- **訂單**：從購物車建立訂單（單一 transaction 內建立訂單、扣庫存、清空購物車）、訂單列表與詳情
- **付款**：綠界 ECPay AIO 信用卡付款（測試環境）。本地端收不到綠界的伺服器通知，付款結果由伺服器主動呼叫綠界查詢 API 驗證
- **後台**：商品 CRUD、訂單列表（狀態篩選）與詳情
- **API 文件**：由路由上的 JSDoc 產生 OpenAPI 3.0 規格檔

完整行為描述見 [FEATURES.md](./FEATURES.md)。

## 技術棧

| 層 | 技術 |
| --- | --- |
| 執行環境 | Node.js 20 以上（CommonJS） |
| Web 框架 | Express 4.16 |
| 資料庫 | SQLite — `better-sqlite3`（同步 API、WAL 模式），單一檔案 `database.sqlite` |
| 認證 | `jsonwebtoken`（HS256）、`bcrypt` |
| 樣板 | EJS（伺服器端輸出頁面外殼） |
| 前端互動 | Vue 3（CDN 全域版，無打包工具）、原生 `fetch` |
| 樣式 | Tailwind CSS v4（`@tailwindcss/cli`） |
| API 文件 | `swagger-jsdoc`（OpenAPI 3.0.3） |
| 金流 | 綠界 ECPay AIO（信用卡，CheckMacValue SHA256）。自行實作於 `src/ecpay.js`，使用 Node 內建的 `crypto` 與 `fetch`，沒有額外套件 |
| 測試 | Vitest 2 + supertest |
| 其他 | `dotenv`、`cors`、`uuid` |

## 快速開始

```bash
# 1. 安裝相依套件
npm install

# 2. 建立環境變數檔，並把 JWT_SECRET 改成自己的隨機字串
cp .env.example .env

# 3. 建置 CSS 並啟動伺服器
npm start
```

開啟 <http://localhost:3001>。

首次啟動會自動建立 `database.sqlite`、建表並寫入預設資料：

| 項目 | 值 |
| --- | --- |
| 管理員帳號 | `admin@hexschool.com` |
| 管理員密碼 | `12345678` |
| 後台入口 | <http://localhost:3001/admin/products>（需先以管理員登入） |
| 預設商品 | 8 筆 |

> `JWT_SECRET` 未設定時 `npm start` 會直接結束並顯示 `Fatal: JWT_SECRET is not set`。

### 開發模式

開兩個終端機：

```bash
npm run dev:css      # Tailwind watch
```

```bash
npm run dev:server   # 啟動伺服器（改後端程式後需手動重啟）
```

### 重置資料庫

停止伺服器後刪除資料庫檔，下次啟動會重新建立並 seed：

```bash
rm database.sqlite database.sqlite-shm database.sqlite-wal
```

## 常用指令

| 指令 | 說明 |
| --- | --- |
| `npm start` | 建置壓縮版 CSS 後啟動伺服器（`css:build` + `node server.js`） |
| `npm run dev:server` | 只啟動伺服器（不建置 CSS） |
| `npm run dev:css` | Tailwind watch：`public/css/input.css` → `public/css/output.css` |
| `npm run css:build` | 建置壓縮版 CSS（單次） |
| `npm run openapi` | 產生 `openapi.json`（專案根目錄） |
| `npm test` | 執行全部測試（`vitest run`） |
| `npx vitest run tests/cart.test.js` | 執行單一測試檔 |

## 頁面

| 路徑 | 說明 | 需登入 |
| --- | --- | --- |
| `/` | 首頁、商品列表 | — |
| `/products/:id` | 商品詳情 | — |
| `/cart` | 購物車 | — |
| `/login` | 登入 / 註冊 | — |
| `/checkout` | 結帳 | 會員 |
| `/orders` | 我的訂單 | 會員 |
| `/orders/:id` | 訂單詳情、前往綠界付款、查詢付款結果 | 會員 |
| `/admin/products` | 後台商品管理 | 管理員 |
| `/admin/orders` | 後台訂單管理 | 管理員 |

## 開發前必讀的幾件事

這些是最容易影響整合的設計，細節見各文件：

1. **統一回應格式**：所有 API 回傳 `{ data, error, message }`。
2. **購物車雙模式認證**：有 `Authorization` 就用 JWT（無效即 401，不退回訪客）；否則用 `X-Session-Id`。訪客購物車登入後**不會**合併到會員購物車。
3. **付款結果靠主動查詢**：付款走綠界 ECPay AIO（`.env` 的 `ECPAY_*`、`BASE_URL`）。因為只在本地端執行、收不到綠界的 Server Notify，訂單只會在 `POST /api/orders/:id/ecpay/verify` 向綠界查詢並驗證後才變成已付款。測試卡號 `4311-9522-2222-2222`、3D 驗證碼 `1234`。
4. **運費只存在於前端畫面**：訂單 `total_amount` 不含運費。
5. **測試與開發共用同一個資料庫檔**：跑測試會留下資料並消耗庫存。
6. **頁面路由不做伺服器端認證**：權限由 API 把關，頁面只做前端導向。
7. **沒有 migration**：修改既有資料表需手動處理或重建資料庫。

## 文件索引

| 文件 | 內容 |
| --- | --- |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 目錄結構、啟動流程、API 路由總覽、回應格式與錯誤碼、認證機制、資料庫 schema、資料流、金流現況 |
| [DEVELOPMENT.md](./DEVELOPMENT.md) | 環境變數、模組系統、命名規則、JSDoc 格式、新增 API / middleware / 資料表 / 頁面的步驟、計畫歸檔流程 |
| [FEATURES.md](./FEATURES.md) | 各功能的行為描述、參數、業務邏輯、錯誤情境、完成狀態與已知問題 |
| [TESTING.md](./TESTING.md) | 測試檔案、執行順序與依賴、輔助函式、撰寫新測試的步驟與範例、常見陷阱 |
| [CHANGELOG.md](./CHANGELOG.md) | 更新日誌 |
| [plans/](./plans/) | 進行中的開發計畫；完成後移至 [plans/archive/](./plans/archive/) |
