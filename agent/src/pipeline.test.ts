import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatReply, fmtWhen, todayContext, reconcile } from './pipeline.js';
import { createEvent, setCalendar, type CalEvent } from './calendar.js';

process.env.TZ = 'America/Los_Angeles';

test('todayContext names the weekday and timezone', () => {
  const s = todayContext(new Date('2026-10-04T18:00:00Z'));
  assert.match(s, /Sunday, October 4, 2026/);
  assert.match(s, /America\/Los_Angeles/);
});

test('fmtWhen is short and local', () => {
  assert.equal(fmtWhen({ start: '2026-10-09T15:00:00-07:00', allDay: false }), 'Fri, Oct 9 3 PM');
  assert.equal(fmtWhen({ start: '2026-10-24', allDay: true }), 'Sat, Oct 24');
});

test('formatReply reads like a text to a parent', () => {
  const reply = formatReply({
    created: [{ id: '1', title: 'Picture Day (Room 12)', start: '2026-10-09T09:15:00-07:00', end: '2026-10-09T10:15:00-07:00', allDay: false, calendar: 'school' }],
    duplicates: [{ title: 'Soccer practice', start: '2026-10-08T16:30', end: null, allDay: false, location: null, child: null, notes: null }],
    conflicts: [{ event: { id: '1', title: 'Picture Day (Room 12)', start: '', end: '', allDay: false, calendar: 'school' }, with: { id: '2', title: 'Dentist', start: '', end: '', allDay: false, calendar: 'personal' } }],
    actionItems: [{ what: 'Return the field trip permission slip', due: '2026-10-10', amount: '$15' }],
  });
  assert.equal(reply, [
    'Added: Picture Day (Room 12) (Fri, Oct 9 9:15 AM).',
    'Already on the calendar: Soccer practice.',
    'Heads up: Picture Day (Room 12) overlaps with Dentist.',
    'To do: Return the field trip permission slip ($15) by Sat, Oct 10.',
  ].join('\n'));
});

test('formatReply with nothing found', () => {
  assert.equal(formatReply({ created: [], duplicates: [], conflicts: [], actionItems: [] }), "I didn't find any dates in that message.");
});

function fakeCalendar(existing: CalEvent) {
  const calls = { insert: 0, patch: 0 };
  return {
    calls,
    events: {
      list: async () => ({ data: { items: [{ ...existing, summary: existing.title, start: { date: existing.start }, end: { date: existing.end } }] } }),
      insert: async ({ requestBody }: any) => {
        calls.insert++;
        return { data: { id: 'created', ...requestBody } };
      },
      patch: async ({ eventId, requestBody }: any) => {
        calls.patch++;
        return { data: { id: eventId, ...requestBody } };
      },
    },
  };
}

test('a moved event updates the source event instead of creating a duplicate', async () => {
  const existing: CalEvent = {
    id: 'g1', title: 'Old title', start: '2026-10-10', end: '2026-10-10', allDay: true,
    calendar: 'school', source: 'whatsapp:m1', description: 'For: Mia\n[source:whatsapp:m1]',
  };
  const calendar = fakeCalendar(existing);
  setCalendar(calendar as any);
  const result = await reconcile({
    events: [{ title: 'New title', start: '2026-10-12', end: null, allDay: true, location: null, child: 'Mia', notes: null }],
    actionItems: [],
  }, { kind: 'whatsapp', id: 'm1' });
  assert.equal(calendar.calls.patch, 1);
  assert.equal(calendar.calls.insert, 0);
  assert.equal(result.updated?.[0].id, 'g1');
  assert.equal(result.created.length, 0);
});

test('unchanged source events stay duplicates without another write', async () => {
  const existing: CalEvent = {
    id: 'g1', title: 'Same title', start: '2026-10-10', end: '2026-10-10', allDay: true,
    calendar: 'school', source: 'whatsapp:m1', description: '[source:whatsapp:m1]',
  };
  const calendar = fakeCalendar(existing);
  setCalendar(calendar as any);
  const result = await reconcile({
    events: [{ title: 'Same title', start: '2026-10-10', end: null, allDay: true, location: null, child: null, notes: null }],
    actionItems: [],
  }, { kind: 'whatsapp', id: 'm1' });
  assert.equal(calendar.calls.patch, 0);
  assert.equal(calendar.calls.insert, 0);
  assert.equal(result.duplicates.length, 1);
});

