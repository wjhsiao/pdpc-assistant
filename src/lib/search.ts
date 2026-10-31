import { pipeline, env } from '@xenova/transformers';
import pdpcData from '../data/pdpc_data.json';

env.allowLocalModels = false;
env.backends.onnx.wasm.numThreads = 1;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Extractor = any;

// ── 對外匯出的資料查詢表（App.tsx 用）────────────────────────────────────────
export const interpMap = new Map<string, {
  條號: string;
  發文日期: string;
  全文: string;
  來源URL: string;
}>();
for (const article of pdpcData) {
  for (const interp of article.函釋) {
    interpMap.set(interp.函釋字號, {
      條號: article.條號,
      發文日期: interp.發文日期,
      全文: interp.全文,
      來源URL: interp.來源URL,
    });
  }
}

// ── 依條號瀏覽（方向 A：篩選功能，不經 BM25／向量）──────────────────────────────
export interface ArticleSummary { 條號: string; 條文內容: string; count: number }

export const articleList: ArticleSummary[] = pdpcData.map(a => ({
  條號: a.條號,
  條文內容: a.條文內容,
  count: a.函釋.length,
}));

// 條號 → 條文內容 查表（/ai 送給 Gemini 的法條原文用，見 AiPanel.tsx）
const articleTextMap = new Map<string, string>(pdpcData.map(a => [a.條號, a.條文內容]));

export function getArticleText(article: string): string | undefined {
  return articleTextMap.get(article);
}

export interface InterpDetail { 函釋字號: string; 條號: string; 發文日期: string; 全文: string; 來源URL: string }

// 注意：同一則函釋可能同時掛在多條之下（原始資料重複列出），
// 故直接讀取該條底下的 函釋 陣列，不透過以函釋字號去重的 interpMap，
// 避免多條共用同一函釋字號時彼此覆蓋、篩選漏掉的問題。
export function getInterpsByArticle(article: string): InterpDetail[] {
  const target = pdpcData.find(a => a.條號 === article);
  if (!target) return [];
  const results: InterpDetail[] = target.函釋.map(i => ({
    函釋字號: i.函釋字號,
    條號: article,
    發文日期: i.發文日期,
    全文: i.全文,
    來源URL: i.來源URL,
  }));
  return results.sort((a, b) => b.發文日期.localeCompare(a.發文日期));
}

// ── 最新函釋（依發文日期，不經 BM25／向量）────────────────────────────────────

export interface LatestInterp { 函釋字號: string; 條號: string[]; 發文日期: string; 全文: string; 來源URL: string }

