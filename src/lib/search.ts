import { pipeline, env } from '@xenova/transformers';

env.allowLocalModels = false;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Extractor = any;

// 存 Promise 而非結果，防止並發競爭（C1 fix）
let extractorPromise: Promise<Extractor> | null = null;
let embeddingsPromise: Promise<void> | null = null;

let extractor: Extractor = null;
let embeddingsData: Array<{ 函釋字號: string; 條號: string; embedding: number[] }> | null = null;
let storedDim: number | null = null;

function loadExtractor(): Promise<Extractor> {
  return (extractorPromise ??= pipeline(
    'feature-extraction',
    'Xenova/multilingual-e5-small',
    { quantized: true },
  ).then(e => {
    extractor = e;
    return e;
  }).catch(err => {
    extractorPromise = null; // 失敗後允許重試
    throw err;
  }));
}

function loadEmbeddings(): Promise<void> {
  return (embeddingsPromise ??= fetch('/embeddings.json')
    .then(res => {
      // C2 fix: 檢查 HTTP 狀態，避免 HTML 錯誤頁觸發 SyntaxError
      if (!res.ok) throw new Error(`無法載入向量資料：HTTP ${res.status}`);
      return res.json();
    })
    .then((data: typeof embeddingsData) => {
      embeddingsData = data;
      // C7 fix: 記錄維度供後續驗證
      if (data && data.length > 0) storedDim = data[0].embedding.length;
    })
    .catch(err => {
      embeddingsPromise = null; // 失敗後允許重試（C4 fix：不永久鎖死）
      throw err;
    }));
}

export async function initSearch(): Promise<void> {
  await Promise.all([loadExtractor(), loadEmbeddings()]);
}

export interface SearchResult {
  函釋字號: string;
  條號: string;
  score: number;
}

export async function search(query: string, topK = 5): Promise<SearchResult[]> {
  await initSearch();

  const output = await extractor(`query: ${query}`, { pooling: 'mean', normalize: true });
  const queryVec = Array.from(output.data) as number[];

  // C7 fix: 維度不匹配時立即報錯，而非靜默產生 NaN 分數
  if (storedDim !== null && queryVec.length !== storedDim) {
    throw new Error(
      `向量維度不匹配（模型 ${queryVec.length} vs 儲存 ${storedDim}）。請重新執行 npm run build:embeddings。`
    );
  }

  const scored = embeddingsData!.map(e => ({
    函釋字號: e.函釋字號,
    條號: e.條號,
    score: e.embedding.reduce((sum, v, i) => sum + v * queryVec[i], 0),
  }));

  return scored.sort((a, b) => b.score - a.score).slice(0, topK);
}
