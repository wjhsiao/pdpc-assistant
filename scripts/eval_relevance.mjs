/**
 * 「查無資料」相關度門檻重測腳本
 *
 * 作用：對 scripts/relevance_questions.json 的每一題，計算它與全部函釋向量的最高 cosine
 *       相似度（即 SearchResult.semantic），與 src/AiPanel.tsx 的 MIN_SEMANTIC_SIMILARITY 比較，
 *       並報告各分類範圍與「個資相關 vs 一般離題」的間距。
 *
 * 需與 src/lib/search.ts 保持一致，改一邊要改另一邊：
 *   - 模型：Xenova/bge-base-zh-v1.5，quantized: true
 *   - 查詢前綴：「为这个句子生成表示以用于检索相关文章：」+ 問題（簡體字原樣，不可改）
 *   - 向量化選項：pooling 'mean'、normalize true；相似度＝已正規化向量內積
 *   - 函釋向量：直接讀 public/embeddings.bin + embeddings-meta.json（與 App 載入的同一份）。
 *     328 列向量的文字（條號＋要旨＋主旨前200字＋說明前300字）由 scripts/build-embeddings.mjs
 *     產生；資料更新後須先 npm run build:embeddings 再跑本腳本，本腳本不重建向量。
 *
 * 與 App 的差異：App 取混合分數（語意＋BM25）前 5 名再取其 semantic 最大值；本腳本取全部
 *   328 列的最大值（與先前量測一致）。全域最大值 >= 前 5 名最大值，故本腳本對離題題的分數
 *   只會偏高、不會偏低，間距的判讀偏保守。
 *
 * 用法（專案根目錄）：
 *   PowerShell 5.1 先設輸出編碼避免亂碼：
 *     chcp 65001 > $null; [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
 *     node scripts/eval_relevance.mjs
 *   何時重跑：函釋資料更新（重建向量）後、更換模型後、調整 MIN_SEMANTIC_SIMILARITY 之前。
 *   首次執行會從 huggingface.co 下載量化模型（約百餘 MB），需連網，快取於
 *   node_modules/@xenova/transformers/.cache；之後離線可跑。
 *   結束碼：0＝正常；1＝讀檔／解析錯誤；2＝個資相關最低分與離題最高分重疊或間距 < 0.02。
 */

import { pipeline, env } from '@xenova/transformers';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

env.allowLocalModels = false;

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const MIN_GAP = 0.02;
const LEGAL = '個資相關';

function readThreshold() {
  const src = readFileSync(join(root, 'src/AiPanel.tsx'), 'utf-8');
  const m = src.match(/const\s+MIN_SEMANTIC_SIMILARITY\s*=\s*([0-9]*\.?[0-9]+)\s*;/);
  if (!m) throw new Error('在 src/AiPanel.tsx 找不到 MIN_SEMANTIC_SIMILARITY 常數定義');
  return Number(m[1]);
}

function loadVectors() {
  const { dim, meta } = JSON.parse(readFileSync(join(root, 'public/embeddings-meta.json'), 'utf-8'));
  const b = readFileSync(join(root, 'public/embeddings.bin'));
  const bin = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  if (bin.length !== dim * meta.length) {
    throw new Error(`embeddings.bin（${bin.length}）與 meta（${meta.length} 列 × ${dim} 維）不符`);
  }
  return { dim, meta, bin };
}

const f = (n) => n.toFixed(4);

