import fs from 'fs';
import readline from 'readline';
import path from 'path';
import type { CursorComposerHead, CursorComposerMetadata, CursorGenerationEntry, CursorWorkspaceState } from './cursor-state.js';
import { findCursorComposerMetadata, parseCursorComposerVirtualPath, readCursorComposerConversation, readCursorWorkspaceState } from './cursor-state.js';
import type {
  ParsedMessage,
  MessageContent,
  ToolResultContent,
  ToolUseAnswerValue,
  ToolUseQuestion,
  ToolUseResultData,
} from '../types.js';
import { normalizeMessageText } from './text-normalization.js';

export interface SessionMetrics {
  messageCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  toolCallCount: number;
  model: string | null;
}

export async function parseSession(filePath: string): Promise<ParsedMessage[]> {
  const result = await parseSessionWithMetrics(filePath);
  return result.messages;
}

export async function parseSessionWithMetrics(filePath: string): Promise<{
  messages: ParsedMessage[];
  metrics: SessionMetrics;
}> {
  const virtualComposerPath = parseCursorComposerVirtualPath(filePath);
  if (!virtualComposerPath && !fs.existsSync(filePath)) {
    return finalizeParsedSession([]);
  }

  if (virtualComposerPath) {
    return finalizeParsedSession(parseCursorComposerSessionById(virtualComposerPath.composerId));
  }

  if (isCursorTranscriptPath(filePath)) {
    return finalizeParsedSession(await parseCursorTranscriptSession(filePath));
  }

  if (path.extname(filePath).toLowerCase() === '.vscdb') {
    return finalizeParsedSession(await parseCursorSession(filePath));
  }

  if (path.extname(filePath).toLowerCase() === '.json') {
    return finalizeParsedSession(await parseCopilotSession(filePath));
  }

  const messages: ParsedMessage[] = [];
  const stream = fs.createReadStream(filePath, { encoding: 'utf-8' });
  const rl = readline.createInterface({ input: stream });

  const assistantChunks = new Map<string, ParsedMessage>();
  const toolUseNames = new Map<string, string>();
  const codexMetrics = isCodexSessionFile(filePath)
    ? { totalInputTokens: 0, totalOutputTokens: 0, model: null as string | null }
    : null;
  let syntheticCounter = 0;
  const nextSyntheticId = (prefix: string) => `${prefix}-${++syntheticCounter}`;

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      const record = obj.type === 'response_item' && obj.payload ? obj.payload : obj;

      if (codexMetrics) {
        if (!codexMetrics.model && record?.type === 'message' && typeof record.model === 'string') {
          codexMetrics.model = record.model;
        }

        if (obj.type === 'event_msg' && obj.payload?.type === 'token_count') {
          const usage = obj.payload?.info?.total_token_usage;
          if (usage && typeof usage === 'object') {
            codexMetrics.totalInputTokens = Math.max(codexMetrics.totalInputTokens, Number(usage.input_tokens) || 0);
            codexMetrics.totalOutputTokens = Math.max(codexMetrics.totalOutputTokens, Number(usage.output_tokens) || 0);
          }
        }
      }

      if (
        ['file-history-snapshot', 'progress', 'summary'].includes(record.type)
        || obj.record_type === 'state'
        || obj.type === 'event_msg'
        || obj.type === 'turn_context'
        || obj.type === 'session_meta'
      ) {
        continue;
      }

      if (record.type === 'user') {
        const msg = parseClaudeUserMessage(record, toolUseNames);
        if (msg) messages.push(msg);
        continue;
      }

      if (record.type === 'assistant') {
        const apiId = record.message?.id;
        if (apiId && assistantChunks.has(apiId)) {
          const existing = assistantChunks.get(apiId)!;
          const newContent = extractClaudeAssistantContent(record.message?.content || []);
          existing.content.push(...newContent);
          for (const block of newContent) {
            if (block.type === 'tool_use' && block.id) {
              toolUseNames.set(block.id, block.name);
            }
          }
          if (record.message?.usage) {
            existing.input_tokens = Math.max(existing.input_tokens, record.message.usage.input_tokens || 0);
            existing.output_tokens = Math.max(existing.output_tokens, record.message.usage.output_tokens || 0);
          }
        } else {
          const msg = parseClaudeAssistantMessage(record);
          if (msg) {
            messages.push(msg);
            if (apiId) assistantChunks.set(apiId, msg);
            for (const block of msg.content) {
              if (block.type === 'tool_use' && block.id) {
                toolUseNames.set(block.id, block.name);
              }
            }
          }
        }
        continue;
      }

      if (record.type === 'result') {
        continue;
      }

      if (record.type === 'message' && (record.role === 'user' || record.role === 'assistant')) {
        const msg = parseCodexMessage(record, nextSyntheticId);
        if (msg) messages.push(msg);
        continue;
      }

      if (record.type === 'reasoning') {
        const msg = parseCodexReasoning(record, nextSyntheticId);
        if (msg) messages.push(msg);
        continue;
      }

      if (record.type === 'function_call') {
        const msg = parseCodexFunctionCall(record, nextSyntheticId);
        if (msg) {
          messages.push(msg);
          for (const block of msg.content) {
            if (block.type === 'tool_use' && block.id) {
              toolUseNames.set(block.id, block.name);
            }
          }
        }
        continue;
      }

      if (record.type === 'function_call_output') {
        const msg = parseCodexFunctionCallOutput(record, nextSyntheticId, toolUseNames);
        if (msg) messages.push(msg);
      }
    } catch {
      // Skip unparseable lines
    }
  }

  return finalizeParsedSession(splitClaudeThinkingMessages(messages), codexMetrics);
}

