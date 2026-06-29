import React, { useState, useRef, useEffect } from 'react';
import { Send, Scale, User, Bot, Loader2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { initSearch, search } from './lib/search';
import pdpcData from './data/pdpc_data.json';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

// 建立查詢表：函釋字號 → { 條號, 發文日期, 全文, 來源URL }
const interpMap = new Map<string, {
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

function extractYaoZhi(fullText: string): string {
  const match = fullText.match(/要旨([\s\S]*?)(?:主旨|說明|正本|$)/);
  return match ? match[1].trim() : fullText.substring(0, 300);
}

function formatResults(results: Array<{ 函釋字號: string; 條號: string; score: number }>): string {
  if (results.length === 0) return '未找到相關函釋，請嘗試調整查詢用詞。';

  const lines: string[] = [`找到 **${results.length}** 條相關函釋，依語意相似度排序：\n`];

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const data = interpMap.get(r.函釋字號);
    if (!data) continue;

    const yaoZhi = extractYaoZhi(data.全文);
    lines.push('---');
    lines.push(`### ${i + 1}. ${data.條號}｜${r.函釋字號}`);
    lines.push(`📅 發文日期：${data.發文日期}\n`);
    lines.push(`**要旨**\n\n${yaoZhi}\n`);
    lines.push(`[查看原文 →](${data.來源URL})\n`);
  }

  return lines.join('\n');
}

let modelReady = false;

export default function App() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'assistant',
      content: '您好！請輸入查詢情境或關鍵字，系統將以語意搜尋找出最相關的個資法官方函釋。\n\n*（首次使用時，瀏覽器需下載語意模型約 50MB，請稍候。）*',
    },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('正在為您檢索法規與函釋...');
  const [initError, setInitError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // C6 fix: 預熱失敗時顯示錯誤，而非靜默 console.error
    initSearch().then(() => { modelReady = true; }).catch(err => {
      setInitError('語意模型載入失敗，請確認網路連線後重新整理頁面。');
      console.error('initSearch failed:', err);
    });
  }, []);

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
    setLoadingMessage(modelReady ? '正在為您檢索法規與函釋...' : '正在初始化語意搜尋引擎（首次約需 10–30 秒）...');

    try {
      const results = await search(query, 5);
      modelReady = true;
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

  return (
    <div className="h-screen w-full bg-[#f1f5f9] p-4 sm:p-6 box-border font-sans overflow-hidden">
      <div className="max-w-6xl mx-auto h-full grid grid-cols-4 grid-rows-[60px_1fr_auto] gap-4">
        {/* Header */}
        <header className="col-span-4 bg-[#0f172a] text-white rounded-2xl px-6 py-0 flex items-center justify-between shadow-[0_4px_6px_-1px_rgba(0,0,0,0.05)] border-none">
          <div className="flex items-center gap-3">
            <div className="bg-[#3b82f6] w-8 h-8 rounded-md flex items-center justify-center">
              <Scale className="w-5 h-5 text-white" />
            </div>
            <h1 className="font-extrabold text-[20px] tracking-[-0.5px]">PDPC Legal Assistant</h1>
          </div>
          <div className="text-[13px] opacity-80 font-medium hidden sm:block">
            語意搜尋引擎 · 純前端 · 零 API 費用
          </div>
        </header>

        {/* Chat Area */}
        <main className="col-span-4 bg-white rounded-2xl border border-[#e2e8f0] border-t-4 border-t-[#10b981] shadow-[0_4px_6px_-1px_rgba(0,0,0,0.05)] p-5 sm:p-6 flex flex-col gap-6 overflow-y-auto">
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
        <footer className="col-span-4 bg-white rounded-2xl border border-[#e2e8f0] border-l-4 border-l-[#3b82f6] shadow-[0_4px_6px_-1px_rgba(0,0,0,0.05)] p-5 flex flex-col justify-center">
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
          <div className="mt-3 flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-[#10b981]"></div>
            <span className="text-[12px] font-semibold text-[#64748b]">本機語意搜尋 · 離線可用</span>
            <span className="text-[12px] text-[#94a3b8] ml-2 hidden sm:inline">新增函釋：更新 pdpc_data.json 後執行 npm run build:embeddings</span>
          </div>
        </footer>
      </div>
    </div>
  );
}
