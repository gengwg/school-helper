import type { MiddlewareHandler } from '@mastra/core/server';

/**
 * Family code gate. When APP_TOKEN is set, dashboard, sync, and chat requests must carry it in
 * x-family-code or as a Bearer token. Unset means open, which is only right for a demo.
 */
export const familyCode: MiddlewareHandler = async (c, next) => {
  const expected = process.env.APP_TOKEN;
  if (!expected) return next();
  const given = c.req.header('x-family-code') ?? c.req.header('authorization')?.replace(/^Bearer\s+/i, '');
  if (given !== expected) return c.json({ error: 'family code required' }, 401);
  return next();
};

/** Email channel allowlist: comma-separated addresses in ALLOWED_SENDERS. Unset means anyone. */
export function senderAllowed(from: string) {
  const allowed = (process.env.ALLOWED_SENDERS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!allowed.length) return true;
  const addr = (from.match(/<([^>]+)>/)?.[1] ?? from).trim().toLowerCase();
  return allowed.includes(addr);
}
