import { extract, reconcile, formatReply, type Input } from './pipeline.js';
import { syncSchool, setSchool } from './sync.js';
import { textEntries, isZip } from './zip.js';

export type Attachment = { data: Buffer; mimeType: string; filename?: string };

export const readable = (mimeType: string, filename?: string) =>
  mimeType.startsWith('text/') || mimeType.startsWith('image/') || isZip(mimeType, filename);

/** One message from any channel: text plus optional files, and a way to answer. */
export type Inbound = {
  text: string;
  attachments: Attachment[];
  reply: (body: string) => Promise<void>;
};

const SCHOOL_RE = /(?:goes? to|attends?|school is)\s+(.+)/i;

export async function handleInbound(mastra: any, m: Inbound) {
  const extractor = mastra.getAgent('extractor');

  const school = m.text.match(SCHOOL_RE);
  if (school && !m.attachments.length) {
    await setSchool(school[1].trim().replace(/[.!]+$/, ''));
    await m.reply('Got it, looking up the school calendar now. This takes a minute.');
    const r = await syncSchool(mastra);
    await m.reply(r.created.length
      ? `Found the school site and added ${r.created.length} events. I'll check for new ones every day.`
      : "I found the school site but no new dated events yet. I'll keep checking daily.");
    return;
  }

  const input: Input = { text: m.text };
  for (const a of m.attachments) {
    if (isZip(a.mimeType, a.filename)) {
      for (const e of textEntries(a.data)) input.text = `${input.text}\n${e.text}`;
    } else if (a.mimeType.startsWith('text/')) input.text = `${input.text}\n${a.data.toString('utf8')}`;
    else if (a.mimeType.startsWith('image/')) input.image = a;
  }
  if (!input.text?.trim() && !input.image) return;

  const result = await reconcile(await extract(extractor, input));
  await m.reply(formatReply(result));
}
