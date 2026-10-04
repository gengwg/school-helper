const GRAPH = 'https://graph.facebook.com/v23.0';

function auth() {
  return { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` };
}

export async function sendText(to: string, body: string) {
  const res = await fetch(`${GRAPH}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: { ...auth(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body } }),
  });
  if (!res.ok) throw new Error(`WhatsApp send failed: ${res.status} ${await res.text()}`);
}

export async function downloadMedia(mediaId: string): Promise<{ data: Buffer; mimeType: string }> {
  const meta = await fetch(`${GRAPH}/${mediaId}`, { headers: auth() });
  if (!meta.ok) throw new Error(`WhatsApp media lookup failed: ${meta.status}`);
  const { url, mime_type } = (await meta.json()) as { url: string; mime_type: string };
  const file = await fetch(url, { headers: auth() });
  if (!file.ok) throw new Error(`WhatsApp media download failed: ${file.status}`);
  return { data: Buffer.from(await file.arrayBuffer()), mimeType: mime_type };
}

export type InboundMessage = {
  from: string;
  id: string;
  type: string;
  text?: { body: string };
  image?: { id: string; mime_type: string; caption?: string };
  document?: { id: string; mime_type: string; filename?: string; caption?: string };
};

export function inboundMessages(payload: any): InboundMessage[] {
  const out: InboundMessage[] = [];
  for (const entry of payload?.entry ?? [])
    for (const change of entry.changes ?? [])
      for (const m of change.value?.messages ?? []) out.push(m);
  return out;
}
