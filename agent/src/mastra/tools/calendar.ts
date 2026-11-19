import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { listEvents } from '../../calendar.js';
import { extract, reconcile, formatReply } from '../../pipeline.js';

export const listEventsTool = createTool({
  id: 'listEvents',
  description: "List the family's school and personal calendar events between two dates (ISO).",
  inputSchema: z.object({ timeMin: z.string(), timeMax: z.string() }),
  execute: async ({ timeMin, timeMax }) => listEvents(timeMin, timeMax),
});

export const createEventTool = createTool({
  id: 'createEvent',
  description: 'Add one event to the School calendar.',
  inputSchema: z.object({
    title: z.string(),
    start: z.string(),
    end: z.string().nullable(),
    allDay: z.boolean(),
    location: z.string().nullable(),
    child: z.string().nullable(),
    notes: z.string().nullable(),
  }),
  execute: async (ev) => (await import('../../calendar.js')).createEvent(ev),
});

export const ingestTool = createTool({
  id: 'ingest',
  description: 'Extract events from pasted chat/newsletter text, add them to the School calendar, and return a parent-friendly summary. More than 25 new events are held, not added; set addAll only after the parent has seen the held count and asked to add them.',
  inputSchema: z.object({ text: z.string(), addAll: z.boolean().optional() }),
  execute: async ({ text, addAll }, ctx) => {
    const extractor = ctx?.mastra?.getAgent('extractor');
    if (!extractor) throw new Error('extractor agent not registered');
    const result = await reconcile(await extract(extractor, { text }), undefined, undefined, { addAll: addAll === true || /^\s*add all\b/i.test(text) });
    return { summary: formatReply(result, 'Ask the parent whether to add them all.'), ...result };
  },
});
