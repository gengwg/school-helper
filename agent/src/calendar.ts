import { calendar, auth as gauth, type calendar_v3 } from '@googleapis/calendar';
import { readFile } from 'node:fs/promises';
import { path } from './paths.js';
import type { Event } from './schemas.js';

const TZ = process.env.TZ || 'America/Los_Angeles';

let api: calendar_v3.Calendar | undefined;
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
};

function toCalEvent(e: calendar_v3.Schema$Event, calendar: CalEvent['calendar']): CalEvent {
  return {
    id: e.id!,
    title: e.summary ?? '(untitled)',
    start: e.start?.dateTime ?? e.start?.date ?? '',
    end: e.end?.dateTime ?? e.end?.date ?? '',
    allDay: !e.start?.dateTime,
    location: e.location ?? undefined,
    description: e.description ?? undefined,
    calendar,
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

export async function createEvent(ev: Event): Promise<CalEvent> {
  const body: calendar_v3.Schema$Event = {
    summary: ev.title,
    location: ev.location ?? undefined,
    description: [ev.child ? `For: ${ev.child}` : null, ev.notes].filter(Boolean).join('\n') || undefined,
    start: ev.allDay ? { date: ev.start.slice(0, 10) } : { dateTime: withSeconds(ev.start), timeZone: TZ },
    end: ev.allDay
      ? { date: ev.end?.slice(0, 10) ?? ev.start.slice(0, 10) }
      : { dateTime: ev.end ? withSeconds(ev.end) : plusHour(ev.start), timeZone: TZ },
  };
  const res = await (await cal()).events.insert({ calendarId: calendarId(), requestBody: body });
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
