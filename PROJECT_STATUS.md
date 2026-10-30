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
6. 視需要為 `vercel.json` 加上基本安全標頭（`X-Content-Type-Options`、`Referrer-Policy` 等），需先確認不影響 PWA 與 HuggingFace 模型載入。
