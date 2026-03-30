import { useEffect, useState } from 'react';
import { Search, Star, X } from 'lucide-react';
import { getProjects } from '../../lib/api';
import type { Project } from '../../lib/api';
import { SourceBadge } from '../shared/SourceBadge';

interface Filters {
  source?: string;
  project?: string;
  favorite?: string;
  tag?: string;
  search?: string;
  sort?: string;
  order?: string;
  model?: string;
  min_tokens?: string;
  max_tokens?: string;
}

interface Props {
  filters: Filters;
  onChange: (filters: Filters) => void;
  sourceCounts?: { all: number; claude: number; codex: number; copilot: number };
}

const TOKEN_RANGES = [
  { label: 'All Sizes', min: undefined, max: undefined },
  { label: '<1K', min: undefined, max: '1000' },
  { label: '1K-10K', min: '1000', max: '10000' },
  { label: '10K-100K', min: '10000', max: '100000' },
  { label: '100K+', min: '100000', max: undefined },
];

const SORT_OPTIONS = [
  { label: 'Latest', sort: 'modified_at', order: 'desc' },
  { label: 'Oldest', sort: 'modified_at', order: 'asc' },
  { label: 'Created', sort: 'created_at', order: 'desc' },
  { label: 'Most Messages', sort: 'message_count', order: 'desc' },
];

function getTokenRangeKey(min?: string, max?: string) {
  return `${min ?? ''}:${max ?? ''}`;
}

function currentTokenRangeKey(filters: Filters) {
  return getTokenRangeKey(filters.min_tokens, filters.max_tokens);
}

export function FilterBar({ filters, onChange, sourceCounts }: Props) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [searchInput, setSearchInput] = useState(filters.search || '');
  const hasActiveFilters = Boolean(
    filters.source
    || filters.project
    || filters.favorite
    || filters.tag
    || filters.search
    || filters.model
    || filters.min_tokens
    || filters.max_tokens
    || filters.sort
    || filters.order
  );

  useEffect(() => {
    getProjects().then(setProjects).catch(() => {});
  }, []);

  useEffect(() => {
    setSearchInput(filters.search || '');
  }, [filters.search]);

  useEffect(() => {
    const timer = setTimeout(() => {
      onChange({ ...filters, search: searchInput || undefined });
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const handleTokenRange = (min?: string, max?: string) => {
    const { min_tokens: _a, max_tokens: _b, ...rest } = filters;
    onChange({ ...rest, ...(min ? { min_tokens: min } : {}), ...(max ? { max_tokens: max } : {}) });
  };

  const currentRange = TOKEN_RANGES.find(
    r => getTokenRangeKey(r.min, r.max) === currentTokenRangeKey(filters)
  ) || TOKEN_RANGES[0];
  const currentSort = `${filters.sort || 'modified_at'}:${filters.order || 'desc'}`;
  const sourceOptions: { value?: 'claude' | 'codex' | 'copilot'; label: string; count: number }[] = [
    { label: 'All', count: sourceCounts?.all ?? 0 },
    { value: 'claude', label: 'Claude', count: sourceCounts?.claude ?? 0 },
    { value: 'codex', label: 'Codex', count: sourceCounts?.codex ?? 0 },
    { value: 'copilot', label: 'Copilot', count: sourceCounts?.copilot ?? 0 },
  ];

  return (
    <div className="border-b border-[#d0ddd5] bg-white px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex items-center rounded-xl border border-[#d0ddd5] bg-[#f5f8f6] p-1 shadow-sm">
          {sourceOptions.map(option => {
            const active = (filters.source || '') === (option.value || '');
            return (
              <button
                key={option.label}
                onClick={() => onChange({
                  ...filters,
                  source: option.value,
                  model: undefined,
                })}
                className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors ${
                  active
                    ? 'bg-white text-[#2d3d34] shadow-sm'
                    : 'text-[#6b8578] hover:text-[#2d3d34]'
                }`}
              >
                {option.value ? <SourceBadge source={option.value} compact /> : <span className="font-medium">All</span>}
                <span className="text-xs text-[#8aa194]">{option.count}</span>
              </button>
            );
          })}
        </div>

        <select
          value={filters.project || ''}
          onChange={e => onChange({ ...filters, project: e.target.value || undefined })}
          className="min-w-[240px] max-w-[360px] flex-1 rounded-full border border-[#dbe6e0] bg-[#f8fbf9] px-4 py-2 text-sm text-[#4c5f56] focus:border-[#7ec8a0] focus:outline-none"
        >
          <option value="">All Projects</option>
          {projects.map(p => (
            <option key={p.project_slug} value={p.project_slug}>
              {p.project_slug.replace(/--/g, '/').split('/').pop()} ({p.session_count})
            </option>
          ))}
        </select>

        <div className="relative flex-1 min-w-[280px] max-w-xl">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9aafa3]" />
          <input
            type="text"
            placeholder="Filter conversations..."
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            className="w-full rounded-xl border border-[#d0ddd5] bg-[#f0f5f2] py-2.5 pl-10 pr-4 text-sm text-[#2d3d34] placeholder-[#9aafa3] transition-colors focus:border-[#7ec8a0] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#9ed7b5]/30"
          />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2.5 rounded-2xl bg-[#f7fbf8] px-2.5 py-2">

        <div className="inline-flex flex-wrap items-center gap-1 rounded-full bg-[#f5f8f6] p-1">
          {TOKEN_RANGES.map(range => {
            const active = getTokenRangeKey(range.min, range.max) === getTokenRangeKey(currentRange.min, currentRange.max);
            return (
              <button
                key={getTokenRangeKey(range.min, range.max)}
                onClick={() => handleTokenRange(range.min, range.max)}
                className={`rounded-full px-3 py-1.5 text-sm transition-colors ${
                  active
                    ? 'bg-[#eaf6ef] text-[#2f6a4a] shadow-sm'
                    : 'text-[#6b8578] hover:text-[#2d3d34]'
                }`}
              >
                {range.label}
              </button>
            );
          })}
        </div>

        <div className="inline-flex flex-wrap items-center gap-1 rounded-full bg-[#f5f8f6] p-1">
          {SORT_OPTIONS.map(option => {
            const value = `${option.sort}:${option.order}`;
            const active = value === currentSort;
            return (
              <button
                key={value}
                onClick={() => onChange({ ...filters, sort: option.sort, order: option.order })}
                className={`rounded-full px-3 py-1.5 text-sm transition-colors ${
                  active
                    ? 'bg-[#eaf6ef] text-[#2f6a4a] shadow-sm'
                    : 'text-[#6b8578] hover:text-[#2d3d34]'
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>

        <button
          onClick={() => onChange({ ...filters, favorite: filters.favorite ? undefined : '1' })}
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-sm transition-colors ${
            filters.favorite
              ? 'bg-[#fff4dc] text-[#b7791f]'
              : 'bg-[#f5f8f6] text-[#6b8578] hover:text-[#2d3d34]'
          }`}
        >
          <Star size={14} fill={filters.favorite ? 'currentColor' : 'none'} />
          Favorites
        </button>

        <button
          onClick={() => {
            setSearchInput('');
            onChange({});
          }}
          disabled={!hasActiveFilters}
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-sm transition-colors ${
            hasActiveFilters
              ? 'bg-[#fbeeee] text-[#b45c5c] hover:bg-[#f7e3e3] hover:text-[#914848]'
              : 'cursor-not-allowed bg-[#f5f8f6] text-[#b7c6be]'
          }`}
        >
          <X size={14} />
          Clear
        </button>
      </div>
    </div>
  );
}
