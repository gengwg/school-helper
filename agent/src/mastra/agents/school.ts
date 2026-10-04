import { Agent } from '@mastra/core/agent';
import { listEventsTool, createEventTool, ingestTool } from '../tools/calendar.js';
import { todayContext } from '../../pipeline.js';
import { createAnthropic } from '@ai-sdk/anthropic';

const MODEL = {
  id: (process.env.MODEL || 'anthropic/claude-opus-5-5') as `${string}/${string}`,
  // Org-level Anthropic keys must name a workspace; workspace-scoped keys do not.
  headers: process.env.ANTHROPIC_WORKSPACE_ID ? { 'anthropic-workspace-id': process.env.ANTHROPIC_WORKSPACE_ID } : undefined,
};

export const extractor = new Agent({
  id: 'extractor',
  name: 'Extractor',
  model: MODEL,
  instructions: `You extract school and kids' activity events from messy parent group chats, WhatsApp exports, forwarded messages, school newsletters, and screenshots.

Rules:
- Only include things with a concrete date. Skip chatter, thanks, and emoji replies.
- Resolve relative dates ("next Friday", "the 14th", "this Wednesday") against today's date given in the message. If a year is missing, assume the next occurrence.
- Dates and times are local to the given timezone. Use "YYYY-MM-DDTHH:MM" for timed events and "YYYY-MM-DD" with allDay=true when no time is given. When a message says a time range, fill both start and end.
- If an event was moved, output only the new date.
- Title: short and parent-friendly, e.g. "Picture Day (Room 12)", "Soccer practice", "Mia's birthday party".
- child: the kid's name only if it is clear the event is for a specific child, else null.
- notes: logistics only (what to bring, where to meet), eight words or fewer, or null. Never put doubts or alternatives in notes; if a date is ambiguous, pick the nearest future reading.
- actionItems: things a parent must do (sign a form, pay, RSVP, bring something) with the due date if given. Skip optional volunteering.
- A chat may contain many unrelated events from different people. Capture all of them.`,
});

// The chat agent runs through the Neon AI Gateway's native Anthropic route when its credentials are
// present. The extractor stays on the direct key: the gateway rejects structured output requests.
const gateway = process.env.NEON_AI_GATEWAY_TOKEN && process.env.NEON_AI_GATEWAY_BASE_URL
  ? createAnthropic({ baseURL: `${process.env.NEON_AI_GATEWAY_BASE_URL}/anthropic/v1`, authToken: process.env.NEON_AI_GATEWAY_TOKEN })
  : undefined;
const CHAT_MODEL = gateway ? gateway(process.env.CHAT_MODEL || 'claude-opus-5-5') : MODEL;

export const schoolAgent = new Agent({
  id: 'schoolAgent',
  name: 'School Helper',
  model: CHAT_MODEL,
  tools: { listEventsTool, createEventTool, ingestTool },
  instructions: () => `You are School Helper, a calm assistant for a busy parent. You know their kids' school events.
${todayContext()} "This week" means today through the coming Sunday.

- When asked what's coming up, call listEventsTool and answer in a few short plain sentences, grouped by day. Mention conflicts.
- When the parent pastes a chat, newsletter, or message with dates, call ingestTool with the full text and relay its summary.
- Never use jargon, JSON, or long lists. Two to four sentences unless asked for more.`,
});
