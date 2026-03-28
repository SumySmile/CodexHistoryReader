import { Bot, Code2, Github } from 'lucide-react';
import type { SessionSource } from '../../lib/utils';
import { cn, sourceLabel } from '../../lib/utils';

interface Props {
  source: SessionSource;
  compact?: boolean;
}

const sourceStyles: Record<SessionSource, string> = {
  claude: 'bg-[#e8f6ef] text-[#2d8a62] border-[#bfe3ce]',
  codex: 'bg-[#fff3e8] text-[#b96d1f] border-[#f0cfaa]',
  copilot: 'bg-[#eef2ff] text-[#5a67d8] border-[#cfd7ff]',
};

const sourceIcons: Record<SessionSource, typeof Bot> = {
  claude: Bot,
  codex: Code2,
  copilot: Github,
};

export function SourceBadge({ source, compact = false }: Props) {
  const Icon = sourceIcons[source];

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border font-medium shrink-0',
        compact ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs',
        sourceStyles[source],
      )}
      title={`${sourceLabel(source)} session`}
    >
      <Icon size={compact ? 11 : 13} />
      {sourceLabel(source)}
    </span>
  );
}
