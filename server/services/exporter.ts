import { parseSession } from './parser.js';
import type { ParsedMessage, ToolResultContent, ToolUseAnswerValue, ToolUseResultData } from '../types.js';
import { getDb } from '../db/connection.js';
import { isCodexSessionId, resolveLatestCodexLineageSession } from './codex-lineage.js';

export async function exportSession(sessionId: string, format: 'md' | 'json'): Promise<string> {
  const db = getDb();
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as any;
  if (!session) throw new Error('Session not found');

  const contentSession = isCodexSessionId(session.id) && !session.parent_session_id
    ? resolveLatestCodexLineageSession(db, session.id) || session
    : session;
  const messages = await parseSession(contentSession.file_path);

  if (format === 'json') {
    return JSON.stringify({ session, messages }, null, 2);
  }

  return exportAsMarkdown(session, messages);
}

function exportAsMarkdown(session: any, messages: ParsedMessage[]): string {
  const lines: string[] = [];
  lines.push(`# ${session.summary || 'Untitled Conversation'}`);
  lines.push('');
  lines.push(`- **Project**: ${session.project_slug}`);
  lines.push(`- **Date**: ${session.created_at || 'Unknown'}`);
  lines.push(`- **Messages**: ${messages.length}`);
  if (session.model) lines.push(`- **Model**: ${session.model}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  for (const msg of messages) {
    if (msg.role === 'user') {
      lines.push('## User');
      lines.push('');
    } else if (msg.role === 'assistant') {
      lines.push('## Assistant');
      if (msg.model) lines.push(`*Model: ${msg.model}*`);
      lines.push('');
    } else {
      lines.push('## System');
      lines.push('');
    }

    for (const block of msg.content) {
      if (block.type === 'text') {
        lines.push(block.text);
      } else if (block.type === 'references') {
        lines.push(...formatReferencesBlock(block.items));
      } else if (block.type === 'thinking') {
        lines.push('<details><summary>Thinking</summary>');
        lines.push('');
        lines.push(block.thinking.slice(0, 10000));
        lines.push('</details>');
      } else if (block.type === 'tool_use') {
        lines.push(`**Tool: ${block.name}**`);
        lines.push('```json');
        lines.push(JSON.stringify(block.input, null, 2).slice(0, 5000));
        lines.push('```');
      } else if (block.type === 'tool_result') {
        if (block.tool_name === 'AskUserQuestion') {
          lines.push(...formatAskUserQuestionResult(block));
        } else {
          lines.push(`<details><summary>Tool result: ${block.tool_name || block.tool_use_id}</summary>`);
          lines.push('');
          lines.push('```');
          lines.push(block.content.slice(0, 5000));
          lines.push('```');
          lines.push('</details>');
        }
      }
      lines.push('');
    }

    lines.push('---');
    lines.push('');
  }

  return lines.join('\n');
}

function formatAskUserQuestionResult(block: ToolResultContent): string[] {
  const lines: string[] = [];
  lines.push('**User answered assistant questions**');
  lines.push('');

  const structured = block.toolUseResult;
  if (structured?.questions?.length && structured.answers) {
    for (const question of structured.questions) {
      const answer = findAnswerValue(question.question, structured);
      const notes = findNotes(question.question, structured);
      if (!answer && !notes) continue;

      lines.push(`- **${question.question}**`);
      for (const item of toAnswerList(answer)) {
        lines.push(`  - ${item}`);
      }
      if (notes) {
        lines.push(`  - Notes: ${notes}`);
      }
      lines.push('');
    }

    if (lines.length > 2) return lines;
  }

  if (block.content) {
    lines.push(block.content.slice(0, 5000));
    lines.push('');
  }

  return lines;
}

function formatReferencesBlock(items: { label?: string; path: string }[]): string[] {
  const lines: string[] = [];
  if (items.length === 0) return lines;

  lines.push('**References**');
  for (const item of items) {
    lines.push(`- ${item.label ? `${item.label}: ` : ''}\`${item.path}\``);
  }
  lines.push('');

  return lines;
}

function findAnswerValue(questionText: string, data: ToolUseResultData): ToolUseAnswerValue | undefined {
  if (questionText in data.answers) return data.answers[questionText];
  const normalizedQuestion = normalizeLookupKey(questionText);

  for (const [key, value] of Object.entries(data.answers)) {
    const normalizedKey = normalizeLookupKey(key);
    if (!normalizedKey) continue;
    if (normalizedKey === normalizedQuestion || normalizedKey.includes(normalizedQuestion) || normalizedQuestion.includes(normalizedKey)) {
      return value;
    }
  }

  return undefined;
}

function findNotes(questionText: string, data: ToolUseResultData): string | undefined {
  if (data.annotations?.[questionText]?.notes) return data.annotations[questionText]?.notes;
  const normalizedQuestion = normalizeLookupKey(questionText);

  for (const [key, value] of Object.entries(data.annotations || {})) {
    const normalizedKey = normalizeLookupKey(key);
    if (!normalizedKey) continue;
    if (normalizedKey === normalizedQuestion || normalizedKey.includes(normalizedQuestion) || normalizedQuestion.includes(normalizedKey)) {
      return value.notes;
    }
  }

  return undefined;
}

function toAnswerList(value: ToolUseAnswerValue | undefined): string[] {
  if (typeof value === 'string') return value ? [value] : [];
  if (Array.isArray(value)) return value.filter(Boolean);
  return [];
}

function normalizeLookupKey(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}
