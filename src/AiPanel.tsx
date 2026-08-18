import React, { useState, useRef, useEffect } from 'react';
import { Send, Loader2, ChevronDown, AlertTriangle } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { search, interpMap, getArticleText } from './lib/search';

// 低於此分數視為「查無相關函釋」，不呼叫 LLM（省 token）。
// 分數 = 0.5*語意相似度 + 0.5*BM25標準化分數，經驗閾值，可視實際查詢調整。
const RELEVANCE_THRESHOLD = 0.15;

// 從回答文字裡抓「XXX字第123號」格式的函釋字號候選，用來驗證 AI 有沒有引用
// 超出本次提供範圍（或根本不存在）的函釋。全庫 160 筆函釋字號實測皆符合此格式。
const CITATION_PATTERN = /[^\s，。、！？：「」『』（）()]*?字第[0-9]+號/g;

function extractCitationTokens(text: string): string[] {
  const matches = text.match(CITATION_PATTERN) ?? [];
  return [...new Set(matches)];
}

interface Citation { 函釋字號: string; 條號: string; 來源URL: string }
interface SourceDoc { 函釋字號: string; 條號: string; 全文: string; 來源URL: string }

interface Turn {
  id: string;
  question: string;
  status: 'loading' | 'no-match' | 'answered' | 'error';
  answer?: string;
  citations?: Citation[];
  flaggedCitations?: string[];
  sources?: SourceDoc[];
  errorMessage?: string;
}

let modelReady = false;

interface Props {
  modelStatus: 'loading' | 'ready' | 'error';
  initError: string | null;
}

