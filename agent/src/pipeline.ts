import { createHash } from 'node:crypto';
import { ExtractionSchema, type Event, type EventSource, type Extraction } from './schemas.js';
import { listEvents, createEvent, updateEvent, findSourceEvent, eventKey, type CalEvent } from './calendar.js';
import { enqueueEffect, processEffects, type Ticket } from './effects.js';
import type { Agent } from '@mastra/core/agent';

const TZ = process.env.TZ || 'America/Los_Angeles';

export type Input = { text?: string; image?: { data: Buffer; mimeType: string }; source?: EventSource };

export type Result = {
  created: CalEvent[];
  updated?: CalEvent[];
  duplicates: Event[];
  conflicts: { event: CalEvent; with: CalEvent }[];
  actionItems: Extraction['actionItems'];
  complete?: boolean;
  error?: string;
};

export function todayContext(now = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
  return `Today is ${fmt.format(now)}. Timezone: ${TZ}.`;
}

export async function extract(agent: Agent, input: Input, now = new Date()): Promise<Extraction> {
  const content: any[] = [{ type: 'text', text: `${todayContext(now)}\n\nMessage:\n${input.text ?? '(see image)'}` }];
  if (input.image) content.push({ type: 'image', image: input.image.data, mimeType: input.image.mimeType });
  const res = await agent.generate([{ role: 'user', content }], {
    structuredOutput: { schema: ExtractionSchema },
  });
  return res.object as Extraction;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter((w) => w.length > 2);

function similar(a: string, b: string) {
  const wa = new Set(norm(a)), wb = new Set(norm(b));
  if (!wa.size || !wb.size) return false;
  let hit = 0;
  for (const w of wa) if (wb.has(w)) hit++;
  return hit / Math.min(wa.size, wb.size) >= 0.6;
}

const day = (s: string) => s.slice(0, 10);

function overlaps(a: { start: string; end: string; allDay: boolean }, b: CalEvent) {
  if (a.allDay || b.allDay) return false;
  return a.start < b.end && b.start < a.end;
}

function sameEvent(ev: Event, existing: CalEvent) {
  const sameStart = ev.allDay ? day(ev.start) === day(existing.start) : Date.parse(ev.start) === Date.parse(existing.start);
  const sameEnd = ev.end == null || Date.parse(ev.end) === Date.parse(existing.end);
  return sameStart && sameEnd && ev.allDay === existing.allDay && ev.title === existing.title && (ev.location ?? null) === (existing.location ?? null)
    && (ev.child ?? null) === (existing.child ?? null) && (ev.notes ?? null) === (existing.notes ?? null);
}

function fingerprint(ev: Event) {
  return createHash('sha256').update(JSON.stringify(ev)).digest('hex').slice(0, 16);
}

function createKey(source: EventSource | undefined, index: number, ev: Event) {
  const key = `calendar.create:${source?.kind}:${source?.id}:${fingerprint(ev)}`;
  return index ? `${key}:${index}` : key;
}

function markCreateSent(ticket: Ticket, key: string, sourceKey: string | undefined, ev: Event) {
  const index = ticket.effects.findIndex((candidate) => {
    if (candidate.kind !== 'calendar.create' || candidate.sent_at) return false;
    if (candidate.key === key || (sourceKey && candidate.payload?.source?.event_key === sourceKey)) return true;
    // School sync has no native source ID. Its fuzzy duplicate still proves
    // that the pending create committed, so acknowledge rather than replay it.
    return !sourceKey && candidate.payload?.event && fingerprint(candidate.payload.event) === fingerprint(ev);
  });
  if (index >= 0) {
    ticket.effects.splice(index, 1);
    ticket.persist?.();
  }
}

function discardPendingUpdate(ticket: Ticket, key: string) {
  const index = ticket.effects.findIndex((effect) => effect.kind === 'calendar.update' && effect.key === key && !effect.sent_at);
  if (index >= 0) {
    ticket.effects.splice(index, 1);
    ticket.persist?.();
  }
}

function sourceForMatch(match: CalEvent, fallback: EventSource): EventSource {
  if (!match.source) return { ...fallback, event_key: match.source_event_key ?? fallback.event_key };
  const separator = match.source.indexOf(':');
  return {
    kind: match.source.slice(0, separator),
    id: match.source.slice(separator + 1),
    event_key: match.source_event_key ?? (match.source === `${fallback.kind}:${fallback.id}` ? fallback.event_key : `${match.source}:0`),
    revision: `${fallback.kind}:${fallback.id}`,
    revision_at: fallback.revision_at,
  };
}

function rememberEvent(existing: CalEvent[], event: CalEvent) {
  const index = existing.findIndex((candidate) => candidate.id === event.id);
  if (index >= 0) existing[index] = event;
  else existing.push(event);
}

let reconciliationQueue: Promise<void> = Promise.resolve();

async function serialized<T>(work: () => Promise<T>): Promise<T> {
  const previous = reconciliationQueue;
  let release!: () => void;
  reconciliationQueue = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    return await work();
  } finally {
    release();
  }
}

