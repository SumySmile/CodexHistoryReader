import type Database from 'better-sqlite3';

export interface CodexLineageSessionSnapshot {
  id: string;
  parent_session_id: string | null;
  file_path: string;
  modified_at: string | null;
  created_at: string | null;
  message_count: number;
  model: string | null;
  total_input_tokens: number;
  total_output_tokens: number;
  tool_call_count: number;
}

export function isCodexSessionId(sessionId: string): boolean {
  return sessionId.startsWith('codex-');
}

export function getHiddenCodexChildSql(alias: string): string {
  return `(${alias}.id LIKE 'codex-%' AND COALESCE(TRIM(${alias}.parent_session_id), '') <> '')`;
}

export function resolveCodexRootSessionId(db: Database.Database, sessionId: string): string {
  if (!isCodexSessionId(sessionId)) return sessionId;

  const row = db.prepare(`
    WITH RECURSIVE ancestors AS (
      SELECT id, parent_session_id
      FROM sessions
      WHERE id = ?
      UNION ALL
      SELECT s.id, s.parent_session_id
      FROM sessions s
      JOIN ancestors a ON a.parent_session_id = s.id
    )
    SELECT id
    FROM ancestors
    WHERE COALESCE(TRIM(parent_session_id), '') = ''
    ORDER BY id
    LIMIT 1
  `).get(sessionId) as { id: string } | undefined;

  return row?.id || sessionId;
}

export function resolveLatestCodexLineageSession<T extends CodexLineageSessionSnapshot>(
  db: Database.Database,
  sessionId: string,
): T | null {
  if (!isCodexSessionId(sessionId)) return null;

  const rootId = resolveCodexRootSessionId(db, sessionId);
  const row = db.prepare(`
    WITH RECURSIVE lineage AS (
      SELECT *
      FROM sessions
      WHERE id = ?
      UNION ALL
      SELECT s.*
      FROM sessions s
      JOIN lineage l ON s.parent_session_id = l.id
    )
    SELECT *
    FROM lineage
    ORDER BY
      datetime(COALESCE(modified_at, created_at)) DESC,
      (total_input_tokens + total_output_tokens) DESC,
      message_count DESC,
      id DESC
    LIMIT 1
  `).get(rootId) as T | undefined;

  return row || null;
}
