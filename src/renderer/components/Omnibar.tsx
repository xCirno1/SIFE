import React, { useCallback, useRef } from 'react';
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
      </div>
    </div>
  );
}
