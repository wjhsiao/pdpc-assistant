import { pipeline, env } from '@xenova/transformers';
import pdpcData from '../data/pdpc_data.json';

env.allowLocalModels = false;
env.backends.onnx.wasm.numThreads = 1;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Extractor = any;

let extractorPromise: Promise<Extractor> | null = null;
let embeddingsPromise: Promise<void> | null = null;
let extractor: Extractor = null;
let embeddingsData: Array<{ 函釋字號: string; 條號: string; embedding: number[] }> | null = null;
let storedDim: number | null = null;

// ── BM25 ──────────────────────────────────────────────────────────────────────

const K1 = 1.5, B = 0.75;

// 中文字符 bigram 斷詞
function bigrams(text: string): string[] {
  const clean = text.replace(/\s+/g, '');
  const out: string[] = [];
  for (let i = 0; i < clean.length - 1; i++) out.push(clean.slice(i, i + 2));
  return out;
}

// 每筆函釋的全文（含條號）
const fullTextMap = new Map<string, string>();
for (const article of pdpcData) {
  for (const interp of article.函釋) {
    fullTextMap.set(interp.函釋字號, `${article.條號} ${interp.全文}`);
  }
}

interface BM25Doc { id: string; tf: Map<string, number>; len: number }
interface BM25Index { docs: BM25Doc[]; idf: Map<string, number>; avgLen: number }

let bm25Index: BM25Index | null = null;

function getBM25Index(): BM25Index {
  if (bm25Index) return bm25Index;

  const docs: BM25Doc[] = [];
  const df = new Map<string, number>();

  for (const [id, text] of fullTextMap) {
    const tokens = bigrams(text);
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

function loadExtractor(): Promise<Extractor> {
  return (extractorPromise ??= pipeline(
    'feature-extraction',
    'Xenova/multilingual-e5-small',
    { quantized: true },
  ).then(e => {
    extractor = e;
    return e;
  }).catch(err => {
    extractorPromise = null;
    throw err;
  }));
}

function loadEmbeddings(): Promise<void> {
  return (embeddingsPromise ??= fetch('/embeddings.json')
    .then(res => {
      if (!res.ok) throw new Error(`無法載入向量資料：HTTP ${res.status}`);
      return res.json();
    })
    .then((data: typeof embeddingsData) => {
      embeddingsData = data;
      if (data && data.length > 0) storedDim = data[0].embedding.length;
    })
    .catch(err => {
      embeddingsPromise = null;
      throw err;
    }));
}

export async function initSearch(): Promise<void> {
  await Promise.all([loadExtractor(), loadEmbeddings()]);
}

export interface SearchResult { 函釋字號: string; 條號: string; score: number }

export async function search(query: string, topK = 5): Promise<SearchResult[]> {
  await initSearch();

  // 語意分數
  const output = await extractor(`query: ${query}`, { pooling: 'mean', normalize: true });
  const queryVec = Array.from(output.data) as number[];

  if (storedDim !== null && queryVec.length !== storedDim) {
    throw new Error(`向量維度不匹配（模型 ${queryVec.length} vs 儲存 ${storedDim}）。請重新執行 npm run build:embeddings。`);
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
  // 正規化至 [0, 1]
  if (maxBM25 > 0) {
    for (const [id, s] of bm25Scores) bm25Scores.set(id, s / maxBM25);
  }

  // 混合排序：語意 50% + BM25 50%
  const scored = embeddingsData!.map(e => {
    const semantic = e.embedding.reduce((sum, v, i) => sum + v * queryVec[i], 0);
    const keyword = bm25Scores.get(e.函釋字號) ?? 0;
    return {
      函釋字號: e.函釋字號,
      條號: e.條號,
      score: 0.5 * semantic + 0.5 * keyword,
    };
  });

  return scored.sort((a, b) => b.score - a.score).slice(0, topK);
}
