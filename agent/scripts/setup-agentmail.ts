// One-time: create the agent's inbox and point its webhook at the deployed server.
// Usage: npx tsx scripts/setup-agentmail.ts https://school-helper-b3yxo.sprites.app
import { AgentMailClient } from 'agentmail';
import { appendFile } from 'node:fs/promises';

const base = process.argv[2];
if (!base) throw new Error('pass the public base URL');
const client = new AgentMailClient({ apiKey: process.env.AGENTMAIL_API_KEY });

const inbox = await client.inboxes.create({ username: 'school-helper', displayName: 'School Helper', clientId: 'school-helper-inbox' });
const webhook = await client.webhooks.create({ url: `${base}/email`, eventTypes: ['message.received'], inboxIds: [inbox.inboxId], clientId: 'school-helper-webhook' });
await appendFile('.env', `AGENTMAIL_INBOX_ID=${inbox.inboxId}\nAGENTMAIL_WEBHOOK_SECRET=${webhook.secret}\n`);
console.log(`inbox: ${inbox.inboxId}`);
console.log('webhook secret appended to .env');
