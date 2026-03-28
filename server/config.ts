import path from 'path';
import os from 'os';

export const CLAUDE_DIR = path.join(os.homedir(), '.claude');
export const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects');
export const CODEX_DIR = path.join(os.homedir(), '.codex');
export const CODEX_SESSIONS_DIR = path.join(CODEX_DIR, 'sessions');
export const CODEX_SESSION_INDEX_PATH = path.join(CODEX_DIR, 'session_index.jsonl');
export const VSCODE_USER_DIR = path.join(os.homedir(), 'AppData', 'Roaming', 'Code', 'User');
export const CURSOR_USER_DIR = path.join(os.homedir(), 'AppData', 'Roaming', 'Cursor', 'User');
export const CURSOR_DIR = path.join(os.homedir(), '.cursor');
export const CURSOR_PROJECTS_DIR = path.join(CURSOR_DIR, 'projects');
export const VSCODE_COPILOT_WORKSPACE_STORAGE_DIR = path.join(VSCODE_USER_DIR, 'workspaceStorage');
export const CURSOR_COPILOT_WORKSPACE_STORAGE_DIR = path.join(CURSOR_USER_DIR, 'workspaceStorage');
export const CURSOR_GLOBAL_STORAGE_DIR = path.join(CURSOR_USER_DIR, 'globalStorage');
export const CURSOR_GLOBAL_STORAGE_DB_PATH = path.join(CURSOR_GLOBAL_STORAGE_DIR, 'state.vscdb');
export const STATS_CACHE_PATH = path.join(CLAUDE_DIR, 'stats-cache.json');
export const DB_PATH = path.join(CLAUDE_DIR, 'history-viewer.db');
export const PORT = 3847;
