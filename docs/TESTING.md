# TESTING — 測試規範與指南

## 1. 概觀

| 項目 | 內容 |
| --- | --- |
| 測試框架 | Vitest 2（`globals: true`，`describe` / `it` / `expect` / `beforeAll` 不需 import） |
| HTTP 測試 | supertest，直接載入 `app`（不啟動伺服器、不佔 port） |
| 測試類型 | API 整合測試：真實的 Express app + 真實的 SQLite 檔案，**沒有 mock** |
| 範圍 | 僅後端 API。前端 JS、EJS 頁面沒有測試 |
| 現況 | 6 個檔案、32 個測試案例 |

```bash
npm test                                 # 執行全部（vitest run，單次執行）
npx vitest run tests/cart.test.js        # 只跑單一檔案
npx vitest run -t "should create an order"   # 依測試名稱篩選
npx vitest                               # watch 模式
```

### 執行前提

1. 已 `npm install`。
2. 專案根目錄有 `.env` 且含 `JWT_SECRET`。測試透過 `require('../app')` 載入 dotenv，**不會經過 `server.js` 的啟動檢查**；缺少 `JWT_SECRET` 時不會有明確提示，而是註冊 / 登入回 500，接著測試因 `res.body.data` 為 `null` 而出現 `TypeError: Cannot read properties of null (reading 'token')` 之類的錯誤。
3. 資料庫中存在 `admin@hexschool.com` / `12345678` 的管理員（預設 seed）。測試檔與 `getAdminToken()` 寫死這組帳密。

## 2. 測試檔案

| 檔案 | 對象 | 案例數 | 涵蓋內容 |
| --- | --- | --- | --- |
| `tests/setup.js` | — | — | 共用輔助（非測試檔） |
| `tests/auth.test.js` | `/api/auth` | 6 | 註冊成功、重複 Email（409）、登入成功、密碼錯誤（401）、取得 profile、未帶 token（401） |
| `tests/products.test.js` | `/api/products` | 4 | 列表、分頁參數、詳情、不存在（404） |
| `tests/cart.test.js` | `/api/cart` | 6 | 訪客模式的加入 / 查看 / 改數量 / 移除、會員模式加入、不存在的商品（404） |
| `tests/orders.test.js` | `/api/orders` | 6 | 從購物車建立訂單、空購物車（400）、未登入（401）、列表、詳情、不存在（404） |
| `tests/adminProducts.test.js` | `/api/admin/products` | 6 | 列表、新增、編輯、刪除、一般使用者（403）、未登入（401） |
| `tests/adminOrders.test.js` | `/api/admin/orders` | 4 | 列表、依狀態篩選、詳情、一般使用者（403） |

### 尚未涵蓋（新增測試的優先候選）

- `PATCH /api/orders/:id/pay`（模擬付款，含 `INVALID_STATUS`）
- 各種 `VALIDATION_ERROR`（註冊欄位、購物車 quantity、商品 price / stock）
- `STOCK_INSUFFICIENT`（購物車與下單）
- 購物車同商品累加行為
- 下單後庫存確實扣除、購物車確實清空
- 刪除商品的 `409 CONFLICT`
- `dualAuth` 在 token 無效時不退回 session 的行為
- 存取他人訂單 / 他人購物車項目回 404

## 3. 執行順序與依賴關係

### 3.1 檔案之間

`vitest.config.js`：

```js
test: {
  globals: true,
  fileParallelism: false,          // 檔案逐一執行，不平行
  sequence: { files: [ 'tests/auth.test.js', 'tests/products.test.js', ... ] },
  hookTimeout: 10000,
}
```

- `fileParallelism: false` **是必要的**：所有檔案共用同一個 `database.sqlite`，平行執行會互相干擾庫存並可能遇到 SQLite 寫入鎖。
- **檔案執行順序並不固定。** 設定中的 `sequence.files` 不是 Vitest 2 支援的選項，實際上不會生效；Vitest 使用預設排序器（依快取中的失敗紀錄、執行時間與檔案大小排序）。實測執行順序為 `orders → cart → adminProducts → auth → adminOrders → products`，與設定列出的順序不同。
- 因此：**每個測試檔必須能獨立執行，不可依賴其他檔案先跑過**。現有檔案都符合這一點——各自在 `beforeAll` 或測試內建立自己需要的使用者、購物車與訂單。

每個測試檔在各自的 worker 中載入 `app`，所以 `src/database.js` 的初始化（建表、seed）每個檔案都會執行一次；因為是冪等的，不會重複建立資料。

### 3.2 檔案內部

**同一個檔案內的 `it` 是依序執行且互相依賴的**，以外層 `let` 變數傳遞狀態：

| 檔案 | 依賴鏈 |
| --- | --- |
| `auth.test.js` | 註冊（設定 `registeredEmail`、`userToken`）→ 重複註冊用同一 email → profile 用 `userToken` |
| `products.test.js` | 列表（設定 `productId`）→ 詳情 |
| `cart.test.js` | `beforeAll` 取 `productId` → 訪客加入（設定 `cartItemId`）→ 查看 → 改數量 → 移除並確認為空 |
| `orders.test.js` | `beforeAll` 註冊使用者並加入購物車 → 建立訂單（設定 `orderId`）→ **空購物車測試依賴前一個測試已清空購物車** → 列表 → 詳情 |
| `adminProducts.test.js` | 新增（設定 `createdProductId`）→ 編輯 → 刪除 |
| `adminOrders.test.js` | `beforeAll` 建立一筆完整訂單（設定 `orderId`）→ 列表 / 篩選 / 詳情 |