// 發文日期 → 可比較的數字（yyyymmdd）；支援 2026-08-19、115/08/19、115年8月19日。無法解析回 null。
function dateKey(raw: string): number | null {
  const iso = raw.match(/^\s*(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (iso) return Number(iso[1]) * 10000 + Number(iso[2]) * 100 + Number(iso[3]);
  const roc = raw.match(/^\s*(?:民國)?(\d{2,3})(?:年|[-/.])(\d{1,2})(?:月|[-/.])(\d{1,2})/);
  if (roc) return (Number(roc[1]) + 1911) * 10000 + Number(roc[2]) * 100 + Number(roc[3]);
  return null;
}

let latestCache: LatestInterp[] | null = null;

function buildLatestList(): LatestInterp[] {
  const byId = new Map<string, LatestInterp>();
  for (const article of pdpcData) {
    for (const i of article.函釋) {
      const existing = byId.get(i.函釋字號);
      if (existing) {
        if (!existing.條號.includes(article.條號)) existing.條號.push(article.條號);
      } else {
        byId.set(i.函釋字號, {
          函釋字號: i.函釋字號,
          條號: [article.條號],
          發文日期: i.發文日期,
          全文: i.全文,
          來源URL: i.來源URL,
        });
      }
    }
  }
  // 日期無法解析者排最後；同日以函釋字號由大到小，讓結果穩定
  return [...byId.values()]
    .map(x => ({ x, k: dateKey(x.發文日期) }))
    .sort((a, b) => {
      if (a.k === null && b.k === null) return b.x.函釋字號.localeCompare(a.x.函釋字號);
      if (a.k === null) return 1;
      if (b.k === null) return -1;
      return b.k - a.k || b.x.函釋字號.localeCompare(a.x.函釋字號);
    })
    .map(e => e.x);
}

// 依「發文日期」新到舊取前 n 則；同一則函釋掛在多條時合併成一筆（條號為陣列）。
export function getLatestInterps(n: number): LatestInterp[] {
  latestCache ??= buildLatestList();
  return latestCache.slice(0, Math.max(0, n));
}

// ── 「列出最新函釋」意圖判斷 ───────────────────────────────────────────────────

const CN_DIGITS: Record<string, number> = { 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const RECENCY_DEFAULT = 3;
const RECENCY_MAX = 10;

function parseCount(token: string): number {
  if (/^\d+$/.test(token)) return Number(token);
  const ten = token.indexOf('十');
  if (ten === -1) return CN_DIGITS[token] ?? RECENCY_DEFAULT;
  const left = ten === 0 ? 1 : (CN_DIGITS[token[0]] ?? 1);
  const right = ten === token.length - 1 ? 0 : (CN_DIGITS[token[ten + 1]] ?? 0);
  return left * 10 + right;
}

// 規則：(1) 要有「最新／最近／近期」（或「新的N則／個」）且提到「函釋」；
// (2) 去掉數量、功能詞、客套話後不能剩下其他內容——剩下就代表有別的主題詞
// （例如「第6條」「同意要件」），那仍是內容問題，回 null 交給語意檢索。
// 回傳筆數：問句有寫就用（1–10），沒寫預設 3。
export function parseRecencyIntent(query: string): number | null {
  const q = query.replace(/[\s，,。.！!？?、；;：:「」『』“”"'()（）]/g, '');
  const newerWord = /最新|最近|近期|新的/.test(q);
  if (!newerWord || !q.includes('函釋')) return null;

  // 數量：不可緊接在「第」後面（「第6條」是條號，不是筆數）
  const countRe = /(?<!第)(\d+|[一二兩三四五六七八九十]+)(?:則|個|筆|份|件|條)/;
  const m = q.match(countRe);
  const count = m ? Math.min(RECENCY_MAX, Math.max(1, parseCount(m[1]))) : RECENCY_DEFAULT;

  let rest = q.replace(countRe, '');
  rest = rest.replace(
    /個人資料保護委員會|個資法|個資|pdpc|函釋|解釋|最新|最近|近期|新的|公布|發布|發佈|發文|出來|請問|請|麻煩|幫我|幫忙|給我|告訴我|可以|能不能|能否|想要|想|列出|顯示|查詢|查|看|找|有哪些|有什麼|是哪些|是什麼|哪些|什麼|哪幾|目前|現在|所有|全部|一下|嗎|呢|吧|啊|呀|的|有|是|我|你|要|看看|依|按|日期|時間|排序|由新到舊|新到舊/gi,
    '',
  );
  return rest.length === 0 ? count : null;
}

// ── BM25 ──────────────────────────────────────────────────────────────────────

const K1 = 1.5, B = 0.75;

function bigrams(text: string): string[] {
  const clean = text.replace(/\s+/g, '');
  const out: string[] = [];
  for (let i = 0; i < clean.length - 1; i++) out.push(clean.slice(i, i + 2));
  return out;
}

interface BM25Doc { id: string; tf: Map<string, number>; len: number }
interface BM25Index { docs: BM25Doc[]; idf: Map<string, number>; avgLen: number }

let bm25Index: BM25Index | null = null;

function getBM25Index(): BM25Index {
  if (bm25Index) return bm25Index;

  const docs: BM25Doc[] = [];
  const df = new Map<string, number>();

  for (const [id, { 條號, 全文 }] of interpMap) {
    const tokens = bigrams(`${條號} ${全文}`);
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    for (const t of tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
    docs.push({ id, tf, len: tokens.length });
  }

  const N = docs.length;
  const avgLen = docs.reduce((s, d) => s + d.len, 0) / N;
  const idf = new Map<string, number>();
  for (const [t, freq] of df) {
    idf.set(t, Math.log((N - freq + 0.5) / (freq + 0.5) + 1));
  }

  bm25Index = { docs, idf, avgLen };
  return bm25Index;
}

function bm25Score(queryTokens: string[], doc: BM25Doc, idf: Map<string, number>, avgLen: number): number {
  let score = 0;
  for (const t of queryTokens) {
    const idfVal = idf.get(t) ?? 0;
    if (idfVal === 0) continue;
    const tf = doc.tf.get(t) ?? 0;
    score += idfVal * (tf * (K1 + 1)) / (tf + K1 * (1 - B + B * doc.len / avgLen));
  }
  return score;
}

// ── 語意模型載入 ──────────────────────────────────────────────────────────────

let extractorPromise: Promise<Extractor> | null = null;
let extractor: Extractor = null;

function loadExtractor(): Promise<Extractor> {
  return (extractorPromise ??= pipeline(
    'feature-extraction',
    'Xenova/bge-base-zh-v1.5',
    { quantized: true },
  ).then(e => {
    extractor = e;
    return e;
  }).catch(err => {
    extractorPromise = null;
    throw err;
  }));
}

// ── Binary embeddings 載入 ────────────────────────────────────────────────────

interface EmbeddingsMeta { dim: number; meta: Array<{ 函釋字號: string; 條號: string }> }

let embeddingsPromise: Promise<void> | null = null;
let embeddingsMeta: EmbeddingsMeta | null = null;
let embeddingsBin: Float32Array | null = null;

function loadEmbeddings(): Promise<void> {
  return (embeddingsPromise ??= Promise.all([
    fetch('/embeddings-meta.json').then(r => {
      if (!r.ok) throw new Error(`無法載入 embeddings-meta.json：HTTP ${r.status}`);
      return r.json() as Promise<EmbeddingsMeta>;
    }),
    fetch('/embeddings.bin').then(r => {
      if (!r.ok) throw new Error(`無法載入 embeddings.bin：HTTP ${r.status}`);
      return r.arrayBuffer();
    }),
  ]).then(([meta, buf]) => {
    embeddingsMeta = meta;
    embeddingsBin = new Float32Array(buf);
  }).catch(err => {
    embeddingsPromise = null;
    throw err;
  }));
}

export async function initSearch(): Promise<void> {
  await Promise.all([loadExtractor(), loadEmbeddings()]);
  getBM25Index(); // 預熱 BM25，避免第一次搜尋時才建立
}

// score＝混合排序用分數（BM25 以當次最大值正規化，跨問題不可比較）；
// semantic＝與該筆向量的原始語意相似度（cosine，跨問題可比較，供「是否相關」的判斷）。
export interface SearchResult { 函釋字號: string; 條號: string; score: number; semantic: number }

export async function search(query: string, topK = 5): Promise<SearchResult[]> {
  await initSearch();

  const { dim, meta } = embeddingsMeta!;
  const bin = embeddingsBin!;

  // 語意分數
  const output = await extractor(`为这个句子生成表示以用于检索相关文章：${query}`, { pooling: 'mean', normalize: true });
  const queryVec: Float32Array = output.data;

  if (queryVec.length !== dim) {
    throw new Error(`向量維度不匹配（模型 ${queryVec.length} vs 儲存 ${dim}）。請重新執行 npm run build:embeddings。`);
  }

  // BM25 分數
  const { docs, idf, avgLen } = getBM25Index();
  const queryTokens = bigrams(query);
  const bm25Scores = new Map<string, number>();
  let maxBM25 = 0;
  for (const doc of docs) {
    const s = bm25Score(queryTokens, doc, idf, avgLen);
    bm25Scores.set(doc.id, s);
    if (s > maxBM25) maxBM25 = s;
  }
  if (maxBM25 > 0) {
    for (const [id, s] of bm25Scores) bm25Scores.set(id, s / maxBM25);
  }

  // 混合排序：語意 50% + BM25 50%
  const scored = meta.map((m, i) => {
    const offset = i * dim;
    let semantic = 0;
    for (let j = 0; j < dim; j++) semantic += bin[offset + j] * queryVec[j];
    const keyword = bm25Scores.get(m.函釋字號) ?? 0;
    return { 函釋字號: m.函釋字號, 條號: m.條號, score: 0.5 * semantic + 0.5 * keyword, semantic };
  });

  return scored.sort((a, b) => b.score - a.score).slice(0, topK);
}
