// Vercel Serverless Function：接收前端已檢索好的 top-5 函釋，交給 Gemini 生成自然語言回答。
// GEMINI_API_KEY 從 Vercel 環境變數讀取，不進 git、不進 browser bundle。

import { findInvalidCitations, formatCitationNumber } from '../src/lib/citations';

const GEMINI_MODEL = 'gemini-3.1-flash-lite';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

interface Context { 函釋字號: string; 條號: string; 全文: string; 來源URL: string }
interface ArticleText { 條號: string; 條文內容: string }

interface AskRequestBody { question?: string; contexts?: Context[]; articles?: ArticleText[] }

function buildPrompt(question: string, contexts: Context[], articles: ArticleText[], correction?: string): string {
  const articleBlock = articles
    .map(a => `【法條】${a.條號}\n${a.條文內容}`)
    .join('\n\n');

  const contextBlock = contexts
    .map((c, i) => `【函釋 ${i + 1}】條號：${c.條號}｜函釋字號：${c.函釋字號}\n全文：${c.全文}`)
    .join('\n\n');

  const correctionBlock = correction
    ? `\n\n【重要修正指示】你上一次的回答引用了以下不在上述【函釋】清單中的字號：${correction}。這是嚴重錯誤，該字號在提供的資料中不存在對應內容，絕對不可引用。請重新產生一次完整回答，只能引用上方【函釋】清單中實際列出的字號，不可提及、杜撰任何清單外的字號。\n`
    : '';

  return `你是台灣個人資料保護法（個資法）的法律助理。請嚴格依據下方提供的法條原文與官方函釋回答使用者的問題，不得引用這些資料以外的法規知識或臆測，也不得引用、杜撰任何不在下方清單中的函釋字號。${correctionBlock}

${articleBlock}

${contextBlock}

使用者問題：${question}

回答要求：
1. 用清楚易懂的自然語言說明個資法如何適用於使用者的情境，可使用 Markdown。
2. 若提供的資料不足以完整回答，明確說明哪個部分無法從中得出結論，不要臆測。
3. 回答結尾另起一段，列出「引用函釋：」，逐一列出你實際引用的函釋字號（只列有實際用到的，且必須是上方【函釋】清單中出現過的字號，不可自行編造，不必全部列出）。`;
}

function isTransientError(status: number, body: string): boolean {
  return status === 503 || /high demand|UNAVAILABLE/i.test(body);
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Gemini 暫時性過載（503／high demand／UNAVAILABLE）時重試，避免單次過載就整個失敗。
// 這跟下面 handler() 裡「引用驗證不過重新生成」是不同層次的重試，各自獨立。
async function callGemini(apiKey: string, prompt: string, retriesLeft = 2): Promise<string> {
  const geminiRes = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
  });

  if (!geminiRes.ok) {
    const errBody = await geminiRes.text();
    if (retriesLeft > 0 && isTransientError(geminiRes.status, errBody)) {
      await sleep((3 - retriesLeft) * 700);
      return callGemini(apiKey, prompt, retriesLeft - 1);
    }
    throw new Error(`Gemini API 錯誤 (${geminiRes.status})：${errBody.slice(0, 300)}`);
  }

  const data = await geminiRes.json();
  const parts: Array<{ thought?: boolean; text?: string }> =
    data?.candidates?.[0]?.content?.parts ?? [];
  const answer = parts.find(p => !p.thought && typeof p.text === 'string')?.text ?? '';

  if (!answer) throw new Error('Gemini 回應為空，請稍後再試');
  return answer;
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'GEMINI_API_KEY 未設定' });
    return;
  }

  const body: AskRequestBody = req.body ?? {};
  const { question, contexts, articles: articlesInput } = body;
  const articles = Array.isArray(articlesInput) ? articlesInput : [];

  if (!question || typeof question !== 'string') {
    res.status(400).json({ error: 'question 為必填字串' });
    return;
  }
  if (!Array.isArray(contexts) || contexts.length === 0) {
    res.status(400).json({ error: 'contexts 為必填陣列' });
    return;
  }

  const validIds = contexts.map(c => c.函釋字號);

  try {
    // 第一次生成
    let answer = await callGemini(apiKey, buildPrompt(question, contexts, articles));
    let invalid = findInvalidCitations(answer, validIds);

    // 引用了查無對應資料的字號：不可把這種內容端給使用者，重試一次要求修正
    if (invalid.length > 0) {
      const correction = invalid.map(formatCitationNumber).join('、');
      answer = await callGemini(apiKey, buildPrompt(question, contexts, articles, correction));
      invalid = findInvalidCitations(answer, validIds);
    }

    // 重試後仍然引用查無對應資料的字號：直接回錯誤，絕不顯示這個回答
    if (invalid.length > 0) {
      res.status(502).json({
        error: `AI 生成的回答引用了查無對應資料的函釋字號（${invalid.map(formatCitationNumber).join('、')}），已中止顯示以避免誤導，請重新嘗試或換個問法。`,
      });
      return;
    }

    res.status(200).json({ answer });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? '生成回答時發生未知錯誤' });
  }
}
