import { createHash } from 'node:crypto';
import { registerApiRoute } from '@mastra/core/server';
import { listEvents } from '../../calendar.js';
import { claim, getTicket, handle } from '../../intake.js';
import type { Inbound } from '../../inbound.js';
import { syncSchool, getSchool, setSchool } from '../../sync.js';
import { formatReply } from '../../pipeline.js';
import { path } from '../../paths.js';
import { familyCode } from '../auth.js';
import type { Ticket } from '../../effects.js';

export async function prepareDashboard(ticket: Ticket): Promise<Inbound> {
  const input = ticket.data;
  const imageData = input.image?.data?.type === 'Buffer' ? input.image.data.data : input.image?.data;
  return {
    text: input.text,
    attachments: input.image ? [{ data: Buffer.from(imageData), mimeType: input.image.mimeType }] : [],
    reply: async () => undefined,
    ticket,
  };
}

const emptyResult = {
  created: [], updated: [], duplicates: [], conflicts: [], actionItems: [],
};

/** Paste a thread or drop a screenshot. Zero setup path for the dashboard. */
export const ingestRoute = registerApiRoute('/ingest', {
  method: 'POST',
  middleware: familyCode,
  handler: async (c) => {
    const mastra = c.get('mastra');
    const body = (await c.req.json()) as { text?: string; imageBase64?: string; mimeType?: string };
    const input = {
      text: body.text,
      ...(body.imageBase64 ? { image: { data: Buffer.from(body.imageBase64, 'base64'), mimeType: body.mimeType ?? 'image/png' } } : {}),
    };
    const localDay = new Intl.DateTimeFormat('en-CA', { timeZone: process.env.TZ || 'America/Los_Angeles' }).format(new Date());
    const source = { kind: 'dashboard', id: createHash('sha256').update(`${localDay}\0${body.text ?? ''}\0${body.imageBase64 ?? ''}`).digest('hex') };
    const ticket = claim(source, input);
    if (!ticket) {
      const existing = getTicket(`${source.kind}:${source.id}`);
      if (existing?.result) return c.json(existing.result);
      if (existing?.status === 'failed') return c.json({ error: existing.last_error ?? 'ingest failed' }, 500);
      return c.json({ deduplicated: true, summary: 'This submission is already being processed.', ...emptyResult });
    }
    try {
      await handle(mastra, ticket, prepareDashboard);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
    return c.json(ticket.result ?? { summary: formatReply(emptyResult), ...emptyResult });
  },
});

export const weekRoute = registerApiRoute('/week', {
  method: 'GET',
  middleware: familyCode,
  handler: async (c) => {
    const now = new Date();
    const end = new Date(now); end.setDate(end.getDate() + 14);
    const events = await listEvents(now.toISOString(), end.toISOString());
    return c.json({ events, school: await getSchool(), whatsapp: process.env.WHATSAPP_DISPLAY_NUMBER ?? null, email: process.env.AGENTMAIL_INBOX_ID ?? null });
  },
});

export const syncRoute = registerApiRoute('/sync', {
  method: 'POST',
  middleware: familyCode,
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
