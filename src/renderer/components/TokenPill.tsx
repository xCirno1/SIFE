

interface TokenPillProps {
  label: string;
  onRemove: () => void;
}

export default function TokenPill({ label, onRemove }: TokenPillProps) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-mono text-purple-300 border"
      style={{
        backgroundColor: 'rgba(88, 28, 135, 0.25)',
        borderColor: 'rgba(168, 85, 247, 0.3)',
      }}
    >
      {label}
      <button
        type="button"
        onClick={onRemove}
        className="cursor-pointer leading-none text-purple-400 hover:text-white transition-colors ml-0.5"
        aria-label={`Remove filter ${label}`}
      >
        ×
      </button>
    </span>
  );
}
