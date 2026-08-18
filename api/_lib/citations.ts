// 函釋字號引用驗證共用邏輯（api/ask.ts 與 src/AiPanel.tsx 共用，避免各自維護一份會漏改）。
//
// 放在 api/_lib/ 而不是 src/lib/：Vercel 的 serverless function 打包只會追蹤
// api/ 目錄底下的相依檔案，從 api/ash.ts import 專案外（例如 src/）的檔案在
// runtime 會出現 ERR_MODULE_NOT_FOUND（實測過，見 commit）。放在 api/ 底下、
// 檔名加底線前綴，Vercel 不會把它當成路由，但函式的相依追蹤看得到它；
// 前端（Vite）沒有這個限制，可以照樣從 src/ 外面 import 這個檔案。
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

/** 把抓到的數字格式化回「字第N號」，方便顯示在錯誤訊息裡。 */
export function formatCitationNumber(n: string): string {
  return `字第${n}號`;
}
