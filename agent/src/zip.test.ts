import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { textEntries } from './zip.js';

test('reads the chat .txt out of a WhatsApp-style zip and skips media', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zip-'));
  writeFileSync(join(dir, 'WhatsApp Chat with Room 12.txt'), '10/1/26, 7:42 PM - Ms. Alvarez: Picture Day Friday Oct 9\n');
  writeFileSync(join(dir, 'IMG-001.jpg'), Buffer.from([0xff, 0xd8, 0xff]));
  execFileSync('zip', ['-q', '-j', 'chat.zip', 'WhatsApp Chat with Room 12.txt', 'IMG-001.jpg'], { cwd: dir });
  const entries = textEntries(readFileSync(join(dir, 'chat.zip')));
  assert.equal(entries.length, 1);
  assert.match(entries[0].text, /Picture Day Friday Oct 9/);
});