/** Serialize the read/reconcile/write sequence within this service process. */
export async function reconcile(ex: Extraction, source?: EventSource, ticket?: Ticket): Promise<Result> {
  return serialized(() => reconcileEvents(ex, source, ticket));
}

/** Create or update events from source identity, then fuzzy-match only new source events. */
async function reconcileEvents(ex: Extraction, source?: EventSource, ticket?: Ticket): Promise<Result> {
  const result: Result = { created: [], updated: [], duplicates: [], conflicts: [], actionItems: ex.actionItems, complete: true };
  const updatedResults = result.updated!;
  const todayLocal = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
  const candidates = ex.events.map((event, index) => ({ event, index })).filter(({ event }) => source || day(event.start) >= todayLocal);
  if (!candidates.length && !ticket) return result;

  const days = candidates.map(({ event }) => day(event.start)).sort();
  const existing = days.length
    ? await listEvents(`${shiftDay(days[0], -1)}T00:00:00Z`, `${shiftDay(days[days.length - 1], 2)}T00:00:00Z`)
    : [];
  const effectKeys = new Set<string>();
  const planned: Event[] = [];

  for (const { event: ev, index } of candidates) {
    const eventSource = source ? { ...source, event_key: source.event_key ?? `${source.kind}:${source.id}:${index}` } : undefined;
    if (eventSource) {
      const allowSemantic = source?.correction === true || source?.event_key !== undefined;
      const match = await findSourceEvent(eventSource, ev, allowSemantic);
      const key = createKey(eventSource, index, ev);
      if (match && ticket) markCreateSent(ticket, key, eventSource.event_key, ev);
      if (match) {
        const incoming = `${eventSource.kind}:${eventSource.id}`;
        const updateKey = `calendar.update:${eventSource.kind}:${eventSource.id}:${match.id}`;
        const superseded = match.revision && match.revision !== incoming && (match.source === incoming
          || (match.revision_at !== undefined && eventSource.revision_at !== undefined && match.revision_at > eventSource.revision_at));
        if (superseded) {
          // An original message or an older correction is retrying after a
          // newer correction. Do not let its stale extraction move the event back.
          if (ticket) discardPendingUpdate(ticket, updateKey);
          result.duplicates.push(ev);
        } else if (sameEvent(ev, match)) {
          const prior = ticket?.effects.find((effect) => effect.sent_at && (effect.key === key || effect.key === updateKey));
          if (ticket && prior?.key) effectKeys.add(prior.key);
          else {
            if (ticket) discardPendingUpdate(ticket, updateKey);
            result.duplicates.push(ev);
          }
        } else if (ticket) {
          const updateSource = sourceForMatch(match, eventSource);
          enqueueEffect(ticket, 'calendar.update', { id: match.id, event: ev, source: updateSource }, updateKey);
          effectKeys.add(updateKey);
        } else {
          updatedResults.push(await updateEvent(match.id, ev, sourceForMatch(match, eventSource)));
        }
        continue;
      }
    }
    if (day(ev.start) < todayLocal) continue;
    const key = createKey(eventSource, index, ev);
    const dup = existing.find((x) => x.calendar === 'school' && day(x.start) === day(ev.start) && similar(x.title, ev.title))
      ?? planned.find((x) => day(x.start) === day(ev.start) && similar(x.title, ev.title));
    if (dup) {
      if (ticket) markCreateSent(ticket, key, eventSource?.event_key, ev);
      result.duplicates.push(ev);
      continue;
    }
    if (ticket) {
      enqueueEffect(ticket, 'calendar.create', { event: ev, source: eventSource }, key);
      effectKeys.add(key);
      planned.push(ev);
    } else {
      const created = await createEvent(ev, eventSource);
      rememberEvent(existing, created);
      result.created.push(created);
      planned.push(ev);
    }
  }

  if (ticket) {
    const effects = await processEffects(ticket, {
      'calendar.create': ({ event, source: eventSource }) => createEvent(event, eventSource),
      'calendar.update': ({ id, event, source: eventSource }) => updateEvent(id, event, eventSource),
      'calendar.sync': async () => undefined,
      reply: async () => undefined,
    }, ['calendar.create', 'calendar.update']);
    for (const effect of ticket.effects) {
      if (!effect.sent_at || !effect.key || !effectKeys.has(effect.key)) continue;
      if (effect.kind === 'calendar.create') {
        result.created.push(effect.result);
        rememberEvent(existing, effect.result);
      }
      if (effect.kind === 'calendar.update') {
        updatedResults.push(effect.result);
        rememberEvent(existing, effect.result);
      }
    }
    result.complete = effects.complete;
    result.error = effects.error;
  }
  for (const created of [...result.created, ...updatedResults]) {
    const createdIso = { start: toIso(created.start), end: toIso(created.end), allDay: created.allDay };
    for (const other of existing) {
      if (created.id !== other.id && overlaps(createdIso, { ...other, start: toIso(other.start), end: toIso(other.end) })) {
        result.conflicts.push({ event: created, with: other });
      }
    }
  }
  return result;
}

