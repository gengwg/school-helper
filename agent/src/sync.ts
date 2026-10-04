import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { findSchoolPages } from './school.js';
import { path } from './paths.js';
import { extract, reconcile, type Result } from './pipeline.js';

const FILE = path('data', 'school.json');

export async function getSchool(): Promise<string | null> {
  try { return JSON.parse(await readFile(FILE, 'utf8')).school ?? null; } catch { return null; }
}

export async function setSchool(school: string) {
  await mkdir(path('data'), { recursive: true });
  await writeFile(FILE, JSON.stringify({ school }));
}

/** Pull the school's public newsletters and add any dated events. Idempotent. */
export async function syncSchool(mastra: any): Promise<Result> {
  const school = await getSchool();
  const total: Result = { created: [], duplicates: [], conflicts: [], actionItems: [] };
  if (!school) return total;
  const extractor = mastra.getAgent('extractor');
  for (const page of await findSchoolPages(school)) {
    const text = `This is a page from the school's own website: ${page.title} (${page.url}). Only extract school and PTA events; skip anything that is not for this school.\n\n${page.text}`;
    const r = await reconcile(await extract(extractor, { text }));
    total.created.push(...r.created);
    total.duplicates.push(...r.duplicates);
    total.conflicts.push(...r.conflicts);
  }
  return total;
}

/** Heartbeat: re-sync once a day while the server is up. */
export function startHeartbeat(mastra: any) {
  const day = 24 * 60 * 60 * 1000;
  const t = setInterval(() => syncSchool(mastra).catch((e) => mastra.getLogger().error('sync failed', { err: String(e) })), day);
  t.unref();
}
