// /api/ask 的輸入驗證（純函式、無任何 import，方便 node 直接測試）。
// 上限依 src/data/pdpc_data.json 實測：全文最長 3017 字、條文內容最長 395 字，各留 20% 餘裕並無條件進位到百。

export type ValidateResult = { ok: true } | { ok: false; error: string };

const MAX_QUESTION = 1000;
const MAX_CONTEXTS = 8;
const MAX_ARTICLES = 8;
const MAX_FULLTEXT = 3700; // 3017 × 1.2 = 3620.4 → 3700
const MAX_ARTICLE_TEXT = 500; // 395 × 1.2 = 474 → 500
const MAX_DOC_ID = 100;
const MAX_ARTICLE_NO = 30;
const MAX_URL = 300;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// 檢查物件欄位為字串且長度不超過上限；通過回 null，否則回中文錯誤訊息
function checkStringField(obj: Record<string, unknown>, key: string, max: number, where: string): string | null {
  const v = obj[key];
  if (typeof v !== 'string') return `${where}的「${key}」必須是字串`;
  if (v.length > max) return `${where}的「${key}」長度超過上限（${max} 字）`;
  return null;
}

function firstHeader(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

// 從 Origin／Referer 的 URL 取出 host（含 port，小寫）；無法解析回 null
function hostOf(value: string): string | null {
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    return null;
  }
}

// 同源檢查：請求的 Origin（無則看 Referer）host 必須等於本站 host（x-forwarded-host 或 host）。
// 注意：這不是完整防護。瀏覽器 POST 一定帶 Origin，能擋一般腳本／curl 直接亂打；
// 但非瀏覽器客戶端可任意偽造這些標頭，無法防有心人。標頭名稱以小寫為準（Node req.headers）。
export function checkSameOrigin(headers: Record<string, string | string[] | undefined>): ValidateResult {
  const denied: ValidateResult = { ok: false, error: '不允許的請求來源' };

  const allowed = new Set<string>();
  const addHosts = (raw: string | undefined) => {
    if (!raw) return;
    for (const part of raw.split(',')) {
      const h = part.trim().toLowerCase();
      if (h) allowed.add(h);
    }
  };
  addHosts(firstHeader(headers['x-forwarded-host']));
  addHosts(firstHeader(headers['host']));

  const origin = firstHeader(headers['origin']);
  const referer = firstHeader(headers['referer']);
  const source = origin ? origin : referer;
  if (!source) return denied;
  if (source.trim().toLowerCase() === 'null') return denied;

  const host = hostOf(source.trim());
  if (host === null || !allowed.has(host)) return denied;
  return { ok: true };
}

export function validateAskBody(body: unknown): ValidateResult {
  if (!isRecord(body)) return { ok: false, error: '請求內容必須是 JSON 物件' };

  const { question, contexts, articles } = body;

  if (typeof question !== 'string') return { ok: false, error: 'question 必須是字串' };
  const qLen = question.trim().length;
  if (qLen < 1) return { ok: false, error: 'question 不可為空白' };
  if (qLen > MAX_QUESTION) return { ok: false, error: `question 長度超過上限（${MAX_QUESTION} 字）` };

  if (!Array.isArray(contexts)) return { ok: false, error: 'contexts 必須是陣列' };
  if (contexts.length < 1) return { ok: false, error: 'contexts 不可為空陣列' };
  if (contexts.length > MAX_CONTEXTS) return { ok: false, error: `contexts 筆數超過上限（${MAX_CONTEXTS} 筆）` };

  for (let i = 0; i < contexts.length; i++) {
    const c: unknown = contexts[i];
    const where = `contexts[${i}]`;
    if (!isRecord(c)) return { ok: false, error: `${where} 必須是物件` };
    const err =
      checkStringField(c, '函釋字號', MAX_DOC_ID, where) ??
      checkStringField(c, '條號', MAX_ARTICLE_NO, where) ??
      checkStringField(c, '來源URL', MAX_URL, where) ??
      checkStringField(c, '全文', MAX_FULLTEXT, where);
    if (err) return { ok: false, error: err };
  }

  if (articles !== undefined && articles !== null) {
    if (!Array.isArray(articles)) return { ok: false, error: 'articles 必須是陣列' };
    if (articles.length > MAX_ARTICLES) return { ok: false, error: `articles 筆數超過上限（${MAX_ARTICLES} 筆）` };
    for (let i = 0; i < articles.length; i++) {
      const a: unknown = articles[i];
      const where = `articles[${i}]`;
      if (!isRecord(a)) return { ok: false, error: `${where} 必須是物件` };
      const err =
        checkStringField(a, '條號', MAX_ARTICLE_NO, where) ??
        checkStringField(a, '條文內容', MAX_ARTICLE_TEXT, where);
      if (err) return { ok: false, error: err };
    }
  }

  return { ok: true };
}