export async function getSessionMetrics(filePath: string, messages?: ParsedMessage[]): Promise<SessionMetrics> {
  if (messages) return summarizeMessages(messages);
  const result = await parseSessionWithMetrics(filePath);
  return result.metrics;
}

function summarizeMessages(messages: ParsedMessage[]): SessionMetrics {
  return {
    messageCount: messages.length,
    totalInputTokens: messages.reduce((sum, message) => sum + (message.input_tokens || 0), 0),
    totalOutputTokens: messages.reduce((sum, message) => sum + (message.output_tokens || 0), 0),
    toolCallCount: messages.reduce(
      (sum, message) => sum + message.content.filter(block => block.type === 'tool_use').length,
      0,
    ),
    model: messages.find(message => message.model)?.model || null,
  };
}

function finalizeParsedSession(
  messages: ParsedMessage[],
  codexMetrics?: { totalInputTokens: number; totalOutputTokens: number; model: string | null } | null,
): { messages: ParsedMessage[]; metrics: SessionMetrics } {
  const metrics = summarizeMessages(messages);
  if (codexMetrics) {
    metrics.totalInputTokens = codexMetrics.totalInputTokens;
    metrics.totalOutputTokens = codexMetrics.totalOutputTokens;
    if (!metrics.model && codexMetrics.model) {
      metrics.model = codexMetrics.model;
    }
  }
  return { messages, metrics };
}

function isCodexSessionFile(filePath: string): boolean {
  return filePath.replace(/[\\/]+/g, '/').toLowerCase().includes('/.codex/sessions/');
}

function parseCursorComposerSessionById(composerId: string): ParsedMessage[] {
  const conversation = readCursorComposerConversation(composerId);
  if (conversation.bubbles.length === 0) return [];
  return parseCursorComposerConversation(conversation.metadata, conversation.bubbles);
}

async function parseCursorTranscriptSession(filePath: string): Promise<ParsedMessage[]> {
  const composerId = path.basename(filePath, '.jsonl');
  const conversation = readCursorComposerConversation(composerId);
  if (conversation.bubbles.length > 0) {
    return parseCursorComposerConversation(conversation.metadata, conversation.bubbles);
  }

  const messages: ParsedMessage[] = [];
  const metadata = conversation.metadata;
  const stream = fs.createReadStream(filePath, { encoding: 'utf-8' });
  const rl = readline.createInterface({ input: stream });
  let index = 0;

  for await (const line of rl) {
    if (!line.trim()) continue;

    try {
      const obj = JSON.parse(line);
      if (obj?.role !== 'user' && obj?.role !== 'assistant') continue;

      const blocks = Array.isArray(obj?.message?.content) ? obj.message.content : [];
      const text = normalizeMessageText(
        blocks
          .filter((block: any) => block?.type === 'text' && typeof block?.text === 'string')
          .map((block: any) => obj.role === 'user' ? unwrapCursorTranscriptUserText(block.text) : block.text)
          .join('\n\n')
      );

      if (!text) continue;

      messages.push({
        uuid: `cursor-transcript-${composerId}-${++index}`,
        role: obj.role,
        type: 'cursor_transcript',
        content: [{ type: 'text', text }],
        timestamp: null,
        model: null,
        input_tokens: 0,
        output_tokens: 0,
        duration_ms: null,
      });
    } catch {
      // Skip unparseable lines
    }
  }

  const metadataContent = buildCursorTranscriptMetadataContent(metadata);
  if (metadataContent.length > 0) {
    messages.unshift({
      uuid: `cursor-transcript-meta-${composerId}`,
      role: 'assistant',
      type: 'cursor_workspace',
      content: metadataContent,
      timestamp: null,
      model: null,
      input_tokens: 0,
      output_tokens: 0,
      duration_ms: null,
    });
  }

  return messages;
}

