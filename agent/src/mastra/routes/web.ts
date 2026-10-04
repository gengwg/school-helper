import { registerApiRoute } from '@mastra/core/server';
import { listEvents } from '../../calendar.js';
import { extract, reconcile, formatReply, type Input } from '../../pipeline.js';
import { syncSchool, getSchool, setSchool } from '../../sync.js';
import { path } from '../../paths.js';

/** Paste a thread or drop a screenshot. Zero setup path for the dashboard. */
export const ingestRoute = registerApiRoute('/ingest', {
  method: 'POST',
  handler: async (c) => {
    const mastra = c.get('mastra');
    const body = (await c.req.json()) as { text?: string; imageBase64?: string; mimeType?: string };
    const input: Input = { text: body.text };
    if (body.imageBase64) input.image = { data: Buffer.from(body.imageBase64, 'base64'), mimeType: body.mimeType ?? 'image/png' };
    const result = await reconcile(await extract(mastra.getAgent('extractor'), input));
    return c.json({ summary: formatReply(result), ...result });
  },
});

export const weekRoute = registerApiRoute('/week', {
  method: 'GET',
  handler: async (c) => {
    const now = new Date();
    const end = new Date(now); end.setDate(end.getDate() + 14);
    const events = await listEvents(now.toISOString(), end.toISOString());
    return c.json({ events, school: await getSchool(), whatsapp: process.env.WHATSAPP_DISPLAY_NUMBER ?? null, email: process.env.AGENTMAIL_INBOX_ID ?? null });
  },
});

export const syncRoute = registerApiRoute('/sync', {
  method: 'POST',
  handler: async (c) => {
    const mastra = c.get('mastra');
    const body = (await c.req.json().catch(() => ({}))) as { school?: string };
    if (body.school) await setSchool(body.school);
    const r = await syncSchool(mastra);
    return c.json({ summary: formatReply(r), ...r });
  },
});

export const appRoute = registerApiRoute('/app', {
  method: 'GET',
  handler: async (c) => c.html(await (await import('node:fs/promises')).readFile(path('public', 'index.html'), 'utf8')),
});
