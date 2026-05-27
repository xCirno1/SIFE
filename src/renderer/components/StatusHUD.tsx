
import type { IndexStats } from '../types';

interface StatusHUDProps {
  stats: IndexStats;
  modelStatus: string;
}

export default function StatusHUD({ stats, modelStatus }: StatusHUDProps) {
  const isModelLoading = stats.modelStatus === 'loading';
  const isIndexing = stats.isIndexing;

  const dotColor = isModelLoading
    ? '#a855f7'
    : isIndexing
    ? '#facc15'
    : '#22c55e';

  const dotShadow = isModelLoading
    ? '0 0 6px #a855f7'
    : isIndexing
    ? '0 0 6px #facc15'
    : '0 0 6px #22c55e';

  const statusText = isModelLoading
    ? 'Model Loading...'
    : isIndexing
    ? 'Indexing...'
    : 'Synced';

  return (
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
          <span>
            Indexing: {stats.progress.current}/{stats.progress.total} files
          </span>
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
          {stats.modelStatus === 'ready'
            ? 'AI Ready'
            : stats.modelStatus === 'error'
            ? 'AI Error'
            : 'AI Loading'}
        </span>

        {modelStatus && modelStatus !== stats.modelStatus && (
          <span className="opacity-60">{modelStatus}</span>
        )}
      </div>
    </div>
  );
}
