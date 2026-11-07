import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enqueueEffect, processEffects, type Ticket } from './effects.js';

const ticket = (): Ticket => ({ id: 't1', source: { kind: 'test', id: 's1' }, status: 'pending', attempts: 0, effects: [] });

test('effects are ordered, deduplicated by key, and sent once', async () => {
  const t = ticket();
  enqueueEffect(t, 'calendar.create', { title: 'A' }, 'a');
  enqueueEffect(t, 'reply', { text: 'B' }, 'b');
  enqueueEffect(t, 'calendar.update', { title: 'C' }, 'c');
  const calls: string[] = [];
  const handlers = {
    'calendar.create': async (payload: any) => { calls.push(`create:${payload.title}`); return payload; },
    'calendar.update': async (payload: any) => { calls.push(`update:${payload.title}`); return payload; },
    'calendar.sync': async () => undefined,
    reply: async (payload: any) => { calls.push(`reply:${payload.text}`); return payload; },
  };
  assert.equal((await processEffects(t, handlers)).complete, true);
  assert.deepEqual(calls, ['create:A', 'reply:B', 'update:C']);
  await processEffects(t, handlers);
  assert.deepEqual(calls, ['create:A', 'reply:B', 'update:C']);
  assert.equal(t.effects.length, 3);
});

test('a failed effect retries without repeating earlier sent effects', async () => {
  const t = ticket();
  enqueueEffect(t, 'calendar.create', { title: 'A' }, 'a');
  enqueueEffect(t, 'reply', { text: 'B' }, 'b');
  enqueueEffect(t, 'calendar.update', { title: 'C' }, 'c');
  const calls: string[] = [];
  let fail = true;
  const handlers = {
    'calendar.create': async (payload: any) => { calls.push(`create:${payload.title}`); return payload; },
    'calendar.update': async (payload: any) => { calls.push(`update:${payload.title}`); return payload; },
    'calendar.sync': async () => undefined,
    reply: async (payload: any) => {
      calls.push(`reply:${payload.text}`);
      if (fail) { fail = false; throw new Error('temporary');
      }
      return payload;
    },
  };
  assert.equal((await processEffects(t, handlers)).complete, false);
  assert.deepEqual(calls, ['create:A', 'reply:B']);
  assert.equal(t.effects[0].sent_at !== undefined, true);
  assert.equal(t.effects[1].sent_at, undefined);
  assert.equal((await processEffects(t, handlers)).complete, true);
  assert.deepEqual(calls, ['create:A', 'reply:B', 'reply:B', 'update:C']);
});
