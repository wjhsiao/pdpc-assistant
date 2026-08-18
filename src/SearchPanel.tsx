import React, { useState, useRef, useEffect } from 'react';
import { Send, User, Bot, Loader2, List } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { search, interpMap, articleList, getInterpsByArticle, type InterpDetail } from './lib/search';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

function extractYaoZhi(fullText: string): string {
  const match = fullText.match(/要旨([\s\S]*?)(?:主旨|說明|正本|$)/);
  return match ? match[1].trim() : fullText.substring(0, 300);
}

function formatResults(results: Array<{ 函釋字號: string; 條號: string; score: number }>): string {
  if (results.length === 0) return '未找到相關函釋，請嘗試調整查詢用詞。';

  const lines: string[] = [`找到 **${results.length}** 條相關函釋，依關聯度排序：\n`];

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const data = interpMap.get(r.函釋字號);
    if (!data) continue;

    const yaoZhi = extractYaoZhi(data.全文);
    lines.push('---');
    // 條號用 r.條號（這次搜尋實際命中的那條），不用 data.條號——同一則函釋
    // 可能掛在多條之下，interpMap 用函釋字號去重時後面的條號會覆蓋前面的。
    lines.push(`### ${i + 1}. ${r.條號}｜${r.函釋字號} · ${(r.score * 100).toFixed(1)}%`);
    lines.push(`📅 發文日期：${data.發文日期}\n`);
    lines.push(`**要旨**\n\n${yaoZhi}\n`);
    lines.push(`[查看原文 →](${data.來源URL})\n`);
  }

  return lines.join('\n');
}

function formatArticleResults(article: string, interps: InterpDetail[]): string {
  if (interps.length === 0) return `${article} 目前沒有相關函釋。`;

  const lines: string[] = [`**${article}** 共 **${interps.length}** 則函釋，依發文日期新到舊排序：\n`];

  for (let i = 0; i < interps.length; i++) {
    const data = interps[i];
    const yaoZhi = extractYaoZhi(data.全文);
    lines.push('---');
    lines.push(`### ${i + 1}. ${data.函釋字號}`);
    lines.push(`📅 發文日期：${data.發文日期}\n`);
    lines.push(`**要旨**\n\n${yaoZhi}\n`);
    lines.push(`[查看原文 →](${data.來源URL})\n`);
  }

  return lines.join('\n');
}

interface Props {
  modelStatus: 'loading' | 'ready' | 'error';
  initError: string | null;
}

