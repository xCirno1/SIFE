import React, { useCallback, useRef, useState } from 'react';
import TokenPill from './TokenPill';

interface OmnibarProps {
  query: string;
  onChange: (q: string) => void;
  onSearch: (q: string) => void;
  resultCount: number;
}

function parseTokens(query: string): { filters: string[]; plain: string } {
  const parts = query.trim().split(/\s+/).filter(Boolean);
  const filters: string[] = [];
  const plain: string[] = [];
  for (const part of parts) {
    if (/^[a-zA-Z]+:[^\s:]+$/.test(part)) {
      filters.push(part);
    } else {
      plain.push(part);
    }
  }
  return { filters, plain: plain.join(' ') };
}

export default function Omnibar({ query, onChange, onSearch, resultCount }: OmnibarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [showHelp, setShowHelp] = useState(false);
  const { filters } = parseTokens(query);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange(e.target.value);
    },
    [onChange]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        onSearch(query);
      }
    },
    [onSearch, query]
  );

  const removeFilter = useCallback(
    (token: string) => {
      const parts = query.split(/\s+/).filter(Boolean);
      const updated = parts.filter((p) => p !== token).join(' ');
      onChange(updated);
      inputRef.current?.focus();
    },
    [query, onChange]
  );

  return (
    <div
      className="no-drag flex flex-col"
      style={{ borderBottom: '1px solid #222226', backgroundColor: '#141417' }}
    >
      {/* Filter chips strip */}
      {filters.length > 0 && (
        <div className="flex flex-wrap gap-1 px-4 pt-2">
          {filters.map((token) => (
            <TokenPill
              key={token}
              label={token}
              onRemove={() => removeFilter(token)}
            />
          ))}
        </div>
      )}

      {/* Search input row */}
      <div className="flex items-center px-4 h-14 gap-3">
        <span className="text-lg flex-shrink-0" style={{ color: '#52525b' }}>
          🔍
        </span>

        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder='Search files... try "ext:jpg" or "photos from vacation"'
          className="flex-1 bg-transparent outline-none text-sm"
          style={{ color: '#fafafa', caretColor: '#a855f7' }}
          spellCheck={false}
          autoComplete="off"
          autoFocus
        />

        {resultCount > 0 && (
          <span
            className="flex-shrink-0 text-xs font-medium px-2 py-0.5 rounded"
            style={{
              backgroundColor: 'rgba(168,85,247,0.1)',
              color: '#a855f7',
              border: '1px solid rgba(168,85,247,0.3)',
            }}
          >
            {resultCount.toLocaleString()} results
          </span>
        )}

        {/* Help toggle */}
        <button
          type="button"
          onClick={() => setShowHelp((v) => !v)}
          className="cursor-pointer flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors"
          style={{
            backgroundColor: showHelp ? 'rgba(168,85,247,0.2)' : 'transparent',
            border: `1px solid ${showHelp ? 'rgba(168,85,247,0.5)' : '#3f3f46'}`,
            color: showHelp ? '#c084fc' : '#71717a',
          }}
          title="Search syntax help"
        >
          ?
        </button>
      </div>

      {/* Help panel */}
      {showHelp && (
        <div
          className="mx-4 mb-3 rounded-lg p-3 text-xs space-y-2"
          style={{ backgroundColor: '#0d0d10', border: '1px solid #27272a' }}
        >
          <p className="font-semibold" style={{ color: '#fafafa' }}>Search syntax</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
            {[
              ['Free text', 'vacation photos', 'Semantic + name search'],
              ['Extension', 'ext:jpg', 'Filter by file extension'],
              ['Type', 'type:image', 'image · video · audio · document · code · archive'],
              ['Name', 'name:report', 'File name contains'],
              ['Directory', 'dir:Downloads', 'Parent folder name'],
              ['Size (bytes)', 'size>1000000', 'Supports > < >= <= ='],
              ['Modified', 'modified:2024-01-15', 'Exact date match'],
              ['Combined', 'type:image ext:png', 'Multiple filters stack'],
            ].map(([label, example, desc]) => (
              <React.Fragment key={label}>
                <div>
                  <span className="font-medium" style={{ color: '#a1a1aa' }}>{label}</span>
                  <code
                    className="ml-2 px-1 py-0.5 rounded text-[10px]"
                    style={{ backgroundColor: '#18181b', color: '#a855f7' }}
                  >
                    {example}
                  </code>
                </div>
                <div style={{ color: '#52525b' }}>{desc}</div>
              </React.Fragment>
            ))}
          </div>
          <p className="text-[10px] pt-1" style={{ color: '#3f3f46' }}>
            Semantic search finds files by meaning even when the exact word is not in the file name. Results improve as more files are analyzed by the AI.
          </p>
        </div>
      )}
    </div>
  );
}
