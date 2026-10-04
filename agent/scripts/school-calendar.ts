// Finds or creates the "School" calendar and prints its id.
import { calendar, auth as gauth } from '@googleapis/calendar';
import { readFile } from 'node:fs/promises';

const c = JSON.parse(await readFile('token.json', 'utf8'));
const o = new gauth.OAuth2(c.client_id, c.client_secret);
o.setCredentials({ refresh_token: c.refresh_token });
const api = calendar({ version: 'v3', auth: o });

const list = await api.calendarList.list();
for (const x of list.data.items ?? []) console.error(`${x.summary} | ${x.id}`);
let school = (list.data.items ?? []).find((x) => x.summary === 'School');
if (!school) {
  const created = await api.calendars.insert({ requestBody: { summary: 'School', timeZone: process.env.TZ || 'America/Los_Angeles' } });
  school = { id: created.data.id!, summary: 'School' };
  console.error('created School calendar');
}
console.log(school.id);
