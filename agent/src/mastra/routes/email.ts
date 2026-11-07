import { registerApiRoute } from '@mastra/core/server';
import { AgentMailClient } from 'agentmail';
import { Webhook } from 'svix';
import { handleInbound, readable, type Attachment, type Inbound } from '../../inbound.js';
import { senderAllowed } from '../auth.js';
import { claim, handle } from '../../intake.js';
import type { Ticket } from '../../effects.js';

let client: AgentMailClient | undefined;
const mail = () => (client ??= new AgentMailClient({ apiKey: process.env.AGENTMAIL_API_KEY }));

/** AgentMail webhook: a parent shared a WhatsApp export or forwarded a school email to the agent's address. */
export const emailInbound = registerApiRoute('/email', {
  method: 'POST',
  handler: async (c) => {
    const mastra = c.get('mastra');
    const raw = await c.req.text();
    const secret = process.env.AGENTMAIL_WEBHOOK_SECRET;
    if (secret) {
      try { new Webhook(secret).verify(raw, c.req.header() as Record<string, string>); }
      catch { return c.text('bad signature', 401); }
    }
    const event = JSON.parse(raw);
    if (event.event_type !== 'message.received') return c.json({ ok: true });
    const id = event.message?.message_id as string;
    if (!id) return c.json({ ok: true });
    if (!senderAllowed(event.message.from ?? '')) {
      mastra.getLogger().warn('email from unlisted sender ignored', { from: event.message.from });
      return c.json({ ok: true });
    }
    const ticket = claim({ kind: 'email', id }, { inboxId: event.message.inbox_id, messageId: id });
    if (!ticket) return c.json({ ok: true });
    void handle(mastra, ticket, prepareEmail).catch((err) => mastra.getLogger().error('email handle failed', { err: String(err) }));
    return c.json({ ok: true });
  },
});

export async function prepareEmail(ticket: Ticket): Promise<Inbound> {
  const { inboxId, messageId } = ticket.data;
  const msg = await mail().inboxes.messages.get(inboxId, messageId);
  // Forwards from Gmail arrive as HTML only; extractedText strips quoted history when present.
  const text = msg.extractedText ?? msg.text ?? stripHtml(msg.html ?? '');
  const attachments: Attachment[] = [];
  for (const a of msg.attachments ?? []) {
    const type = a.contentType ?? '';
    if (!readable(type, a.filename)) continue;
    const { downloadUrl } = await mail().inboxes.messages.getAttachment(inboxId, messageId, a.attachmentId);
    const res = await fetch(downloadUrl);
    attachments.push({ data: Buffer.from(await res.arrayBuffer()), mimeType: type, filename: a.filename });
  }
  return {
    text: `${msg.subject ?? ''}\n${text}`,
    attachments,
    reply: (body) => mail().inboxes.messages.reply(inboxId, messageId, { text: body }).then(() => undefined),
    ticket,
  };
}

const stripHtml = (h: string) => h.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+\n/g, '\n').trim();
