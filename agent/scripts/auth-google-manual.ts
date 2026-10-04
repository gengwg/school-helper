// Usage: npx tsx scripts/auth-google-manual.ts              -> prints the consent URL
//        npx tsx scripts/auth-google-manual.ts "<redirect url with ?code=...>"  -> writes token.json
import { auth as gauth } from '@googleapis/calendar';
import { readFile, writeFile } from 'node:fs/promises';

const keys = JSON.parse(await readFile('credentials.json', 'utf8'));
const key = keys.installed ?? keys.web;
const redirect = 'http://localhost:1';
const client = new gauth.OAuth2(key.client_id, key.client_secret, redirect);

const arg = process.argv[2];
if (!arg) {
  console.log(client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/calendar'],
  }));
} else {
  const code = new URL(arg).searchParams.get('code');
  if (!code) throw new Error('no code= in that URL');
  const { tokens } = await client.getToken(code);
  await writeFile('token.json', JSON.stringify({
    type: 'authorized_user',
    client_id: key.client_id,
    client_secret: key.client_secret,
    refresh_token: tokens.refresh_token,
  }));
  console.log('token.json written');
}