test('multiple events from one message each get an effect', async () => {
  const existing: CalEvent = { id: 'g1', title: 'Other', start: '2026-10-10', end: '2026-10-10', allDay: true, calendar: 'school' };
  const calendar = fakeCalendar(existing);
  setCalendar(calendar as any);
  const ticket: any = { id: 'whatsapp:multi', source: { kind: 'whatsapp', id: 'multi' }, status: 'pending', attempts: 0, effects: [] };
  const result = await reconcile({ events: [
    { title: 'First', start: '2026-11-12', end: null, allDay: true, location: null, child: null, notes: null },
    { title: 'Second', start: '2026-11-13', end: null, allDay: true, location: null, child: null, notes: null },
  ], actionItems: [] }, ticket.source, ticket);
  assert.equal(calendar.calls.insert, 2);
  assert.equal(result.created.length, 2);
});

test('a correction with a new message id updates the original event', async () => {
  const existing: CalEvent = {
    id: 'g1', title: 'Same title', start: '2026-10-10', end: '2026-10-10', allDay: true,
    calendar: 'school', source: 'whatsapp:m1', event_key: 'same-title', description: '[source:whatsapp:m1]\n[event:same-title]',
  };
  const calendar = fakeCalendar(existing);
  setCalendar(calendar as any);
  const result = await reconcile({
    events: [{ title: 'Same title', start: '2026-10-12', end: null, allDay: true, location: null, child: null, notes: null }],
    actionItems: [],
  }, { kind: 'whatsapp', id: 'm2', correction: true });
  assert.equal(result.updated?.[0].id, 'g1');
  assert.equal(calendar.calls.insert, 0);
});

test('an ambiguous committed insert is not replayed', async () => {
  const existing: CalEvent = {
    id: 'g1', title: 'Same title', start: '2026-10-10', end: '2026-10-10', allDay: true,
    calendar: 'school', source: 'whatsapp:m1', event_key: 'same-title', description: '[source:whatsapp:m1]\n[event:same-title]',
  };
  const calendar = fakeCalendar(existing);
  setCalendar(calendar as any);
  const ticket: any = { id: 'whatsapp:m1', source: { kind: 'whatsapp', id: 'm1' }, status: 'pending', attempts: 0, effects: [] };
  const { enqueueEffect } = await import('./effects.js');
  const { createHash } = await import('node:crypto');
  const ev = { title: 'Same title', start: '2026-10-10', end: null, allDay: true, location: null, child: null, notes: null };
  enqueueEffect(ticket, 'calendar.create', { event: ev, source: ticket.source }, `calendar.create:whatsapp:m1:${createHash('sha256').update(JSON.stringify(ev)).digest('hex').slice(0, 16)}`);
  const result = await reconcile({ events: [ev], actionItems: [] }, ticket.source, ticket);
  assert.equal(calendar.calls.insert, 0);
  assert.equal(result.duplicates.length, 1);
  assert.equal(ticket.effects.length, 0);
});

test('a recurring occurrence does not overwrite the previous occurrence', async () => {
  const existing: CalEvent = {
    id: 'g1', title: 'Soccer practice', start: '2026-11-10', end: '2026-11-10', allDay: true,
    calendar: 'school', source: 'whatsapp:m1', event_key: 'soccer-practice', description: '[source:whatsapp:m1]\\n[event:soccer-practice]',
  };
  const calendar = fakeCalendar(existing);
  setCalendar(calendar as any);
  const result = await reconcile({
    events: [{ title: 'Soccer practice', start: '2026-11-17', end: null, allDay: true, location: null, child: null, notes: null }],
    actionItems: [],
  }, { kind: 'whatsapp', id: 'm2' });
  assert.equal(calendar.calls.insert, 1);
  assert.equal(calendar.calls.patch, 0);
  assert.equal(result.created.length, 1);
});

test('duplicate events within one extraction create only once', async () => {
  const existing: CalEvent = { id: 'g1', title: 'Other', start: '2026-11-10', end: '2026-11-10', allDay: true, calendar: 'school' };
  const calendar = fakeCalendar(existing);
  setCalendar(calendar as any);
  const ticket: any = { id: 'whatsapp:dupes', source: { kind: 'whatsapp', id: 'dupes' }, status: 'pending', attempts: 0, effects: [] };
  const event = { title: 'Picture day', start: '2026-11-12', end: null, allDay: true, location: null, child: null, notes: null };
  const result = await reconcile({ events: [event, { ...event }], actionItems: [] }, ticket.source, ticket);
  assert.equal(calendar.calls.insert, 1);
  assert.equal(result.created.length, 1);
  assert.equal(result.duplicates.length, 1);
});

