import { extract, reconcile, formatReply, type Input } from './pipeline.js';
import { enqueueEffect, processEffects, type Ticket } from './effects.js';
import { syncSchool, setSchool } from './sync.js';
import { textEntries, isZip } from './zip.js';

export type Attachment = { data: Buffer; mimeType: string; filename?: string };

export const readable = (mimeType: string, filename?: string) =>
  mimeType.startsWith('text/') || mimeType.startsWith('image/') || isZip(mimeType, filename);

/** One message from any channel: text plus optional files, and a way to answer. */
export type Inbound = {
  text: string;
  attachments: Attachment[];
  reply: (body: string) => Promise<void>;
  ticket?: Ticket;
  notice?: string;
};

const SCHOOL_RE = /(?:goes? to|attends?|school is)\s+(.+)/i;
const CORRECTION_RE = /\b(correction|corrected|rescheduled?|moved|postponed?|instead|new date|date change|time change)\b/i;
const EMPTY_RESULT = { created: [], updated: [], duplicates: [], conflicts: [], actionItems: [] };

function sourceFor(ticket: Ticket | undefined, text: string) {
  if (!ticket) return undefined;
  return { ...ticket.source, revision_at: ticket.created_at, ...(CORRECTION_RE.test(text) ? { correction: true } : {}) };
}

async function deliverReply(m: Inbound, body: string, key: string, response: any) {
  if (!m.ticket) {
    await m.reply(body);
    return;
  }
  const effect = enqueueEffect(m.ticket, 'reply', { text: body, result: response }, key);
  if (m.ticket.effects.some((candidate) => candidate.kind.startsWith('calendar.') && !candidate.sent_at)) {
    throw new Error('calendar effects are incomplete');
  }
  const effects = await processEffects(m.ticket, {
    'calendar.create': async () => undefined,
    'calendar.update': async () => undefined,
    'calendar.sync': async () => undefined,
    reply: ({ text }) => m.reply(text),
  }, ['reply']);
  if (!effects.complete) throw new Error(effects.error ?? 'reply delivery failed');
  // The effect retains the first response even if reconciliation on a retry
  // sees the calendar write as an already-existing event.
  m.ticket.result = effect.payload.result ?? { summary: effect.payload.text, ...EMPTY_RESULT };
  m.ticket.persist?.();
}

export async function handleInbound(mastra: any, m: Inbound) {
  const extractor = mastra.getAgent('extractor');
  const messageText = m.text ?? '';

  if (m.notice) {
    await deliverReply(m, m.notice, `reply:${m.ticket?.id ?? 'notice'}:notice`, { summary: m.notice, ...EMPTY_RESULT });
    return;
  }

  const school = messageText.match(SCHOOL_RE);
  if (school && !m.attachments.length) {
    await setSchool(school[1].trim().replace(/[.!]+$/, ''));
    if (!m.ticket) {
      await m.reply('Got it, looking up the school calendar now. This takes a minute.');
      const r = await syncSchool(mastra);
      await m.reply(r.created.length
        ? `Found the school site and added ${r.created.length} events. I'll check for new ones every day.`
        : "I found the school site but no new dated events yet. I'll keep checking daily.");
      return;
    }
    enqueueEffect(m.ticket, 'reply', { text: 'Got it, looking up the school calendar now. This takes a minute.' }, `reply:${m.ticket.id}:setup`);
    enqueueEffect(m.ticket, 'calendar.sync', {}, 'calendar.sync');
    const syncEffects = await processEffects(m.ticket, {
      'calendar.create': async () => undefined,
      'calendar.update': async () => undefined,
      'calendar.sync': async () => {
        const result = await syncSchool(mastra, m.ticket);
        if (result.complete === false) throw new Error(result.error ?? 'school sync failed');
        return result;
      },
      reply: ({ text }) => m.reply(text),
    }, ['reply', 'calendar.sync']);
    if (!syncEffects.complete) throw new Error(syncEffects.error ?? 'school sync failed');
    const r = m.ticket.effects.find((effect) => effect.kind === 'calendar.sync')?.result;
    const body = r?.created?.length
      ? `Found the school site and added ${r.created.length} events. I'll check for new ones every day.`
      : "I found the school site but no new dated events yet. I'll keep checking daily.";
    await deliverReply(m, body, `reply:${m.ticket.id}:result`, {
      summary: body,
      created: r?.created ?? [], updated: r?.updated ?? [], duplicates: r?.duplicates ?? [],
      conflicts: r?.conflicts ?? [], actionItems: r?.actionItems ?? [],
    });
    return;
  }

  const input: Input = { text: messageText };
  for (const a of m.attachments) {
    if (isZip(a.mimeType, a.filename)) {
      for (const e of textEntries(a.data)) input.text = `${input.text}\n${e.text}`;
    } else if (a.mimeType.startsWith('text/')) input.text = `${input.text}\n${a.data.toString('utf8')}`;
    else if (a.mimeType.startsWith('image/')) input.image = a;
  }
  if (!input.text?.trim() && !input.image) {
    if (m.ticket) {
      m.ticket.result = { summary: "I didn't find any dates in that message.", ...EMPTY_RESULT };
      m.ticket.persist?.();
    }
    return;
  }

  const result = await reconcile(await extract(extractor, input), sourceFor(m.ticket, messageText), m.ticket);
  if (m.ticket && result.complete === false) throw new Error(result.error ?? 'calendar effects are incomplete');
  const body = formatReply(result);
  await deliverReply(m, body, `reply:${m.ticket?.id ?? 'message'}:result`, { summary: body, ...result });
}
