import { test } from 'node:test';
import assert from 'node:assert/strict';
import { senderAllowed } from './auth.js';

test('senderAllowed is open when ALLOWED_SENDERS is unset', () => {
  delete process.env.ALLOWED_SENDERS;
  assert.equal(senderAllowed('Anyone <anyone@example.com>'), true);
});

test('senderAllowed matches the address inside a display name, case-insensitively', () => {
  process.env.ALLOWED_SENDERS = 'parent@gmail.com, other@school.org';
  assert.equal(senderAllowed('Weigang <Parent@Gmail.com>'), true);
  assert.equal(senderAllowed('other@school.org'), true);
  assert.equal(senderAllowed('Spammer <spam@example.com>'), false);
});