export default function AiPanel({ modelStatus, initError }: Props) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns, isBusy]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const question = input.trim();
    if (!question || isBusy) return;

    const id = crypto.randomUUID();
    setInput('');
    setIsBusy(true);
    setTurns(prev => [...prev, { id, question, status: 'loading' }]);

    try {
      const results = await search(question, 5);
      modelReady = true;

      if (results.length === 0 || results[0].score < RELEVANCE_THRESHOLD) {
        setTurns(prev => prev.map(t => t.id === id ? { ...t, status: 'no-match' } : t));
        return;
      }

      // 同一則函釋可能同時掛在多條之下，top-5 結果去重，避免同一函釋重複佔位、
      // 也避免把重複的全文送給 LLM 浪費 token
      const seen = new Set<string>();
      const contexts = results
        .map(r => {
          const data = interpMap.get(r.函釋字號);
          if (!data) return null;
          return { 函釋字號: r.函釋字號, 條號: data.條號, 全文: data.全文, 來源URL: data.來源URL };
        })
        .filter((c): c is NonNullable<typeof c> => {
          if (c === null || seen.has(c.函釋字號)) return false;
          seen.add(c.函釋字號);
          return true;
        });

      // 送給 Gemini 的法條原文：本次候選函釋涉及的條號各取一次，避免重複
      const articleNos = [...new Set(contexts.map(c => c.條號))];
      const articles = articleNos
        .map(條號 => {
          const 條文內容 = getArticleText(條號);
          return 條文內容 ? { 條號, 條文內容 } : null;
        })
        .filter((a): a is NonNullable<typeof a> => a !== null);

      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, contexts, articles }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }

      const data = await res.json() as { answer: string };
      // 只顯示模型回答內文中實際提到的函釋字號；一個都比對不到時退回顯示全部 contexts
      const cited = contexts.filter(c => data.answer.includes(c.函釋字號));
      const citations: Citation[] = (cited.length > 0 ? cited : contexts)
        .map(c => ({ 函釋字號: c.函釋字號, 條號: c.條號, 來源URL: c.來源URL }));

      // 引用驗證：回答文字裡出現的函釋字號，若不在本次送出的 contexts 範圍內，標記出來提醒使用者
      const sentIds = new Set(contexts.map(c => c.函釋字號));
      const flaggedCitations = extractCitationTokens(data.answer).filter(token => !sentIds.has(token));

      const sources: SourceDoc[] = contexts;

      setTurns(prev => prev.map(t => t.id === id
        ? { ...t, status: 'answered', answer: data.answer, citations, flaggedCitations, sources }
        : t));
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : '未知錯誤';
      setTurns(prev => prev.map(t => t.id === id ? { ...t, status: 'error', errorMessage: msg } : t));
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className="h-full grid grid-rows-[1fr_auto] gap-4 min-h-0">
      {initError && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-[13px]">
          ⚠ {initError}
        </div>
      )}

      <main className="flex flex-col gap-4 overflow-y-auto bg-white rounded-2xl border border-[#e2e8f0] border-t-4 border-t-[#8b5cf6] shadow-[0_4px_6px_-1px_rgba(0,0,0,0.05)] p-5 sm:p-6">
        {turns.length === 0 && (
          <div className="text-[13px] text-[#64748b]">
            請描述具體情境，例如：「公司要求全體員工配戴全名名牌是否違反個資法？」系統會先用語意搜尋找出最相關的函釋，再交給 AI 生成自然語言解答。
          </div>
        )}

        {turns.map(turn => (
          <div key={turn.id} className="flex flex-col gap-2">
            <div className="self-end max-w-[85%] bg-[#8b5cf6] text-white rounded-2xl rounded-tr-sm px-4 py-2.5 text-[14px]">
              {turn.question}
            </div>

            {turn.status === 'loading' && (
              <div className="self-start flex items-center gap-2 bg-[#f8fafc] border border-[#e2e8f0] rounded-2xl rounded-tl-sm px-4 py-3 text-[13px] text-[#64748b]">
                <Loader2 className="w-4 h-4 animate-spin" />
                正在檢索相關函釋並生成回答...
              </div>
            )}

            {turn.status === 'no-match' && (
              <div className="self-start max-w-[90%] bg-[#f8fafc] border border-[#e2e8f0] rounded-2xl rounded-tl-sm px-4 py-3 text-[13px] text-[#64748b]">
                查無資料：找不到與此問題足夠相關的官方函釋，請嘗試換個說法，或改用「關鍵字搜尋」瀏覽相近條文。
              </div>
            )}

            {turn.status === 'error' && (
              <div className="self-start max-w-[90%] bg-red-50 border border-red-200 rounded-2xl rounded-tl-sm px-4 py-3 text-[13px] text-red-700">
                發生錯誤：{turn.errorMessage}
              </div>
            )}

            {turn.status === 'answered' && (
              <div className="self-start max-w-[90%] bg-[#f8fafc] border border-[#e2e8f0] rounded-2xl rounded-tl-sm px-4 py-3.5 text-[14px] leading-[1.6] text-[#1e293b]">
                <div className="markdown-body">
                  <ReactMarkdown>{turn.answer}</ReactMarkdown>
                </div>
                {turn.citations && turn.citations.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-[#e2e8f0] flex flex-col gap-1">
                    <div className="text-[10px] font-bold uppercase tracking-[0.05em] text-[#94a3b8]">引用函釋</div>
                    {turn.citations.map(c => (
                      <a
                        key={c.函釋字號}
                        href={c.來源URL}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[12px] text-[#8b5cf6] hover:underline"
                      >
                        {c.條號}｜{c.函釋字號} →
                      </a>
                    ))}
                  </div>
                )}

                {turn.flaggedCitations && turn.flaggedCitations.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-amber-200 flex flex-col gap-1.5">
                    <div className="flex items-center gap-1.5 text-[11px] font-bold text-amber-700">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      引用範圍提醒
                    </div>
                    <div className="text-[12px] text-amber-700 leading-[1.5]">
                      回答中提到「{turn.flaggedCitations.join('、')}」，
                      {turn.flaggedCitations.some(t => interpMap.has(t))
                        ? '不在本次實際提供給 AI 的函釋範圍內，請自行查證。'
                        : '在資料庫中找不到對應資料，可能是 AI 誤植或杜撰的字號，請勿直接採信。'}
                    </div>
                  </div>
                )}

                {turn.sources && turn.sources.length > 0 && (
                  <details className="mt-3 pt-3 border-t border-[#e2e8f0]">
                    <summary className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-[0.05em] text-[#94a3b8] cursor-pointer select-none [&::-webkit-details-marker]:hidden">
                      <ChevronDown className="w-3.5 h-3.5" />
                      本次參考原文（{turn.sources.length} 則）
                    </summary>
                    <div className="mt-2 flex flex-col gap-3">
                      {turn.sources.map(s => (
                        <div key={s.函釋字號} className="bg-white border border-[#e2e8f0] rounded-xl p-3 text-[12px] text-[#475569] leading-[1.6]">
                          <div className="font-semibold text-[#1e293b] mb-1">{s.條號}｜{s.函釋字號}</div>
                          <p className="whitespace-pre-wrap line-clamp-6">{s.全文}</p>
                          <a href={s.來源URL} target="_blank" rel="noreferrer" className="text-[#8b5cf6] hover:underline">查看原文 →</a>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            )}
          </div>
        ))}
        <div ref={endRef} />
      </main>

      <footer className="bg-white rounded-2xl border border-[#e2e8f0] border-l-4 border-l-[#8b5cf6] shadow-[0_4px_6px_-1px_rgba(0,0,0,0.05)] p-5 flex flex-col justify-center">
        <div className="text-[10px] font-bold uppercase tracking-[0.05em] text-[#64748b] mb-2">輸入問題情境</div>
        <form onSubmit={handleSubmit} className="flex items-end gap-3">
          <textarea
            className="flex-1 max-h-32 min-h-[44px] bg-[#f8fafc] border border-[#e2e8f0] rounded-xl resize-none outline-none p-3 text-[14px] text-[#1e293b] placeholder:text-[#94a3b8] focus:ring-2 focus:ring-[#8b5cf6] focus:border-transparent transition-all"
            placeholder="輸入您的問題情境..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmit(e);
              }
            }}
            rows={1}
          />
          <button
            type="submit"
            disabled={!input.trim() || isBusy}
            className="shrink-0 bg-[#8b5cf6] hover:bg-violet-600 disabled:bg-[#e2e8f0] disabled:text-[#94a3b8] disabled:cursor-not-allowed text-white px-5 py-2.5 rounded-lg font-semibold text-[14px] transition-colors h-[44px] flex items-center justify-center border-none"
          >
            <Send className="w-4 h-4 sm:mr-2" />
            <span className="hidden sm:inline">送出</span>
          </button>
        </form>
        <div className="mt-3 flex items-center gap-2">
          {modelStatus === 'loading' ? (
            <>
              <Loader2 className="w-3 h-3 animate-spin text-[#f59e0b]" />
              <span className="text-[12px] font-semibold text-[#f59e0b]">語意模型載入中，首次約需 10–30 秒…</span>
            </>
          ) : modelStatus === 'error' ? (
            <>
              <div className="w-2 h-2 rounded-full bg-red-500"></div>
              <span className="text-[12px] font-semibold text-red-500">模型載入失敗，請重新整理頁面</span>
            </>
          ) : (
            <>
              <div className="w-2 h-2 rounded-full bg-[#10b981]"></div>
              <span className="text-[12px] font-semibold text-[#64748b]">檢索：本機｜生成：Gemini API</span>
            </>
          )}
        </div>
      </footer>
    </div>
  );
}
