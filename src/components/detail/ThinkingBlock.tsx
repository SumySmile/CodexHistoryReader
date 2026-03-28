import { useState } from 'react';
import { Brain, ChevronDown, ChevronRight } from 'lucide-react';

interface Props {
  thinking: string;
  summary?: string;
}

export function ThinkingBlock({ thinking, summary }: Props) {
  const lineCount = thinking.split(/\r?\n/).length;
  const collapsible = thinking.length > 600 || lineCount > 10;
  const [expanded, setExpanded] = useState(!collapsible);

  return (
    <div className="border border-[#d0ddd5] rounded-lg overflow-hidden bg-white">
      <div
        role={collapsible ? 'button' : undefined}
        tabIndex={collapsible ? 0 : undefined}
        onClick={collapsible ? () => setExpanded(prev => !prev) : undefined}
        onKeyDown={collapsible ? (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setExpanded(prev => !prev);
          }
        } : undefined}
        className={`flex items-center gap-2 w-full px-3 py-2 text-sm text-[#6b8578] transition-colors ${
          collapsible ? 'cursor-pointer hover:bg-[#f0f5f2]' : ''
        }`}
      >
        <Brain size={14} className="text-[#b08fd0]" />
        <span className="font-medium">Thinking</span>
        {summary && <span className="text-[#9aafa3] truncate flex-1 text-left">- {summary}</span>}
        <span className="text-xs text-[#9aafa3]">{thinking.length.toLocaleString()} chars</span>
        {collapsible && (expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />)}
      </div>

      <div className="border-t border-[#d0ddd5] bg-[#faf5fe]">
        <div
          className="px-3 py-2 text-sm text-[#6b8578] whitespace-pre-wrap leading-relaxed overflow-hidden"
          style={expanded || !collapsible
            ? { maxHeight: '500px', overflowY: 'auto' }
            : { display: '-webkit-box', WebkitLineClamp: 5, WebkitBoxOrient: 'vertical' as const }}
        >
          {thinking}
        </div>

        {collapsible && (
          <div className="px-3 pb-2">
            <button
              onClick={() => setExpanded(prev => !prev)}
              className="text-xs text-[#6b8578] hover:text-[#2d3d34] underline underline-offset-2"
            >
              {expanded ? 'Collapse' : 'Expand'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
