import { useState, useEffect, useCallback } from 'react';
import * as api from '../lib/api';
import type { Session, PaginatedSessions } from '../lib/api';

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

export function useConversations(filters: Filters = {}) {
  const [data, setData] = useState<PaginatedSessions | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string> = { page: String(page), limit: '50' };
      if (filters.source) params.source = filters.source;
      if (filters.project) params.project = filters.project;
      if (filters.favorite) params.favorite = filters.favorite;
      if (filters.tag) params.tag = filters.tag;
      if (filters.search) params.search = filters.search;
      if (filters.sort) params.sort = filters.sort;
      if (filters.order) params.order = filters.order;
      if (filters.model) params.model = filters.model;
      if (filters.min_tokens) params.min_tokens = filters.min_tokens;
      if (filters.max_tokens) params.max_tokens = filters.max_tokens;
      const result = await api.getSessions(params);
      setData(result);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [
    page,
    filters.source,
    filters.project,
    filters.favorite,
    filters.tag,
    filters.search,
    filters.sort,
    filters.order,
    filters.model,
    filters.min_tokens,
    filters.max_tokens,
  ]);

  useEffect(() => { load(); }, [load]);

  const toggleFavorite = useCallback(async (id: string) => {
    try {
      const result = await api.toggleFavorite(id);
      setData(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          sessions: prev.sessions.map(s =>
            s.id === id ? { ...s, is_favorite: result.is_favorite } : s
          ),
        };
      });
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  return { data, loading, error, page, setPage, reload: load, toggleFavorite };
}

export function useSessionDetail(id: string | undefined) {
  const [data, setData] = useState<api.SessionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    api.getSessionMessages(id)
      .then(setData)
      .catch((e: any) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  return { data, loading, error };
}
