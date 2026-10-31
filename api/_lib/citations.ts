// 函釋字號引用驗證共用邏輯（api/ask.ts 與 src/AiPanel.tsx 共用，避免各自維護一份會漏改）。
//
// 放在 api/_lib/（底線前綴，Vercel 不會把它當成路由）。api/ask.ts 對它的 import 必須帶 .js
// 副檔名：Vercel 執行期是原生 ESM，缺副檔名會 ERR_MODULE_NOT_FOUND，本機 tsc／vite build
// 都檢查不出來（production 因此出過兩次 500）。從 api/ 以外的目錄 import 是否可行沒驗證過：
// 早期兩次失敗的錯誤相同，最後是加上副檔名才修好，不是搬位置修好的。
// 前端（Vite）不受此限制，src/AiPanel.tsx 可直接 import 這個檔案。
//
// 原本用「排除清單」規則猜整段字號的邊界（例如排除標點、空白），但 Markdown 粗體符號
// (*, _ 等) 或行內散文都不在排除清單裡，會被誤判進字號裡，導致明明是正確的引用被判定
// 成「查無對應資料」。改成只比對「字第<數字>號」裡的數字——這段數字才是函釋字號真正
// 具唯一性的部分，不受前綴機關名稱周圍出現什麼字元影響，結構性避開猜邊界的問題。

const CITATION_NUMBER_PATTERN = /字第([0-9]+)號/g;

function citationNumber(函釋字號: string): string | null {
  const m = 函釋字號.match(/字第([0-9]+)號/);
  return m ? m[1] : null;
}

/** 從一段文字裡抓出所有「字第N號」格式的數字（去重）。 */
export function extractCitationNumbers(text: string): string[] {
  const numbers = new Set<string>();
  for (const m of text.matchAll(CITATION_NUMBER_PATTERN)) {
    numbers.add(m[1]);
  }
  return [...numbers];
}

/** 回答文字裡引用的字號數字，若不在 validIds 對應的數字集合內，視為查無對應資料。 */
export function findInvalidCitations(answerText: string, validIds: string[]): string[] {
  const validNumbers = new Set(
    validIds.map(citationNumber).filter((n): n is string => n !== null),
  );
  return extractCitationNumbers(answerText).filter(n => !validNumbers.has(n));
}

/** 回傳 ids 中「字第N號」的數字有出現在回答文字內的函釋字號（依 ids 順序、去重）。 */
export function findCitedIds(answerText: string, ids: string[]): string[] {
  const answerNumbers = new Set(extractCitationNumbers(answerText));
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of ids) {
    const n = citationNumber(id);
    if (n !== null && answerNumbers.has(n) && !seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }
  return result;
}

/** 把抓到的數字格式化回「字第N號」，方便顯示在錯誤訊息裡。 */
export function formatCitationNumber(n: string): string {
  return `字第${n}號`;
}
