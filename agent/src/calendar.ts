import { calendar, auth as gauth, type calendar_v3 } from '@googleapis/calendar';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { path } from './paths.js';
import type { Event, EventSource } from './schemas.js';

const TZ = process.env.TZ || 'America/Los_Angeles';

let api: calendar_v3.Calendar | undefined;
export function setCalendar(client: calendar_v3.Calendar | undefined) {
  api = client;
}

async function cal() {
  if (!api) {
    const creds = JSON.parse(await readFile(path('token.json'), 'utf8'));
    const client = new gauth.OAuth2(creds.client_id, creds.client_secret);
    client.setCredentials({ refresh_token: creds.refresh_token });
    api = calendar({ version: 'v3', auth: client });
  }
  return api;
}

function calendarId() {
  return process.env.SCHOOL_CALENDAR_ID || 'primary';
}

export type CalEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location?: string;
  description?: string;
  calendar: 'school' | 'personal';
  source?: string;
  source_event_key?: string;
  revision?: string;
  revision_at?: number;
  event_key?: string;
  child?: string | null;
  notes?: string | null;
};

export function eventKey(ev: Event): string {
  const raw = `${ev.title} ${ev.child ?? ''}`;
  const key = raw.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
  return key || `event-${createHash('sha256').update(raw).digest('hex').slice(0, 16)}`;
}

function eventId(ev: Event, salt = ''): string {
  const occurrence = ev.allDay ? ev.start.slice(0, 10) : ev.start;
  const identity = `${eventKey(ev)}|${ev.allDay ? 'day' : 'time'}|${occurrence}${salt}`;
  return `pa${createHash('sha256').update(identity).digest('hex').slice(0, 32)}`;
}

function toCalEvent(e: calendar_v3.Schema$Event, calendar: CalEvent['calendar']): CalEvent {
  const description = e.description ?? '';
  const notes = description.split('\n').filter((line) => !line.startsWith('For: ') && !line.startsWith('[source:') && !line.startsWith('[source-event:') && !line.startsWith('[revision:') && !line.startsWith('[revised-at:') && !line.startsWith('[event:')).join('\n');
  return {
    id: e.id!,
    title: e.summary ?? '(untitled)',
    start: e.start?.dateTime ?? e.start?.date ?? '',
    end: e.end?.dateTime ?? e.end?.date ?? '',
    allDay: !e.start?.dateTime,
    location: e.location ?? undefined,
    description: e.description ?? undefined,
    calendar,
    source: description.match(/\[source:([^\]]+)\]/)?.[1],
    source_event_key: description.match(/\[source-event:([^\]]+)\]/)?.[1],
    revision: description.match(/\[revision:([^\]]+)\]/)?.[1],
    revision_at: Number(description.match(/\[revised-at:([^\]]+)\]/)?.[1]) || undefined,
    event_key: description.match(/\[event:([^\]]+)\]/)?.[1],
    child: description.match(/^For: ([^\n]+)/m)?.[1] ?? null,
    notes: notes || null,
  };
}

async function listFrom(id: string, calendar: CalEvent['calendar'], timeMin: string, timeMax: string) {
  const res = await (await cal()).events.list({
    calendarId: id,
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 250,
  });
  return (res.data.items ?? []).map((e: calendar_v3.Schema$Event) => toCalEvent(e, calendar));
}

/**
 * School calendar plus the parent's primary calendar, so conflicts against family events are caught.
 * EXTRA_CALENDAR_IDS (e.g. a district's public Google Calendar the parent already follows) count as
 * school events too, so we never re-add what the district already publishes.
 */
export async function listEvents(timeMin: string, timeMax: string): Promise<CalEvent[]> {
  const school = await listFrom(calendarId(), 'school', timeMin, timeMax);
  if (calendarId() === 'primary') return school;
  const personal = await listFrom('primary', 'personal', timeMin, timeMax);
  const extra = (process.env.EXTRA_CALENDAR_IDS ?? '').split(',').filter(Boolean);
  const extras = (await Promise.all(extra.map((id) => listFrom(id, 'school', timeMin, timeMax)))).flat();
  return [...school, ...personal, ...extras].sort((a, b) => a.start.localeCompare(b.start));
}

