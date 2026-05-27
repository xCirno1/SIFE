import { CSSProperties, memo } from 'react';
import { FixedSizeList as List, ListChildComponentProps } from 'react-window';
import type { FileRecord } from '../types';
import { useContainerSize } from '../hooks/useContainerSize';

interface ResultsListProps {
  results: FileRecord[];
  selectedId: string | null;
  onSelect: (file: FileRecord) => void;
}

function parseTags(tags: string): Record<string, string> {
  const entries = tags
    .split(';')
    .filter(Boolean)
    .map((t) => {
      const idx = t.indexOf(':');
      if (idx === -1) return null;
      return [t.slice(0, idx), t.slice(idx + 1)] as [string, string];
    })
    .filter((e): e is [string, string] => e !== null);
  return Object.fromEntries(entries);
}

function formatBytes(kb: string): string {
  const n = parseFloat(kb);
  if (isNaN(n)) return '';
  if (n < 1024) return `${n.toFixed(0)} KB`;
  return `${(n / 1024).toFixed(1)} MB`;
}

function formatDate(ts: number): string {
  if (!ts) return '';
  return new Date(ts).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
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

function getExtColor(type: string): { bg: string; text: string } {
  return EXT_COLORS[type?.toLowerCase()] ?? EXT_COLORS.other;
}

// Row component defined outside to avoid react-window remount issues
interface RowData {
  results: FileRecord[];
  selectedId: string | null;
  onSelect: (file: FileRecord) => void;
}

const Row = memo(({ index, style, data }: ListChildComponentProps<RowData>) => {
  const { results, selectedId, onSelect } = data;
  const file = results[index];
  if (!file) return null;

  const tags = parseTags(file.metadataTags);
  const ext = (tags['Ext'] ?? '').toUpperCase().slice(0, 4);
  const type = tags['Type'] ?? 'other';
  const sizeKB = tags['SizeKB'] ?? '';
  const color = getExtColor(type);
  const isSelected = file.fileId === selectedId;

  const rowStyle: CSSProperties = {
    ...style,
    backgroundColor: isSelected ? 'rgba(168,85,247,0.08)' : 'transparent',
    borderLeft: isSelected ? '2px solid #a855f7' : '2px solid transparent',
    paddingLeft: isSelected ? '14px' : '16px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    paddingRight: '16px',
    transition: 'background-color 0.1s',
    boxSizing: 'border-box',
  };

  return (
    <div
      style={rowStyle}
      onClick={() => onSelect(file)}
      role="option"
      aria-selected={isSelected}
    >
      {/* Extension badge */}
      <div
        className="flex-shrink-0 w-10 h-10 rounded flex items-center justify-center text-[10px] font-bold tracking-wide"
        style={{ backgroundColor: color.bg, color: color.text }}
      >
        {ext || '?'}
      </div>

      {/* File info */}
      <div className="flex-1 min-w-0">
        <div
          className="text-sm font-medium truncate"
          style={{ color: '#fafafa' }}
        >
          {file.fileName}
        </div>
        <div className="text-xs truncate mt-0.5" style={{ color: '#a1a1aa' }}>
          {file.filePath}
        </div>
      </div>

      {/* Size + Date */}
      <div
        className="flex-shrink-0 text-right text-xs"
        style={{ color: '#a1a1aa' }}
      >
        {sizeKB && <div>{formatBytes(sizeKB)}</div>}
        <div className="mt-0.5">{formatDate(file.lastModifiedUtc)}</div>
      </div>
    </div>
  );
});

Row.displayName = 'ResultRow';

export default function ResultsList({ results, selectedId, onSelect }: ResultsListProps) {
  const { ref, width, height } = useContainerSize();

  if (results.length === 0) {
    return (
      <div
        ref={ref}
        className="flex-1 flex flex-col items-center justify-center"
        style={{ color: '#52525b' }}
      >
        <span className="text-4xl mb-3">🔍</span>
        <p className="text-sm">
          {selectedId === null
            ? 'Start typing to search your files'
            : 'No results found'}
        </p>
      </div>
    );
  }

  return (
    <div ref={ref} className="flex-1 overflow-hidden">
      {width > 0 && height > 0 && (
        <List
          height={height}
          width={width}
          itemCount={results.length}
          itemSize={64}
          itemData={{ results, selectedId, onSelect }}
          overscanCount={8}
        >
          {Row}
        </List>
      )}
    </div>
  );
}
