# PDPC 個資法函釋助理

提供個資法函釋查詢與 AI 問答。React 19 + Vite PWA；檢索在瀏覽器端執行，AI 問答透過 Vercel Function 呼叫 Gemini。

- `/`：函釋查詢，瀏覽器端 BM25 與語意向量檢索，資料來自 `src/data/pdpc_data.json`。
- `/ai`：前端檢索最多 5 筆候選，去重後連同相關法條呼叫 `POST /api/ask`，由 Vercel Function 呼叫 Gemini（`gemini-3.1-flash-lite`）產生回答。
- `/api/ask`：後端介面；單獨啟動 Vite（`npm run dev`）不會提供。

## 本機啟動

需要 Node.js、npm。以下指令在專案根目錄執行。

### 只使用前端查詢

```powershell
npm ci
npm run dev
```

不需要 Gemini 金鑰，但無法執行 AI 問答。首次語意檢索需下載 HuggingFace 模型檔，需保持連線。

### 完整模式（含 AI 問答）

需要 [Vercel CLI](https://vercel.com/docs/cli)。已在 Windows＋CLI 54.18.2 以 `--local` 實測：頁面、`/api/ask` 的同源檢查、未設金鑰與金鑰無效的錯誤分支皆如預期；真實 Gemini 回答只在正式站驗證過。

1. `npm ci`
2. 建立 `.env.local`（已存在則保留）：

   ```powershell
   if (-not (Test-Path -LiteralPath '.env.local')) {
       Copy-Item -LiteralPath '.env.example' -Destination '.env.local'
   }
   ```

3. 編輯 `.env.local` 填入 `GEMINI_API_KEY`。該檔已被 `.gitignore` 排除，請勿提交真實金鑰。
4. 啟動：`vercel dev --local --listen 127.0.0.1:3000`，再開啟 `http://127.0.0.1:3000/`。若 3000 埠已被占用，CLI 會改用下一個埠，請依終端機顯示的網址開啟。

`vercel.json` 的 `devCommand` 是必要的：本機模式下 CLI 預設用 `yarn` 啟動前端，沒安裝 yarn 時 `/`、`/ai` 會回 500（API 仍正常）。它只影響 `vercel dev`，不影響正式部署。

環境變數僅 `GEMINI_API_KEY`，只由後端讀取，不可加 `VITE_` 前綴或放進前端程式。`DISABLE_HMR` 由程序環境直接讀取，不讀 `.env`；需要時在同一個 PowerShell 工作階段先執行 `$env:DISABLE_HMR='true'`。`npm run preview` 只預覽前端產物，不提供 AI API。

AI 問答會將使用者問題、選中的函釋全文與相關法條送至 Gemini，請勿輸入敏感個資。

## 資料與更新

- 資料欄位：「發文日期」為公文實際發文日（由全文解析）；「公布日期」為網站發布日。
- `.github/workflows/update-data.yml` 於每週一 09:00（台灣時間）執行爬蟲，有新函釋才重建向量。
- 爬蟲以（條號, 函釋字號）配對去重；既有函釋內容不會被更新；任一抓取失敗會使 workflow 失敗，且不提交不完整資料。
- `public/data-updated.json` 的日期代表排程最後一次成功檢查的日期（失敗不更新），不是每筆資料的新增日，也不是法律效力證明。

手動更新（會改寫資料產物，請先建立分支或備份）：

```powershell
# Python 需先安裝 requests
python scripts/scrape.py
npm run build:embeddings
```

## API 保護

- 輸入驗證與大小上限：question ≤ 1000 字、contexts ≤ 8 筆、單筆全文 ≤ 3700 字、條文 ≤ 500 字。
- 同源檢查：只接受來自本站的瀏覽器請求。非瀏覽器客戶端可偽造標頭，這不是完整防護。

## 已知限制與風險

**引用驗證有限**
- 只比對回答中「字第N號」的數字是否在本次候選名單內；不驗機關前綴，也不驗論述是否被函釋支持。法律結論必須人工核對。
- 畫面上「引用函釋」只列可確認被引用者；「檢索候選原文」未必全部被引用。

**「查無資料」判斷有限**
- `/ai` 以候選中最高的原始語意相似度與 0.37 比較，低於就不呼叫 Gemini。門檻依 24 個問題實測：個資相關 0.390–0.593、一般離題 0.225–0.350。樣本小，累積實際使用後應重新檢視。
- 邏輯相鄰的法域問題（加班費、房租等，實測 0.395–0.440）分不開，仍會送給 Gemini，由提示詞要求它說明資料不足。
- 不能改用畫面上的「關聯度 %」：它的 BM25 以當次最大值正規化，只要有字詞重疊最高分就固定得 1.0，不同問題之間不可比較。

**依賴漏洞（已接受的風險）**
- `npm audit` 尚餘 9 項：1 critical、4 high 來自 `@xenova/transformers`（經 onnxruntime-web、onnx-proto、protobufjs、sharp）；4 low 來自 `vite-plugin-pwa` 鏈。修補皆需破壞性變更。
- 接受理由：`@xenova/transformers` 已是最後一版。protobufjs 公告的利用前提是攻擊者能控制被載入的 schema／descriptor，本專案只用 `onnx-proto` 預先產生的靜態 schema 解碼模型檔，不符前提；`sharp` 在瀏覽器版被排除（正式 bundle 內無 libvips）；`vite-plugin-pwa` 鏈只在建置時使用。
- 真正的執行期信任點是 `huggingface.co`（模型檔）與 `cdn.jsdelivr.net`（ONNX WASM），沒有完整性檢查，且 service worker 會快取 90 天；任一來源被入侵，惡意程式可讀取使用者輸入的問題。可考慮的緩解：CSP 的 `connect-src` 白名單，或自行託管模型與 WASM。
- **不可執行 `npm audit fix --force`**：它會把 `@xenova/transformers` 降到 1.4.2，破壞語意搜尋。根治方向是遷移到 `@huggingface/transformers`，屬另案。

**其他**
- 專案位於 OneDrive 內，`node_modules` 與少數檔案可能因同步造成讀取逾時；本機 build 異常時，先檢查 OneDrive 同步狀態。
- 向量與來源全文的一致性目前沒有雜湊可驗證；既有函釋內容變更不會自動同步。

現況與待辦見 [PROJECT_STATUS.md](PROJECT_STATUS.md)。
