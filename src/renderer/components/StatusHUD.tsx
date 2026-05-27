import { useState, useRef, useEffect } from 'react';
import type { IndexStats } from '../types';

interface AiQueue {
  size: number;
  processing: boolean;
  current: string;
  items: string[];
}

interface StatusHUDProps {
  stats: IndexStats;
  modelStatus: string;
  aiQueue: AiQueue;
}

export default function StatusHUD({ stats, modelStatus, aiQueue }: StatusHUDProps) {
  const [showQueuePanel, setShowQueuePanel] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const isModelLoading = stats.modelStatus === 'loading';
  const isIndexing = stats.isIndexing;

  const dotColor = isModelLoading ? '#a855f7' : isIndexing ? '#facc15' : '#22c55e';
  const dotShadow = isModelLoading ? '0 0 6px #a855f7' : isIndexing ? '0 0 6px #facc15' : '0 0 6px #22c55e';
  const statusText = isModelLoading ? 'Model Loading...' : isIndexing ? 'Indexing...' : 'Synced';

  // Close panel when clicking outside
  useEffect(() => {
    if (!showQueuePanel) return;
    function onPointerDown(e: PointerEvent) {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        btnRef.current && !btnRef.current.contains(e.target as Node)
      ) {
        setShowQueuePanel(false);
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [showQueuePanel]);

  // Auto-close when queue drains
  useEffect(() => {
    if (aiQueue.size === 0) setShowQueuePanel(false);
  }, [aiQueue.size]);

  return (
    <div className="relative">
      <div
        className="h-7 flex items-center justify-between px-3 text-xs no-drag"
        style={{
          backgroundColor: '#0d0d10',
          borderTop: '1px solid #222226',
          color: '#a1a1aa',
        }}
      >
        {/* Left side */}
        <div className="flex items-center gap-2">
          <span
            className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isModelLoading ? 'animate-pulse' : ''}`}
            style={{ backgroundColor: dotColor, boxShadow: dotShadow }}
          />
          <span>{statusText}</span>
        </div>

        {/* Right side */}
        <div className="flex items-center gap-3">
          {isIndexing ? (
            <span>Indexing: {stats.progress.current}/{stats.progress.total} files</span>
          ) : (
            <span>{stats.totalFiles.toLocaleString()} files indexed</span>
          )}

          <span
            className="px-1.5 py-0.5 rounded text-[10px] font-medium"
            style={
              stats.modelStatus === 'ready'
                ? { backgroundColor: 'rgba(34,197,94,0.15)', color: '#4ade80' }
                : stats.modelStatus === 'error'
                ? { backgroundColor: 'rgba(239,68,68,0.15)', color: '#f87171' }
                : { backgroundColor: 'rgba(250,204,21,0.15)', color: '#fbbf24' }
            }
          >
            {stats.modelStatus === 'ready' ? 'AI Ready' : stats.modelStatus === 'error' ? 'AI Error' : 'AI Loading'}
          </span>

          {modelStatus && modelStatus !== stats.modelStatus && (
            <span className="opacity-60">{modelStatus}</span>
          )}

          {aiQueue.size > 0 && (
            <button
              ref={btnRef}
              onClick={() => setShowQueuePanel((v) => !v)}
              className="flex items-center gap-1 cursor-pointer rounded px-1.5 py-0.5 transition-colors"
              style={{
                color: '#a855f7',
                backgroundColor: showQueuePanel ? 'rgba(168,85,247,0.15)' : 'transparent',
              }}
              title="Click to view AI embedding queue"
            >
              {aiQueue.processing && (
                <svg className="w-2.5 h-2.5 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
              )}
              <span>
                AI Queue: {aiQueue.size}
                {aiQueue.current
                  ? ` · ${aiQueue.current.length > 24 ? aiQueue.current.slice(0, 24) + '…' : aiQueue.current}`
                  : ''}
              </span>
              <svg
                className="w-2.5 h-2.5 ml-0.5"
                style={{ transform: showQueuePanel ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}
                viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
              >
                <polyline points="18 15 12 9 6 15" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Queue popup panel — renders above the status bar */}
      {showQueuePanel && aiQueue.size > 0 && (
        <div
          ref={panelRef}
          className="absolute bottom-full right-0 mb-1 rounded-lg shadow-2xl border text-xs overflow-hidden"
          style={{
            backgroundColor: '#18181b',
            borderColor: '#3b0764',
            width: 360,
            maxHeight: 320,
            zIndex: 9999,
          }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between px-3 py-2 border-b"
            style={{ borderColor: '#27272a', backgroundColor: '#09090b' }}
          >
            <div className="flex items-center gap-2" style={{ color: '#a855f7' }}>
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2L2 7l10 5 10-5-10-5z" />
                <path d="M2 17l10 5 10-5" />
                <path d="M2 12l10 5 10-5" />
              </svg>
              <span className="font-semibold">AI Embedding Queue</span>
            </div>
            <span style={{ color: '#71717a' }}>
              {aiQueue.size} pending{aiQueue.processing ? ' · processing…' : ''}
            </span>
          </div>

          {/* Currently processing */}
          {aiQueue.current && (
            <div
              className="flex items-center gap-2 px-3 py-1.5 border-b"
              style={{ borderColor: '#27272a', backgroundColor: 'rgba(168,85,247,0.08)' }}
            >
              <svg className="w-3 h-3 animate-spin flex-shrink-0" style={{ color: '#a855f7' }} viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              <span className="truncate" style={{ color: '#d8b4fe' }} title={aiQueue.current}>
                {aiQueue.current}
              </span>
            </div>
          )}

          {/* Queue list */}
          <div className="overflow-y-auto" style={{ maxHeight: 228 }}>
            {aiQueue.items.length === 0 ? (
              <div className="px-3 py-4 text-center" style={{ color: '#52525b' }}>
                Queue is empty
              </div>
            ) : (
              aiQueue.items.map((label, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 px-3 py-1.5 border-b last:border-b-0"
                  style={{ borderColor: '#27272a' }}
                >
                  <span className="flex-shrink-0 font-mono text-[10px]" style={{ color: '#3f3f46', minWidth: 20 }}>
                    {i + 1}
                  </span>
                  <span className="truncate" style={{ color: '#a1a1aa' }} title={label}>
                    {label}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