test('a fuzzy school duplicate acknowledges an ambiguous pending create', async () => {
  const existing: CalEvent = {
    id: 'g1', title: 'Picture day', start: '2026-11-12', end: '2026-11-12', allDay: true, calendar: 'school',
  };
  const calendar = fakeCalendar(existing);
  setCalendar(calendar as any);
  const ticket: any = { id: 'sync:one', source: { kind: 'sync', id: 'one' }, status: 'pending', attempts: 0, effects: [] };
  const { enqueueEffect } = await import('./effects.js');
  const { createHash } = await import('node:crypto');
  const event = { title: 'Picture day', start: '2026-11-12', end: null, allDay: true, location: null, child: null, notes: null };
  const key = `calendar.create:undefined:undefined:${createHash('sha256').update(JSON.stringify(event)).digest('hex').slice(0, 16)}`;
  enqueueEffect(ticket, 'calendar.create', { event, source: undefined }, key);
  const result = await reconcile({ events: [event], actionItems: [] }, undefined, ticket);
  assert.equal(calendar.calls.insert, 0);
  assert.equal(result.duplicates.length, 1);
  assert.equal(ticket.effects.length, 0);
});

test('corrections can move events originally created by school sync', async () => {
  const existing: CalEvent = {
    id: 'g1', title: 'Picture day', start: '2026-11-12', end: '2026-11-12', allDay: true,
    calendar: 'school', event_key: 'picture-day', description: '[event:picture-day]',
  };
  const calendar = fakeCalendar(existing);
  setCalendar(calendar as any);
  const result = await reconcile({
    events: [{ title: 'Picture day', start: '2026-11-19', end: null, allDay: true, location: null, child: null, notes: null }],
    actionItems: [],
  }, { kind: 'whatsapp', id: 'moved', correction: true });
  assert.equal(calendar.calls.patch, 1);
  assert.equal(calendar.calls.insert, 0);
  assert.equal(result.updated?.[0].id, 'g1');
});

test('concurrent tickets cannot both create the same event', async () => {
  const events: any[] = [];
  let inserts = 0;
  setCalendar({
    events: {
      list: async () => ({ data: { items: events } }),
      insert: async ({ requestBody }: any) => {
        inserts++;
        await new Promise((resolve) => setTimeout(resolve, 5));
        const created = { id: requestBody.id, ...requestBody };
        events.push(created);
        return { data: created };
      },
      get: async ({ eventId }: any) => ({ data: events.find((event) => event.id === eventId) }),
      patch: async () => { throw new Error('unexpected patch'); },
    },
  } as any);
  const event = { title: 'Science fair', start: '2026-11-20', end: null, allDay: true, location: null, child: null, notes: null };
  const ticket = (id: string): any => ({ id, source: { kind: 'email', id }, status: 'pending', attempts: 0, effects: [] });
  try {
    await Promise.all([
      reconcile({ events: [event], actionItems: [] }, { kind: 'email', id: 'one' }, ticket('one')),
      reconcile({ events: [event], actionItems: [] }, { kind: 'email', id: 'two' }, ticket('two')),
    ]);
    assert.equal(inserts, 1);
    assert.equal(events.length, 1);
  } finally {
    setCalendar(undefined);
  }
});

test('a stale original retry cannot undo a newer correction', async () => {
  const existing: CalEvent = {
    id: 'g1', title: 'Picture day', start: '2026-11-21', end: '2026-11-21', allDay: true,
    calendar: 'school', source: 'whatsapp:m1', source_event_key: 'whatsapp:m1:0', revision: 'whatsapp:m2',
    event_key: 'picture-day', description: '[source:whatsapp:m1]\\n[source-event:whatsapp:m1:0]\\n[revision:whatsapp:m2]\\n[event:picture-day]',
  };
  const calendar = fakeCalendar(existing);
  setCalendar(calendar as any);
  const { enqueueEffect } = await import('./effects.js');
  const event = { title: 'Picture day', start: '2026-11-20', end: null, allDay: true, location: null, child: null, notes: null };
  const ticket: any = { id: 'whatsapp:m1', source: { kind: 'whatsapp', id: 'm1' }, status: 'pending', attempts: 0, effects: [] };
  enqueueEffect(ticket, 'calendar.update', { id: 'g1', event, source: ticket.source }, 'calendar.update:whatsapp:m1:g1');
  const result = await reconcile({ events: [event], actionItems: [] }, ticket.source, ticket);
  assert.equal(calendar.calls.patch, 0);
  assert.equal(calendar.calls.insert, 0);
  assert.equal(result.duplicates.length, 1);
  assert.equal(ticket.effects.length, 0);
});

