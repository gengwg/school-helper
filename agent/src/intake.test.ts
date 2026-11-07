import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claim, getTicket, handle, recover, startTicket } from './intake.js';
import { setCalendar } from './calendar.js';

function mastra() {
  return {
    getAgent: () => ({ generate: async () => ({ object: { events: [], actionItems: [] } }) }),
    getLogger: () => ({ error: () => undefined, warn: () => undefined }),
  };
}

test('a stale claim lock is reclaimed without losing the claim', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'personal-agent-lock-'));
  process.env.AGENT_STATE_DIR = dir;
  const lock = join(dir, 'intake.json.lock');
  writeFileSync(lock, '999999:dead-process');
  const old = new Date(Date.now() - 120_000);
  utimesSync(lock, old, old);
  const ticket = claim({ kind: 'dashboard', id: 'lock-1' }, {});
  assert.ok(ticket);
  assert.equal(getTicket(ticket!.id)?.source.id, 'lock-1');
});

test('concurrent claims create one ticket', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'personal-agent-claims-'));
  process.env.AGENT_STATE_DIR = dir;
  const source = { kind: 'dashboard', id: 'concurrent-1' };
  const results = await Promise.all(Array.from({ length: 10 }, () => Promise.resolve().then(() => claim(source, {}))));
  assert.equal(results.filter(Boolean).length, 1);
});

test('source ids are namespaced by channel', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'personal-agent-namespaces-'));
  process.env.AGENT_STATE_DIR = dir;
  assert.ok(claim({ kind: 'email', id: '123' }, {}));
  assert.ok(claim({ kind: 'whatsapp', id: '123' }, {}));
});

test('a stale running ticket is recovered', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'personal-agent-stale-'));
  process.env.AGENT_STATE_DIR = dir;
  const ticket = claim({ kind: 'dashboard', id: 'stale-1' }, { text: 'hello', heartbeat: 0 });
  ticket!.status = 'running';
  const m = mastra();
  const replies: string[] = [];
  const prepare = async (current: any) => ({
    text: current.data.text,
    attachments: [],
    ticket: current,
    reply: async (body: string) => { replies.push(body); },
  });
  await recover(m, { dashboard: prepare });
  assert.equal(getTicket(ticket!.id)!.status, 'done');
  assert.equal(replies.length, 1);
});

test('a healthy running ticket is not reclaimed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'personal-agent-lease-'));
  process.env.AGENT_STATE_DIR = dir;
  const ticket = claim({ kind: 'dashboard', id: 'healthy-1' }, { text: 'hello' });
  assert.equal(startTicket(ticket!), true);
  let prepared = false;
  await handle(mastra(), ticket!, async (current) => {
    prepared = true;
    return { text: current.data.text, attachments: [], ticket: current, reply: async () => undefined };
  });
  assert.equal(prepared, false);
  assert.equal(getTicket(ticket!.id)!.attempts, 1);
});

test('calendar effects and the original reply survive a failed attempt', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'personal-agent-effects-'));
  process.env.AGENT_STATE_DIR = dir;
  const events: any[] = [];
  let inserts = 0;
  setCalendar({
    events: {
      list: async () => ({ data: { items: events } }),
      insert: async ({ requestBody }: any) => {
        inserts++;
        const event = { id: `g${events.length + 1}`, ...requestBody };
        events.push(event);
        return { data: event };
      },
      patch: async ({ eventId, requestBody }: any) => {
        const index = events.findIndex((event) => event.id === eventId);
        events[index] = { ...events[index], ...requestBody };
        return { data: events[index] };
      },
    },
  } as any);
  const event = { title: 'Picture day', start: '2026-11-12', end: null, allDay: true, location: null, child: null, notes: null };
  const m = {
    getAgent: () => ({ generate: async () => ({ object: { events: [event], actionItems: [] } }) }),
    getLogger: () => ({ error: () => undefined, warn: () => undefined }),
  };
  const replies: string[] = [];
  let failReply = true;
  const prepare = async (ticket: any) => ({
    text: 'Picture day', attachments: [], ticket,
    reply: async (body: string) => {
      if (failReply) { failReply = false; throw new Error('temporary reply failure'); }
      replies.push(body);
    },
  });
  const ticket = claim({ kind: 'dashboard', id: 'effects-1' }, { text: 'Picture day' });
  try {
    await assert.rejects(handle(m, ticket!, prepare));
    const pending = getTicket(ticket!.id)!;
    assert.equal(pending.status, 'pending');
    assert.equal(pending.effects.find((effect) => effect.kind === 'calendar.create')?.sent_at !== undefined, true);
    assert.equal(pending.effects.find((effect) => effect.kind === 'reply')?.sent_at, undefined);

    await recover(m, { dashboard: prepare });
    const done = getTicket(ticket!.id)!;
    assert.equal(done.status, 'done');
    assert.equal(inserts, 1);
    assert.equal(replies.length, 1);
    assert.match(replies[0], /^Added:/);
    assert.match(done.result.summary, /^Added:/);
    assert.equal(done.result.created.length, 1);
  } finally {
    setCalendar(undefined);
  }
});

test('empty completed input retains its idempotent result', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'personal-agent-empty-'));
  process.env.AGENT_STATE_DIR = dir;
  const ticket = claim({ kind: 'dashboard', id: 'empty-1' }, { text: '   ' });
  await handle(mastra(), ticket!, async (current) => ({
    text: current.data.text, attachments: [], ticket: current, reply: async () => undefined,
  }));
  const done = getTicket(ticket!.id)!;
  assert.equal(done.status, 'done');
  assert.match(done.result.summary, /didn't find any dates/);
  const again = getTicket(ticket!.id)!;
  assert.deepEqual(again.result, done.result);
});

test('native intake claims are durable and recovery does not repeat done work', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'personal-agent-intake-'));
  process.env.AGENT_STATE_DIR = dir;
  const source = { kind: 'dashboard', id: 'event-1' };
  const first = claim(source, { text: 'hello' });
  assert.ok(first);
  assert.equal(claim(source, { text: 'hello' }), null);

  const m = mastra();
  const replies: string[] = [];
  const prepare = async (ticket: any) => ({
    text: ticket.data.text,
    attachments: [],
    ticket,
    reply: async (body: string) => { replies.push(body); },
  });
  await handle(m, first!, prepare);
  assert.equal(first!.status, 'done');
  assert.equal(replies.length, 1);
  await recover(m, { dashboard: prepare });
  assert.equal(replies.length, 1);
});
