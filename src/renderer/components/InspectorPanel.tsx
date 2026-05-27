import { useState, useCallback } from 'react';
import type { FileRecord } from '../types';

interface InspectorPanelProps {
  file: FileRecord | null;
  onClose: () => void;
}

function parseTags(tags: string): Array<{ key: string; value: string }> {
  return tags
    .split(';')
    .filter(Boolean)
    .map((t) => {
      const idx = t.indexOf(':');
      if (idx === -1) return null;
      return { key: t.slice(0, idx), value: t.slice(idx + 1) };
    })
    .filter((e): e is { key: string; value: string } => e !== null);
}

function getTagMap(tags: string): Record<string, string> {
  return Object.fromEntries(parseTags(tags).map(({ key, value }) => [key, value]));
}

const EXT_COLORS: Record<string, { bg: string; text: string }> = {
  image:    { bg: 'rgba(59,130,246,0.2)',  text: '#60a5fa' },
  video:    { bg: 'rgba(239,68,68,0.2)',   text: '#f87171' },
  audio:    { bg: 'rgba(34,197,94,0.2)',   text: '#4ade80' },
  document: { bg: 'rgba(249,115,22,0.2)',  text: '#fb923c' },
  code:     { bg: 'rgba(6,182,212,0.2)',   text: '#22d3ee' },
  text:     { bg: 'rgba(113,113,122,0.2)', text: '#a1a1aa' },
  archive:  { bg: 'rgba(234,179,8,0.2)',   text: '#facc15' },
  other:    { bg: 'rgba(63,63,70,0.2)',    text: '#71717a' },
};

function getExtColor(type: string) {
  return EXT_COLORS[type?.toLowerCase()] ?? EXT_COLORS.other;
}

function formatDate(ts: number): string {
  if (!ts) return 'Unknown';
  return new Date(ts).toLocaleString(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function InspectorPanel({ file, onClose }: InspectorPanelProps) {
  const [copiedPath, setCopiedPath] = useState(false);

  const handleCopyPath = useCallback(async () => {
    if (!file) return;
    await window.sifeEngine.copyPath(file.filePath);
    setCopiedPath(true);
    setTimeout(() => setCopiedPath(false), 1500);
  }, [file]);

  const handleOpenFile = useCallback(async () => {
    if (!file) return;
    await window.sifeEngine.openFile(file.filePath);
  }, [file]);

  if (!file) {
    return (
      <div
        className="w-80 flex flex-col items-center justify-center text-xs"
        style={{
          borderLeft: '1px solid #222226',
          backgroundColor: '#141417',
          color: '#52525b',
        }}
      >
        <span className="text-2xl mb-2">📄</span>
        <p>Select a file to inspect</p>
      </div>
    );
  }

  const tagMap = getTagMap(file.metadataTags);
  const tagList = parseTags(file.metadataTags);
  const type = tagMap['Type'] ?? 'other';
  const ext = (tagMap['Ext'] ?? '').toUpperCase();
  const color = getExtColor(type);
  const hasEmbedding = Array.isArray(file.vectorEmbedding) && file.vectorEmbedding.length > 0;

  return (
    <div
      className="w-80 flex flex-col overflow-hidden flex-shrink-0"
      style={{
        borderLeft: '1px solid #222226',
        backgroundColor: '#141417',
      }}
    >
      {/* Header */}
      <div
        className="flex items-start gap-3 p-4"
        style={{ borderBottom: '1px solid #222226' }}
      >
        <div
          className="flex-shrink-0 w-14 h-14 rounded-lg flex items-center justify-center text-sm font-bold tracking-wide"
          style={{ backgroundColor: color.bg, color: color.text }}
        >
          {ext || '?'}
        </div>
        <div className="flex-1 min-w-0">
          <p
            className="text-sm font-semibold truncate"
            style={{ color: '#fafafa' }}
            title={file.fileName}
          >
            {file.fileName}
          </p>
          <p className="text-xs mt-0.5" style={{ color: '#a1a1aa' }}>
            {type.charAt(0).toUpperCase() + type.slice(1)} file
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="cursor-pointer flex-shrink-0 text-lg leading-none hover:text-white transition-colors mt-0.5"
          style={{ color: '#71717a' }}
          aria-label="Close inspector"
        >
          ×
        </button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">

        {/* File Path */}
        <section>
          <h3 className="text-[10px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: '#71717a' }}>
            File Path
          </h3>
          <div
            className="rounded p-2 font-mono text-[11px] break-all leading-relaxed"
            style={{ backgroundColor: '#1e1e24', color: '#a1a1aa', border: '1px solid #222226' }}
          >
            {file.filePath}
          </div>
        </section>

        {/* Metadata */}
        {tagList.length > 0 && (
          <section>
            <h3 className="text-[10px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: '#71717a' }}>
              Metadata
            </h3>
            <div className="grid grid-cols-2 gap-1.5">
              {tagList.map(({ key, value }) => (
                <div
                  key={key}
                  className="rounded px-2 py-1.5 text-xs"
                  style={{ backgroundColor: '#1e1e24', border: '1px solid #222226' }}
                >
                  <div style={{ color: '#a1a1aa' }}>{key}</div>
                  <div className="font-medium truncate mt-0.5" style={{ color: '#fafafa' }} title={value}>
                    {value}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* AI Status */}
        <section>
          <h3 className="text-[10px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: '#71717a' }}>
            AI Status
          </h3>
          {hasEmbedding ? (
            <span
              className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded"
              style={{
                backgroundColor: 'rgba(168,85,247,0.1)',
                border: '1px solid rgba(168,85,247,0.3)',
                color: '#c084fc',
              }}
            >
              <span>✓</span>
              Embedding generated
            </span>
          ) : (
            <p className="text-xs" style={{ color: '#52525b' }}>
              Not yet analyzed
            </p>
          )}
        </section>

        {/* Last Modified */}
        <section>
          <h3 className="text-[10px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: '#71717a' }}>
            Last Modified
          </h3>
          <p className="text-xs" style={{ color: '#a1a1aa' }}>
            {formatDate(file.lastModifiedUtc)}
          </p>
        </section>

        {/* Quick Actions */}
        <section>
          <h3 className="text-[10px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: '#71717a' }}>
            Quick Actions
          </h3>
          <div className="space-y-1.5">
            <button
              type="button"
              onClick={handleOpenFile}
              className="cursor-pointer w-full text-left text-xs px-3 py-2 rounded transition-colors hover:text-white"
              style={{
                backgroundColor: '#1e1e24',
                border: '1px solid #222226',
                color: '#a1a1aa',
              }}
            >
              ↗ Open File
            </button>
            <button
              type="button"
              onClick={handleCopyPath}
              className="cursor-pointer w-full text-left text-xs px-3 py-2 rounded transition-colors hover:text-white"
              style={{
                backgroundColor: '#1e1e24',
                border: '1px solid #222226',
                color: copiedPath ? '#4ade80' : '#a1a1aa',
              }}
            >
              {copiedPath ? '✓ Copied!' : '⧉ Copy Path'}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
