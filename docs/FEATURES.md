# FEATURES — 功能清單與完成狀態

所有 API 回應皆為 `{ data, error, message }` 格式（見 [ARCHITECTURE.md](./ARCHITECTURE.md#4-統一回應格式)）。本文件中的「回應 data」僅列出 `data` 欄位內容。

## 完成狀態總覽

| 功能區塊 | 狀態 | 說明 |
| --- | --- | --- |
| 會員註冊 / 登入 / 個人資料 | ✅ 完成 | JWT，7 天有效 |
| 商品瀏覽（列表、詳情） | ✅ 完成 | 公開、分頁 |
| 購物車（訪客 + 會員雙模式） | ✅ 完成 | 訪客購物車登入後**不會合併** |
| 訂單建立 / 查詢 | ✅ 完成 | transaction 扣庫存 |
| 付款 | 🟡 模擬 | 以按鈕手動標記成功 / 失敗；ECPay 僅預留環境變數，未實作 |
| 運費 | 🟡 僅前端顯示 | 滿 500 免運、未滿收 150 的規則只存在於畫面，後端 `total_amount` 不含運費 |
| 後台商品管理 | ✅ 完成 | CRUD |
| 後台訂單管理 | 🟡 唯讀 | 列表、狀態篩選、詳情；無法修改訂單狀態 |
| 前台頁面 | ✅ 完成 | 首頁、商品詳情、購物車、結帳、登入、訂單列表、訂單詳情、404 |
| 後台頁面 | ✅ 完成 | 商品管理、訂單管理 |
| OpenAPI 文件產生 | ✅ 完成 | `npm run openapi` → `openapi.json`（無 Swagger UI） |
| 訪客購物車合併、商品搜尋 / 分類、訂單取消、庫存回補、密碼重設、修改個人資料 | ⬜ 未實作 | — |

---

## 1. 會員認證（`/api/auth`）

### 1.1 註冊 `POST /api/auth/register`

公開端點。建立一般使用者（`role` 固定為 `user`，無法透過 API 建立管理員）並**直接回傳 token**，前端註冊後即視為已登入。

| Body 欄位 | 必填 | 規則 |
| --- | --- | --- |
| `email` | ✅ | 需符合 `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` |
| `password` | ✅ | 長度 ≥ 6 |
| `name` | ✅ | 非空 |

處理順序：必填檢查 → Email 格式 → 密碼長度 → Email 是否已存在 → `bcrypt.hashSync(password, 10)` → 寫入 → 簽發 JWT。

回應 `201`，data：`{ user: { id, email, name, role }, token }`

| 狀態 | error | message | 情境 |
| --- | --- | --- | --- |
| 400 | `VALIDATION_ERROR` | email、password、name 為必填欄位 | 任一欄位缺失或為空字串 |
| 400 | `VALIDATION_ERROR` | Email 格式不正確 | — |
| 400 | `VALIDATION_ERROR` | 密碼至少需要 6 個字元 | — |
| 409 | `CONFLICT` | Email 已被註冊 | Email 比對區分大小寫（未做正規化） |

### 1.2 登入 `POST /api/auth/login`

| Body 欄位 | 必填 |
| --- | --- |
| `email` | ✅ |
| `password` | ✅ |

回應 `200`，data：`{ user: { id, email, name, role }, token }`

| 狀態 | error | message | 情境 |
| --- | --- | --- | --- |
| 400 | `VALIDATION_ERROR` | email 和 password 為必填欄位 | — |
| 401 | `UNAUTHORIZED` | Email 或密碼錯誤 | 帳號不存在**或**密碼錯誤（刻意回相同訊息，避免帳號列舉） |

### 1.3 個人資料 `GET /api/auth/profile`

需 JWT。回應 data：`{ id, email, name, role, created_at }`（從資料庫即時讀取，不含 `password_hash`）。

| 狀態 | error | 情境 |
| --- | --- | --- |
| 401 | `UNAUTHORIZED` | 未帶 token / token 無效或過期 / 使用者已被刪除 |
| 404 | `NOT_FOUND` | 理論上不會發生（`authMiddleware` 已先檢查使用者存在） |

### 1.4 前端行為（`/login`）

- 同一頁以分頁切換「登入 / 註冊」。前端先做基本驗證（必填、註冊密碼 ≥ 6），不通過則顯示欄位錯誤、不送出請求。
- 成功後 `Auth.login(token, user)` 寫入 localStorage，並導向 `?redirect=` 指定的路徑（預設 `/`）。
- 導覽列（`header-init.js`）：已登入顯示使用者名稱與「登出」；管理員額外顯示「後台管理」連結；「我的訂單」連結僅登入後顯示。
- 登出：清除 `flower_token`、`flower_user` 後導向 `/`。`flower_session_id` 保留。

> **已知問題**：`apiFetch()` 對**所有** 401 都會清除登入狀態並導向 `/login`，且回傳 `undefined`。登入失敗（帳密錯誤）本身就是 401，因此在登入頁輸入錯誤密碼時，頁面會重新載入 `/login`，後端回傳的「Email 或密碼錯誤」**不會**顯示給使用者（`?redirect=` 參數也會遺失）。

---

## 2. 商品瀏覽（`/api/products`）

### 2.1 商品列表 `GET /api/products`

公開端點。依 `created_at DESC` 排序。

| Query | 預設 | 範圍 | 說明 |
| --- | --- | --- | --- |
| `page` | 1 | ≥ 1 | 非數字或 < 1 時視為 1 |
| `limit` | 10 | 1–100 | 非數字或 0 時視為 10；超過 100 截為 100 |

回應 data：`{ products: [ { id, name, description, price, stock, image_url, created_at, updated_at } ], pagination: { total, page, limit, totalPages } }`

- 超出範圍的頁碼不會報錯，回傳空陣列。
- 沒有搜尋、分類、排序參數；庫存為 0 的商品也會列出。

### 2.2 商品詳情 `GET /api/products/:id`

回應 data：單一商品物件（欄位同上）。找不到時 `404 NOT_FOUND「商品不存在」`。

### 2.3 前端行為

- **首頁 `/`**：每頁 9 筆（`limit=9`）。上方「精選」區塊取目前頁的前 4 筆商品，搭配 `index.js` 中寫死的 4 張 Unsplash 圖片。商品卡片可點擊進入詳情；「加入購物車」固定數量 1，庫存 ≤ 0 時按鈕停用。總頁數 > 1 才顯示分頁鈕。
- **商品詳情 `/products/:id`**：數量選擇器下限 1、上限為該商品庫存；庫存 ≤ 0 時無法加入。API 回 404 時顯示找不到商品的畫面。
- 加入購物車成功後，導覽列徽章數字直接 +1（見下方購物車徽章說明）。

---

## 3. 購物車（`/api/cart`）

### 3.1 雙模式認證（非標準機制）

購物車四個端點都使用 `dualAuth`，同時支援會員與訪客：

| 請求帶有 | 行為 | 購物車擁有者 |
| --- | --- | --- |
| 有效的 `Authorization: Bearer` | 會員模式 | `cart_items.user_id = <userId>` |
| 無 `Authorization`、有 `X-Session-Id` | 訪客模式 | `cart_items.session_id = <sid>` |
| **無效**的 `Authorization`（不論有無 `X-Session-Id`） | `401 UNAUTHORIZED「Token 無效或已過期」` | — 不會退回訪客模式 |
| 兩者皆無 | `401 UNAUTHORIZED「請提供有效的登入 Token 或 X-Session-Id」` | — |

- `X-Session-Id` 的值由用戶端自行產生（前端使用 `crypto.randomUUID()`），伺服器不驗證格式也不核發。知道某個 session id 的人即可讀寫該訪客購物車。
- 會員購物車與訪客購物車是**兩個獨立的購物車**。登入時不會合併；前端登入後一律帶 token，因此看到的是會員購物車。
- 所有針對 `:itemId` 的操作都會同時比對擁有者；操作別人的項目會得到 `404`（不是 403），不洩漏項目是否存在。

### 3.2 查看購物車 `GET /api/cart`

回應 data：

```json
{
  "items": [
    {
      "id": "<cart item id>",
      "product_id": "<product id>",
      "quantity": 2,
      "product": { "name": "粉色玫瑰花束", "price": 1680, "stock": 30, "image_url": "https://..." }
    }
  ],
  "total": 3360
}
```

- `total` = Σ（商品**目前**單價 × 數量），不含運費。價格是即時 JOIN `products` 取得，商品改價後購物車金額會跟著變。
- 空購物車回 `{ items: [], total: 0 }`。

### 3.3 加入商品 `POST /api/cart`

| Body 欄位 | 必填 | 預設 | 規則 |
| --- | --- | --- | --- |
| `productId` | ✅ | — | 必須是存在的商品 id |
| `quantity` | ❌ | 1 | `parseInt` 後須為 ≥ 1 的整數（字串 `"2"` 可接受） |

**累加邏輯**：若該擁有者的購物車已有同一商品，**不會新增一列，而是把數量加上去**；否則新增一列。

**庫存檢查**：以「累加後的總數量」對比 `products.stock`，超過即拒絕。加入購物車**不會保留 / 預扣庫存**，庫存只在建立訂單時扣除。

回應 `200`（注意：新增也是 200，不是 201），data：`{ id, product_id, quantity }`，其中 `quantity` 是累加後的數量。message：「已加入購物車」。

| 狀態 | error | message | 情境 |
| --- | --- | --- | --- |
| 400 | `VALIDATION_ERROR` | productId 為必填欄位 | — |
| 400 | `VALIDATION_ERROR` | quantity 必須為正整數 | 0、負數、非數字 |
| 404 | `NOT_FOUND` | 商品不存在 | — |
| 400 | `STOCK_INSUFFICIENT` | 庫存不足 | 新數量（或累加後數量）> 庫存 |
| 401 | `UNAUTHORIZED` | — | 見 3.1 |

### 3.4 修改數量 `PATCH /api/cart/:itemId`

| Body 欄位 | 必填 | 規則 |
| --- | --- | --- |
| `quantity` | ✅ | ≥ 1 的整數。這是**覆寫**為指定數量，不是累加 |

數量不能設為 0；要移除請用 DELETE。回應 data：`{ id, product_id, quantity }`，message：「數量已更新」。

| 狀態 | error | message |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | quantity 必須為正整數 |
| 404 | `NOT_FOUND` | 購物車項目不存在（含不屬於自己的項目） |
| 400 | `STOCK_INSUFFICIENT` | 庫存不足 |

### 3.5 移除項目 `DELETE /api/cart/:itemId`

回應 `200`，data 為 `null`，message：「已從購物車移除」。找不到或不屬於自己 → `404 NOT_FOUND「購物車項目不存在」`。

沒有「清空購物車」端點；購物車只會在建立訂單成功時被整個清空。

### 3.6 前端行為（`/cart`）

- 訪客可直接使用，不需登入。
- 數量 `−` 鈕在數量 ≤ 1 時停用；`+` 鈕在數量 ≥ 庫存時停用。更新成功後才改變畫面數字。
- 移除前會跳出確認對話框。
- **運費顯示規則（僅前端）**：小計 < 500 顯示「再買 NT$ X 即可享免運費」並加收運費 NT$ 150；≥ 500 顯示免運。同樣的規則也寫在 `checkout.ejs`。**後端不計算運費**，訂單的 `total_amount` 只有商品小計，因此小計未滿 500 時，結帳頁顯示的應付金額會比訂單詳情的總計多 150。
- 「前往結帳」：未登入導向 `/login?redirect=/checkout`。
- **購物車徽章**（導覽列）：頁面載入時顯示「購物車項目種類數」（`items.length`，不是件數總和）。在首頁 / 商品頁加入成功時前端直接把數字 +1——即使加入的是購物車裡已有的商品（實際種類數不變），因此徽章可能暫時比實際多，重新整理後校正。

---

## 4. 訂單（`/api/orders`）

整個 router 掛了 `authMiddleware`，**所有端點都需要 JWT**；訪客無法下單。所有查詢都限定 `user_id = 自己`，存取他人訂單一律得到 404。

### 4.1 建立訂單 `POST /api/orders`

訂單內容**完全來自伺服器端的會員購物車**，request body 只帶收件資訊，用戶端無法指定商品或價格。

| Body 欄位 | 必填 | 規則 |
| --- | --- | --- |
| `recipientName` | ✅ | 非空 |
| `recipientEmail` | ✅ | 需符合 Email 正規表示式 |
| `recipientAddress` | ✅ | 非空 |

> 注意命名：request body 是 **camelCase**（`recipientName`），回應與資料庫是 **snake_case**（`recipient_name`）。

**處理流程：**

1. 驗證必填與 Email 格式。
2. 讀取該會員的購物車（JOIN 商品取得當下名稱、價格、庫存）。只讀 `user_id` 的項目，訪客 session 的項目不會納入。
3. 購物車為空 → `CART_EMPTY`。
4. 檢查每個項目 `quantity <= stock`；有任何一項不足 → `STOCK_INSUFFICIENT`，message 會列出所有不足的商品名稱（以 `, ` 分隔），整張訂單不成立。
5. 計算 `total_amount = Σ(price × quantity)`（不含運費）。
6. 產生訂單編號 `ORD-YYYYMMDD-XXXXX`：日期為 **UTC** 日期，後綴為 UUID 前 5 碼轉大寫（16 進位字元）。
7. 在**單一 `db.transaction`** 中依序執行，任一步失敗全部回滾：
   - 新增 `orders`（`status` 預設 `pending`）
   - 對每個購物車項目：新增 `order_items`（複製商品名稱與單價作為快照）＋ `UPDATE products SET stock = stock - ?`
   - `DELETE FROM cart_items WHERE user_id = ?`（清空會員購物車）
8. 回應 `201`。

回應 data：

```json
{
  "id": "<order id>",
  "order_no": "ORD-20260407-A1B2C",
  "total_amount": 1680,
  "status": "pending",
  "items": [ { "product_name": "粉色玫瑰花束", "product_price": 1680, "quantity": 1 } ],
  "created_at": "2026-04-07 08:30:00"
}
```

（建立時的回應不含收件資訊與 `items[].id`；完整資料請呼叫詳情端點。）

| 狀態 | error | message | 情境 |
| --- | --- | --- | --- |
| 400 | `VALIDATION_ERROR` | 收件人姓名、Email 和地址為必填欄位 | — |
| 400 | `VALIDATION_ERROR` | Email 格式不正確 | — |
| 400 | `CART_EMPTY` | 購物車為空 | 含「剛下完單再送一次」的重複提交 |
| 400 | `STOCK_INSUFFICIENT` | 以下商品庫存不足：A, B | — |
| 401 | `UNAUTHORIZED` | — | 未登入 |

**併發安全性**：better-sqlite3 為同步 API，且 Node.js 單執行緒，步驟 2–7 之間不會有其他請求插入，因此在單一行程下不會超賣。資料庫層另有 `CHECK(stock >= 0)` 作為最後防線。

**邊界情況**：訂單編號後綴只有 5 個 16 進位字元（約 100 萬種 / 天）；若同日撞號會違反 `order_no UNIQUE`，transaction 回滾並回 500，使用者重送即可。

### 4.2 我的訂單 `GET /api/orders`

回應 data：`{ orders: [ { id, order_no, total_amount, status, created_at } ] }`，依 `created_at DESC`。**沒有分頁**，一次回傳全部；不含明細與收件資訊。

### 4.3 訂單詳情 `GET /api/orders/:id`

回應 data：`orders` 整列（`id, order_no, user_id, recipient_name, recipient_email, recipient_address, total_amount, status, created_at`）加上 `items: [ { id, order_id, product_id, product_name, product_price, quantity } ]`。

不存在或不屬於自己 → `404 NOT_FOUND「訂單不存在」`。

### 4.4 模擬付款 `PATCH /api/orders/:id/pay`

目前**沒有真實金流**。此端點讓訂單擁有者自行決定付款結果，用於展示流程。

| Body 欄位 | 必填 | 值 |
| --- | --- | --- |
| `action` | ✅ | `"success"` → 狀態變 `paid`；`"fail"` → 狀態變 `failed` |

- 只有 `pending` 的訂單可以操作。`paid` 與 `failed` 都是終態：**付款失敗的訂單無法重新付款**，需重新下單。
- 付款失敗**不會回補庫存**，也不會還原購物車。
- 回應 data：更新後的完整訂單 + `items`（格式同 4.3）。message 為「付款成功」或「付款失敗」（兩者 HTTP 狀態都是 200，`error` 都是 `null`）。

| 狀態 | error | message |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | action 必須為 success 或 fail |
| 404 | `NOT_FOUND` | 訂單不存在 |
| 400 | `INVALID_STATUS` | 訂單狀態不是 pending，無法付款 |

檢查順序為 action → 訂單存在 → 狀態；因此對不存在的訂單送出不合法的 action 會先得到 400。

### 4.5 前端行為

- **結帳 `/checkout`**：需登入（否則導向 `/login?redirect=/checkout`）。載入時取購物車，若為空或失敗則導回 `/cart`。表單前端驗證三個欄位後送出；成功導向 `/orders/<id>`；失敗以 Toast 顯示後端的 `message`（例如庫存不足的商品名稱）。送出期間按鈕鎖定避免重複提交。
- **我的訂單 `/orders`**：需登入。列出訂單編號、金額、狀態徽章、日期，點擊進入詳情。
- **訂單詳情 `/orders/:id`**：需登入。顯示訂單資訊、收件資訊、明細表與總計。`status === 'pending'` 時顯示「付款成功」「付款失敗」兩顆模擬按鈕；操作後就地更新訂單並顯示結果橫幅。網址帶 `?payment=success|failed|cancel` 時也會顯示對應橫幅（為金流導回預留，純顯示）。
- 狀態顯示對照：`pending` 待付款、`paid` 已付款、`failed` 付款失敗（`statusMap` 在 `orders.js`、`order-detail.js`、`admin-orders.js` 各有一份，新增狀態時三處都要改）。
- 日期以 `new Date(created_at).toLocaleDateString('zh-TW')` 顯示。`created_at` 是不帶時區的 UTC 字串，瀏覽器會當成本地時間解析，接近午夜（UTC）建立的訂單在台灣可能顯示為前一天。

---

## 5. 後台商品管理（`/api/admin/products`）

整個 router 需 JWT + `role === 'admin'`。未登入 → 401；一般使用者 → `403 FORBIDDEN「權限不足」`。

### 5.1 列表 `GET /api/admin/products`

Query 與回應格式與公開的 `GET /api/products` **完全相同**（`page` 預設 1、`limit` 預設 10、上限 100、`created_at DESC`）。目前兩者實作一樣，僅權限不同。

### 5.2 新增 `POST /api/admin/products`

| Body 欄位 | 必填 | 規則 |
| --- | --- | --- |
| `name` | ✅ | 非空 |
| `price` | ✅ | **JSON number** 型別的正整數（`Number.isInteger`；字串 `"500"` 會被拒絕） |
| `stock` | ✅ | JSON number 型別的非負整數（可為 0） |
| `description` | ❌ | 省略或空字串存為 `NULL` |
| `image_url` | ❌ | 省略或空字串存為 `NULL`；不驗證 URL 格式 |

回應 `201`，data：完整商品列。message：「商品新增成功」。

| 狀態 | error | message |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | name 為必填欄位 |
| 400 | `VALIDATION_ERROR` | price 必須為正整數 |
| 400 | `VALIDATION_ERROR` | stock 必須為非負整數 |

> 注意與購物車的差異：購物車的 `quantity` 用 `parseInt` 寬鬆解析，商品的 `price` / `stock` 則嚴格要求 number 型別。

### 5.3 編輯 `PUT /api/admin/products/:id`

雖然是 PUT，但行為是**部分更新**：只更新 body 中有提供（`!== undefined`）的欄位，其餘保留原值。每次更新都會把 `updated_at` 設為 `datetime('now')`。

| Body 欄位 | 規則（有提供時才驗證） |
| --- | --- |
| `name` | `trim()` 後不可為空字串 |
| `price` | number 型別正整數 |
| `stock` | number 型別非負整數 |
| `description`、`image_url` | 不驗證；可傳 `null` 清除 |

回應 data：更新後的完整商品列。message：「商品更新成功」。

| 狀態 | error | message |
| --- | --- | --- |
| 404 | `NOT_FOUND` | 商品不存在（先於欄位驗證） |
| 400 | `VALIDATION_ERROR` | 商品名稱不能為空 / price 必須為正整數 / stock 必須為非負整數 |

- 修改價格不影響既有訂單（明細為快照），但**會立即影響**所有購物車中該商品的金額。
- 把庫存調低到小於某些購物車中的數量是允許的；那些使用者結帳時會收到 `STOCK_INSUFFICIENT`。

### 5.4 刪除 `DELETE /api/admin/products/:id`

硬刪除。回應 data 為 `null`，message：「商品刪除成功」。

| 狀態 | error | message | 情境 |
| --- | --- | --- | --- |
| 404 | `NOT_FOUND` | 商品不存在 | — |
| 409 | `CONFLICT` | 此商品存在未完成的訂單，無法刪除 | 有任何 `pending` 訂單的明細包含此商品 |
| 500 | `INTERNAL_ERROR` | 伺服器內部錯誤 | **已知問題**：商品仍在任何人的購物車中時，外鍵約束（`cart_items.product_id`）會使 DELETE 失敗，目前未處理 |

只存在於 `paid` / `failed` 訂單中的商品可以刪除；歷史訂單因快照仍可正常顯示。

### 5.5 前端行為（`/admin/products`）

- 版型內嵌守衛：未登入或非管理員（依 localStorage 的 `flower_user.role`）導向 `/login`。
- 每頁 10 筆。新增 / 編輯共用同一個 Modal；前端檢查名稱非空且價格 > 0，price / stock 以 `v-model.number` 綁定以確保送出 number 型別。
- 編輯時會送出表單的全部五個欄位。
- 刪除前跳確認框。儲存或刪除失敗時只顯示通用訊息（「儲存失敗」「刪除失敗」），**不會顯示後端的具體原因**（例如 409 的說明）。

---

## 6. 後台訂單管理（`/api/admin/orders`）

需 JWT + admin。**唯讀**，沒有修改 / 刪除訂單的端點。

### 6.1 列表 `GET /api/admin/orders`

| Query | 預設 | 說明 |
| --- | --- | --- |
| `page` | 1 | 同商品列表 |
| `limit` | 10 | 1–100 |
| `status` | （無） | `pending` / `paid` / `failed`。**不在這三個值內的輸入會被靜默忽略**（回傳全部，不報 400） |

回應 data：`{ orders: [ orders 整列 ], pagination }`，包含所有使用者的訂單，依 `created_at DESC`。列表不含明細與下單者資訊（只有 `user_id` 與收件人欄位）。`pagination.total` 會反映篩選後的筆數。

### 6.2 詳情 `GET /api/admin/orders/:id`

回應 data：`orders` 整列 + `items`（`order_items` 整列陣列）+ `user: { name, email }`（下單會員；查不到時為 `null`）。不限制擁有者。找不到 → `404 NOT_FOUND「訂單不存在」`。

### 6.3 前端行為（`/admin/orders`）

- 狀態下拉選單（全部 / 待付款 / 已付款 / 付款失敗）變更時自動回到第 1 頁重新載入。
- 列表的「買家」欄顯示的是**收件人姓名**（`recipient_name`），不是會員名稱；會員名稱與 Email 在詳情 Modal 中顯示。
- 點擊訂單開啟詳情 Modal（另發一次詳情請求）。

---

## 7. 共用前端機制

| 機制 | 檔案 | 行為 |
| --- | --- | --- |
| API 呼叫 | `public/js/api.js` | `apiFetch(url, options)`：自動加 `Content-Type: application/json`、`Authorization`（若已登入）、`X-Session-Id`。成功回傳整個 `{ data, error, message }`；401 清除登入並導向 `/login`、回傳 `undefined`；其他非 2xx `throw { status, data }`。body 需自行 `JSON.stringify` |
| 登入狀態 | `public/js/auth.js` | `Auth.getToken / getUser / isLoggedIn / isAdmin / login / logout / getSessionId / getAuthHeaders / requireAuth / requireAdmin` |
| Toast | `public/js/notification.js` | `Notification.show(message, type)`，type：`success` / `error` / `warning` / `info`（預設），3 秒後淡出。同時間只顯示一則 |
| 404 | `app.js` | `/api/*` 回 JSON `NOT_FOUND「找不到該路徑」`；其他路徑渲染 404 頁面 |

> `requireAuth()` 會帶上 `?redirect=<目前 pathname>`（不含 query string）；`requireAdmin()` 導向 `/login` 時不帶 redirect。兩者都只是檢查 localStorage，屬於使用體驗層的導向，不是安全機制。
