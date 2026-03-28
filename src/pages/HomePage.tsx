import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useConversations } from '../hooks/useConversations';
import { ConversationList } from '../components/conversations/ConversationList';
import { FilterBar } from '../components/conversations/FilterBar';
import { ConversationListSkeleton } from '../components/shared/Skeleton';
import { ChevronLeft, ChevronRight } from 'lucide-react';

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

function readFiltersFromSearchParams(params: URLSearchParams): Filters {
  const getValue = (key: keyof Filters) => params.get(key)?.trim() || undefined;
  return {
    source: getValue('source'),
    project: getValue('project'),
    favorite: getValue('favorite'),
    tag: getValue('tag'),
    search: getValue('search'),
    sort: getValue('sort'),
    order: getValue('order'),
    model: getValue('model'),
    min_tokens: getValue('min_tokens'),
    max_tokens: getValue('max_tokens'),
  };
}

function buildSearchParams(filters: Filters, page: number): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  if (page > 1) params.set('page', String(page));
  return params;
}

export function HomePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [filters, setFilters] = useState<Filters>(() => readFiltersFromSearchParams(searchParams));
  const { data, loading, error, page, setPage, toggleFavorite } = useConversations(filters);
  const returnTo = useMemo(() => {
    const params = buildSearchParams(filters, page);
    const query = params.toString();
    return query ? `/?${query}` : '/';
  }, [filters, page]);

  useEffect(() => {
    setFilters(readFiltersFromSearchParams(searchParams));
    const rawPage = Number(searchParams.get('page') || '1');
    const nextPage = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
    setPage(prev => (prev === nextPage ? prev : nextPage));
  }, [searchParams, setPage]);

  useEffect(() => {
    const nextParams = buildSearchParams(filters, page);
    const nextQuery = nextParams.toString();
    const currentQuery = searchParams.toString();
    if (nextQuery !== currentQuery) {
      setSearchParams(nextParams, { replace: true });
    }
  }, [filters, page, searchParams, setSearchParams]);

  const scopeLabel = filters.source === 'codex'
    ? 'Codex'
    : filters.source === 'copilot'
      ? 'Copilot'
    : filters.source === 'claude'
      ? 'Claude'
      : 'All';
  const handleFiltersChange = (nextFilters: Filters) => {
    setPage(1);
    setFilters(nextFilters);
  };

  const handleSelectProject = (projectSlug: string) => {
    setPage(1);
    setFilters(prev => ({ ...prev, project: projectSlug }));
  };

  return (
    <div className="h-full flex flex-col">
      <FilterBar
        filters={filters}
        onChange={handleFiltersChange}
        sourceCounts={data?.sourceCounts}
      />

      {error && (
        <div className="mx-4 mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
          {error}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {loading ? (
          <ConversationListSkeleton count={8} />
        ) : data ? (
          <>
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm text-[#9aafa3]">
                {data.pagination.total} {scopeLabel} conversations
              </span>
            </div>
            <ConversationList
              sessions={data.sessions}
              onToggleFavorite={toggleFavorite}
              onSelectProject={handleSelectProject}
              returnTo={returnTo}
            />
            {data.pagination.totalPages > 1 && (
              <div className="flex items-center justify-center gap-4 mt-6 pb-4">
                <button
                  onClick={() => setPage(page - 1)}
                  disabled={page <= 1}
                  className="p-2 rounded-lg bg-white border border-[#d0ddd5] text-[#6b8578] disabled:opacity-30 hover:bg-[#edf5f0] shadow-sm"
                >
                  <ChevronLeft size={16} />
                </button>
                <span className="text-sm text-[#6b8578]">
                  {page} / {data.pagination.totalPages}
                </span>
                <button
                  onClick={() => setPage(page + 1)}
                  disabled={page >= data.pagination.totalPages}
                  className="p-2 rounded-lg bg-white border border-[#d0ddd5] text-[#6b8578] disabled:opacity-30 hover:bg-[#edf5f0] shadow-sm"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
