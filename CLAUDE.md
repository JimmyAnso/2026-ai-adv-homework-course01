# CLAUDE.md

## 專案概述

花漾生活 Flower Life（`backend-project`）— 花卉電商示範網站。Node.js（CommonJS）+ Express 4.16 單體應用，同時提供 REST API 與 EJS 頁面；SQLite（better-sqlite3，同步 API）；JWT + bcrypt 認證；前端為 Vue 3 CDN（無打包）+ Tailwind CSS v4；Vitest + supertest 測試；swagger-jsdoc 產生 OpenAPI。

## 常用指令

```bash
npm start            # 建置 CSS 後啟動伺服器（http://localhost:3001）
npm run dev:server   # 只啟動伺服器（node server.js，無自動重啟）
npm run dev:css      # Tailwind watch（public/css/input.css → output.css）
npm run css:build    # 建置壓縮版 CSS
npm run openapi      # 由 @openapi JSDoc 產生 openapi.json
npm test             # 執行全部測試（vitest run）
npx vitest run tests/cart.test.js   # 執行單一測試檔
```

啟動前需有 `.env`（`cp .env.example .env`）且設定 `JWT_SECRET`。預設管理員：`admin@hexschool.com` / `12345678`。

## 關鍵規則

- **統一回應格式**：所有 API 一律回傳 `{ data, error, message }` 三個欄位；失敗時 `data: null`、`error` 為大寫蛇形錯誤碼、`message` 為繁體中文。回應欄位維持資料庫的 snake_case。
- **資料庫存取**：路由直接 `require('../database')` 寫 SQL，一律用 `db.prepare()` 與 `?` 參數綁定；多步驟寫入必須包在 `db.transaction()`。Schema 只在 `src/database.js`，沒有 migration——修改既有資料表不會套用到現有的 `database.sqlite`。
- **路由 handler 保持同步**：Express 4.16 不會捕捉 async rejection；若必須使用 `async`（例如呼叫綠界的付款端點），要自行 `try/catch` 並 `next(err)`。
- **綠界金流**：簽章、付款參數與查詢都在 `src/ecpay.js`；`ECPAY_HASH_KEY` / `ECPAY_HASH_IV` 只能在後端使用。修改前先參考 `.claude/skills/ecpay`。
- **認證**：需登入用 `authMiddleware`（設定 `req.user.userId`，注意不是 `id`）；後台用 `router.use(authMiddleware, adminMiddleware)`，順序不可顛倒；購物車使用 `cartRoutes.js` 內的 `dualAuth`（JWT 優先，無效即 401，不退回 `X-Session-Id`）。頁面路由不做伺服器端認證，敏感資料不可渲染進 EJS。
- **每個 API 路由都要有 `@openapi` JSDoc**，並新增 / 更新對應測試。測試檔必須能獨立執行（檔案順序不保證），且測試會寫入開發用的 `database.sqlite`。
- **不要假設尚未實作的功能存在**：付款走綠界 ECPay AIO（僅信用卡），但本地端收不到綠界的 Server Notify，訂單只會在 `POST /api/orders/:id/ecpay/verify` 主動查詢綠界後才變成 `paid`——不要依賴 `/api/ecpay/notify` 或瀏覽器導回的資料更新狀態；訪客購物車不會合併到會員購物車；運費只在前端顯示。
- 功能開發使用 docs/plans/ 記錄計畫；完成後移至 docs/plans/archive/，並更新 docs/FEATURES.md 與 docs/CHANGELOG.md。

## 詳細文件

- @docs/README.md — 項目介紹與快速開始
- @docs/ARCHITECTURE.md — 架構、目錄結構、資料流
- @docs/DEVELOPMENT.md — 開發規範、命名規則
- @docs/FEATURES.md — 功能列表與完成狀態
- @docs/TESTING.md — 測試規範與指南
- @docs/CHANGELOG.md — 更新日誌
