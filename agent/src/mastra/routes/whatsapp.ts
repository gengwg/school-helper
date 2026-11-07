import { registerApiRoute } from '@mastra/core/server';
import { downloadMedia, inboundMessages, sendText } from '../../whatsapp.js';
import { handleInbound, readable, type Attachment, type Inbound } from '../../inbound.js';
import { claim, handle } from '../../intake.js';
import type { Ticket } from '../../effects.js';
import { onAllowlist } from '../auth.js';

export const whatsappVerify = registerApiRoute('/whatsapp', {
  method: 'GET',
  handler: async (c) => {
    const q = c.req.query();
    if (q['hub.mode'] === 'subscribe' && q['hub.verify_token'] === process.env.WHATSAPP_VERIFY_TOKEN)
      return c.text(q['hub.challenge'] ?? '');
    return c.text('forbidden', 403);
  },
});

export const whatsappInbound = registerApiRoute('/whatsapp', {
  method: 'POST',
  handler: async (c) => {
    const mastra = c.get('mastra');
    const body = await c.req.json();
    for (const m of inboundMessages(body)) {
      if (!onAllowlist('WHATSAPP_ALLOWED_FROM', m.from)) {
        mastra.getLogger().warn('whatsapp from unlisted number ignored', { from: m.from });
        continue;
      }
      const ticket = claim({ kind: 'whatsapp', id: m.id }, m);
      if (!ticket) continue;
      // Reply async so Meta gets its 200 right away and does not retry.
      void handle(mastra, ticket, prepareWhatsapp).catch((err) => mastra.getLogger().error('whatsapp handle failed', { err: String(err) }));
    }
    return c.json({ ok: true });
  },
});

export async function prepareWhatsapp(ticket: Ticket): Promise<Inbound> {
  const m = ticket.data as ReturnType<typeof inboundMessages>[number];
  const attachments: Attachment[] = [];
  const media = m.image?.id ?? m.document?.id;
  if (media) {
    const file = await downloadMedia(media);
    if (!readable(file.mimeType, m.document?.filename)) {
      return {
        text: '', attachments: [], reply: (body) => sendText(m.from, body), ticket,
        notice: 'I can read text, chat exports, and screenshots, but not that file type.',
      };
    }
    attachments.push({ ...file, filename: m.document?.filename });
  }
  return {
    text: m.text?.body ?? m.image?.caption ?? m.document?.caption ?? '',
    attachments,
    reply: (body) => sendText(m.from, body),
    ticket,
  };
}
