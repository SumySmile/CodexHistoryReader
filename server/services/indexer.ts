import { getDb } from '../db/connection.js';
import { parseSession } from './parser.js';

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
      'SELECT id, file_path FROM sessions WHERE indexed_at IS NULL'
    ).all() as { id: string; file_path: string }[];

    console.log(`[indexer] ${sessions.length} sessions to index`);

    const insertFts = db.prepare(`
      INSERT INTO messages_fts (session_id, message_uuid, role, content, timestamp)
      VALUES (?, ?, ?, ?, ?)
    `);

    for (const session of sessions) {
      try {
        await indexSession(session.id, session.file_path, insertFts);
        db.prepare('UPDATE sessions SET indexed_at = ? WHERE id = ?')
          .run(new Date().toISOString(), session.id);
      } catch (e) {
        console.error(`[indexer] Failed to index ${session.id}:`, e);
      }
    }
  } finally {
    isIndexing = false;
    console.log('[indexer] Indexing complete');
  }
}

async function indexSession(
  sessionId: string,
  filePath: string,
  insertStmt: any
): Promise<void> {
  const messages = await parseSession(filePath);
  for (const message of messages) {
    const content = message.content
      .flatMap((block) => {
        if (block.type === 'text') return [block.text];
        if (block.type === 'thinking') return [block.thinking];
        if (block.type === 'references') return block.items.map(item => item.path);
        return [];
      })
      .filter(Boolean)
      .join(' ');

    if (content.trim()) {
      insertStmt.run(sessionId, message.uuid, message.role, content.slice(0, 50000), message.timestamp);
    }
  }
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

  await indexSession(sessionId, filePath, insertFts);
  db.prepare('UPDATE sessions SET indexed_at = ? WHERE id = ?')
    .run(new Date().toISOString(), sessionId);
}