async function main() {
  const t0 = Date.now();
  const threshold = readThreshold();
  const { dim, meta, bin } = loadVectors();
  const questions = JSON.parse(readFileSync(join(here, 'relevance_questions.json'), 'utf-8'));

  console.log(`門檻 MIN_SEMANTIC_SIMILARITY = ${threshold}（讀自 src/AiPanel.tsx）｜向量 ${meta.length} 列 × ${dim} 維｜題數 ${questions.length}`);
  console.log('載入模型 Xenova/bge-base-zh-v1.5 ...');
  const extractor = await pipeline('feature-extraction', 'Xenova/bge-base-zh-v1.5', { quantized: true });

  const rows = [];
  for (const q of questions) {
    const out = await extractor(`为这个句子生成表示以用于检索相关文章：${q.question}`, { pooling: 'mean', normalize: true });
    const v = out.data;
    if (v.length !== dim) throw new Error(`向量維度不匹配（模型 ${v.length} vs 儲存 ${dim}）`);
    let best = -Infinity, bestIdx = -1;
    for (let i = 0; i < meta.length; i++) {
      let s = 0;
      for (let j = 0; j < dim; j++) s += bin[i * dim + j] * v[j];
      if (s > best) { best = s; bestIdx = i; }
    }
    rows.push({ ...q, semantic: best, id: meta[bestIdx].函釋字號, art: meta[bestIdx].條號 });
  }

  console.log('\n=== 逐題結果（分類｜最高 semantic｜是否低於門檻｜來源｜最高分函釋）===');
  for (const r of rows) {
    const flag = r.semantic < threshold ? '低於(查無資料)' : '通過(送LLM)';
    console.log(`[${r.category}] ${f(r.semantic)} ${flag} (${r.source}) ${r.question} → ${r.id} (${r.art})`);
  }

  console.log('\n=== 各分類範圍 ===');
  const cats = [...new Set(rows.map(r => r.category))];
  const stat = {};
  for (const c of cats) {
    const s = rows.filter(r => r.category === c).map(r => r.semantic);
    stat[c] = { n: s.length, min: Math.min(...s), max: Math.max(...s) };
    const below = s.filter(x => x < threshold).length;
    console.log(`${c}：${s.length} 題，min ${f(stat[c].min)} ～ max ${f(stat[c].max)}，低於門檻 ${below} 題`);
  }

  console.log('\n=== 最接近門檻的 5 題 ===');
  [...rows].sort((a, b) => Math.abs(a.semantic - threshold) - Math.abs(b.semantic - threshold)).slice(0, 5)
    .forEach(r => console.log(`${f(r.semantic)}（差 ${(r.semantic - threshold >= 0 ? '+' : '') + f(r.semantic - threshold)}）[${r.category}] ${r.question}`));

  let exit = 0;
  console.log('\n=== 間距檢查 ===');
  const legal = stat[LEGAL];
  const off = stat['一般離題'];
  if (!legal || !off) {
    throw new Error(`題庫缺少「${LEGAL}」或「一般離題」分類，無法計算間距`);
  }
  const gap = legal.min - off.max;
  console.log(`個資相關最低分 ${f(legal.min)} － 一般離題最高分 ${f(off.max)} ＝ 間距 ${f(gap)}`);
  if (gap < MIN_GAP) {
    console.log(`警告：間距 ${f(gap)} < ${MIN_GAP}（${gap < 0 ? '兩類分數重疊' : '間距過小'}），門檻無法穩定區分，需重新檢視。`);
    exit = 2;
  }
  if (!(off.max < threshold && threshold <= legal.min)) {
    console.log(`警告：門檻 ${threshold} 未落在 (離題最高 ${f(off.max)}, 個資相關最低 ${f(legal.min)}] 區間內。`);
    exit = 2;
  } else {
    console.log(`門檻 ${threshold} 位於兩類之間：距離題上緣 ${f(threshold - off.max)}，距個資相關下緣 ${f(legal.min - threshold)}。`);
  }
  if (stat['相鄰法域']) {
    console.log('註：「相鄰法域」題已知與個資相關重疊，設計上仍送 LLM，不納入間距判定。');
  }
  console.log(`\n耗時 ${((Date.now() - t0) / 1000).toFixed(1)} 秒`);
  process.exit(exit);
}

main().catch(err => { console.error(err.message ?? err); process.exit(1); });