test('a stale intermediate correction cannot undo a newer correction', async () => {
  const existing: CalEvent = {
    id: 'g1', title: 'Picture day', start: '2026-11-22', end: '2026-11-22', allDay: true,
    calendar: 'school', source: 'whatsapp:m1', source_event_key: 'whatsapp:m1:0', revision: 'whatsapp:m3', revision_at: 300,
    event_key: 'picture-day', description: '[source:whatsapp:m1]\\n[source-event:whatsapp:m1:0]\\n[revision:whatsapp:m3]\\n[revised-at:300]\\n[event:picture-day]',
  };
  const calendar = fakeCalendar(existing);
  setCalendar(calendar as any);
  const { enqueueEffect } = await import('./effects.js');
  const event = { title: 'Picture day', start: '2026-11-21', end: null, allDay: true, location: null, child: null, notes: null };
  const ticket: any = { id: 'whatsapp:m2', source: { kind: 'whatsapp', id: 'm2' }, status: 'pending', attempts: 0, effects: [], created_at: 200 };
  enqueueEffect(ticket, 'calendar.update', { id: 'g1', event, source: ticket.source }, 'calendar.update:whatsapp:m2:g1');
  const result = await reconcile({ events: [event], actionItems: [] }, { ...ticket.source, correction: true, revision_at: 200 }, ticket);
  assert.equal(calendar.calls.patch, 0);
  assert.equal(calendar.calls.insert, 0);
  assert.equal(result.duplicates.length, 1);
  assert.equal(ticket.effects.length, 0);
});

test('same-title occurrences survive a partial retry', async () => {
  const existing: CalEvent = {
    id: 'g1', title: 'Soccer practice', start: '2026-11-10', end: '2026-11-10', allDay: true,
    calendar: 'school', source: 'whatsapp:m1', source_event_key: 'whatsapp:m1:0', revision: 'whatsapp:m1',
    event_key: 'soccer-practice', description: '[source:whatsapp:m1]\\n[source-event:whatsapp:m1:0]\\n[revision:whatsapp:m1]\\n[event:soccer-practice]',
  };
  const calendar = fakeCalendar(existing);
  setCalendar(calendar as any);
  const { enqueueEffect } = await import('./effects.js');
  const { createHash } = await import('node:crypto');
  const second = { title: 'Soccer practice', start: '2026-11-17', end: null, allDay: true, location: null, child: null, notes: null };
  const first = { ...second, start: '2026-11-10' };
  const ticket: any = { id: 'whatsapp:m1', source: { kind: 'whatsapp', id: 'm1' }, status: 'pending', attempts: 0, effects: [] };
  const fingerprint = createHash('sha256').update(JSON.stringify(second)).digest('hex').slice(0, 16);
  enqueueEffect(ticket, 'calendar.create', { event: second, source: { ...ticket.source, event_key: 'whatsapp:m1:1' } }, `calendar.create:whatsapp:m1:${fingerprint}:1`);
  const result = await reconcile({ events: [first, second], actionItems: [] }, { ...ticket.source, correction: true }, ticket);
  assert.equal(calendar.calls.patch, 0);
  assert.equal(calendar.calls.insert, 1);
  assert.equal(result.created[0].start, '2026-11-17');
});

