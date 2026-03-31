import chokidar from 'chokidar';
import path from 'path';
import fs from 'fs';
import {
  CODEX_SESSION_INDEX_PATH,
  CODEX_SESSIONS_DIR,
  CURSOR_COPILOT_WORKSPACE_STORAGE_DIR,
  CURSOR_GLOBAL_STORAGE_DB_PATH,
  CURSOR_PROJECTS_DIR,
  PROJECTS_DIR,
  VSCODE_COPILOT_WORKSPACE_STORAGE_DIR,
} from '../config.js';
import { scanAllProjects, upsertSessionFromFile } from './scanner.js';
import { buildIndex, reindexSession } from './indexer.js';

type ChangeListener = (type: string, sessionId?: string) => void;

interface PendingFileSync {
  timer: NodeJS.Timeout | null;
  running: boolean;
  queued: boolean;
  lastEvent: string;
}

const listeners: ChangeListener[] = [];
const fileSyncStates = new Map<string, PendingFileSync>();
const FILE_SYNC_DEBOUNCE_MS = 3500;
const BATCH_REFRESH_DEBOUNCE_MS = 1500;
let batchRefreshTimer: NodeJS.Timeout | null = null;
let heavyTaskQueue: Promise<void> = Promise.resolve();

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
    CURSOR_COPILOT_WORKSPACE_STORAGE_DIR,
    CURSOR_GLOBAL_STORAGE_DB_PATH,
    CURSOR_PROJECTS_DIR,
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

function handleFileChange(filePath: string, event: string): void {
  const basename = path.basename(filePath);
  const isIndexFile = basename === 'sessions-index.json'
    || basename === 'session_index.jsonl'
    || basename === 'workspace.json';
  const isCopilotJsonSession = basename.endsWith('.json') && filePath.includes(`${path.sep}chatSessions${path.sep}`);
  const isCursorStateDb = basename === 'state.vscdb' && filePath.includes(`${path.sep}workspaceStorage${path.sep}`);
  const isCursorGlobalStateDb = basename === 'state.vscdb' && filePath.includes(`${path.sep}globalStorage${path.sep}`);

  if (isIndexFile || isCursorGlobalStateDb) {
    scheduleBatchRefresh(filePath);
    return;
  }

  if (basename.endsWith('.jsonl') || isCopilotJsonSession || isCursorStateDb) {
    scheduleIncrementalSync(filePath, event);
  }
}

function scheduleBatchRefresh(filePath: string): void {
  if (batchRefreshTimer) {
    clearTimeout(batchRefreshTimer);
  }

  batchRefreshTimer = setTimeout(() => {
    batchRefreshTimer = null;
    enqueueHeavyTask(async () => {
      console.log(`[watcher] Refreshing history after index change: ${filePath}`);
      await scanAllProjects();
      await buildIndex();
      notifyListeners('scan-complete');
    });
  }, BATCH_REFRESH_DEBOUNCE_MS);
}

function scheduleIncrementalSync(filePath: string, event: string): void {
  const state = fileSyncStates.get(filePath) || {
    timer: null,
    running: false,
    queued: false,
    lastEvent: event,
  };

  state.lastEvent = event;

  if (state.timer) {
    clearTimeout(state.timer);
  }

  state.timer = setTimeout(() => {
    state.timer = null;
    void flushIncrementalSync(filePath);
  }, FILE_SYNC_DEBOUNCE_MS);

  fileSyncStates.set(filePath, state);
}

async function flushIncrementalSync(filePath: string): Promise<void> {
  const state = fileSyncStates.get(filePath);
  if (!state) return;

  if (state.running) {
    state.queued = true;
    return;
  }

  state.running = true;
  enqueueHeavyTask(async () => {
    try {
      do {
        state.queued = false;
        await processIncrementalSync(filePath, state.lastEvent);
      } while (state.queued);
    } finally {
      state.running = false;
      if (!state.timer && !state.queued) {
        fileSyncStates.delete(filePath);
      }
    }
  });
}

async function processIncrementalSync(filePath: string, event: string): Promise<void> {
  console.log(`[watcher] Session ${event}: ${filePath}`);

  const sessionId = await upsertSessionFromFile(filePath);
  if (!sessionId) {
    notifyListeners('session-updated');
    return;
  }

  await reindexSession(sessionId, filePath);
  notifyListeners('session-updated', sessionId);
}

function enqueueHeavyTask(task: () => Promise<void>): void {
  heavyTaskQueue = heavyTaskQueue.then(async () => {
    try {
      await task();
    } catch (error) {
      console.error('[watcher] Background task failed:', error);
    }
  });
}
