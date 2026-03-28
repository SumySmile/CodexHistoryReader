import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { CURSOR_COPILOT_WORKSPACE_STORAGE_DIR, CURSOR_GLOBAL_STORAGE_DB_PATH } from '../config.js';
import { normalizeMessageText, sanitizeConversationText } from './text-normalization.js';

export interface CursorPromptEntry {
  text: string;
  commandType?: number;
}

export interface CursorGenerationEntry {
  unixMs?: number;
  generationUUID?: string;
  type?: string;
  textDescription?: string;
}

export interface CursorComposerBranch {
  branchName?: string;
  lastInteractionAt?: number;
}

export interface CursorComposerHead {
  composerId?: string;
  name?: string;
  subtitle?: string;
  createdAt?: number;
  lastUpdatedAt?: number;
  unifiedMode?: string;
  forceMode?: string;
  createdOnBranch?: string;
  activeBranch?: CursorComposerBranch;
  branches?: CursorComposerBranch[];
}

export interface CursorWorkspaceState {
  workspaceId: string;
  filePath: string;
  workspacePath: string | null;
  prompts: CursorPromptEntry[];
  generations: CursorGenerationEntry[];
  composers: CursorComposerHead[];
  selectedComposerIds: string[];
  lastFocusedComposerIds: string[];
  cachedGitBranch: string | null;
}

export interface CursorComposerMetadata {
  composerId: string;
  workspaceId: string;
  workspacePath: string | null;
  name: string | null;
  subtitle: string | null;
  createdAt: number | null;
  lastUpdatedAt: number | null;
  unifiedMode: string | null;
  forceMode: string | null;
  createdOnBranch: string | null;
  activeBranch: string | null;
  selected: boolean;
  focused: boolean;
  cachedGitBranch: string | null;
}

export interface CursorComposerBubble {
  bubbleId: string;
  role: 'user' | 'assistant';
  type: number | null;
  createdAt: string | null;
  text: string | null;
  thinking: string | null;
  references: { label?: string; path: string }[];
  toolName: string | null;
  toolInput: unknown;
  toolResult: string | null;
}

const CURSOR_COMPOSER_PATH_MARKER = '::composer:';

export function readCursorWorkspaceState(filePath: string): CursorWorkspaceState | null {
  if (!fs.existsSync(filePath)) return null;

  const workspaceId = path.basename(path.dirname(filePath));
  const db = new Database(filePath, { readonly: true, fileMustExist: true });

  try {
    const prompts = readJsonValue<CursorPromptEntry[]>(db, 'aiService.prompts') || [];
    const generations = readJsonValue<CursorGenerationEntry[]>(db, 'aiService.generations') || [];
    const composerData = readJsonValue<{
      allComposers?: CursorComposerHead[];
      selectedComposerIds?: string[];
      lastFocusedComposerIds?: string[];
    }>(db, 'composer.composerData');
    const backgroundData = readJsonValue<Record<string, any>>(db, 'workbench.backgroundComposer.workspacePersistentData');

    const workspaceJsonPath = path.join(path.dirname(filePath), 'workspace.json');
    const workspacePath = readWorkspacePathFromJson(workspaceJsonPath)
      || extractWorkspacePathFromBackground(backgroundData)
      || extractWorkspacePathFromHistory(db);

    return {
      workspaceId,
      filePath,
      workspacePath,
      prompts: prompts.filter(isCursorPromptEntry),
      generations: generations.filter(isCursorGenerationEntry),
      composers: Array.isArray(composerData?.allComposers) ? composerData.allComposers.filter(Boolean) : [],
      selectedComposerIds: Array.isArray(composerData?.selectedComposerIds)
        ? composerData.selectedComposerIds.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        : [],
      lastFocusedComposerIds: Array.isArray(composerData?.lastFocusedComposerIds)
        ? composerData.lastFocusedComposerIds.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        : [],
      cachedGitBranch: extractCachedGitBranch(backgroundData),
    };
  } finally {
    db.close();
  }
}