後果：用 `-t` 只跑中間某一個案例、或用 `it.only` / `it.skip` 跳過前面的案例，後面的案例會因為變數是 `undefined` 而失敗。這是預期中的限制，不是 bug。

## 4. 輔助函式（`tests/setup.js`）

```js
const { app, request, getAdminToken, registerUser } = require('./setup');
```

| 匯出 | 說明 |
| --- | --- |
| `app` | Express app（`require('../app')`） |
| `request` | supertest。用法：`request(app).get('/api/...')` |
| `getAdminToken()` | 以 `admin@hexschool.com` / `12345678` 登入，回傳 JWT 字串（`Promise<string>`） |
| `registerUser(overrides?)` | 註冊一個新使用者，回傳 `Promise<{ token, user }>`。`user` 為 `{ id, email, name, role }` |

`registerUser` 的 `overrides`：

| 欄位 | 預設 |
| --- | --- |
| `email` | `test-<Date.now()>-<隨機字串>@example.com`（每次呼叫都唯一） |
| `password` | `password123` |
| `name` | `測試使用者` |

注意：

- 兩個函式都**沒有檢查回應是否成功**。若登入或註冊失敗，`res.body.data` 為 `null`，會在輔助函式內拋出 `TypeError`，錯誤訊息不會指出真正原因。遇到這類錯誤先確認 `.env` 與管理員帳號。
- `registerUser` 走真實的註冊 API，使用 bcrypt 10 rounds（`NODE_ENV=test` 的 1 round 只套用在 seed 管理員），每次約數十毫秒。大量建立使用者會拖慢測試，同一個 `describe` 內請重複使用同一個 token。
- 沒有「建立商品」「建立訂單」的輔助函式；目前各檔案自行以 API 組出（參考 `adminOrders.test.js` 的 `beforeAll`）。若第三個檔案也需要，請抽進 `setup.js`。

## 5. 資料庫與測試資料

**測試直接寫入開發用的 `database.sqlite`，沒有獨立的測試資料庫，也沒有清理步驟。** 資料庫路徑寫死在 `src/database.js`（`path.join(__dirname, '..', 'database.sqlite')`），無法以環境變數切換。

每執行一次 `npm test`，資料庫會累積：

| 殘留資料 | 來源 |
| --- | --- |
| 約 6 個 `@example.com` 使用者 | 各檔案的註冊 |
| 2 筆 `pending` 訂單 | `orders.test.js`、`adminOrders.test.js` |
| `products[0]` 的庫存 −2 | 上述兩筆訂單各扣 1 |
| 1 筆會員購物車項目（數量 2） | `cart.test.js` 的會員模式測試未清理 |

（`adminProducts.test.js` 建立的商品會被它自己刪除；`cart.test.js` 的訪客項目也會被移除。）

這帶來幾個實際影響：

- 本機開發時跑過測試，後台訂單列表與會員列表會出現測試資料。
- 測試取用的商品是 `GET /api/products` 的第一筆（`created_at DESC`）。seed 的 8 筆商品時間戳相同，第一筆是哪個商品取決於 SQLite 的回傳順序；若開發時手動新增了商品，第一筆會變成那個新商品。
- **庫存會被逐次消耗**。當「第一筆商品」的庫存降到不足時（例如手動新增了一個庫存為 0 或 1 的商品，或同一資料庫上跑了很多輪測試），購物車與訂單相關測試會開始失敗。
- 被測試殘留的購物車項目或 pending 訂單參考到的商品，無法從後台刪除（見 FEATURES.md 5.4）。

**重置方式**：停止伺服器，刪除 `database.sqlite`、`database.sqlite-shm`、`database.sqlite-wal`，下次啟動或測試時會自動重建並 seed。

## 6. 撰寫新測試

### 6.1 步驟

1. 在 `tests/` 建立 `<resource>.test.js`（對既有資源則加到對應檔案）。Vitest 預設會自動找到 `tests/**/*.test.js`，不需要註冊。
2. 第一行從 `./setup` 取得 `app`、`request` 與需要的輔助函式。
3. 在 `beforeAll` 準備**這個檔案自己**需要的資料（使用者、購物車、訂單）。不要假設其他測試檔留下了什麼。
4. 每個案例至少驗證：HTTP 狀態碼、統一回應格式（`data` / `error` / `message`）、以及該端點的關鍵欄位或副作用。
5. 錯誤案例驗證狀態碼與 `error` 碼（建議比對確切的錯誤碼字串）。
6. 需要唯一值時使用 `Date.now()` 或交給 `registerUser()` 產生，確保同一個資料庫上重複執行不會衝突。
7. 測試建立的商品請在測試結束前刪除；會消耗庫存的測試盡量使用自己建立的商品，而不是 seed 商品。
8. 執行 `npm test` **至少兩次**，確認在已有殘留資料的資料庫上仍然通過。
9. 更新本文件第 2 節的表格。

