import { ExtractionSchema, type Event, type Extraction } from './schemas.js';
import { listEvents, createEvent, type CalEvent } from './calendar.js';
import type { Agent } from '@mastra/core/agent';

const TZ = process.env.TZ || 'America/Los_Angeles';

export type Input = { text?: string; image?: { data: Buffer; mimeType: string } };

export type Result = {
  created: CalEvent[];
  duplicates: Event[];
  conflicts: { event: CalEvent; with: CalEvent }[];
  actionItems: Extraction['actionItems'];
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

/** Create new events, skip duplicates, report overlaps with anything already on the calendars. */
export async function reconcile(ex: Extraction): Promise<Result> {
  const result: Result = { created: [], duplicates: [], conflicts: [], actionItems: ex.actionItems };
  if (!ex.events.length) return result;

  // Drop anything already in the past; newsletters and web pages list old dates too.
  const todayLocal = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
  const events = ex.events.filter((e) => day(e.start) >= todayLocal);
  if (!events.length) return result;

  const days = events.map((e) => day(e.start)).sort();
  // Pad a day each side so local evenings are not cut off by the UTC bounds.
  const existing = await listEvents(`${shiftDay(days[0], -1)}T00:00:00Z`, `${shiftDay(days[days.length - 1], 2)}T00:00:00Z`);

  for (const ev of events) {
    const dup = existing.find((x) => x.calendar === 'school' && day(x.start) === day(ev.start) && similar(x.title, ev.title));
    if (dup) { result.duplicates.push(ev); continue; }
    const created = await createEvent(ev);
    const createdIso = { start: toIso(created.start), end: toIso(created.end), allDay: created.allDay };
    for (const x of existing) {
      if (overlaps(createdIso, { ...x, start: toIso(x.start), end: toIso(x.end) })) result.conflicts.push({ event: created, with: x });
    }
    existing.push(created);
    result.created.push(created);
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
  if (r.duplicates.length) lines.push(`Already on the calendar: ${r.duplicates.map((e) => e.title).join(', ')}.`);
  for (const c of r.conflicts) lines.push(`Heads up: ${c.event.title} overlaps with ${c.with.title}.`);
  for (const a of r.actionItems) {
    const due = a.due ? ` by ${fmtWhen({ start: a.due, allDay: true })}` : '';
    lines.push(`To do: ${a.what}${a.amount ? ` (${a.amount})` : ''}${due}.`);
  }
  if (!lines.length) lines.push("I didn't find any dates in that message.");
  return lines.join('\n');
}
