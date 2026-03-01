/**
 * LLM provider factory — reads config from app_settings (DB), falls back to env vars.
 */

async function getSettings(db) {
  const result = await db.query(
    `SELECT key, value FROM app_settings WHERE key IN ('ai_provider', 'ai_model', 'anthropic_api_key', 'openai_api_key')`
  );
  const settings = {};
  for (const row of result.rows) settings[row.key] = row.value;
  return settings;
}

export async function getModel(db) {
  const s = await getSettings(db);

  const provider = (s.ai_provider || process.env.AI_PROVIDER || 'anthropic').toLowerCase();
  const modelId = s.ai_model || process.env.AI_MODEL;

  let apiKey;
  if (provider === 'openai') {
    apiKey = s.openai_api_key || process.env.OPENAI_API_KEY;
  } else {
    apiKey = s.anthropic_api_key || process.env.ANTHROPIC_API_KEY;
  }

  if (!apiKey) {
    throw new Error('AI API ключ не е конфигуриран. Моля, добавете го от Настройки → AI Настройки.');
  }

  if (provider === 'anthropic') {
    const { createAnthropic } = await import('@ai-sdk/anthropic');
    const anthropic = createAnthropic({ apiKey });
    return anthropic(modelId || 'claude-sonnet-4-6');
  }

  if (provider === 'openai') {
    const { createOpenAI } = await import('@ai-sdk/openai');
    const openai = createOpenAI({ apiKey });
    return openai(modelId || 'gpt-5.2');
  }

  throw new Error(`Неподдържан AI доставчик: ${provider}. Поддържани: Anthropic, OpenAI.`);
}

/**
 * Returns the OpenAI API key for Whisper / voice services.
 */
export async function getOpenAIKey(db) {
  const s = await getSettings(db);
  const key = s.openai_api_key || process.env.OPENAI_API_KEY;

  if (!key) {
    throw new Error('OpenAI API ключ не е конфигуриран. Нужен е за гласово разпознаване. Добавете го от Настройки → AI Настройки.');
  }
  return key;
}