const toIso = (s: string) => (s ? new Date(s).toISOString() : s);

function shiftDay(ymd: string, delta: number) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

export function fmtWhen(e: { start: string; allDay: boolean }) {
  // A bare YYYY-MM-DD parses as UTC midnight, which is the previous evening in the US.
  const d = new Date(e.allDay && e.start.length === 10 ? `${e.start}T12:00:00` : e.start);
  const date = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric' }).format(d);
  if (e.allDay) return date;
  const time = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }).format(d).replace(':00', '');
  return `${date} ${time}`;
}

/** Two or three plain sentences a parent can read at a red light. */
export function formatReply(r: Result): string {
  const lines: string[] = [];
  if (r.created.length) lines.push(`Added: ${r.created.map((e) => `${e.title} (${fmtWhen(e)})`).join(', ')}.`);
  if (r.updated?.length) lines.push(`Updated: ${r.updated.map((e) => `${e.title} (${fmtWhen(e)})`).join(', ')}.`);
  if (r.duplicates.length) lines.push(`Already on the calendar: ${r.duplicates.map((e) => e.title).join(', ')}.`);
  for (const c of r.conflicts) lines.push(`Heads up: ${c.event.title} overlaps with ${c.with.title}.`);
  for (const a of r.actionItems) {
    const due = a.due ? ` by ${fmtWhen({ start: a.due, allDay: true })}` : '';
    lines.push(`To do: ${a.what}${a.amount ? ` (${a.amount})` : ''}${due}.`);
  }
  if (!lines.length) lines.push("I didn't find any dates in that message.");
  return lines.join('\n');
}
