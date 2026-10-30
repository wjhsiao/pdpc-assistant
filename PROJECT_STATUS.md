# PDPC assistant 現況與待辦

## 現況

React 19 + Vite PWA。`/` 為瀏覽器端函釋查詢；`/ai` 為問答，經 `POST /api/ask`（Vercel Function）呼叫 Gemini。API 已有輸入驗證、大小上限與同源檢查；每週一由 GitHub Actions 更新資料，爬蟲失敗不會提交不完整資料。架構、資料語意與 API 細節見 [README.md](README.md)。

## 已接受的風險

`npm audit` 殘餘項目、引用驗證能力限制、OneDrive 同步問題，皆記錄於 README 的「[已知限制與風險](README.md#已知限制與風險)」。不可執行 `npm audit fix --force`。

## 待辦

1. 向量產生時一併記錄來源內容雜湊與模型版本，載入時檢查。
2. API 改由後端依可信識別碼重建原文與法條（目前決定暫不做）。
3. 引用是否實質支持論述，仍靠人工抽樣核對。
4. 遷移到 `@huggingface/transformers`，以根治依賴漏洞（另案）。
5. 既有函釋內容變更不會自動同步，需人工處理或另行設計。
6. 累積實際使用後，重新檢視 `/ai` 的語意相似度門檻（`MIN_SEMANTIC_SIMILARITY`，見 README「查無資料判斷有限」）；並考慮把關鍵字搜尋頁面的「關聯度 %」改成可比較的指標，或移除，因為目前跨問題不可比較。
7. 評估加上 `Content-Security-Policy`：需先逐一確認不影響 PWA、service worker 與 HuggingFace 模型／WASM 載入，誤設會讓語意搜尋失效，因此目前只加了不影響功能的基本標頭（`vercel.json`）。
