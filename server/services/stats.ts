import { getDb } from '../db/connection.js';
import type { StatsData } from '../types.js';
import { getHiddenCodexChildSql } from './codex-lineage.js';

let memCache: { data: StatsData; expiresAt: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

const SOURCE_SQL = `CASE
  WHEN id LIKE 'codex-%' THEN 'codex'
  WHEN id LIKE 'copilot-%' THEN 'copilot'
  ELSE 'claude'
END`;

export function invalidateStatsCache(): void {
  memCache = null;
}

export function getStats(): StatsData {
  if (memCache && Date.now() < memCache.expiresAt) {
    return memCache.data;
  }

  const db = getDb();
  const visibleSessionWhere = `WHERE NOT ${getHiddenCodexChildSql('sessions')}`;

  const totals = db.prepare(`
    SELECT
      COUNT(*) as totalSessions,
      COALESCE(SUM(message_count), 0) as totalMessages,
      COALESCE(SUM(total_input_tokens), 0) as totalInputTokens,
      COALESCE(SUM(total_output_tokens), 0) as totalOutputTokens,
      COALESCE(SUM(tool_call_count), 0) as totalToolCalls,
      ROUND(AVG(
        CASE
          WHEN (total_input_tokens + total_output_tokens) > 0
          THEN total_input_tokens + total_output_tokens
          ELSE NULL
        END
      )) as avgTokensPerSession,
      COUNT(DISTINCT project_slug) as projectCount
    FROM sessions
    ${visibleSessionWhere}
  `).get() as {
    totalSessions: number;
    totalMessages: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalToolCalls: number;
    avgTokensPerSession: number | null;
    projectCount: number;
  };

  const dailyActivity = db.prepare(`
    SELECT
      date(COALESCE(modified_at, created_at)) as date,
      COUNT(*) as sessions,
      COALESCE(SUM(message_count), 0) as messages
    FROM sessions
    ${visibleSessionWhere} AND COALESCE(modified_at, created_at) IS NOT NULL
    GROUP BY date(COALESCE(modified_at, created_at))
    ORDER BY date ASC
  `).all() as { date: string; sessions: number; messages: number }[];

  const modelUsage = db.prepare(`
    SELECT
      model,
      COALESCE(SUM(total_input_tokens + total_output_tokens), 0) as count
    FROM sessions
    ${visibleSessionWhere} AND model IS NOT NULL AND TRIM(model) <> ''
    GROUP BY model
    ORDER BY count DESC, model ASC
    LIMIT 20
  `).all() as { model: string; count: number }[];

  const sourceUsage = db.prepare(`
    SELECT
      ${SOURCE_SQL} as source,
      COUNT(*) as sessions,
      COALESCE(SUM(total_input_tokens), 0) as inputTokens,
      COALESCE(SUM(total_output_tokens), 0) as outputTokens,
      COALESCE(SUM(total_input_tokens + total_output_tokens), 0) as tokens,
      COALESCE(SUM(tool_call_count), 0) as toolCalls
    FROM sessions
    ${visibleSessionWhere}
    GROUP BY ${SOURCE_SQL}
    ORDER BY sessions DESC
  `).all() as StatsData['sourceUsage'];

  const projectDistribution = db.prepare(`
    SELECT project_slug as project, COUNT(*) as sessions
    FROM sessions
    ${visibleSessionWhere}
    GROUP BY project_slug
    ORDER BY sessions DESC
    LIMIT 20
  `).all() as { project: string; sessions: number }[];

  const data: StatsData = {
    totalSessions: totals.totalSessions,
    totalMessages: totals.totalMessages,
    totalInputTokens: totals.totalInputTokens,
    totalOutputTokens: totals.totalOutputTokens,
    totalToolCalls: totals.totalToolCalls,
    avgTokensPerSession: Math.round(totals.avgTokensPerSession || 0),
    projectCount: totals.projectCount,
    dailyActivity,
    modelUsage,
    sourceUsage,
    projectDistribution,
    topToolCalls: [],
  };

  memCache = { data, expiresAt: Date.now() + CACHE_TTL_MS };
  return data;
}
