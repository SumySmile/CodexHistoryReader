import { getDb } from '../db/connection.js';
import { getSessionMetrics, parseSession } from './parser.js';
import { invalidateStatsCache } from './stats.js';

let isIndexing = false;

export function getIndexingStatus(): { isIndexing: boolean; indexed: number; total: number } {
  const db = getDb();
  const indexed = (db.prepare('SELECT COUNT(*) as c FROM sessions WHERE indexed_at IS NOT NULL').get() as any).c;
  const total = (db.prepare('SELECT COUNT(*) as c FROM sessions').get() as any).c;
  return { isIndexing, indexed, total };
}

export async function buildIndex(): Promise<void> {
  if (isIndexing) return;
  isIndexing = true;

  try {
    const db = getDb();
    const sessions = db.prepare(
      `SELECT id, file_path
       FROM sessions
       WHERE indexed_at IS NULL
          OR (id LIKE 'codex-%' AND total_input_tokens = 0 AND total_output_tokens = 0)`
    ).all() as { id: string; file_path: string }[];

    console.log(`[indexer] ${sessions.length} sessions to index`);

    const insertFts = db.prepare(`
      INSERT INTO messages_fts (session_id, message_uuid, role, content, timestamp)
      VALUES (?, ?, ?, ?, ?)
    `);

    for (const session of sessions) {
      try {
        const metrics = await indexSession(session.id, session.file_path, insertFts);
        db.prepare(`UPDATE sessions
          SET indexed_at = ?, message_count = ?, model = COALESCE(?, model),
              total_input_tokens = ?, total_output_tokens = ?, tool_call_count = ?
          WHERE id = ?`)
          .run(
            new Date().toISOString(),
            metrics.messageCount,
            metrics.model,
            metrics.totalInputTokens,
            metrics.totalOutputTokens,
            metrics.toolCallCount,
            session.id,
          );
      } catch (e) {
        console.error(`[indexer] Failed to index ${session.id}:`, e);
      }
    }
  } finally {
    isIndexing = false;
    invalidateStatsCache();
    console.log('[indexer] Indexing complete');
  }
}

async function indexSession(
  sessionId: string,
  filePath: string,
  insertStmt: any
): Promise<Awaited<ReturnType<typeof getSessionMetrics>>> {
  const messages = await parseSession(filePath);
  for (const message of messages) {
    const content = message.content
      .flatMap((block) => {
        if (block.type === 'text') return [block.text];
        if (block.type === 'thinking') return [block.thinking];
        if (block.type === 'references') return block.items.flatMap(item => [item.label || '', item.path]);
        if (block.type === 'tool_use') {
          return [
            block.name,
            typeof block.input === 'string' ? block.input : JSON.stringify(block.input, null, 2),
          ];
        }
        if (block.type === 'tool_result') {
          return [block.tool_name || '', block.content];
        }
        return [];
      })
      .filter(Boolean)
      .join(' ');

    if (content.trim()) {
      insertStmt.run(sessionId, message.uuid, message.role, content.slice(0, 50000), message.timestamp);
    }
  }

  return getSessionMetrics(filePath, messages);
}

export async function reindexSession(sessionId: string, filePath: string): Promise<void> {
  const db = getDb();
  // Remove old FTS entries
  db.prepare('DELETE FROM messages_fts WHERE session_id = ?').run(sessionId);
  db.prepare('UPDATE sessions SET indexed_at = NULL WHERE id = ?').run(sessionId);

  const insertFts = db.prepare(`
    INSERT INTO messages_fts (session_id, message_uuid, role, content, timestamp)
    VALUES (?, ?, ?, ?, ?)
  `);

  const metrics = await indexSession(sessionId, filePath, insertFts);
  db.prepare(`UPDATE sessions
    SET indexed_at = ?, message_count = ?, model = COALESCE(?, model),
        total_input_tokens = ?, total_output_tokens = ?, tool_call_count = ?
    WHERE id = ?`)
    .run(
      new Date().toISOString(),
      metrics.messageCount,
      metrics.model,
      metrics.totalInputTokens,
      metrics.totalOutputTokens,
      metrics.toolCallCount,
      sessionId,
    );
  invalidateStatsCache();
}
