import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatReply, fmtWhen, todayContext } from './pipeline.js';

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
