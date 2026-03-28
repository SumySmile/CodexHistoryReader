import chokidar from 'chokidar';
import path from 'path';
import fs from 'fs';
import {
  CODEX_SESSION_INDEX_PATH,
  CODEX_SESSIONS_DIR,
  PROJECTS_DIR,
  VSCODE_COPILOT_WORKSPACE_STORAGE_DIR,
} from '../config.js';
import { scanAllProjects } from './scanner.js';
import { reindexSession } from './indexer.js';
import { getDb } from '../db/connection.js';

type ChangeListener = (type: string, sessionId?: string) => void;
const listeners: ChangeListener[] = [];

export function onFileChange(listener: ChangeListener): void {
  listeners.push(listener);
}

function notifyListeners(type: string, sessionId?: string): void {
  for (const listener of listeners) {
    listener(type, sessionId);
  }
}

export function startWatcher(): void {
  const watchTargets = [
    PROJECTS_DIR,
    CODEX_SESSIONS_DIR,
    CODEX_SESSION_INDEX_PATH,
    VSCODE_COPILOT_WORKSPACE_STORAGE_DIR,
  ]
    .filter(target => fs.existsSync(target));

  if (watchTargets.length === 0) {
    console.warn('[watcher] No history directories found to watch');
    return;
  }

  const watcher = chokidar.watch(watchTargets, {
    ignoreInitial: true,
    depth: 6,
    ignored: [/node_modules/, /\.git/],
    awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 500 },
  });

  watcher.on('add', (filePath) => handleFileChange(filePath, 'add'));
  watcher.on('change', (filePath) => handleFileChange(filePath, 'change'));

  console.log('[watcher] Watching for changes in', watchTargets.join(', '));
}

async function handleFileChange(filePath: string, event: string): Promise<void> {
  const basename = path.basename(filePath);

  if (basename === 'sessions-index.json' || basename === 'session_index.jsonl' || basename === 'workspace.json') {
    console.log(`[watcher] Index changed: ${filePath}`);
    await scanAllProjects();
    notifyListeners('scan-complete');
    return;
  }

  const isCopilotSession = basename.endsWith('.json') && filePath.includes(`${path.sep}chatSessions${path.sep}`);

  if (basename.endsWith('.jsonl') || isCopilotSession) {
    console.log(`[watcher] Session ${event}: ${filePath}`);
    const db = getDb();

    await scanAllProjects();

    const session = db.prepare('SELECT id, indexed_at FROM sessions WHERE file_path = ?').get(filePath) as {
      id: string;
      indexed_at: string | null;
    } | undefined;

    try {
      const stat = fs.statSync(filePath);
      if (session?.id) {
        db.prepare('UPDATE sessions SET file_mtime = ?, modified_at = ? WHERE id = ?')
          .run(stat.mtimeMs, new Date(stat.mtimeMs).toISOString(), session.id);
      }
    } catch (e) {
      console.warn('[watcher] stat failed', filePath, ':', (e as Error).message);
    }

    if (session?.indexed_at) {
      await reindexSession(session.id, filePath);
    }

    notifyListeners('session-updated', session?.id);
  }
}