function parseCursorComposerConversation(
  metadata: CursorComposerMetadata | null,
  bubbles: ReturnType<typeof readCursorComposerConversation>['bubbles'],
): ParsedMessage[] {
  const messages: ParsedMessage[] = [];
  const metadataContent = buildCursorTranscriptMetadataContent(metadata);

  if (metadataContent.length > 0) {
    messages.push({
      uuid: `cursor-transcript-meta-${metadata?.composerId || 'unknown'}`,
      role: 'assistant',
      type: 'cursor_workspace',
      content: metadataContent,
      timestamp: bubbles[0]?.createdAt || null,
      model: null,
      input_tokens: 0,
      output_tokens: 0,
      duration_ms: null,
    });
  }

  for (const bubble of bubbles) {
    if (bubble.thinking) {
      messages.push({
        uuid: `cursor-bubble-thinking-${bubble.bubbleId}`,
        role: 'assistant',
        type: 'cursor_thinking',
        content: [{ type: 'thinking', thinking: bubble.thinking }],
        timestamp: bubble.createdAt,
        model: null,
        input_tokens: 0,
        output_tokens: 0,
        duration_ms: null,
      });
    }

    const content: MessageContent[] = [];
    if (bubble.toolName) {
      const normalizedToolName = normalizeCursorToolName(bubble.toolName);
      content.push({
        type: 'tool_use',
        id: bubble.bubbleId,
        name: normalizedToolName,
        input: bubble.toolInput ?? {},
      });

      if (bubble.toolResult) {
        content.push({
          type: 'tool_result',
          tool_use_id: bubble.bubbleId,
          tool_name: normalizedToolName,
          content: bubble.toolResult,
        });
      }
    }
    if (bubble.text) {
      content.push({
        type: 'text',
        text: bubble.role === 'user' ? unwrapCursorTranscriptUserText(bubble.text) : bubble.text,
      });
    }
    if (bubble.references.length > 0) {
      content.push({ type: 'references', items: bubble.references });
    }

    if (content.length === 0) continue;

    messages.push({
      uuid: `cursor-bubble-${bubble.bubbleId}`,
      role: bubble.role,
      type: 'cursor_transcript',
      content,
      timestamp: bubble.createdAt,
      model: null,
      input_tokens: 0,
      output_tokens: 0,
      duration_ms: null,
    });
  }

  return messages;
}

async function parseCursorSession(filePath: string): Promise<ParsedMessage[]> {
  const state = readCursorWorkspaceState(filePath);
  if (!state) return [];

  const messages: ParsedMessage[] = [];
  const composerGenerations = state.generations
    .filter(entry => typeof entry.unixMs === 'number')
    .filter(entry => entry.type === 'composer')
    .slice()
    .sort((a, b) => (a.unixMs || 0) - (b.unixMs || 0));
  const activityGenerations = state.generations
    .filter(entry => entry.type !== 'composer')
    .slice()
    .sort((a, b) => (a.unixMs || 0) - (b.unixMs || 0));
  const usedComposerGenerationIds = new Set<string>();
  let composerIndex = 0;

  for (const prompt of state.prompts) {
    const promptText = normalizeMessageText(prompt.text || '');
    if (!promptText) continue;

    const matchedGeneration = findMatchingComposerGeneration(
      promptText,
      composerGenerations,
      usedComposerGenerationIds,
      composerIndex,
    );
    if (matchedGeneration) {
      const matchedIndex = composerGenerations.indexOf(matchedGeneration);
      if (matchedIndex >= 0) composerIndex = matchedIndex + 1;
      if (matchedGeneration.generationUUID) {
        usedComposerGenerationIds.add(matchedGeneration.generationUUID);
      }
    }

    messages.push({
      uuid: matchedGeneration?.generationUUID || `cursor-prompt-${messages.length + 1}`,
      role: 'user',
      type: 'cursor_prompt',
      content: [{ type: 'text', text: promptText }],
      timestamp: typeof matchedGeneration?.unixMs === 'number' ? new Date(matchedGeneration.unixMs).toISOString() : null,
      model: null,
      input_tokens: 0,
      output_tokens: 0,
      duration_ms: null,
    });
  }

  for (const generation of composerGenerations) {
    if (generation.generationUUID && usedComposerGenerationIds.has(generation.generationUUID)) continue;

    const promptText = normalizeMessageText(generation.textDescription || '');
    if (!promptText) continue;

    messages.push({
      uuid: generation.generationUUID || `cursor-composer-${messages.length + 1}`,
      role: 'user',
      type: 'cursor_prompt',
      content: [{ type: 'text', text: promptText }],
      timestamp: typeof generation.unixMs === 'number' ? new Date(generation.unixMs).toISOString() : null,
      model: null,
      input_tokens: 0,
      output_tokens: 0,
      duration_ms: null,
    });
  }

  for (const generation of activityGenerations) {
    const description = formatCursorGenerationDescription(generation);
    if (!description) continue;

    messages.push({
      uuid: generation.generationUUID || `cursor-activity-${messages.length + 1}`,
      role: 'assistant',
      type: 'cursor_generation',
      content: [{ type: 'text', text: description }],
      timestamp: typeof generation.unixMs === 'number' ? new Date(generation.unixMs).toISOString() : null,
      model: null,
      input_tokens: 0,
      output_tokens: 0,
      duration_ms: null,
    });
  }

  messages.sort((a, b) => {
    const left = a.timestamp ? Date.parse(a.timestamp) : 0;
    const right = b.timestamp ? Date.parse(b.timestamp) : 0;
    return left - right;
  });

  const metadataContent = buildCursorMetadataContent(state);
  if (metadataContent.length > 0) {
    messages.unshift({
      uuid: 'cursor-workspace',
      role: 'assistant',
      type: 'cursor_workspace',
      content: metadataContent,
      timestamp: messages[0]?.timestamp || null,
      model: null,
      input_tokens: 0,
      output_tokens: 0,
      duration_ms: null,
    });
  }

  return messages;
}

