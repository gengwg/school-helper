import { mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setCalendar } from './calendar.js';

// Fixture dates are absolute; pin today before them.
mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-07T20:00:00Z') });

test('a held school sync is recorded for the dashboard and cleared once added', async () => {
  // sync.ts keeps its state under the project root found from cwd; run it in a scratch directory.
  process.chdir(await mkdtemp(join(tmpdir(), 'personal-agent-sync-')));
  const { syncSchool, setSchool, getHeld } = await import('./sync.js');
  let inserts = 0;
  setCalendar({
    events: {
      list: async () => ({ data: { items: [] } }),
      insert: async ({ requestBody }: any) => { inserts++; return { data: { id: `g${inserts}`, ...requestBody } }; },
      patch: async () => { throw new Error('unexpected patch'); },
    },
  } as any);
  const events = Array.from({ length: 30 }, (_, i) => ({
    title: `Term event ${i + 1}`, start: `2026-12-${String(i + 1).padStart(2, '0')}`, end: null, allDay: true, location: null, child: null, notes: null,
  }));
  const mastra = { getAgent: () => ({ generate: async () => ({ object: { events, actionItems: [] } }) }) };
  const pages = async () => [{ url: 'https://school.example/calendar', title: 'Calendar', text: 'Term dates' }];
  try {
    await setSchool('Synthetic Elementary');
    const held = await syncSchool(mastra, undefined, {}, pages);
    assert.equal(held.held, 30);
    assert.equal(inserts, 0);
    assert.equal(await getHeld(), 30);

    const added = await syncSchool(mastra, undefined, { addAll: true }, pages);
    assert.equal(added.created.length, 30);
    assert.equal(await getHeld(), 0);

    await syncSchool(mastra, undefined, {}, pages);
    await setSchool('Another School');
    assert.equal(await getHeld(), 0);
  } finally {
    setCalendar(undefined);
  }
});
