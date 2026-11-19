import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { findSchoolPages } from './school.js';
import { path } from './paths.js';
import { extract, reconcile, type ReconcileOptions, type Result } from './pipeline.js';
import type { Ticket } from './effects.js';

const FILE = path('data', 'school.json');

/** held: new events the last sync held for the parent to confirm, shown on the dashboard. */
type SchoolState = { school?: string; held?: number };

async function readState(): Promise<SchoolState> {
  try { return JSON.parse(await readFile(FILE, 'utf8')); } catch { return {}; }
}

async function writeState(state: SchoolState) {
  await mkdir(path('data'), { recursive: true });
  await writeFile(FILE, JSON.stringify(state));
}

export async function getSchool(): Promise<string | null> {
  return (await readState()).school ?? null;
}

export async function setSchool(school: string) {
  await writeState({ school });
}

export async function getHeld(): Promise<number> {
  return (await readState()).held ?? 0;
}

/** Pull the school's public newsletters and add any dated events. Idempotent. */
export async function syncSchool(mastra: any, ticket?: Ticket, options: ReconcileOptions = {}, findPages = findSchoolPages): Promise<Result> {
  const school = await getSchool();
  const total: Result = { created: [], updated: [], duplicates: [], conflicts: [], actionItems: [], complete: true };
  if (!school) return total;
  const extractor = mastra.getAgent('extractor');
  for (const page of await findPages(school)) {
    const text = `This is a page from the school's own website: ${page.title} (${page.url}). Only extract school and PTA events; skip anything that is not for this school.\n\n${page.text}`;
    const r = await reconcile(await extract(extractor, { text }), undefined, ticket, options);
    total.created.push(...r.created);
    total.updated?.push(...(r.updated ?? []));
    total.duplicates.push(...r.duplicates);
    total.conflicts.push(...r.conflicts);
    if (r.held) total.held = (total.held ?? 0) + r.held;
    if (r.complete === false) {
      total.complete = false;
      total.error = r.error;
      break;
    }
  }
  // The daily recheck has nobody to reply to, so the dashboard reads the held count from here.
  if (total.complete !== false) await writeState({ ...(await readState()), held: total.held ?? 0 });
  return total;
}

/** Heartbeat: re-sync once a day while the server is up. */
export function startHeartbeat(mastra: any) {
  const day = 24 * 60 * 60 * 1000;
  const t = setInterval(() => syncSchool(mastra)
    .then((r) => { if (r.held) mastra.getLogger().warn('sync held new events; confirm from the dashboard', { held: r.held }); })
    .catch((e) => mastra.getLogger().error('sync failed', { err: String(e) })), day);
  t.unref();
}