async function parseCopilotSession(filePath: string): Promise<ParsedMessage[]> {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, any>;
  const requests = Array.isArray(raw.requests) ? raw.requests : [];
  const messages: ParsedMessage[] = [];
  let syntheticCounter = 0;
  const nextSyntheticId = (prefix: string) => `${prefix}-${++syntheticCounter}`;

  for (const request of requests) {
    const timestamp = normalizeTimestamp(request?.timestamp);
    const userContent = buildCopilotUserContent(request);
    if (userContent.length > 0) {
      messages.push({
        uuid: typeof request?.requestId === 'string' && request.requestId ? request.requestId : nextSyntheticId('copilot-user'),
        role: 'user',
        type: 'copilot_request',
        content: userContent,
        timestamp,
        model: null,
        input_tokens: 0,
        output_tokens: 0,
        duration_ms: null,
      });
    }

    const assistantContent = buildCopilotAssistantContent(request);
    if (assistantContent.length > 0) {
      messages.push({
        uuid: typeof request?.responseId === 'string' && request.responseId ? request.responseId : nextSyntheticId('copilot-assistant'),
        role: 'assistant',
        type: 'copilot_response',
        content: assistantContent,
        timestamp,
        model: null,
        input_tokens: 0,
        output_tokens: 0,
        duration_ms: null,
      });
    }
  }

  return messages;
}

function parseClaudeUserMessage(obj: any, toolUseNames?: Map<string, string>): ParsedMessage | null {
  const content = obj.message?.content;
  if (!content) return null;

  const messageContent: MessageContent[] = [];

  if (typeof content === 'string') {
    const normalized = normalizeMessageText(content);
    if (normalized) messageContent.push({ type: 'text', text: normalized });
  } else if (Array.isArray(content)) {
    for (const block of content) {
      if (block.type === 'tool_result') {
        const toolName = resolveToolName(block, obj, toolUseNames);
        const resultBlock: ToolResultContent = {
          type: 'tool_result',
          tool_use_id: block.tool_use_id,
          content: getNormalizedToolResultContent(block),
          is_error: block.is_error,
          ...(toolName ? { tool_name: toolName } : {}),
        };

        const toolUseResult = normalizeToolUseResultData(obj, block, toolName);
        if (toolUseResult) {
          resultBlock.toolUseResult = toolUseResult;
        }

        if (resultBlock.content || resultBlock.toolUseResult || resultBlock.tool_name) {
          messageContent.push(resultBlock);
        }
      } else if (block.type === 'text') {
        const normalized = normalizeMessageText(block.text);
        if (normalized) messageContent.push({ type: 'text', text: normalized });
      } else if (block.type === 'image') {
        messageContent.push({ type: 'image', source: block.source });
      }
    }
  }

  if (messageContent.length === 0) return null;

  return {
    uuid: obj.uuid,
    role: 'user',
    type: obj.type,
    content: messageContent,
    timestamp: obj.timestamp || null,
    model: null,
    input_tokens: 0,
    output_tokens: 0,
    duration_ms: null,
  };
}

function buildCopilotUserContent(request: any): MessageContent[] {
  const content: MessageContent[] = [];
  const text = extractCopilotMessageText(request?.message);
  if (text) {
    content.push({ type: 'text', text });
  }

  const references = collectCopilotReferencesFromRequest(request);
  if (references.length > 0) {
    content.push({ type: 'references', items: references });
  }

  return content;
}

function buildCopilotAssistantContent(request: any): MessageContent[] {
  const content: MessageContent[] = [];
  const text = extractCopilotResponseText(request?.response);
  if (text) {
    content.push({ type: 'text', text });
  }

  const references = collectCopilotReferencesFromResponse(request);
  if (references.length > 0) {
    content.push({ type: 'references', items: references });
  }

  return content;
}

function parseClaudeAssistantMessage(obj: any): ParsedMessage | null {
  const content = extractClaudeAssistantContent(obj.message?.content || []);
  if (content.length === 0) return null;

  return {
    uuid: obj.uuid,
    role: 'assistant',
    type: obj.type,
    content,
    timestamp: obj.timestamp || null,
    model: obj.message?.model || null,
    input_tokens: obj.message?.usage?.input_tokens || 0,
    output_tokens: obj.message?.usage?.output_tokens || 0,
    duration_ms: null,
  };
}

function splitClaudeThinkingMessages(messages: ParsedMessage[]): ParsedMessage[] {
  const result: ParsedMessage[] = [];

  for (const message of messages) {
    if (message.role !== 'assistant' || message.type !== 'assistant') {
      result.push(message);
      continue;
    }

    const thinkingBlocks = message.content.filter(
      (block): block is Extract<MessageContent, { type: 'thinking' }> => block.type === 'thinking'
    );
    const otherBlocks = message.content.filter(block => block.type !== 'thinking');

    if (thinkingBlocks.length === 0 || otherBlocks.length === 0) {
      result.push(message);
      continue;
    }

    thinkingBlocks.forEach((block, index) => {
      result.push({
        ...message,
        uuid: `${message.uuid}-thinking-${index + 1}`,
        type: 'assistant_thinking',
        content: [block],
      });
    });

    result.push({
      ...message,
      content: otherBlocks,
    });
  }

  return result;
}

