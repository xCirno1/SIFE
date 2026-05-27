import { useState, useEffect, useRef, useCallback } from 'react';

interface LogEntry {
  level: string;
  source: string;
  message: string;
  ts: string;
}

interface DebugPanelProps {
  onClose: () => void;
}

function levelColor(level: string): string {
  if (level === 'ERROR') return '#f87171'; // red-400
  if (level === 'WARN') return '#fbbf24';  // amber-400
  return '#86efac';                         // green-300
}

export default function DebugPanel({ onClose }: DebugPanelProps) {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [logFilePath, setLogFilePath] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Load existing log buffer on mount
  useEffect(() => {
    window.sifeEngine.getLogs().then(({ lines, filePath }) => {
      const parsed = lines.map((line) => parseLogLine(line));
      setEntries(parsed);
      setLogFilePath(filePath);
    }).catch(console.error);

    // Subscribe to live log events
    window.sifeEngine.onLog((data) => {
      setEntries((prev) => [
        ...prev.slice(-499), // keep last 500
        { level: data.level, source: data.source, message: data.message, ts: new Date().toISOString() },
      ]);
    });

    return () => {
      window.sifeEngine.removeAllListeners('sife:log');
    };
  }, []);

  useEffect(() => {
    if (autoScroll) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [entries, autoScroll]);

  const handleCopy = useCallback(() => {
    const text = entries.map((e) => `[${e.ts}] [${e.level}] [${e.source}] ${e.message}`).join('\n');
    navigator.clipboard.writeText(text).catch(console.error);
  }, [entries]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.75)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-[780px] max-w-[95vw] h-[520px] rounded-lg flex flex-col overflow-hidden"
        style={{ backgroundColor: '#0d0d10', border: '1px solid #222226', boxShadow: '0 25px 60px rgba(0,0,0,0.7)' }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-2.5 flex-shrink-0"
          style={{ borderBottom: '1px solid #222226', backgroundColor: '#141417' }}
        >
          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold" style={{ color: '#a855f7' }}>⬡ Debug Log</span>
            {logFilePath && (
              <span className="text-xs font-mono truncate max-w-xs" style={{ color: '#3f3f46' }}>
                {logFilePath}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 no-drag">
            <label className="flex items-center gap-1.5 cursor-pointer text-xs" style={{ color: '#71717a' }}>
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={(e) => setAutoScroll(e.target.checked)}
                className="cursor-pointer"
              />
              Auto-scroll
            </label>
            <button
              type="button"
              onClick={handleCopy}
              className="cursor-pointer text-xs px-2 py-1 rounded transition-colors hover:text-white"
              style={{ color: '#71717a', border: '1px solid #27272a' }}
            >
              Copy
            </button>
            <button
              type="button"
              onClick={onClose}
              className="cursor-pointer text-lg leading-none hover:text-white transition-colors"
              style={{ color: '#71717a' }}
            >
              ×
            </button>
          </div>
        </div>

        {/* Log lines */}
        <div className="flex-1 overflow-y-auto p-3 font-mono text-xs" style={{ backgroundColor: '#09090b' }}>
          {entries.length === 0 ? (
            <p style={{ color: '#3f3f46' }}>No log entries yet.</p>
          ) : (
            entries.map((e, i) => (
              <div key={i} className="flex gap-2 leading-5 break-all">
                <span className="flex-shrink-0" style={{ color: '#3f3f46' }}>
                  {e.ts.slice(11, 23)}
                </span>
                <span className="flex-shrink-0 w-12 text-right font-semibold" style={{ color: levelColor(e.level) }}>
                  {e.level}
                </span>
                <span className="flex-shrink-0 w-20 text-right" style={{ color: '#a855f7' }}>
                  [{e.source}]
                </span>
                <span style={{ color: '#e4e4e7' }}>{e.message}</span>
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>

        {/* Footer count */}
        <div
          className="px-4 py-1.5 flex-shrink-0 text-xs"
          style={{ borderTop: '1px solid #222226', color: '#52525b' }}
        >
          {entries.length} entries
          {entries.filter((e) => e.level === 'ERROR').length > 0 && (
            <span className="ml-3" style={{ color: '#f87171' }}>
              {entries.filter((e) => e.level === 'ERROR').length} error{entries.filter((e) => e.level === 'ERROR').length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function parseLogLine(line: string): LogEntry {
  // Format: [2024-01-01T00:00:00.000Z] [LEVEL] [Source] message
  const m = line.match(/^\[([^\]]+)\]\s+\[([^\]]+)\]\s+\[([^\]]+)\]\s+(.*)$/);
  if (m) {
    return { ts: m[1], level: m[2], source: m[3], message: m[4] };
  }
  return { ts: new Date().toISOString(), level: 'INFO', source: 'App', message: line };
}
