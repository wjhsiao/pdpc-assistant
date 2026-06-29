/**
 * 執行一次：為 pdpc_data.json 的每條函釋產生向量
 * 輸出：
 *   public/embeddings.bin  — 平坦 Float32Array（N × D）
 *   public/embeddings-meta.json — [{函釋字號, 條號}, ...]
 *
 * 用法：node scripts/build-embeddings.mjs
 */

import { pipeline, env } from '@xenova/transformers';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

env.allowLocalModels = false;

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

function extractEmbedText(fullText) {
  const extract = (pattern) => {
    const m = fullText.match(pattern);
    return m ? m[1].trim() : '';
  };
  const yaoZhi   = extract(/要旨([\s\S]*?)(?:主旨|說明|正本|$)/);
  const zhuZhi   = extract(/主旨([\s\S]*?)(?:說明|正本|$)/).substring(0, 200);
  const shuoMing = extract(/說明([\s\S]*?)(?:正本|$)/).substring(0, 300);
  const combined = [yaoZhi, zhuZhi, shuoMing].filter(Boolean).join(' ');
  return combined || fullText.substring(0, 500);
}

async function main() {
  console.log('載入 bge-base-zh-v1.5 模型...');
  const extractor = await pipeline('feature-extraction', 'Xenova/bge-base-zh-v1.5', {
    quantized: true,
  });

  const pdpcData = JSON.parse(readFileSync(join(root, 'src/data/pdpc_data.json'), 'utf-8'));

  const meta = [];
  const vectors = [];
  let total = 0;
  for (const article of pdpcData) total += article.函釋.length;

  let count = 0, skipped = 0;
  for (const article of pdpcData) {
    for (const interp of article.函釋) {
      const embedText = extractEmbedText(interp.全文);
      if (!embedText) {
        console.warn(`\n⚠ 跳過 ${interp.函釋字號}：無法提取有效內容`);
        skipped++;
        continue;
      }

      const output = await extractor(`${article.條號} ${embedText}`, { pooling: 'mean', normalize: true });
      vectors.push(output.data); // Float32Array
      meta.push({ 函釋字號: interp.函釋字號, 條號: article.條號 });

      count++;
      process.stdout.write(`\r進度：${count}/${total} — ${interp.函釋字號}`);
    }
  }

  const dim = vectors[0].length;
  const bin = new Float32Array(vectors.length * dim);
  vectors.forEach((v, i) => bin.set(v, i * dim));

  mkdirSync(join(root, 'public'), { recursive: true });
  writeFileSync(join(root, 'public/embeddings.bin'), Buffer.from(bin.buffer));
  writeFileSync(join(root, 'public/embeddings-meta.json'), JSON.stringify({ dim, meta }));

  const binMB = (bin.buffer.byteLength / 1024 / 1024).toFixed(2);
  console.log(`\n完成！${meta.length} 條函釋`);
  console.log(`  embeddings.bin  ${binMB} MB`);
  console.log(`  embeddings-meta.json（字號 + 條號索引）`);
  if (skipped) console.log(`  跳過 ${skipped} 條`);
}

main().catch(err => { console.error(err); process.exit(1); });
