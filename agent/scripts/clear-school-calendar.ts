// Deletes every event on the School calendar (SCHOOL_CALENDAR_ID). Demo reset only.
import { calendar, auth as gauth } from '@googleapis/calendar';
import { readFile } from 'node:fs/promises';

const id = process.env.SCHOOL_CALENDAR_ID;
if (!id || id === 'primary') throw new Error('refusing: SCHOOL_CALENDAR_ID must point at the School calendar');
const c = JSON.parse(await readFile('token.json', 'utf8'));
const o = new gauth.OAuth2(c.client_id, c.client_secret);
o.setCredentials({ refresh_token: c.refresh_token });
const api = calendar({ version: 'v3', auth: o });
let n = 0;
for (;;) {
  const res = await api.events.list({ calendarId: id, maxResults: 250, singleEvents: true });
  const items = res.data.items ?? [];
  if (!items.length) break;
  for (const e of items) { await api.events.delete({ calendarId: id, eventId: e.id! }); n++; }
}
console.log(`deleted ${n}`);