export function buildCursorComposerMetadataIndex(): Map<string, CursorComposerMetadata> {
  const index = new Map<string, CursorComposerMetadata>();
  if (!fs.existsSync(CURSOR_COPILOT_WORKSPACE_STORAGE_DIR)) return index;

  const workspaceDirs = fs.readdirSync(CURSOR_COPILOT_WORKSPACE_STORAGE_DIR, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => path.join(CURSOR_COPILOT_WORKSPACE_STORAGE_DIR, entry.name));

  for (const workspaceDir of workspaceDirs) {
    const stateDbPath = path.join(workspaceDir, 'state.vscdb');
    if (!fs.existsSync(stateDbPath)) continue;

    const state = readCursorWorkspaceState(stateDbPath);
    if (!state) continue;

    for (const composer of state.composers) {
      if (typeof composer.composerId !== 'string' || !composer.composerId.trim()) continue;
      index.set(composer.composerId, {
        composerId: composer.composerId,
        workspaceId: state.workspaceId,
        workspacePath: state.workspacePath,
        name: sanitizeConversationText(composer.name || null),
        subtitle: sanitizeConversationText(composer.subtitle || null),
        createdAt: typeof composer.createdAt === 'number' ? composer.createdAt : null,
        lastUpdatedAt: typeof composer.lastUpdatedAt === 'number' ? composer.lastUpdatedAt : null,
        unifiedMode: typeof composer.unifiedMode === 'string' ? composer.unifiedMode : null,
        forceMode: typeof composer.forceMode === 'string' ? composer.forceMode : null,
        createdOnBranch: typeof composer.createdOnBranch === 'string' ? composer.createdOnBranch : null,
        activeBranch: typeof composer.activeBranch?.branchName === 'string' ? composer.activeBranch.branchName : null,
        selected: state.selectedComposerIds.includes(composer.composerId),
        focused: state.lastFocusedComposerIds.includes(composer.composerId),
        cachedGitBranch: state.cachedGitBranch,
      });
    }
  }

  return index;
}

export function findCursorComposerMetadata(composerId: string): CursorComposerMetadata | null {
  if (!composerId.trim()) return null;
  return buildCursorComposerMetadataIndex().get(composerId) || null;
}

export function readCursorComposerConversation(composerId: string): {
  metadata: CursorComposerMetadata | null;
  bubbles: CursorComposerBubble[];
} {
  const metadata = findCursorComposerMetadata(composerId);
  if (!fs.existsSync(CURSOR_GLOBAL_STORAGE_DB_PATH)) {
    return { metadata, bubbles: [] };
  }

  const db = new Database(CURSOR_GLOBAL_STORAGE_DB_PATH, { readonly: true, fileMustExist: true });
  try {
    const composerData = readCursorDiskKvJson<Record<string, any>>(db, `composerData:${composerId}`);
    const headers = Array.isArray(composerData?.fullConversationHeadersOnly)
      ? composerData.fullConversationHeadersOnly
      : [];

    const bubbles = headers
      .map((header) => {
        const bubbleId = typeof header?.bubbleId === 'string' ? header.bubbleId : null;
        if (!bubbleId) return null;
        const bubble = readCursorDiskKvJson<Record<string, any>>(db, `bubbleId:${composerId}:${bubbleId}`);
        if (!bubble) return null;
        return toCursorComposerBubble(bubbleId, bubble, metadata?.workspacePath || null);
      })
      .filter((bubble): bubble is CursorComposerBubble => Boolean(bubble));

    return { metadata, bubbles };
  } finally {
    db.close();
  }
}

export function listCursorComposerIdsWithBubbles(): string[] {
  if (!fs.existsSync(CURSOR_GLOBAL_STORAGE_DB_PATH)) return [];

  const db = new Database(CURSOR_GLOBAL_STORAGE_DB_PATH, { readonly: true, fileMustExist: true });
  try {
    const rows = db.prepare("SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%'").all() as {
      key: string;
      value: Buffer | string | null;
    }[];

    const composerIds: string[] = [];
    for (const row of rows) {
      if (row.value == null) continue;
      try {
        const text = Buffer.isBuffer(row.value) ? row.value.toString('utf8') : String(row.value);
        const composerData = JSON.parse(text) as Record<string, any>;
        if (!Array.isArray(composerData.fullConversationHeadersOnly) || composerData.fullConversationHeadersOnly.length === 0) {
          continue;
        }
        const composerId = row.key.split(':', 2)[1];
        if (composerId) composerIds.push(composerId);
      } catch {
        // ignore malformed rows
      }
    }

    return composerIds;
  } finally {
    db.close();
  }
}

export function buildCursorComposerVirtualPath(composerId: string): string {
  return `${CURSOR_GLOBAL_STORAGE_DB_PATH}${CURSOR_COMPOSER_PATH_MARKER}${composerId}`;
}

export function parseCursorComposerVirtualPath(filePath: string): { dbPath: string; composerId: string } | null {
  const markerIndex = filePath.indexOf(CURSOR_COMPOSER_PATH_MARKER);
  if (markerIndex === -1) return null;

  const dbPath = filePath.slice(0, markerIndex);
  const composerId = filePath.slice(markerIndex + CURSOR_COMPOSER_PATH_MARKER.length);
  if (!dbPath || !composerId) return null;

  return { dbPath, composerId };
}