function extractClaudeAssistantContent(blocks: any[]): MessageContent[] {
  const result: MessageContent[] = [];
  for (const block of blocks) {
    if (block.type === 'text' && block.text) {
      const normalized = normalizeMessageText(block.text);
      if (normalized) result.push({ type: 'text', text: normalized });
    } else if (block.type === 'thinking' && block.thinking) {
      result.push({ type: 'thinking', thinking: block.thinking, summary: block.summary });
    } else if (block.type === 'tool_use') {
      result.push({
        type: 'tool_use',
        id: block.id,
        name: block.name,
        input: block.input,
      });
    }
  }
  return result;
}

function parseCodexMessage(obj: any, nextSyntheticId: (prefix: string) => string): ParsedMessage | null {
  const messageContent: MessageContent[] = [];

  if (!Array.isArray(obj.content)) return null;

  for (const block of obj.content) {
    if ((block.type === 'input_text' || block.type === 'output_text') && typeof block.text === 'string') {
      const normalized = normalizeMessageText(block.text);
      if (normalized) messageContent.push({ type: 'text', text: normalized });
    }
  }

  if (messageContent.length === 0) return null;

  return {
    uuid: typeof obj.id === 'string' && obj.id ? obj.id : nextSyntheticId(`codex-${obj.role}`),
    role: obj.role,
    type: obj.type,
    content: messageContent,
    timestamp: obj.timestamp || null,
    model: typeof obj.model === 'string' ? obj.model : null,
    input_tokens: 0,
    output_tokens: 0,
    duration_ms: null,
  };
}

function parseCodexReasoning(obj: any, nextSyntheticId: (prefix: string) => string): ParsedMessage | null {
  const summary = Array.isArray(obj.summary)
    ? obj.summary
      .filter((item: any) => item?.type === 'summary_text' && typeof item?.text === 'string')
      .map((item: any) => normalizeMessageText(item.text))
      .filter(Boolean)
      .join('\n\n')
    : '';

  if (!summary) return null;

  return {
    uuid: typeof obj.id === 'string' && obj.id ? obj.id : nextSyntheticId('codex-reasoning'),
    role: 'assistant',
    type: obj.type,
    content: [{ type: 'thinking', thinking: summary }],
    timestamp: obj.timestamp || null,
    model: null,
    input_tokens: 0,
    output_tokens: 0,
    duration_ms: null,
  };
}

function parseCodexFunctionCall(obj: any, nextSyntheticId: (prefix: string) => string): ParsedMessage | null {
  if (typeof obj.name !== 'string' || !obj.name.trim()) return null;

  const toolName = normalizeToolName(obj.name);
  const toolId = typeof obj.call_id === 'string' && obj.call_id ? obj.call_id : (typeof obj.id === 'string' && obj.id ? obj.id : nextSyntheticId('codex-call'));

  return {
    uuid: typeof obj.id === 'string' && obj.id ? obj.id : nextSyntheticId('codex-tool-use'),
    role: 'assistant',
    type: obj.type,
    content: [{
      type: 'tool_use',
      id: toolId,
      name: toolName,
      input: parseStructuredValue(obj.arguments),
    }],
    timestamp: obj.timestamp || null,
    model: null,
    input_tokens: 0,
    output_tokens: 0,
    duration_ms: null,
  };
}

function parseCodexFunctionCallOutput(
  obj: any,
  nextSyntheticId: (prefix: string) => string,
  toolUseNames?: Map<string, string>,
): ParsedMessage | null {
  const toolUseId = typeof obj.call_id === 'string' && obj.call_id ? obj.call_id : nextSyntheticId('codex-call-output');
  const toolName = toolUseNames?.get(toolUseId);

  const resultBlock: ToolResultContent = {
    type: 'tool_result',
    tool_use_id: toolUseId,
    content: normalizeMessageText(getFunctionCallOutputText(obj.output)) || '',
    ...(toolName ? { tool_name: toolName } : {}),
  };

  const toolUseResult = normalizeToolUseResultData(obj, { tool_use_id: toolUseId, content: obj.output }, toolName);
  if (toolUseResult) {
    resultBlock.toolUseResult = toolUseResult;
  }

  if (!resultBlock.content && !resultBlock.toolUseResult && !resultBlock.tool_name) {
    return null;
  }

  return {
    uuid: typeof obj.id === 'string' && obj.id ? obj.id : nextSyntheticId('codex-tool-result'),
    role: 'user',
    type: obj.type,
    content: [resultBlock],
    timestamp: obj.timestamp || null,
    model: null,
    input_tokens: 0,
    output_tokens: 0,
    duration_ms: null,
  };
}

function resolveToolName(block: any, obj: any, toolUseNames?: Map<string, string>): string | undefined {
  const explicitName =
    block.tool_name
    || block.name
    || block.content?.find?.((item: any) => item?.type === 'tool_reference')?.tool_name
    || obj.toolUseResult?.tool_name
    || obj.toolUseResult?.toolName;

  if (typeof explicitName === 'string' && explicitName.trim()) {
    return normalizeToolName(explicitName);
  }

  const mapped = block.tool_use_id ? toolUseNames?.get(block.tool_use_id) : undefined;
  return typeof mapped === 'string' && mapped.trim() ? mapped : undefined;
}

