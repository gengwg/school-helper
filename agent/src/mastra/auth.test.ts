import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onAllowlist, senderAllowed } from './auth.js';

test('senderAllowed lets nobody in when ALLOWED_SENDERS is unset or empty', () => {
  delete process.env.ALLOWED_SENDERS;
  assert.equal(senderAllowed('Anyone <anyone@example.com>'), false);
  process.env.ALLOWED_SENDERS = ' , ';
  assert.equal(senderAllowed('Anyone <anyone@example.com>'), false);
});

test('senderAllowed matches the address inside a display name, case-insensitively', () => {
  process.env.ALLOWED_SENDERS = 'parent@gmail.com, other@school.org';
  assert.equal(senderAllowed('Weigang <Parent@Gmail.com>'), true);
  assert.equal(senderAllowed('other@school.org'), true);
  assert.equal(senderAllowed('Spammer <spam@example.com>'), false);
});

test('onAllowlist reads WhatsApp numbers with spaces after commas', () => {
  delete process.env.WHATSAPP_ALLOWED_FROM;
  assert.equal(onAllowlist('WHATSAPP_ALLOWED_FROM', '15551234567'), false);
  process.env.WHATSAPP_ALLOWED_FROM = '15551234567, 15557654321';
  assert.equal(onAllowlist('WHATSAPP_ALLOWED_FROM', '15557654321'), true);
  assert.equal(onAllowlist('WHATSAPP_ALLOWED_FROM', '15550000000'), false);
});
