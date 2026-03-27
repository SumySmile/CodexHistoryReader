import fs from 'fs';
import readline from 'readline';
import path from 'path';
import type {
  ParsedMessage,
  MessageContent,
  ToolResultContent,
  ToolUseAnswerValue,
  ToolUseQuestion,
  ToolUseResultData,
} from '../types.js';
import { normalizeMessageText } from './text-normalization.js';

export async function parseSession(filePath: string): Promise<ParsedMessage[]> {
  if (!fs.existsSync(filePath)) return [];

  const messages: ParsedMessage[] = [];
  const stream = fs.createReadStream(filePath, { encoding: 'utf-8' });
  const rl = readline.createInterface({ input: stream });

  const assistantChunks = new Map<string, ParsedMessage>();
  const toolUseNames = new Map<string, string>();
  let syntheticCounter = 0;
  const nextSyntheticId = (prefix: string) => `${prefix}-${++syntheticCounter}`;

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      const record = obj.type === 'response_item' && obj.payload ? obj.payload : obj;

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

export async function parseSubagents(sessionFilePath: string): Promise<Map<string, ParsedMessage[]>> {
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