export default function SearchPanel({ modelStatus, initError }: Props) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'assistant',
      content: '您好！請輸入查詢情境或關鍵字，系統將以語意搜尋找出最相關的個資法官方函釋。\n\n*（首次使用時，瀏覽器需下載語意模型，請稍候。）*',
    },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('正在為您檢索法規與函釋...');
  const [mode, setMode] = useState<'keyword' | 'article'>('keyword');
  const [selectedArticle, setSelectedArticle] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const query = input.trim();
    const userMessage: Message = { id: crypto.randomUUID(), role: 'user', content: query };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);
    // modelStatus 是 App.tsx 統一管的初始化狀態（一次初始化，兩個分頁共用），
    // 用它判斷要不要顯示「初始化中」文案，不要各分頁自己土法煉鋼追蹤一份。
    setLoadingMessage(modelStatus === 'ready' ? '正在為您檢索法規與函釋...' : '正在初始化語意搜尋引擎（首次約需 10–30 秒）...');

    try {
      const results = await search(query, 5);
      const content = formatResults(results);
      setMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'assistant', content }]);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : '未知錯誤';
      setMessages(prev => [...prev, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `**錯誤：** 搜尋失敗，請重新整理頁面後再試。(${msg})`,
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleArticleSelect = (article: string) => {
    setSelectedArticle(article);
    if (!article) return;
    const userMessage: Message = { id: crypto.randomUUID(), role: 'user', content: `瀏覽 ${article} 所有函釋` };
    const interps = getInterpsByArticle(article);
    const content = formatArticleResults(article, interps);
    setMessages(prev => [...prev, userMessage, { id: crypto.randomUUID(), role: 'assistant', content }]);
  };

  return (
    <div className="h-full grid grid-rows-[1fr_auto] gap-4 min-h-0">
      {/* Chat Area */}
      <main className="bg-white rounded-2xl border border-[#e2e8f0] border-t-4 border-t-[#10b981] shadow-[0_4px_6px_-1px_rgba(0,0,0,0.05)] p-5 sm:p-6 flex flex-col gap-6 overflow-y-auto">
        <div className="text-[10px] font-bold uppercase tracking-[0.05em] text-[#64748b] mb-[-12px]">語意函釋檢索</div>
        {initError && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-[13px]">
            ⚠ {initError}
          </div>
        )}
        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex gap-4 ${message.role === 'user' ? 'flex-row-reverse' : ''}`}
          >
            <div className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
              message.role === 'user' ? 'bg-[#3b82f6] text-white' : 'bg-[#e2e8f0] text-[#334155]'
            }`}>
              {message.role === 'user' ? <User className="w-5 h-5" /> : <Bot className="w-5 h-5" />}
            </div>

            <div className={`max-w-[85%] rounded-2xl p-4 shadow-sm text-[14px] leading-[1.6] ${
              message.role === 'user'
                ? 'bg-[#3b82f6] text-white rounded-tr-sm'
                : 'bg-[#f8fafc] border border-[#e2e8f0] text-[#1e293b] rounded-tl-sm'
            }`}>
              {message.role === 'user' ? (
                <p className="whitespace-pre-wrap">{message.content}</p>
              ) : (
                <div className="markdown-body">
                  <ReactMarkdown>{message.content}</ReactMarkdown>
                </div>
              )}
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex gap-4">
            <div className="shrink-0 w-8 h-8 rounded-full bg-[#e2e8f0] text-[#334155] flex items-center justify-center">
              <Bot className="w-5 h-5" />
            </div>
            <div className="bg-[#f8fafc] border border-[#e2e8f0] rounded-2xl rounded-tl-sm p-4 flex items-center gap-2 text-[#64748b] shadow-sm">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-[14px] font-medium">{loadingMessage}</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </main>

      {/* Input Area */}
      <footer className="bg-white rounded-2xl border border-[#e2e8f0] border-l-4 border-l-[#3b82f6] shadow-[0_4px_6px_-1px_rgba(0,0,0,0.05)] p-5 flex flex-col justify-center">
        <div className="flex items-center gap-1 mb-3 bg-[#f1f5f9] rounded-lg p-1 w-fit">
          <button
            type="button"
            onClick={() => setMode('keyword')}
            className={`px-3 py-1.5 rounded-md text-[12px] font-semibold transition-colors border-none ${
              mode === 'keyword' ? 'bg-white text-[#1e293b] shadow-sm' : 'bg-transparent text-[#64748b]'
            }`}
          >
            關鍵字搜尋
          </button>
          <button
            type="button"
            onClick={() => setMode('article')}
            className={`px-3 py-1.5 rounded-md text-[12px] font-semibold transition-colors border-none flex items-center gap-1 ${
              mode === 'article' ? 'bg-white text-[#1e293b] shadow-sm' : 'bg-transparent text-[#64748b]'
            }`}
          >
            <List className="w-3.5 h-3.5" />
            依條號瀏覽
          </button>
        </div>

        {mode === 'keyword' ? (
          <>
            <div className="text-[10px] font-bold uppercase tracking-[0.05em] text-[#64748b] mb-2">輸入查詢情境</div>
            <form onSubmit={handleSubmit} className="flex items-end gap-3 w-full">
              <textarea
                className="flex-1 max-h-32 min-h-[44px] bg-[#f8fafc] border border-[#e2e8f0] rounded-xl resize-none outline-none p-3 text-[14px] text-[#1e293b] placeholder:text-[#94a3b8] focus:ring-2 focus:ring-[#3b82f6] focus:border-transparent transition-all"
                placeholder="例如：公司要求全體員工配戴全名名牌是否違反個資法？"
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
                disabled={!input.trim() || isLoading}
                className="shrink-0 bg-[#3b82f6] hover:bg-blue-600 disabled:bg-[#e2e8f0] disabled:text-[#94a3b8] disabled:cursor-not-allowed text-white px-5 py-2.5 rounded-lg font-semibold text-[14px] transition-colors h-[44px] flex items-center justify-center border-none"
              >
                <Send className="w-4 h-4 sm:mr-2" />
                <span className="hidden sm:inline">搜尋</span>
              </button>
            </form>
          </>
        ) : (
          <>
            <div className="text-[10px] font-bold uppercase tracking-[0.05em] text-[#64748b] mb-2">選擇條號直接瀏覽全部函釋</div>
            <select
              className="w-full bg-[#f8fafc] border border-[#e2e8f0] rounded-xl outline-none p-3 text-[14px] text-[#1e293b] focus:ring-2 focus:ring-[#3b82f6] focus:border-transparent transition-all"
              value={selectedArticle}
              onChange={(e) => handleArticleSelect(e.target.value)}
            >
              <option value="">請選擇條號…</option>
              {articleList.map(a => (
                <option key={a.條號} value={a.條號}>
                  {a.條號}（{a.count} 則函釋）
                </option>
              ))}
            </select>
          </>
        )}

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
              <span className="text-[12px] font-semibold text-[#64748b]">本機語意搜尋 · 離線可用</span>
            </>
          )}
        </div>
      </footer>
    </div>
  );
}
