import OpenAI from 'openai';
import { AiUsageService } from '../analytics/ai-usage.service';

export interface SSEEvent {
  type: string;
  data: Record<string, any>;
}

/**
 * Attempt to repair and parse potentially truncated/trailing JSON from streamed OpenAI tool calls.
 */
export function safeParseToolArgs(raw: string): Record<string, any> {
  try {
    return JSON.parse(raw);
  } catch (firstErr) {
    console.warn(
      '[safeParseToolArgs] Raw tool args failed to parse, attempting repair. Raw:',
      raw,
    );

    // Strategy 1: extract all top-level JSON objects and merge them
    const objects: Record<string, any>[] = [];
    let pos = 0;
    while (pos < raw.length) {
      const braceIdx = raw.indexOf('{', pos);
      if (braceIdx < 0) break;
      let depth = 0;
      let inString = false;
      let escape = false;
      let endIdx = -1;
      for (let i = braceIdx; i < raw.length; i++) {
        const ch = raw[i];
        if (escape) {
          escape = false;
          continue;
        }
        if (ch === '\\') {
          escape = true;
          continue;
        }
        if (ch === '"') {
          inString = !inString;
          continue;
        }
        if (inString) continue;
        if (ch === '{') depth++;
        if (ch === '}') depth--;
        if (depth === 0) {
          endIdx = i;
          break;
        }
      }
      if (endIdx >= 0) {
        try {
          objects.push(JSON.parse(raw.slice(braceIdx, endIdx + 1)));
        } catch {
          // skip malformed object
        }
        pos = endIdx + 1;
      } else {
        break;
      }
    }
    if (objects.length === 1) {
      return objects[0];
    }
    if (objects.length > 1) {
      // Merge: concatenate array values with the same key
      const merged: Record<string, any> = { ...objects[0] };
      for (let i = 1; i < objects.length; i++) {
        for (const [key, val] of Object.entries(objects[i])) {
          if (Array.isArray(merged[key]) && Array.isArray(val)) {
            merged[key] = [...merged[key], ...val];
          } else if (!(key in merged)) {
            merged[key] = val;
          }
        }
      }
      console.log(
        '[safeParseToolArgs] Merged',
        objects.length,
        'concatenated JSON objects',
      );
      return merged;
    }

    // Strategy 2: truncated JSON — close open strings, arrays, objects
    let repaired = raw.trim();
    const quoteCount = (repaired.match(/(?<!\\)"/g) || []).length;
    if (quoteCount % 2 !== 0) repaired += '"';
    const balance = (o: string, c: string) => {
      const opens = (repaired.match(new RegExp(`\\${o}`, 'g')) || []).length;
      const closes = (repaired.match(new RegExp(`\\${c}`, 'g')) || []).length;
      for (let i = 0; i < opens - closes; i++) repaired += c;
    };
    balance('[', ']');
    balance('{', '}');
    repaired = repaired.replace(/,\s*([\]}])/g, '$1');

    try {
      return JSON.parse(repaired);
    } catch {
      console.error(
        '[safeParseToolArgs] Repair also failed. Repaired:',
        repaired,
      );
      throw firstErr;
    }
  }
}

/**
 * Feed a tool result back to OpenAI and stream the follow-up response.
 * Yields text_delta SSE events and tracks AI usage.
 * Returns the accumulated follow-up content.
 */
export async function* streamToolFollowUp(params: {
  openai: OpenAI;
  model: string;
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  toolCallId: string;
  toolCallName: string;
  toolCallArgs: string;
  toolResult: string;
  fullContent: string;
  maxTokens: number;
  aiUsage: AiUsageService;
  userId: string;
  feature: string;
}): AsyncGenerator<SSEEvent & { _followUpContent?: string }> {
  const followUp = await params.openai.chat.completions.create({
    model: params.model,
    messages: [
      ...params.messages,
      {
        role: 'assistant',
        content: params.fullContent || null,
        tool_calls: [
          {
            id: params.toolCallId,
            type: 'function',
            function: {
              name: params.toolCallName,
              arguments: params.toolCallArgs,
            },
          },
        ],
      },
      {
        role: 'tool',
        tool_call_id: params.toolCallId,
        content: params.toolResult,
      },
    ],
    stream: true,
    stream_options: { include_usage: true },
    max_tokens: params.maxTokens,
    temperature: 0.7,
  });

  let followUpUsage: {
    prompt_tokens: number;
    completion_tokens: number;
  } | null = null;

  let followUpContent = '';

  for await (const followChunk of followUp) {
    const followDelta = followChunk.choices[0]?.delta;
    if (followDelta?.content) {
      followUpContent += followDelta.content;
      yield {
        type: 'text_delta',
        data: { content: followDelta.content },
      };
    }
    if (followChunk.usage) {
      followUpUsage = {
        prompt_tokens: followChunk.usage.prompt_tokens,
        completion_tokens: followChunk.usage.completion_tokens,
      };
    }
  }

  if (followUpUsage) {
    params.aiUsage.trackUsage({
      userId: params.userId,
      feature: params.feature,
      model: params.model,
      promptTokens: followUpUsage.prompt_tokens,
      completionTokens: followUpUsage.completion_tokens,
    });
  }

  // Yield a final marker event with the accumulated content (consumed by caller)
  yield {
    type: '_followup_content',
    data: {},
    _followUpContent: followUpContent,
  };
}