export async function findSourceEvent(source: EventSource, ev?: Event, allowSemantic = source.correction === true): Promise<CalEvent | undefined> {
  const sourceId = `${source.kind}:${source.id}`;
  const sourceKey = source.event_key ?? `${sourceId}:0`;
  const sourceRes = await (await cal()).events.list({
    calendarId: calendarId(), q: `[source:${sourceId}]`, singleEvents: true, maxResults: 250,
  });
  const sourceEvents = (sourceRes.data.items ?? []).map((e) => toCalEvent(e, 'school')).filter((e) => e.source === sourceId);

  // A message can contain several events. Match its per-message key first;
  // never let the first event with the same message ID absorb the others.
  const exact = sourceEvents.find((e) => e.source_event_key === sourceKey);
  if (exact) return exact;
  if (ev && sourceKey === `${sourceId}:0`) {
    const semantic = sourceEvents.filter((e) => !e.source_event_key && e.event_key === eventKey(ev));
    if (semantic.length === 1) return semantic[0];
  }
  // This also reads events written before per-message keys were introduced.
  if (sourceEvents.length === 1 && sourceKey === `${sourceId}:0`) return sourceEvents[0];

  if (ev && allowSemantic) {
    // Only an explicit correction may link a new message to an old event.
    // Otherwise a recurring occurrence with the same title must create anew.
    const eventRes = await (await cal()).events.list({
      calendarId: calendarId(), q: `[event:${eventKey(ev)}]`, singleEvents: true, maxResults: 250,
    });
    const matches = (eventRes.data.items ?? []).map((e) => toCalEvent(e, 'school'))
      .filter((e) => e.event_key === eventKey(ev) && e.source !== sourceId);
    if (matches.length === 1) return matches[0];
  }
  return undefined;
}

function bodyFor(ev: Event, source?: EventSource): calendar_v3.Schema$Event {
  return {
    summary: ev.title,
    location: ev.location ?? undefined,
    description: [
      ev.child ? `For: ${ev.child}` : null,
      ev.notes,
      source ? `[source:${source.kind}:${source.id}]` : null,
      source ? `[source-event:${source.event_key ?? `${source.kind}:${source.id}:0`}]` : null,
      source ? `[revision:${source.revision ?? `${source.kind}:${source.id}`}]` : null,
      source?.revision_at ? `[revised-at:${source.revision_at}]` : null,
      `[event:${eventKey(ev)}]`,
    ].filter(Boolean).join('\n') || undefined,
    start: ev.allDay ? { date: ev.start.slice(0, 10) } : { dateTime: withSeconds(ev.start), timeZone: TZ },
    end: ev.allDay
      ? { date: ev.end?.slice(0, 10) ?? ev.start.slice(0, 10) }
      : { dateTime: ev.end ? withSeconds(ev.end) : plusHour(ev.start), timeZone: TZ },
  };
}

function sameIdentity(ev: Event, existing: CalEvent) {
  const existingKey = existing.event_key ?? eventKey({ ...ev, title: existing.title, child: existing.child ?? null });
  const sameStart = ev.allDay ? ev.start.slice(0, 10) === existing.start.slice(0, 10) : Date.parse(ev.start) === Date.parse(existing.start);
  return existingKey === eventKey(ev) && ev.allDay === existing.allDay && sameStart;
}

export async function createEvent(ev: Event, source?: EventSource): Promise<CalEvent> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = eventId(ev, attempt ? `:${attempt}` : '');
    try {
      const res = await (await cal()).events.insert({ calendarId: calendarId(), requestBody: { id, ...bodyFor(ev, source) } });
      return toCalEvent(res.data, 'school');
    } catch (error) {
      lastError = error;
      // A committed insert can lose its response, and another ticket may have
      // won the same deterministic ID. Resolve both cases with a read before retrying.
      let existing: CalEvent;
      try {
        const res = await (await cal()).events.get({ calendarId: calendarId(), eventId: id });
        if (!res.data.id) throw new Error('event not found');
        existing = toCalEvent(res.data, 'school');
      } catch {
        throw error;
      }
      if (sameIdentity(ev, existing)) return existing;
      // The ID's original occurrence was moved. Use the next stable ID rather
      // than pretending that the moved event is the requested occurrence.
    }
  }
  throw lastError;
}

export async function updateEvent(id: string, ev: Event, source?: EventSource): Promise<CalEvent> {
  const res = await (await cal()).events.patch({ calendarId: calendarId(), eventId: id, requestBody: bodyFor(ev, source) });
  return toCalEvent(res.data, 'school');
}

/** Google wants RFC3339 with seconds; the model emits YYYY-MM-DDTHH:MM. */
function withSeconds(local: string) {
  return /T\d\d:\d\d$/.test(local) ? `${local}:00` : local;
}

function plusHour(local: string) {
  const [date, time] = local.split('T');
  const [h, m] = time.split(':').map(Number);
  return `${date}T${String((h + 1) % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
}
