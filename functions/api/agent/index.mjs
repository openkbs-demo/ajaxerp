/**
 * AI Agent handler — Production Intelligence & Natural Language Query agents.
 * Uses Vercel AI SDK generateText() with tool-calling.
 */
import { generateText } from 'ai';
import { getModel } from './provider.mjs';
import { PRODUCTION_PROMPT, QUERY_PROMPT } from './systemPrompts.mjs';
import { productionTools } from './tools/production.mjs';
import { queryTools } from './tools/query.mjs';

const MAX_HISTORY = 20;
const MAX_STEPS = 5;
const MAX_TOKENS = 4096;

/**
 * agentChat — main chat endpoint
 * @param {object} db - PostgreSQL client
 * @param {object} params - { session_id, personnel_id, message, mode }
 */
export async function agentChat(db, { session_id, personnel_id, message, mode }) {
  if (!session_id || !message) {
    throw new Error('session_id и message са задължителни');
  }

  mode = mode || 'production';
  if (!['production', 'query'].includes(mode)) {
    throw new Error('mode трябва да е "production" или "query"');
  }

  // Save user message
  await db.query(
    `INSERT INTO agent_conversations (session_id, personnel_id, agent_mode, role, content)
     VALUES ($1, $2, $3, 'user', $4)`,
    [session_id, personnel_id || null, mode, message]
  );

  // Load conversation history
  const historyResult = await db.query(
    `SELECT role, content FROM agent_conversations
     WHERE session_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [session_id, MAX_HISTORY]
  );

  const messages = historyResult.rows.reverse().map(row => ({
    role: row.role,
    content: row.content
  }));

  // Select prompt and tools based on mode
  const systemPrompt = mode === 'production' ? PRODUCTION_PROMPT : QUERY_PROMPT;
  const tools = mode === 'production' ? productionTools(db) : queryTools(db);

  // Call LLM
  const model = await getModel(db);
  const result = await generateText({
    model,
    system: systemPrompt,
    messages,
    tools,
    maxSteps: MAX_STEPS,
    maxTokens: MAX_TOKENS
  });

  const responseText = result.text || 'Не успях да генерирам отговор.';

  // Save assistant response
  // Build enriched tool_calls with results paired by toolCallId
  const toolCalls = result.steps?.flatMap(step => {
    const calls = step.toolCalls || [];
    const results = step.toolResults || [];
    const resultMap = new Map(results.map(tr => [tr.toolCallId, tr.result]));
    return calls.map(tc => ({
      name: tc.toolName,
      args: tc.args,
      result: resultMap.get(tc.toolCallId) ?? null
    }));
  }) || [];

  await db.query(
    `INSERT INTO agent_conversations (session_id, personnel_id, agent_mode, role, content, tool_calls)
     VALUES ($1, $2, $3, 'assistant', $4, $5)`,
    [session_id, personnel_id || null, mode, responseText, toolCalls?.length ? JSON.stringify(toolCalls) : null]
  );

  return { response: responseText, tool_calls: toolCalls || [] };
}

/**
 * agentHistory — retrieve conversation messages
 * @param {object} db - PostgreSQL client
 * @param {object} params - { session_id, limit }
 */
export async function agentHistory(db, { session_id, limit }) {
  if (!session_id) throw new Error('session_id е задължителен');

  const result = await db.query(
    `SELECT role, content, agent_mode, tool_calls, created_at
     FROM agent_conversations
     WHERE session_id = $1
     ORDER BY created_at ASC
     LIMIT $2`,
    [session_id, limit || 50]
  );

  return { messages: result.rows };
}