function getNormalizedToolResultContent(block: any): string {
  const text = typeof block.content === 'string'
    ? block.content
    : Array.isArray(block.content)
      ? block.content
        .map((item: any) => {
          if (typeof item?.text === 'string') return item.text;
          if (item?.type === 'tool_reference' && typeof item.tool_name === 'string') {
            return `[Tool reference: ${item.tool_name}]`;
          }
          return JSON.stringify(item);
        })
        .filter(Boolean)
        .join('\n')
      : block.content == null
        ? ''
        : JSON.stringify(block.content);

  return normalizeMessageText(text)?.slice(0, 10000) || '';
}

function getFunctionCallOutputText(value: unknown): string {
  const parsed = parseStructuredValue(value);

  if (parsed == null) return '';
  if (typeof parsed === 'string') return parsed;
  if (typeof parsed === 'object') {
    const record = parsed as Record<string, unknown>;
    if (typeof record.output === 'string') return record.output;
  }

  return JSON.stringify(parsed, null, 2);
}

function normalizeToolUseResultData(obj: any, block: any, toolName?: string): ToolUseResultData | undefined {
  const candidates = [
    obj.toolUseResult,
    block.toolUseResult,
    block.result,
    block.data,
    block.content,
    obj.output,
  ];

  for (const candidate of candidates) {
    const normalized = toToolUseResultData(candidate);
    if (normalized) return normalized;
  }

  if (toolName === 'AskUserQuestion') {
    const parsed = extractAskUserQuestionAnswersFromContent(block.content);
    if (parsed) return parsed;
  }

  return undefined;
}

function toToolUseResultData(value: unknown): ToolUseResultData | undefined {
  if (!value) return undefined;

  if (typeof value === 'string') {
    const parsed = parseStructuredValue(value);
    if (!parsed || typeof parsed === 'string') return undefined;
    return toToolUseResultData(parsed);
  }

  if (typeof value !== 'object' || Array.isArray(value)) return undefined;

  const record = value as Record<string, unknown>;
  const questions = normalizeQuestions(record.questions);
  const answers = normalizeAnswers(record.answers);
  const annotations = normalizeAnnotations(record.annotations);

  if (!questions || !answers) return undefined;

  return {
    questions,
    answers,
    ...(annotations ? { annotations } : {}),
  };
}

function normalizeQuestions(value: unknown): ToolUseQuestion[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const questions = value
    .map(question => {
      if (!question || typeof question !== 'object') return null;
      const record = question as Record<string, unknown>;
      if (typeof record.question !== 'string' || !record.question.trim()) return null;
      const options = Array.isArray(record.options)
        ? record.options
          .map(option => {
            if (!option || typeof option !== 'object') return null;
            const optionRecord = option as Record<string, unknown>;
            if (typeof optionRecord.label !== 'string' || !optionRecord.label.trim()) return null;
            return {
              label: optionRecord.label,
              ...(typeof optionRecord.description === 'string' && optionRecord.description.trim()
                ? { description: optionRecord.description }
                : {}),
            };
          })
          .filter((option): option is ToolUseQuestion['options'][number] => Boolean(option))
        : [];

      return {
        question: record.question,
        ...(typeof record.header === 'string' && record.header.trim() ? { header: record.header } : {}),
        options,
        ...(typeof record.multiSelect === 'boolean' ? { multiSelect: record.multiSelect } : {}),
      };
    })
    .filter((question): question is ToolUseQuestion => Boolean(question));

  return questions.length > 0 ? questions : undefined;
}

function normalizeAnswers(value: unknown): Record<string, ToolUseAnswerValue> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;

  const result: Record<string, ToolUseAnswerValue> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    const normalized = normalizeAnswerValue(rawValue);
    if (!normalized) continue;
    result[key] = normalized;
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

function normalizeAnswerValue(value: unknown): ToolUseAnswerValue | undefined {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    const items = value.filter((item): item is string => typeof item === 'string');
    return items.length > 0 ? items : undefined;
  }

  return undefined;
}

function normalizeAnnotations(value: unknown): ToolUseResultData['annotations'] | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;

  const result: NonNullable<ToolUseResultData['annotations']> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) continue;
    const notes = (rawValue as Record<string, unknown>).notes;
    if (typeof notes !== 'string' || !notes.trim()) continue;
    result[key] = { notes };
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

function extractAskUserQuestionAnswersFromContent(content: unknown): ToolUseResultData | undefined {
  const text = typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.map((item: any) => item?.text).filter((item: unknown): item is string => typeof item === 'string').join('\n')
      : '';

  if (!text) return undefined;

  const marker = 'User has answered your questions:';
  const markerIndex = text.indexOf(marker);
  if (markerIndex === -1) return undefined;

  const body = text.slice(markerIndex + marker.length).replace(/You can now continue[\s\S]*$/i, '').trim();
  const answers: Record<string, string> = {};
  const pairRe = /"([^"]+)"\s*=\s*"([\s\S]*?)"(?=,\s*"[^"]+"\s*=|\.?\s*$)/g;
  let match: RegExpExecArray | null;

  while ((match = pairRe.exec(body))) {
    answers[match[1]] = match[2];
  }

  if (Object.keys(answers).length === 0) return undefined;

  return {
    questions: Object.keys(answers).map(question => ({ question, options: [] })),
    answers,
  };
}

function parseStructuredValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function normalizeToolName(name: string): string {
  switch (name) {
    case 'shell':
    case 'shell_command':
      return 'Bash';
    case 'request_user_input':
      return 'AskUserQuestion';
    default:
      return name;
  }
}

function extractCopilotMessageText(message: any): string | null {
  if (!message) return null;
  if (typeof message.text === 'string') {
    return normalizeMessageText(message.text);
  }
  if (Array.isArray(message.parts)) {
    const joined = message.parts
      .map((part: any) => typeof part?.text === 'string' ? part.text : '')
      .filter(Boolean)
      .join('\n');
    return normalizeMessageText(joined);
  }
  return null;
}

function extractCopilotResponseText(response: any): string | null {
  if (!Array.isArray(response)) return null;
  const joined = response
    .map((item: any) => typeof item?.value === 'string' ? item.value : '')
    .filter(Boolean)
    .join('\n\n');
  return normalizeMessageText(joined);
}

function collectCopilotReferencesFromRequest(request: any): { label?: string; path: string }[] {
  const refs: { label?: string; path: string }[] = [];

  if (Array.isArray(request?.variableData?.variables)) {
    for (const variable of request.variableData.variables) {
      const fsPath = typeof variable?.value?.fsPath === 'string' ? variable.value.fsPath : null;
      if (!fsPath) continue;
      refs.push({
        ...(typeof variable?.name === 'string' && variable.name.trim() ? { label: variable.name } : {}),
        path: fsPath,
      });
    }
  }

  return dedupeReferences(refs);
}