function readJsonValue<T>(db: Database.Database, key: string): T | null {
  try {
    const row = db.prepare('SELECT value FROM ItemTable WHERE key = ?').get(key) as { value: Buffer | string } | undefined;
    if (!row) return null;
    const text = Buffer.isBuffer(row.value) ? row.value.toString('utf8') : String(row.value);
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function readCursorDiskKvJson<T>(db: Database.Database, key: string): T | null {
  try {
    const row = db.prepare('SELECT value FROM cursorDiskKV WHERE key = ?').get(key) as { value: Buffer | string } | undefined;
    if (!row) return null;
    const text = Buffer.isBuffer(row.value) ? row.value.toString('utf8') : String(row.value);
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function readWorkspacePathFromJson(workspaceJsonPath: string): string | null {
  if (!fs.existsSync(workspaceJsonPath)) return null;

  try {
    const raw = JSON.parse(fs.readFileSync(workspaceJsonPath, 'utf-8')) as Record<string, unknown>;
    const value = typeof raw.folder === 'string'
      ? raw.folder
      : typeof raw.workspace === 'string'
        ? raw.workspace
        : null;
    return normalizeFileUriToPath(value);
  } catch {
    return null;
  }
}

function extractWorkspacePathFromBackground(backgroundData: Record<string, any> | null | undefined): string | null {
  const rootUri = backgroundData?.cachedSelectedRemote?.rootUri;
  if (!rootUri) return null;

  if (typeof rootUri.external === 'string') {
    return normalizeFileUriToPath(rootUri.external);
  }
  if (typeof rootUri.path === 'string') {
    return normalizeFileUriToPath(rootUri.path);
  }

  return null;
}

function extractCachedGitBranch(backgroundData: Record<string, any> | null | undefined): string | null {
  const gitState = backgroundData?.cachedSelectedGitState;
  if (!gitState || typeof gitState !== 'object') return null;

  const candidates = [gitState.ref, gitState.continueRef, gitState.baseRef];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate;
    }
  }

  return null;
}

function extractWorkspacePathFromHistory(db: Database.Database): string | null {
  const entries = readJsonValue<any[]>(db, 'history.entries');
  if (!Array.isArray(entries)) return null;

  for (const entry of entries) {
    const resource = entry?.editor?.resource;
    if (typeof resource !== 'string') continue;
    const filePath = normalizeFileUriToPath(resource);
    if (!filePath) continue;
    return path.dirname(filePath);
  }

  return null;
}

function normalizeFileUriToPath(value: string | null): string | null {
  if (!value) return null;

  try {
    if (value.startsWith('file://')) {
      const url = new URL(value);
      const pathname = decodeURIComponent(url.pathname);
      if (/^\/[A-Za-z]:\//.test(pathname)) {
        return pathname.slice(1).replace(/\//g, path.sep);
      }
      return pathname.replace(/\//g, path.sep);
    }
  } catch {
    // ignore
  }

  if (/^\/[A-Za-z]:\//.test(value)) {
    return value.slice(1).replace(/\//g, path.sep);
  }

  return value.replace(/\//g, path.sep);
}

function toCursorComposerBubble(
  bubbleId: string,
  bubble: Record<string, any>,
  workspacePath: string | null,
): CursorComposerBubble | null {
  const role = bubble.type === 1 ? 'user' : bubble.type === 2 ? 'assistant' : null;
  if (!role) return null;

  const text = normalizeCursorMessageBlock(typeof bubble.text === 'string' ? bubble.text : null);
  const thinking = extractCursorBubbleThinking(bubble);
  const references = extractCursorBubbleReferences(bubble, workspacePath);

  const toolName = extractCursorBubbleToolName(bubble);
  const toolInput = extractCursorBubbleToolInput(bubble);
  const toolResult = extractCursorBubbleToolResult(bubble);

  if (!text && !thinking && references.length === 0 && !toolName && !toolResult) {
    return null;
  }

  return {
    bubbleId,
    role,
    type: typeof bubble.type === 'number' ? bubble.type : null,
    createdAt: typeof bubble.createdAt === 'string' && bubble.createdAt.trim() ? bubble.createdAt : null,
    text,
    thinking,
    references,
    toolName,
    toolInput,
    toolResult,
  };
}

function extractCursorBubbleThinking(bubble: Record<string, any>): string | null {
  const candidates: string[] = [];

  if (bubble.thinking && typeof bubble.thinking === 'object' && typeof bubble.thinking.text === 'string') {
    candidates.push(bubble.thinking.text);
  }

  if (Array.isArray(bubble.allThinkingBlocks)) {
    for (const block of bubble.allThinkingBlocks) {
      if (typeof block?.text === 'string') {
        candidates.push(block.text);
      }
    }
  }

  return normalizeCursorMessageBlock(candidates.filter(Boolean).join('\n\n'));
}

function extractCursorBubbleReferences(
  bubble: Record<string, any>,
  workspacePath: string | null,
): { label?: string; path: string }[] {
  const references: { label?: string; path: string }[] = [];

  if (Array.isArray(bubble.attachedFileCodeChunksMetadataOnly)) {
    for (const item of bubble.attachedFileCodeChunksMetadataOnly) {
      const relative = typeof item?.relativeWorkspacePath === 'string' ? item.relativeWorkspacePath : null;
      if (!relative) continue;
      references.push({
        label: relative,
        path: workspacePath ? path.join(workspacePath, relative) : relative,
      });
    }
  }

  if (Array.isArray(bubble.fileLinks)) {
    for (const raw of bubble.fileLinks) {
      try {
        const item = typeof raw === 'string' ? JSON.parse(raw) : raw;
        const relative = typeof item?.relativeWorkspacePath === 'string' ? item.relativeWorkspacePath : null;
        const displayName = typeof item?.displayName === 'string' ? item.displayName : undefined;
        if (!relative) continue;
        references.push({
          ...(displayName ? { label: displayName } : {}),
          path: workspacePath ? path.join(workspacePath, relative) : relative,
        });
      } catch {
        // ignore malformed file link payloads
      }
    }
  }

  if (Array.isArray(bubble.workspaceUris)) {
    for (const uri of bubble.workspaceUris) {
      const external = typeof uri?.external === 'string' ? uri.external : null;
      const uriPath = typeof uri?.path === 'string' ? uri.path : null;
      const normalized = normalizeFileUriToPath(external || uriPath);
      if (!normalized) continue;
      references.push({ label: 'Workspace', path: normalized });
    }
  }

  return dedupeReferences(references);
}

function extractCursorBubbleToolName(bubble: Record<string, any>): string | null {
  const value = bubble.toolFormerData?.name;
  return typeof value === 'string' && value.trim() ? value : null;
}

function extractCursorBubbleToolInput(bubble: Record<string, any>): unknown {
  const toolFormerData = bubble.toolFormerData;
  if (!toolFormerData || typeof toolFormerData !== 'object') return null;

  const rawArgs = parseJsonString(toolFormerData.rawArgs);
  if (rawArgs && typeof rawArgs === 'object') return rawArgs;

  const params = parseJsonString(toolFormerData.params);
  if (params && typeof params === 'object') return params;

  return null;
}

function extractCursorBubbleToolResult(bubble: Record<string, any>): string | null {
  const toolFormerData = bubble.toolFormerData;
  if (!toolFormerData || typeof toolFormerData !== 'object') return null;

  const parsedResult = parseJsonString(toolFormerData.result);
  if (parsedResult && typeof parsedResult === 'object') {
    const record = parsedResult as Record<string, any>;
    if (typeof record.contents === 'string' && record.contents.trim()) {
      return normalizeCursorMessageBlock(record.contents);
    }
    if (typeof record.content === 'string' && record.content.trim()) {
      return normalizeCursorMessageBlock(record.content);
    }
    if (typeof record.text === 'string' && record.text.trim()) {
      return normalizeCursorMessageBlock(record.text);
    }
    return normalizeCursorMessageBlock(JSON.stringify(parsedResult, null, 2));
  }

  if (typeof parsedResult === 'string') {
    return normalizeCursorMessageBlock(parsedResult);
  }

  return null;
}

function normalizeCursorMessageBlock(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = normalizeMessageText(value);
  return normalized.trim() ? normalized : null;
}

function parseJsonString(value: unknown): unknown {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function dedupeReferences(items: { label?: string; path: string }[]): { label?: string; path: string }[] {
  const seen = new Set<string>();
  const results: { label?: string; path: string }[] = [];

  for (const item of items) {
    const key = `${item.label || ''}::${item.path}`;
    if (!item.path || seen.has(key)) continue;
    seen.add(key);
    results.push(item);
  }

  return results;
}

function isCursorPromptEntry(value: CursorPromptEntry | null | undefined): value is CursorPromptEntry {
  return typeof value?.text === 'string' && Boolean(sanitizeConversationText(value.text));
}

function isCursorGenerationEntry(value: CursorGenerationEntry | null | undefined): value is CursorGenerationEntry {
  return typeof value === 'object' && value !== null;
}
