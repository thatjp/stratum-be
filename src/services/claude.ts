import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { pool } from '../db';
import { logger } from '../logger';

export const DEFAULT_MODEL = () => process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6';
export const HAIKU_MODEL = 'claude-haiku-4-5-20251001';

// Single client for the whole process so timeout / retry policy lives in one place.
// 60s is long enough for extraction and quiz generation; maxRetries=2 covers
// transient Anthropic blips without multiplying spend on a real outage.
export const anthropic = new Anthropic({
  apiKey:     process.env.ANTHROPIC_API_KEY,
  timeout:    parseInt(process.env.ANTHROPIC_TIMEOUT_MS ?? '60000', 10),
  maxRetries: parseInt(process.env.ANTHROPIC_MAX_RETRIES ?? '2', 10),
});

export interface UsageContext {
  userId?:         string;
  conversationId?: string;
  operation:       string;
}

// Fire-and-forget — never blocks the calling path, never throws into it.
export function logTokenUsage(params: UsageContext & {
  model:        string;
  inputTokens:  number;
  outputTokens: number;
}): void {
  if (!params.userId) return;
  pool.query(
    `INSERT INTO token_usage (user_id, conversation_id, operation, model, input_tokens, output_tokens)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [params.userId, params.conversationId ?? null, params.operation, params.model, params.inputTokens, params.outputTokens],
  ).catch((err: unknown) =>
    logger.error({ event: 'token_usage_log_failed', err: String(err) }),
  );
}

function textFrom(response: Anthropic.Message): string {
  return response.content[0]?.type === 'text' ? response.content[0].text : '';
}

function stripFences(raw: string): string {
  return raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
}

export interface ClaudeCallOptions {
  model?:     string;
  maxTokens:  number;
  system?:    string;
  messages:   Anthropic.MessageParam[];
  usage:      UsageContext;
}

export async function callClaudeText(opts: ClaudeCallOptions): Promise<{
  content:      string;
  inputTokens:  number;
  outputTokens: number;
  model:        string;
}> {
  const model = opts.model ?? DEFAULT_MODEL();
  const response = await anthropic.messages.create({
    model,
    max_tokens: opts.maxTokens,
    ...(opts.system ? { system: opts.system } : {}),
    messages: opts.messages,
  });

  logTokenUsage({
    ...opts.usage,
    model,
    inputTokens:  response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  });

  return {
    content:      textFrom(response),
    inputTokens:  response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    model,
  };
}

export async function callClaudeJSON<T>(opts: ClaudeCallOptions & {
  schema:   z.ZodType<T>;
  fallback: T;
}): Promise<{
  data:         T;
  inputTokens:  number;
  outputTokens: number;
  model:        string;
}> {
  const { content, inputTokens, outputTokens, model } = await callClaudeText(opts);
  const cleaned = stripFences(content);

  try {
    const parsed = JSON.parse(cleaned);
    const result = opts.schema.safeParse(parsed);
    if (result.success) {
      return { data: result.data, inputTokens, outputTokens, model };
    }
    logger.error({
      event:     'claude_json_schema_failed',
      operation: opts.usage.operation,
      issues:    result.error.issues.slice(0, 5),
      preview:   cleaned.slice(0, 200),
    });
  } catch {
    logger.error({
      event:     'claude_json_parse_failed',
      operation: opts.usage.operation,
      preview:   cleaned.slice(0, 200),
    });
  }

  return { data: opts.fallback, inputTokens, outputTokens, model };
}
