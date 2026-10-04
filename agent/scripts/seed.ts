// Demo seed: puts one family event on the primary calendar that collides with Picture Day in the fixture.
import { calendar, auth as gauth } from '@googleapis/calendar';
import { readFile } from 'node:fs/promises';

const creds = JSON.parse(await readFile('token.json', 'utf8'));
const client = new gauth.OAuth2(creds.client_id, creds.client_secret);
client.setCredentials({ refresh_token: creds.refresh_token });
const cal = calendar({ version: 'v3', auth: client });
const tz = process.env.TZ || 'America/Los_Angeles';

const res = await cal.events.insert({
  calendarId: 'primary',
  requestBody: {
    summary: "Mia's dentist",
    start: { dateTime: '2026-10-09T09:00:00', timeZone: tz },
    end: { dateTime: '2026-10-09T10:00:00', timeZone: tz },
  },
});
console.log('seeded', res.data.htmlLink);
