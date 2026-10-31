# PDPC 個資法函釋助理

個人資料保護法官方函釋的查詢與 AI 問答工具。函釋資料來自個人資料保護委員會網站（`www.pdpc.gov.tw`），每週自動更新。

> 本工具的輸出僅供檢索與參考。AI 回答是依檢索到的函釋生成，**法律結論必須人工核對原文**。

## 功能

- **函釋查詢（`/`）**
  - 關鍵字搜尋：輸入情境或關鍵字，以 BM25 與語意向量混合排序，找出最相關的函釋。檢索全程在瀏覽器執行（首次需從 HuggingFace 與 jsDelivr 下載模型與 WASM），不需金鑰、不需自己的後端。
  - 依條號瀏覽：選一個條號，列出該條底下所有函釋，依公文發文日由新到舊排序。
  - 最新函釋：按 3／5／10 則按鈕，依發文日期列出最新函釋；在關鍵字搜尋輸入「最新的三個函釋」這類問句也會直接列出。
- **AI 問答（`/ai`）**：描述情境（問「最新幾則函釋」時以發文日期最新者作為候選），系統先檢索相關函釋與對應法條，再交給 Gemini 生成自然語言回答，附上引用的函釋字號與可展開的檢索原文。
- **PWA**：可安裝。`/` 與 `/ai` 是同一個 app 的兩個分頁（上方切換鈕），網址會同步，因此只有一個安裝身份。

## 架構

```
scripts/scrape.py ──► src/data/pdpc_data.json ──► scripts/build-embeddings.mjs ──► public/embeddings.bin
 （每週 GitHub Actions）                                                          └► public/embeddings-meta.json
                                         │
                                  瀏覽器載入資料與向量（BM25 + 語意向量）
                                         │
   /   函釋查詢 ◄────────────────────────┤
   /ai 問答：檢索 5 筆 → 相關度門檻 → POST /api/ask → Gemini → 引用驗證 → 顯示
```

技術：React 19、TypeScript、Tailwind CSS v4、Vite 6、`vite-plugin-pwa`。檢索用 `@xenova/transformers` 在瀏覽器以 WASM 執行 `Xenova/bge-base-zh-v1.5`（量化版）。後端是一支 Vercel Function（`api/ask.ts`），呼叫 `gemini-3.1-flash-lite`。

| 路徑 | 內容 |
|---|---|
| `src/App.tsx` | 外殼：模型初始化、分頁切換、資料更新日期 |
| `src/SearchPanel.tsx`、`src/AiPanel.tsx` | 函釋查詢、AI 問答兩個分頁 |
| `src/lib/search.ts` | 資料查表、BM25、語意向量、混合排序 |
| `src/data/pdpc_data.json` | 函釋資料（條 → 函釋陣列） |
| `public/embeddings.*`、`public/data-updated.json` | 向量與其對照表、排程最後成功檢查日期 |
| `api/ask.ts`、`api/_lib/` | 後端與其共用模組（引用驗證 `citations.ts`、輸入／來源驗證 `validate.ts`） |
| `scripts/` | 爬蟲 `scrape.py`、向量產生 `build-embeddings.mjs` |
| `.github/workflows/update-data.yml` | 每週更新資料的排程 |
| `vercel.json` | 路由改寫、安全標頭、`vercel dev` 的前端啟動指令 |

## 本機開發

需要 Node.js 與 npm。以下在專案根目錄執行（PowerShell）。

### 只使用前端查詢

```powershell
npm ci
npm run dev
```

不需要 Gemini 金鑰，但沒有 `/api/ask`，無法使用 AI 問答。首次語意檢索需從 HuggingFace 下載模型檔，需保持連線。

### 完整模式（含 AI 問答）

