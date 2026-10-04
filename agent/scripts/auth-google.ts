// One-time: opens a browser, writes token.json next to credentials.json.
import { authenticate } from '@google-cloud/local-auth';
import { readFile, writeFile } from 'node:fs/promises';

const SCOPES = ['https://www.googleapis.com/auth/calendar'];

const client = await authenticate({ scopes: SCOPES, keyfilePath: 'credentials.json' });
const keys = JSON.parse(await readFile('credentials.json', 'utf8'));
const key = keys.installed ?? keys.web;
await writeFile(
  'token.json',
  JSON.stringify({
    type: 'authorized_user',
    client_id: key.client_id,
    client_secret: key.client_secret,
    refresh_token: client.credentials.refresh_token,
  }),
);
console.log('token.json written');
