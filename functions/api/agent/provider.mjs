/**
 * LLM provider factory — reads config from app_settings (DB), falls back to env vars.
 */

async function getSettings(db) {
  const result = await db.query(
    `SELECT key, value FROM app_settings WHERE key IN ('ai_provider', 'ai_model', 'ai_api_key')`
  );
  const settings = {};
  for (const row of result.rows) settings[row.key] = row.value;
  return settings;
}

export async function getModel(db) {
  const s = await getSettings(db);

  const provider = (s.ai_provider || process.env.AI_PROVIDER || 'anthropic').toLowerCase();
  const apiKey = s.ai_api_key || process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || process.env.GOOGLE_API_KEY;
  const modelId = s.ai_model || process.env.AI_MODEL;

  if (!apiKey) {
    throw new Error('AI API ключ не е конфигуриран. Моля, добавете го от Настройки → AI Асистент.');
  }

  if (provider === 'anthropic') {
    const { createAnthropic } = await import('@ai-sdk/anthropic');
    const anthropic = createAnthropic({ apiKey });
    return anthropic(modelId || 'claude-sonnet-4-6');
  }

  throw new Error(`Неподдържан AI доставчик: ${provider}. В момента се поддържа само Anthropic.`);
}
