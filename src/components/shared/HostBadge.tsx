interface Props {
  host?: 'code' | 'cursor' | null;
  compact?: boolean;
}

const HOST_STYLES: Record<'code' | 'cursor', string> = {
  code: 'bg-[#edf3ff] text-[#4c6fd6] border-[#cdd9ff]',
  cursor: 'bg-[#f2f6f9] text-[#5f7c8f] border-[#d3e0e8]',
};

const HOST_LABELS: Record<'code' | 'cursor', string> = {
  code: 'Code',
  cursor: 'Cursor',
};

export function HostBadge({ host, compact = false }: Props) {
  if (!host) return null;

  return (
    <span
      className={`inline-flex items-center rounded-full border font-medium shrink-0 ${
        compact ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs'
      } ${HOST_STYLES[host]}`}
      title={`${HOST_LABELS[host]} host`}
    >
      {HOST_LABELS[host]}
    </span>
  );
}
