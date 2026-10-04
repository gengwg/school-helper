import { z } from 'zod';

export const EventSchema = z.object({
  title: z.string(),
  start: z.string().describe('Local ISO date-time like 2026-10-09T15:00, or YYYY-MM-DD when allDay'),
  end: z.string().nullable().describe('Same format as start; null if unknown'),
  allDay: z.boolean(),
  location: z.string().nullable(),
  child: z.string().nullable().describe("Child's name if the message makes it clear, else null"),
  notes: z.string().nullable().describe('One short line of useful detail, e.g. what to bring'),
});

export const ActionItemSchema = z.object({
  what: z.string().describe('e.g. Sign the field trip permission slip'),
  due: z.string().nullable().describe('YYYY-MM-DD or null'),
  amount: z.string().nullable().describe('e.g. $15, or null'),
});

export const ExtractionSchema = z.object({
  events: z.array(EventSchema),
  actionItems: z.array(ActionItemSchema),
});

export type Event = z.infer<typeof EventSchema>;
export type ActionItem = z.infer<typeof ActionItemSchema>;
export type Extraction = z.infer<typeof ExtractionSchema>;
