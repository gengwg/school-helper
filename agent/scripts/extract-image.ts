// Usage: npx tsx scripts/extract-image.ts screenshot.png   (extraction only, no calendar writes)
import { readFile } from 'node:fs/promises';
import { mastra } from '../src/mastra/index.js';
import { extract } from '../src/pipeline.js';

const file = process.argv[2];
const data = await readFile(file);
const mimeType = /\.jpe?g$/.test(file) ? 'image/jpeg' : 'image/png';
const out = await extract(mastra.getAgent('extractor'), { image: { data, mimeType } });
console.log(JSON.stringify(out, null, 2));