需要 [Vercel CLI](https://vercel.com/docs/cli)。

1. `npm ci`
2. 建立 `.env.local`（已存在則保留），再編輯填入 `GEMINI_API_KEY`。該檔已被 `.gitignore` 排除，請勿提交真實金鑰：

   ```powershell
   if (-not (Test-Path -LiteralPath '.env.local')) {
       Copy-Item -LiteralPath '.env.example' -Destination '.env.local'
   }
   ```

3. 啟動：`vercel dev --local --listen 127.0.0.1:3000`，開啟終端機顯示的網址。若 3000 埠被占用，CLI 會改用下一個埠。

說明：

- `GEMINI_API_KEY` 是唯一的環境變數，只由後端讀取，不可加 `VITE_` 前綴或放進前端程式。
- `vercel.json` 的 `devCommand` 是必要的：本機模式下 CLI 預設用 `yarn` 啟動前端，沒安裝 yarn 時 `/` 與 `/ai` 會回 500（API 仍正常）。它只影響 `vercel dev`，不影響正式部署。
- `npm run preview` 只預覽前端建置產物，不提供 API。`DISABLE_HMR` 由程序環境直接讀取，不讀 `.env`。
- 型別檢查 `npm run lint`（即 `tsc --noEmit`）、建置 `npm run build`。目前沒有自動化測試。

## 檢索如何運作

- **向量**：每筆函釋以「條號＋要旨＋主旨前 200 字＋說明前 300 字」計算，查詢則加上 bge 的中文檢索指令前綴。向量與對照表由 `npm run build:embeddings` 產生。
- **BM25**：對「條號＋全文」建立字元 bigram 索引，以函釋字號為單位（一則函釋一份文件）。同一則函釋掛在多個條號時，條號取資料中最後出現的那條，且這幾列共用同一個 BM25 分數；向量則是每個（條號, 函釋）各一列。
- **混合排序**：`score = 0.5 × 語意相似度 + 0.5 × BM25`，其中 BM25 以當次的最大值正規化。
- **兩種分數不可混用**：`score` 只用於同一次查詢內排序，跨問題不可比較（只要有任何字詞重疊，最高分的 BM25 就固定是 1，離題問題也有約 60%）。判斷「是否相關」要用 `semantic`，它是原始的語意相似度（cosine）。

- **最新函釋**：不經 BM25／向量，`getLatestInterps(n)` 把全部函釋依函釋字號去重（同一則掛多條時合併，保留所有條號），依「發文日期」（非公布日期）新到舊排序。`parseRecencyIntent(query)` 判斷問句是否「只是要看最新函釋」：須含「最新／最近／近期」（或「新的N則」）與「函釋」，且去掉數量與功能詞後不得剩其他主題詞（如「第6條」「同意要件」），否則仍走語意檢索。數量支援阿拉伯與中文數字，預設 3、上限 10。

## AI 問答流程

1. 前端檢索最多 5 筆候選。問題若命中「最新函釋」意圖（見上），改取發文日期最新的 N 則（後端 contexts 上限 8，故最多 8 則），並略過下一步的門檻。
2. **相關度門檻**：候選中最高的 `semantic` 低於 `0.37` 就顯示「查無資料」，不呼叫後端。
3. 同一則函釋可能掛在多個條號底下，依函釋字號去重；條號取這次檢索實際命中的那條；附上涉及條號的法條原文。
4. `POST /api/ask`，後端依序檢查：HTTP 方法 → 同源（403）→ 金鑰（500）→ 輸入驗證（400）。
5. 呼叫 Gemini，提示詞要求只依提供的法條與函釋回答、不得杜撰字號。遇到 503／過載最多重試 2 次。
6. **引用驗證**：從回答抽出「字第 N 號」，數字不在本次候選名單內就帶著修正指示重新生成一次；仍不符回 502，不顯示該回答。前端會再驗一次。
7. 畫面顯示回答、**引用函釋**（只列確認被引用者）與可展開的**檢索候選原文**（未必全部被引用）。

API 保護（常數見 `api/_lib/validate.ts`）：

- 輸入上限：問題 ≤ 1000 字、候選 ≤ 8 筆、單筆全文 ≤ 3700 字、單條法條 ≤ 500 字。上限依實際資料最大值留 20% 餘裕。
- 同源檢查：只接受來自本站的瀏覽器請求（比對 `Origin`，無則比對 `Referer`）。非瀏覽器客戶端可偽造標頭，**這不是完整防護**。

## 資料與更新

資料為兩層結構：條（`條號`、`條文內容`、`函釋列表URL`）底下有 `函釋` 陣列。同一則函釋可能出現在多個條號底下，各自一列。

函釋欄位：`函釋字號`、`標題`、`發文日期`（公文實際發文日，由全文解析）、`公布日期`（網站發布日）、`全文`、`來源URL`。

**排程**（`.github/workflows/update-data.yml`）：每週一 09:00（台灣時間）執行爬蟲；有新函釋才重建向量；最後寫入 `public/data-updated.json` 並提交。

- 爬蟲以（條號, 函釋字號）配對去重：已存在的配對會略過，既有函釋的內容**不會**被更新。
- 任何一筆抓取失敗，爬蟲會在寫回已成功的內容後以非 0 結束，使 workflow 失敗，因此不會提交不完整的資料，也不會更新成功日期。
- `data-updated.json` 的日期是「排程最後一次成功檢查的日期」，不是每筆資料的新增日，也不代表法律效力。
- 工作流程中的 GitHub Actions 已釘死到 commit SHA，版本號寫在行尾註解。

手動更新會改寫資料產物，請先建立分支或備份：

```powershell
# 需先安裝 Python 與 requests；在 Windows 終端機請先設定 $env:PYTHONIOENCODING='utf-8'
python scripts/scrape.py
npm run build:embeddings
```

試跑時可用環境變數 `PDPC_DATA_PATH` 指向資料檔的複本，避免動到正式資料。

## 部署

Vercel 會從 `master` 自動部署。需在專案環境變數設定 `GEMINI_API_KEY`（Production 與 Preview）。`vercel.json` 內容：

- `/ai` 改寫到 `index.html`（單頁應用，頁面由前端依網址切換）。
- 安全標頭：`X-Content-Type-Options: nosniff`、`Referrer-Policy: strict-origin-when-cross-origin`、`X-Frame-Options: DENY`。
- 尚未設定 `Content-Security-Policy`：設錯會讓模型或 WASM 載入失敗，需在預覽部署上驗證，見 [PROJECT_STATUS.md](PROJECT_STATUS.md)。

PWA 以 `autoUpdate` 更新；HuggingFace 模型檔與 jsDelivr 的 WASM 以 CacheFirst 快取 90 天。部署後若看到舊畫面，重新整理或清除網站資料。

## 已知限制與風險

**「查無資料」判斷有限**
- 門檻 `0.37` 依 24 個問題實測（2026-10）：個資相關 0.390–0.593、一般離題 0.225–0.350。樣本小，語料或模型變動後應重新檢視。**原始問題與量測腳本尚未納入專案**（已列入待辦），目前無法從專案內重現這組數字。
- 邏輯相鄰的法域問題（加班費、房租等，實測 0.395–0.440）分不開，仍會送給 Gemini，由提示詞要求它說明資料不足。

**引用驗證有限**
- 只比對「字第 N 號」的數字是否在候選名單內；不驗機關前綴，也不驗論述是否被函釋支持。

**依賴漏洞（已接受的風險）**
- （以下依 2026-10 的 `npm audit` 與 GitHub Advisory 原文評估，之後可能過期。）`npm audit` 仍有未修的項目，其中 critical 與 high 來自 `@xenova/transformers`（經 onnxruntime-web、onnx-proto、protobufjs、sharp），其餘多為建置期工具（`vite-plugin-pwa` → `workbox-build` 鏈）。`@xenova/transformers` 已是最後一版，修補需要破壞性變更。
- 評估：protobufjs 公告的利用前提是攻擊者能控制被載入的 schema 或 descriptor，本專案只用 `onnx-proto` 預先產生的靜態 schema；`sharp` 在瀏覽器版被排除，正式 bundle 內沒有 libvips；建置期工具不隨網站出貨。
- **不可執行 `npm audit fix --force`**：它會把 `@xenova/transformers` 降到 1.4.2，破壞語意搜尋。根治方向是遷移到 `@huggingface/transformers`，屬另案。
- 真正的執行期信任點是 `huggingface.co`（模型檔）與 `cdn.jsdelivr.net`（ONNX WASM），沒有完整性檢查，且會被快取 90 天；任一來源被入侵，惡意程式可讀取使用者輸入的問題。可考慮的緩解：CSP 的 `connect-src` 白名單，或自行託管模型與 WASM。

**其他**
- 向量與來源全文的一致性沒有雜湊可驗證；既有函釋內容變更不會自動同步。
- 專案若放在 OneDrive，`node_modules` 與部分檔案可能因同步而讀取逾時或變成僅雲端佔位檔，導致建置失敗；先檢查 OneDrive 同步狀態。

## 維護注意事項

- `api/` 內檔案互相 import 必須帶 `.js` 副檔名（例如 `'./_lib/citations.js'`）：Vercel 執行期是原生 ESM，不帶副檔名會 `ERR_MODULE_NOT_FOUND`，本機 `tsc` 與 `vite build` 都檢查不出來。前端（Vite）則不受此限制，`src/AiPanel.tsx` 可直接 import `api/_lib/citations`。共用模組目前放在 `api/_lib/`；從 `api/` 以外的目錄 import 是否可行沒有驗證過（早期兩次失敗的錯誤相同，最後是加上副檔名才修好，見 commit `9b834fc`、`4e5c711`）。
- 取函釋的條號時，用檢索結果自己的 `條號`，不要用以函釋字號為鍵的 `interpMap`：同一則函釋掛在多個條號時，後面的條號會覆蓋前面的。
- 改動 `api/` 後，本機建置通過不代表部署後可用，部署完要實際打一次 `/api/ask`。

相關文件：[PROJECT_STATUS.md](PROJECT_STATUS.md)（現況與待辦）。
