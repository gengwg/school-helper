// Usage: npx tsx scripts/extract.ts fixtures/whatsapp-export.txt   (extraction only, no calendar writes)
import { readFile } from 'node:fs/promises';
import { mastra } from '../src/mastra/index.js';
import { extract } from '../src/pipeline.js';

const text = await readFile(process.argv[2], 'utf8');
const out = await extract(mastra.getAgent('extractor'), { text });
console.log(JSON.stringify(out, null, 2));
