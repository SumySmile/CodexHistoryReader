import { getDb } from '../db/connection.js';
import { parseSessionWithMetrics } from './parser.js';
import { invalidateStatsCache } from './stats.js';

let isIndexing = false;
const INDEX_YIELD_INTERVAL = 10;
let indexingQueue: Promise<void> = Promise.resolve();

export function getIndexingStatus(): { isIndexing: boolean; indexed: number; total: number } {
  const db = getDb();
  const indexed = (db.prepare('SELECT COUNT(*) as c FROM sessions WHERE indexed_at IS NOT NULL').get() as any).c;
  const total = (db.prepare('SELECT COUNT(*) as c FROM sessions').get() as any).c;
  return { isIndexing, indexed, total };
}

export async function buildIndex(): Promise<void> {
  return enqueueIndexTask(async () => {
    const db = getDb();
    const sessions = db.prepare(
      `SELECT id, file_path
       FROM sessions
       WHERE indexed_at IS NULL`
    ).all() as { id: string; file_path: string }[];

    console.log(`[indexer] ${sessions.length} sessions to index`);

    const insertFts = db.prepare(`
      INSERT INTO messages_fts (session_id, message_uuid, role, content, timestamp)
      VALUES (?, ?, ?, ?, ?)
    `);

    for (const [index, session] of sessions.entries()) {
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

      if ((index + 1) % INDEX_YIELD_INTERVAL === 0) {
        await yieldToEventLoop();
      }
    }

    invalidateStatsCache();
    console.log('[indexer] Indexing complete');
  });
}

async function indexSession(
  sessionId: string,
  filePath: string,
  insertStmt: any
): Promise<{
  messageCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  toolCallCount: number;
  model: string | null;
}> {
  const { messages, metrics } = await parseSessionWithMetrics(filePath);
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

  return metrics;
}

export async function reindexSession(sessionId: string, filePath: string): Promise<void> {
  return enqueueIndexTask(async () => {
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
  });
}

function yieldToEventLoop(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

function enqueueIndexTask<T>(task: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    indexingQueue = indexingQueue.then(async () => {
      isIndexing = true;
      try {
        resolve(await task());
      } catch (error) {
        reject(error);
      } finally {
        isIndexing = false;
      }
    });
  });
}
