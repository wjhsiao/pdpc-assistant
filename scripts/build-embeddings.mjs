/**
 * 執行一次：為 pdpc_data.json 的每條函釋產生向量，輸出 public/embeddings.json
 * 用法：node scripts/build-embeddings.mjs
 *
 * 新增函釋時：在 pdpc_data.json 加入資料後重新執行本腳本即可。
 */

import { pipeline, env } from '@xenova/transformers';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

env.allowLocalModels = false;

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

// 提取要旨 + 主旨 + 說明前段，讓嵌入文字更豐富、更有區分度
function extractEmbedText(fullText) {
  const extract = (pattern) => {
    const m = fullText.match(pattern);
    return m ? m[1].trim() : '';
  };
  const yaoZhi  = extract(/要旨([\s\S]*?)(?:主旨|說明|正本|$)/);
  const zhuZhi  = extract(/主旨([\s\S]*?)(?:說明|正本|$)/).substring(0, 200);
  const shuoMing = extract(/說明([\s\S]*?)(?:正本|$)/).substring(0, 300);
  const combined = [yaoZhi, zhuZhi, shuoMing].filter(Boolean).join(' ');
  return combined || fullText.substring(0, 500);
}

async function main() {
  console.log('載入 multilingual-e5-small 模型（首次需下載約 50MB）...');
  const extractor = await pipeline('feature-extraction', 'Xenova/multilingual-e5-small', {
    quantized: true,
  });

  const pdpcData = JSON.parse(readFileSync(join(root, 'src/data/pdpc_data.json'), 'utf-8'));

  const embeddings = [];
  let total = 0;
  for (const article of pdpcData) total += article.函釋.length;

  let count = 0;
  let skipped = 0;
  for (const article of pdpcData) {
    for (const interp of article.函釋) {
      const embedText = extractEmbedText(interp.全文);

      if (!embedText) {
        console.warn(`\n⚠ 跳過 ${interp.函釋字號}：無法提取有效內容`);
        skipped++;
        continue;
      }

      const text = `passage: ${article.條號} ${embedText}`;
      const output = await extractor(text, { pooling: 'mean', normalize: true });

      embeddings.push({
        函釋字號: interp.函釋字號,
        條號: article.條號,
        embedding: Array.from(output.data),
      });

      count++;
      process.stdout.write(`\r進度：${count}/${total} — ${interp.函釋字號}`);
    }
  }

  mkdirSync(join(root, 'public'), { recursive: true });
  const outPath = join(root, 'public/embeddings.json');
  writeFileSync(outPath, JSON.stringify(embeddings));
  console.log(`\n完成！${embeddings.length} 條函釋向量已寫入 public/embeddings.json${skipped ? `（跳過 ${skipped} 條）` : ''}`);
}

main().catch(err => { console.error(err); process.exit(1); });
