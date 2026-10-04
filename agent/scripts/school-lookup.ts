// Usage: npx tsx scripts/school-lookup.ts "Ardenwood Elementary Fremont"
import { findSchoolPages } from '../src/school.js';

for (const p of await findSchoolPages(process.argv[2] ?? 'Ardenwood Elementary Fremont'))
  console.log(p.url, '|', p.title, '|', p.text.length, 'chars');
