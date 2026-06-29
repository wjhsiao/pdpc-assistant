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

export interface SearchResult { 函釋字號: string; 條號: string; score: number }

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
    return { 函釋字號: m.函釋字號, 條號: m.條號, score: 0.5 * semantic + 0.5 * keyword };
  });

  return scored.sort((a, b) => b.score - a.score).slice(0, topK);
}