function collectCopilotReferencesFromResponse(request: any): { label?: string; path: string }[] {
  if (!Array.isArray(request?.response)) return [];

  const refs = request.response.flatMap((item: any) => {
    const candidates: { label?: string; path: string }[] = [];
    const basePath = normalizeBaseUriPath(item?.baseUri);
    if (basePath) {
      candidates.push({ label: 'Workspace', path: basePath });
    }
    return candidates;
  });

  return dedupeReferences(refs);
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

function normalizeBaseUriPath(baseUri: any): string | null {
  if (!baseUri) return null;
  if (typeof baseUri.fsPath === 'string' && baseUri.fsPath.trim()) {
    return baseUri.fsPath;
  }
  if (typeof baseUri.scheme === 'string' && baseUri.scheme === 'file' && typeof baseUri.path === 'string') {
    return normalizeFileUriToPath(`file://${baseUri.path}`);
  }
  if (typeof baseUri.path === 'string' && baseUri.path.trim()) {
    return normalizeFileUriToPath(baseUri.path);
  }
  return null;
}

function normalizeFileUriToPath(value: string): string {
  if (/^file:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      const pathname = decodeURIComponent(url.pathname);
      if (/^\/[A-Za-z]:\//.test(pathname)) {
        return pathname.slice(1).replace(/\//g, path.sep);
      }
      return pathname.replace(/\//g, path.sep);
    } catch {
      return value;
    }
  }

  if (/^\/[A-Za-z]:\//.test(value)) {
    return value.slice(1).replace(/\//g, path.sep);
  }

  return value.replace(/\//g, path.sep);
}

function normalizeTimestamp(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  if (typeof value === 'string' && value.trim()) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return null;
}

export async function parseSubagents(sessionFilePath: string): Promise<Map<string, ParsedMessage[]>> {
  if (path.extname(sessionFilePath).toLowerCase() !== '.jsonl') {
    return new Map();
  }

  const sessionDir = sessionFilePath.replace('.jsonl', '');
  const subagentsDir = path.join(sessionDir, 'subagents');
  const result = new Map<string, ParsedMessage[]>();

  if (!fs.existsSync(subagentsDir)) return result;

  const files = fs.readdirSync(subagentsDir).filter(f => f.endsWith('.jsonl'));
  for (const file of files) {
    const agentId = file.replace('.jsonl', '');
    const messages = await parseSession(path.join(subagentsDir, file));
    result.set(agentId, messages);
  }

  return result;
}

function findMatchingComposerGeneration(
  promptText: string,
  generations: CursorGenerationEntry[],
  usedIds: Set<string>,
  startIndex: number,
): CursorGenerationEntry | null {
  for (let index = startIndex; index < generations.length; index++) {
    const generation = generations[index];
    if (generation.generationUUID && usedIds.has(generation.generationUUID)) continue;
    const description = normalizeMessageText(generation.textDescription || '');
    if (description === promptText) {
      return generation;
    }
  }

  for (let index = startIndex; index < generations.length; index++) {
    const generation = generations[index];
    if (generation.generationUUID && usedIds.has(generation.generationUUID)) continue;
    return generation;
  }

  return null;
}

function buildCursorMetadataContent(state: CursorWorkspaceState): MessageContent[] {
  const content: MessageContent[] = [];
  const references: { label?: string; path: string }[] = [];

  if (state.workspacePath) {
    references.push({ label: 'Workspace', path: state.workspacePath });
  }

  if (references.length > 0) {
    content.push({ type: 'references', items: references });
  }

  const composerSummary = formatCursorComposerSummary(state);
  if (composerSummary) {
    content.push({ type: 'text', text: composerSummary });
  }

  return content;
}

function buildCursorTranscriptMetadataContent(metadata: CursorComposerMetadata | null): MessageContent[] {
  if (!metadata) return [];

  const content: MessageContent[] = [];
  if (metadata.workspacePath) {
    content.push({
      type: 'references',
      items: [{ label: 'Workspace', path: metadata.workspacePath }],
    });
  }

  const lines: string[] = [];
  if (metadata.cachedGitBranch || metadata.activeBranch || metadata.createdOnBranch) {
    lines.push(`Branch: ${metadata.activeBranch || metadata.cachedGitBranch || metadata.createdOnBranch}`);
  }

  const title = metadata.name || 'Untitled composer';
  const subtitle = metadata.subtitle && metadata.subtitle !== title ? metadata.subtitle : null;
  const meta: string[] = [];
  if (metadata.unifiedMode) meta.push(metadata.unifiedMode);
  if (metadata.forceMode && metadata.forceMode !== metadata.unifiedMode) meta.push(metadata.forceMode);
  if (metadata.createdOnBranch) meta.push(`created on ${metadata.createdOnBranch}`);
  if (metadata.activeBranch) meta.push(`active ${metadata.activeBranch}`);
  if (metadata.selected) meta.push('selected');
  if (metadata.focused) meta.push('focused');

  const header = [title, subtitle ? `: ${subtitle}` : '', meta.length > 0 ? ` (${meta.join(', ')})` : ''].join('');
  lines.push(header);

  if (lines.length > 0) {
    content.push({ type: 'text', text: lines.join('\n') });
  }

  return content;
}

function formatCursorComposerSummary(state: CursorWorkspaceState): string | null {
  const lines: string[] = [];

  if (state.cachedGitBranch) {
    lines.push(`Branch: ${state.cachedGitBranch}`);
  }

  const composers = state.composers
    .slice()
    .sort((a, b) => (a.createdAt || a.lastUpdatedAt || 0) - (b.createdAt || b.lastUpdatedAt || 0));

  if (composers.length > 0) {
    lines.push(`Cursor composers (${composers.length}):`);
    for (const composer of composers) {
      const line = formatCursorComposerLine(composer, state);
      if (line) lines.push(line);
    }
  }

  return lines.length > 0 ? lines.join('\n') : null;
}

function formatCursorComposerLine(composer: CursorComposerHead, state: CursorWorkspaceState): string | null {
  const parts: string[] = [];
  const title = normalizeMessageText(composer.name || '') || 'Untitled composer';
  parts.push(`- ${title}`);

  const subtitle = normalizeMessageText(composer.subtitle || '');
  if (subtitle && subtitle !== title) {
    parts.push(`: ${subtitle}`);
  }

  const meta: string[] = [];
  if (composer.unifiedMode) meta.push(composer.unifiedMode);
  if (composer.forceMode && composer.forceMode !== composer.unifiedMode) meta.push(composer.forceMode);
  if (composer.createdOnBranch) meta.push(`created on ${composer.createdOnBranch}`);
  if (composer.activeBranch?.branchName) meta.push(`active ${composer.activeBranch.branchName}`);
  if (composer.composerId && state.selectedComposerIds.includes(composer.composerId)) meta.push('selected');
  if (composer.composerId && state.lastFocusedComposerIds.includes(composer.composerId)) meta.push('focused');

  if (meta.length > 0) {
    parts.push(` (${meta.join(', ')})`);
  }

  return parts.join('');
}

function formatCursorGenerationDescription(entry: { type?: string; textDescription?: string }): string | null {
  const description = normalizeMessageText(entry.textDescription || '');
  if (!description) return null;

  switch (entry.type) {
    case 'apply':
      return `Applied changes to ${description}`;
    default:
      return `${capitalize(entry.type || 'activity')}: ${description}`;
  }
}

function capitalize(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

function unwrapCursorTranscriptUserText(text: string): string {
  const match = text.match(/^<user_query>\s*([\s\S]*?)\s*<\/user_query>$/i);
  return match?.[1]?.trim() || text;
}

function isCursorTranscriptPath(filePath: string): boolean {
  const normalized = filePath.replace(/[\\/]+/g, '/').toLowerCase();
  return path.extname(filePath).toLowerCase() === '.jsonl'
    && normalized.includes('/.cursor/projects/')
    && normalized.includes('/agent-transcripts/');
}

function normalizeCursorToolName(name: string): string {
  switch (name) {
    case 'read_file_v2':
      return 'Read';
    case 'glob_file_search':
      return 'Glob';
    case 'ripgrep_raw_search':
      return 'Grep';
    case 'web_search':
      return 'WebSearch';
    case 'semantic_search_full':
      return 'Search';
    default:
      return normalizeToolName(name);
  }
}