test('a partial retry retains events created before the failure', async () => {
  const events: any[] = [];
  let failSecond = true;
  let inserts = 0;
  setCalendar({
    events: {
      list: async () => ({ data: { items: events } }),
      insert: async ({ requestBody }: any) => {
        inserts++;
        if (requestBody.summary === 'Second' && failSecond) {
          failSecond = false;
          throw new Error('temporary insert failure');
        }
        const created = { ...requestBody };
        events.push(created);
        return { data: created };
      },
      get: async ({ eventId }: any) => {
        const event = events.find((candidate) => candidate.id === eventId);
        if (!event) throw new Error('not found');
        return { data: event };
      },
      patch: async () => { throw new Error('unexpected patch'); },
    },
  } as any);
  const first = { title: 'First', start: '2026-11-12', end: null, allDay: true, location: null, child: null, notes: null };
  const second = { title: 'Second', start: '2026-11-13', end: null, allDay: true, location: null, child: null, notes: null };
  const ticket: any = { id: 'email:partial', source: { kind: 'email', id: 'partial' }, status: 'pending', attempts: 0, effects: [] };
  try {
    const initial = await reconcile({ events: [first, second], actionItems: [] }, ticket.source, ticket);
    assert.equal(initial.complete, false);
    assert.equal(initial.created.length, 1);
    const recovered = await reconcile({ events: [first, second], actionItems: [] }, ticket.source, ticket);
    assert.equal(recovered.complete, true);
    assert.deepEqual(recovered.created.map((event) => event.title), ['First', 'Second']);
    assert.equal(recovered.duplicates.length, 0);
    assert.equal(inserts, 3);
  } finally {
    setCalendar(undefined);
  }
});

test('source metadata is written into created event descriptions', async () => {
  const existing: CalEvent = { id: 'g1', title: 'Other', start: '2026-10-10', end: '2026-10-10', allDay: true, calendar: 'school' };
  const calendar = fakeCalendar(existing);
  setCalendar(calendar as any);
  const created = await createEvent({ title: 'New', start: '2026-10-12', end: null, allDay: true, location: null, child: null, notes: null }, { kind: 'email', id: 'message-1' });
  assert.equal(created.source, 'email:message-1');
});

test('a moved deterministic ID does not satisfy a request for the old date', async () => {
  const event = { title: 'Picture day', start: '2026-11-20', end: null, allDay: true, location: null, child: null, notes: null };
  let inserts = 0;
  let originalId = '';
  setCalendar({
    events: {
      insert: async ({ requestBody }: any) => {
        inserts++;
        if (inserts === 1) {
          originalId = requestBody.id;
          throw new Error('ID already exists');
        }
        return { data: requestBody };
      },
      get: async ({ eventId }: any) => ({
        data: {
          id: eventId, summary: event.title, description: '[event:picture-day]',
          start: { date: '2026-11-21' }, end: { date: '2026-11-21' },
        },
      }),
    },
  } as any);
  try {
    const created = await createEvent(event);
    assert.equal(inserts, 2);
    assert.equal(created.start, '2026-11-20');
    assert.notEqual(created.id, originalId);
  } finally {
    setCalendar(undefined);
  }
});

test('distinct non-Latin titles have distinct deterministic identities', async () => {
  const events: any[] = [];
  setCalendar({
    events: {
      insert: async ({ requestBody }: any) => {
        if (events.some((event) => event.id === requestBody.id)) throw new Error('ID already exists');
        events.push(requestBody);
        return { data: requestBody };
      },
      get: async ({ eventId }: any) => ({ data: events.find((event) => event.id === eventId) }),
    },
  } as any);
  const base = { start: '2026-11-20', end: null, allDay: true, location: null, child: null, notes: null };
  try {
    const first = await createEvent({ ...base, title: '家长会' });
    const second = await createEvent({ ...base, title: '科学展览' });
    assert.notEqual(first.id, second.id);
    assert.equal(events.length, 2);
    assert.deepEqual(events.map((event) => event.summary), ['家长会', '科学展览']);
  } finally {
    setCalendar(undefined);
  }
});

test('a lost insert response is recovered by its deterministic event id', async () => {
  const event = { title: 'New', start: '2026-11-12', end: null, allDay: true, location: null, child: null, notes: null };
  let insertedId = '';
  setCalendar({
    events: {
      insert: async ({ requestBody }: any) => {
        insertedId = requestBody.id;
        throw new Error('response lost');
      },
      get: async ({ eventId }: any) => ({
        data: {
          id: eventId, summary: event.title, description: '[event:new]',
          start: { date: event.start }, end: { date: event.start },
        },
      }),
    },
  } as any);
  try {
    const created = await createEvent(event);
    assert.equal(created.id, insertedId);
    assert.match(created.id, /^pa[0-9a-f]{32}$/);
  } finally {
    setCalendar(undefined);
  }
});
