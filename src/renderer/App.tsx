import { useState, useEffect, useCallback } from 'react';
import type { FileRecord, IndexStats } from './types';
import Omnibar from './components/Omnibar';
import ResultsList from './components/ResultsList';
import InspectorPanel from './components/InspectorPanel';
import StatusHUD from './components/StatusHUD';
import { useDebounce } from './hooks/useDebounce';

const DEFAULT_STATS: IndexStats = {
  totalFiles: 0,
  indexedFiles: 0,
  isIndexing: false,
  progress: { current: 0, total: 0 },
  modelStatus: 'loading',
};

export default function App() {
  const [results, setResults] = useState<FileRecord[]>([]);
  const [selectedFile, setSelectedFile] = useState<FileRecord | null>(null);
  const [query, setQuery] = useState('');
  const [indexStats, setIndexStats] = useState<IndexStats>(DEFAULT_STATS);
  const [watchDir, setWatchDir] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [settingsDirInput, setSettingsDirInput] = useState('');
  const [modelStatus, setModelStatus] = useState('');

  const debouncedQuery = useDebounce(query, 150);

  // Mount: fetch initial stats and watch dir; register event listeners
  useEffect(() => {
    window.sifeEngine.getStats().then(setIndexStats).catch(console.error);
    window.sifeEngine.getWatchDir().then(setWatchDir).catch(console.error);

    window.sifeEngine.onIndexProgress((data) => {
      setIndexStats((prev) => ({
        ...prev,
        isIndexing: true,
        progress: { current: data.current, total: data.total },
      }));
    });

    window.sifeEngine.onIndexStatus((data) => {
      setIndexStats(data);
    });

    window.sifeEngine.onAiProgress((data) => {
      setModelStatus(data.status);
      if (data.status === 'ready') {
        setIndexStats((prev) => ({ ...prev, modelStatus: 'ready' }));
      }
    });

    return () => {
      window.sifeEngine.removeAllListeners('index:progress');
      window.sifeEngine.removeAllListeners('index:status');
      window.sifeEngine.removeAllListeners('ai:progress');
    };
  }, []);

  // Search whenever debounced query changes
  useEffect(() => {
    if (!debouncedQuery.trim()) {
      setResults([]);
      return;
    }
    let cancelled = false;
    window.sifeEngine
      .search(debouncedQuery)
      .then((res) => {
        if (!cancelled) {
          setResults(res);
        }
      })
      .catch((err) => {
        console.error('Search error:', err);
        if (!cancelled) setResults([]);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery]);

  const handleQueryChange = useCallback((q: string) => {
    setQuery(q);
  }, []);

  const handleSearch = useCallback((q: string) => {
    setQuery(q);
  }, []);

  const handleSelectFile = useCallback((file: FileRecord) => {
    setSelectedFile((prev) => (prev?.fileId === file.fileId ? null : file));
  }, []);

  const handleCloseInspector = useCallback(() => {
    setSelectedFile(null);
  }, []);

  const handleBrowse = useCallback(async () => {
    const dir = await window.sifeEngine.selectDirectory();
    if (dir) setSettingsDirInput(dir);
  }, []);

  const handleSaveSettings = useCallback(async () => {
    if (!settingsDirInput.trim()) return;
    const result = await window.sifeEngine.setWatchDir(settingsDirInput.trim());
    if (result.success) {
      setWatchDir(settingsDirInput.trim());
      setShowSettings(false);
    } else {
      console.error('setWatchDir error:', result.error);
    }
  }, [settingsDirInput]);

  const openSettings = useCallback(() => {
    setSettingsDirInput(watchDir);
    setShowSettings(true);
  }, [watchDir]);

  return (
    <div className="h-full flex flex-col" style={{ backgroundColor: '#09090b' }}>
      {/* Custom titlebar */}
      <div
        className="drag-region flex items-center h-10 flex-shrink-0 select-none"
        style={{ borderBottom: '1px solid #222226', backgroundColor: '#0d0d10' }}
      >
        <div className="no-drag flex items-center gap-2 px-4">
          <span
            className="text-sm font-semibold tracking-widest"
            style={{ color: '#a855f7' }}
          >
            SIFE
          </span>
          <span className="text-xs" style={{ color: '#3f3f46' }}>
            Smart Indexing File Engine
          </span>
        </div>
        <div className="flex-1" />
        <div className="no-drag px-3">
          <button
            type="button"
            onClick={openSettings}
            className="cursor-pointer text-sm hover:text-white transition-colors px-2 py-1 rounded"
            style={{ color: '#71717a' }}
            title="Settings"
          >
            ⚙
          </button>
        </div>
      </div>

      {/* Omnibar */}
      <Omnibar
        query={query}
        onChange={handleQueryChange}
        onSearch={handleSearch}
        resultCount={results.length}
      />

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {!watchDir ? (
          /* ── Onboarding empty state ── */
          <div className="flex-1 flex flex-col items-center justify-center gap-6 px-8 select-none">
            <div className="flex flex-col items-center gap-3">
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl"
                style={{ backgroundColor: 'rgba(168,85,247,0.12)', border: '1px solid rgba(168,85,247,0.25)' }}
              >
                🗂️
              </div>
              <h2 className="text-lg font-semibold" style={{ color: '#fafafa' }}>
                No folder indexed yet
              </h2>
              <p className="text-sm text-center max-w-xs" style={{ color: '#71717a' }}>
                Choose a folder to watch. SIFE will index every file inside it and keep it in sync automatically.
              </p>
            </div>
            <button
              type="button"
              onClick={async () => {
                const dir = await window.sifeEngine.selectDirectory();
                if (!dir) return;
                const result = await window.sifeEngine.setWatchDir(dir);
                if (result.success) setWatchDir(dir);
                else console.error('setWatchDir error:', result.error);
              }}
              className="cursor-pointer flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-all hover:brightness-110 active:scale-95"
              style={{
                backgroundColor: '#a855f7',
                color: '#fff',
                boxShadow: '0 0 20px rgba(168,85,247,0.35)',
              }}
            >
              <span>📁</span>
              Select Folder to Index
            </button>
            <p className="text-xs" style={{ color: '#3f3f46' }}>
              You can change this anytime via the ⚙ settings icon.
            </p>
          </div>
        ) : (
          <>
            <ResultsList
              results={results}
              selectedId={selectedFile?.fileId ?? null}
              onSelect={handleSelectFile}
            />
            {selectedFile && (
              <InspectorPanel file={selectedFile} onClose={handleCloseInspector} />
            )}
          </>
        )}
      </div>

      {/* Status bar */}
      <StatusHUD stats={indexStats} modelStatus={modelStatus} />

      {/* Settings modal */}
      {showSettings && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowSettings(false);
          }}
        >
          <div
            className="w-96 rounded-lg p-6 flex flex-col gap-4"
            style={{
              backgroundColor: '#141417',
              border: '1px solid #222226',
              boxShadow: '0 25px 50px rgba(0,0,0,0.6)',
            }}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold" style={{ color: '#fafafa' }}>
                Settings
              </h2>
              <button
                type="button"
                onClick={() => setShowSettings(false)}
                className="cursor-pointer text-lg hover:text-white transition-colors"
                style={{ color: '#71717a' }}
              >
                ×
              </button>
            </div>

            <div>
              <label
                className="block text-xs mb-1.5 font-medium"
                style={{ color: '#a1a1aa' }}
              >
                Watch Directory
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={settingsDirInput}
                  onChange={(e) => setSettingsDirInput(e.target.value)}
                  placeholder="C:\Users\..."
                  className="flex-1 text-xs px-3 py-2 rounded outline-none"
                  style={{
                    backgroundColor: '#1e1e24',
                    border: '1px solid #222226',
                    color: '#fafafa',
                    caretColor: '#a855f7',
                  }}
                />
                <button
                  type="button"
                  onClick={handleBrowse}
                  className="cursor-pointer text-xs px-3 py-2 rounded transition-colors hover:text-white flex-shrink-0"
                  style={{
                    backgroundColor: '#1e1e24',
                    border: '1px solid #222226',
                    color: '#a1a1aa',
                  }}
                >
                  Browse
                </button>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowSettings(false)}
                className="cursor-pointer text-xs px-4 py-2 rounded transition-colors hover:text-white"
                style={{
                  backgroundColor: '#1e1e24',
                  border: '1px solid #222226',
                  color: '#a1a1aa',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveSettings}
                className="cursor-pointer text-xs px-4 py-2 rounded font-medium transition-colors hover:opacity-90"
                style={{ backgroundColor: '#a855f7', color: '#fff' }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
