/**
 * Natural Language Query tool — LLM generates SELECT SQL, tool validates and executes.
 */
import { z } from 'zod';
import { tool } from 'ai';
import { safeQuery } from './shared.mjs';

export function queryTools(db) {
  return {
    execute_sql: tool({
      description: `Изпълнява SELECT SQL заявка върху базата данни на фермата. Генерирай валиден PostgreSQL SELECT за да отговориш на въпроса. Максимум 200 реда. Използвай LIMIT. НЕ използвай INSERT/UPDATE/DELETE/DROP.`,
      parameters: z.object({
        sql: z.string().describe('PostgreSQL SELECT заявка'),
        explanation: z.string().describe('Кратко обяснение на заявката на български')
      }),
      execute: async ({ sql, explanation }) => {
        try {
          const rows = await safeQuery(db, sql, [], 200);
          return { rows, row_count: rows.length, explanation };
        } catch (e) {
          return { error: e.message, sql };
        }
      }
    })
  };
}