### 6.2 範例：測試模擬付款

```js
const { app, request, getAdminToken, registerUser } = require('./setup');

describe('Order Payment API', () => {
  let adminToken;
  let userToken;
  let productId;
  let orderId;

  beforeAll(async () => {
    adminToken = await getAdminToken();

    // Use a dedicated product so seed stock is not consumed
    const productRes = await request(app)
      .post('/api/admin/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: `付款測試商品-${Date.now()}`, price: 100, stock: 5 });
    productId = productRes.body.data.id;

    const { token } = await registerUser();
    userToken = token;

    await request(app)
      .post('/api/cart')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ productId, quantity: 2 });

    const orderRes = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        recipientName: '付款測試',
        recipientEmail: 'pay-test@example.com',
        recipientAddress: '台北市測試路 1 號',
      });
    orderId = orderRes.body.data.id;
  });

  it('should reject an invalid action', async () => {
    const res = await request(app)
      .patch(`/api/orders/${orderId}/pay`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ action: 'refund' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('data', null);
    expect(res.body).toHaveProperty('error', 'VALIDATION_ERROR');
  });

  it('should mark a pending order as paid', async () => {
    const res = await request(app)
      .patch(`/api/orders/${orderId}/pay`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ action: 'success' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('error', null);
    expect(res.body.data).toHaveProperty('status', 'paid');
    expect(Array.isArray(res.body.data.items)).toBe(true);
  });

  it('should reject paying an order that is no longer pending', async () => {
    const res = await request(app)
      .patch(`/api/orders/${orderId}/pay`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ action: 'success' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error', 'INVALID_STATUS');
  });

  it('should allow deleting the product once no pending order references it', async () => {
    const res = await request(app)
      .delete(`/api/admin/products/${productId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
  });
});
```

這個範例示範了：自備商品避免消耗 seed 庫存、檔案內依序依賴（pending → paid → 再付一次）、比對確切錯誤碼、以及最後清理自己建立的商品（訂單已 `paid` 且購物車已在下單時清空，故可刪除）。

### 6.3 斷言慣例

```js
// 成功
expect(res.status).toBe(200);
expect(res.body).toHaveProperty('data');
expect(res.body).toHaveProperty('error', null);
expect(res.body).toHaveProperty('message');

// 失敗
expect(res.status).toBe(404);
expect(res.body).toHaveProperty('data', null);
expect(res.body).toHaveProperty('error', 'NOT_FOUND');
```

認證 header：

```js
.set('Authorization', `Bearer ${token}`)   // 會員 / 管理員
.set('X-Session-Id', sessionId)            // 訪客購物車
```

## 7. 常見陷阱

| 陷阱 | 說明 |
| --- | --- |
| 測試檔使用 CommonJS | 測試檔用 `require`，只有 `vitest.config.js` 是 ESM。不要在測試檔混用 `import`。`describe` / `it` / `expect` 是全域的，不需引入 |
| 缺少 `.env` | 症狀是 `Cannot read properties of null (reading 'token')` 或大量 500，而不是明確的設定錯誤 |
| 依賴檔案順序 | `vitest.config.js` 的 `sequence.files` 沒有作用，檔案順序不保證。跨檔案的前置資料一律自己在 `beforeAll` 建立 |
| 打開平行執行 | 不要移除 `fileParallelism: false`，也不要用 `describe.concurrent` / `it.concurrent`：共用資料庫與檔案內依序依賴都會被破壞 |
| 單獨執行中間的案例 | 檔案內案例互相依賴，`-t` / `.only` 可能讓後續案例因變數未設定而失敗 |
| 寫死 Email | 第二次執行會得到 409。使用 `registerUser()` 或加上 `Date.now()` |
| 帶了無效 token 又帶 session id | `/api/cart` 只要有 `Authorization` header 就走 JWT，無效直接 401，不會退回訪客模式 |
| 以為訪客購物車會跟著登入 | 訪客（session）與會員（token）是兩個獨立的購物車；下單只讀會員購物車。要測下單，必須**帶 token** 加入購物車 |
| `price` / `stock` 傳字串 | 後台商品 API 要求 JSON number，`"500"` 會得到 400 |
| 加入購物車預期 201 | `POST /api/cart` 成功回 **200** |
| 刪不掉測試商品 | 商品仍在任何購物車中 → 500；仍在 pending 訂單中 → 409。先清購物車 / 完成付款再刪 |
| `hookTimeout` | `beforeAll` 上限 10 秒。前置步驟包含多次註冊（bcrypt 10 rounds）時留意不要超過 |
| 測試後資料變髒 | 測試寫入的是開發資料庫，不會自動還原。需要乾淨環境時刪除 `database.sqlite*` |
| 管理員密碼被改過 | `.env` 的 `ADMIN_EMAIL` / `ADMIN_PASSWORD` 與測試寫死的值不同、且資料庫為新建時，`getAdminToken()` 會失敗 |
