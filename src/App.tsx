import { useState, useEffect } from 'react';
import { Scale, Sparkles } from 'lucide-react';
import { initSearch } from './lib/search';
import SearchPanel from './SearchPanel';
import AiPanel from './AiPanel';

type Page = 'search' | 'ai';

function initialPage(): Page {
  return window.location.pathname === '/ai' ? 'ai' : 'search';
}

export default function App() {
  const [page, setPage] = useState<Page>(initialPage);
  const [modelStatus, setModelStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [initError, setInitError] = useState<string | null>(null);
  const [dataUpdatedAt, setDataUpdatedAt] = useState<string | null>(null);

  useEffect(() => {
    // C6 fix: 預熱失敗時顯示錯誤，而非靜默 console.error
    initSearch().then(() => setModelStatus('ready')).catch(err => {
      setInitError(`語意模型載入失敗，請重新整理頁面。(${err instanceof Error ? err.message : String(err)})`);
      setModelStatus('error');
      console.error('initSearch failed:', err);
    });

    fetch('/data-updated.json')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.updatedAt) setDataUpdatedAt(data.updatedAt); })
      .catch(() => {}); // 純資訊性質，抓不到就不顯示，不影響主功能
  }, []);

  const switchTo = (next: Page) => {
    setPage(next);
    const path = next === 'ai' ? '/ai' : '/';
    if (window.location.pathname !== path) {
      window.history.pushState(null, '', path);
    }
  };

  return (
    <div className="h-screen w-full bg-[#f1f5f9] p-4 sm:p-6 box-border font-sans overflow-hidden">
      <div className="max-w-6xl mx-auto h-full flex flex-col gap-4 min-h-0">
        {/* Header */}
        <header className="shrink-0 bg-[#0f172a] text-white rounded-2xl px-6 py-3 flex items-center justify-between shadow-[0_4px_6px_-1px_rgba(0,0,0,0.05)] gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className={`w-8 h-8 rounded-md flex items-center justify-center shrink-0 ${page === 'ai' ? 'bg-[#8b5cf6]' : 'bg-[#3b82f6]'}`}>
              {page === 'ai' ? <Sparkles className="w-5 h-5 text-white" /> : <Scale className="w-5 h-5 text-white" />}
            </div>
            <div>
              <h1 className="font-extrabold text-[18px] sm:text-[20px] tracking-[-0.5px] leading-tight">
                {page === 'ai' ? 'PDPC AI 問答' : 'PDPC 個資法函釋助理'}
              </h1>
              {dataUpdatedAt && (
                <div className="text-[11px] text-white/50 leading-tight">函釋資料更新至 {dataUpdatedAt}</div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1 bg-white/10 rounded-lg p-1">
            <button
              type="button"
              onClick={() => switchTo('search')}
              className={`px-3 py-1.5 rounded-md text-[12px] font-semibold transition-colors border-none ${
                page === 'search' ? 'bg-white text-[#0f172a]' : 'bg-transparent text-white/80'
              }`}
            >
              函釋查詢
            </button>
            <button
              type="button"
              onClick={() => switchTo('ai')}
              className={`px-3 py-1.5 rounded-md text-[12px] font-semibold transition-colors border-none ${
                page === 'ai' ? 'bg-white text-[#0f172a]' : 'bg-transparent text-white/80'
              }`}
            >
              AI 問答
            </button>
          </div>
        </header>

        <div className="flex-1 min-h-0">
          {page === 'search'
            ? <SearchPanel modelStatus={modelStatus} initError={initError} />
            : <AiPanel modelStatus={modelStatus} initError={initError} />}
        </div>
      </div>
    </div>
  );
}
