import { registerApiRoute } from '@mastra/core/server';
import { downloadMedia, inboundMessages, sendText } from '../../whatsapp.js';
import { handleInbound, readable, type Attachment } from '../../inbound.js';

const seen = new Set<string>();

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
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      const allowed = process.env.WHATSAPP_ALLOWED_FROM?.split(',').filter(Boolean);
      if (allowed?.length && !allowed.includes(m.from)) continue;
      // Reply async so Meta gets its 200 right away and does not retry.
      handle(mastra, m).catch((err) => mastra.getLogger().error('whatsapp handle failed', { err: String(err) }));
    }
    return c.json({ ok: true });
  },
});

async function handle(mastra: any, m: ReturnType<typeof inboundMessages>[number]) {
  const attachments: Attachment[] = [];
  const media = m.image?.id ?? m.document?.id;
  if (media) {
    const file = await downloadMedia(media);
    if (!readable(file.mimeType, m.document?.filename)) {
      await sendText(m.from, 'I can read text, chat exports, and screenshots, but not that file type.');
      return;
    }
    attachments.push({ ...file, filename: m.document?.filename });
  }
  await handleInbound(mastra, {
    text: m.text?.body ?? m.image?.caption ?? m.document?.caption ?? '',
    attachments,
    reply: (body) => sendText(m.from, body),
  });
}
