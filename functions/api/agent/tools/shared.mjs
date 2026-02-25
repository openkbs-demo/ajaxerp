/**
 * Shared utilities for AI agent tools — safe read-only SQL executor.
 */

const FORBIDDEN_KEYWORDS = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE|EXEC|EXECUTE|MERGE|REPLACE|CALL)\b/i;

export async function safeQuery(db, sql, params = [], maxRows = 200) {
  const trimmed = sql.trim().replace(/;+$/, '');

  if (FORBIDDEN_KEYWORDS.test(trimmed)) {
    throw new Error('Само SELECT заявки са разрешени.');
  }

  if (!/^\s*SELECT\b/i.test(trimmed)) {
    throw new Error('Заявката трябва да започва със SELECT.');
  }

  // Enforce row limit
  const limited = /\bLIMIT\b/i.test(trimmed)
    ? trimmed
    : `${trimmed} LIMIT ${maxRows}`;

  const result = await db.query(limited, params);
  return result.rows;
}
