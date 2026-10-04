import Exa from 'exa-js';

let exa: Exa | undefined;
function client() {
  if (!exa) exa = new Exa(process.env.EXA_API_KEY);
  return exa;
}

export type SchoolPage = { url: string; title: string; text: string };

/** Find the school's recent newsletters and news posts from just its name. */
export async function findSchoolPages(school: string, limit = 4): Promise<SchoolPage[]> {
  const month = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(new Date());
  const queries = [`${school} newsletter ${month}`, `${school} upcoming events this month`];
  const seen = new Map<string, SchoolPage>();
  for (const q of queries) {
    const res = await client().search(q, { numResults: limit, type: 'auto', contents: { text: { maxCharacters: 8000 } } });
    for (const r of res.results) if (r.text && !seen.has(r.url)) seen.set(r.url, { url: r.url, title: r.title ?? r.url, text: r.text });
  }
  // Keep only the school's own site: the domain most results come from. Drops lookalikes such as
  // a historic farm or a PTA fundraiser platform sharing the school's name.
  const pages = [...seen.values()];
  const count = new Map<string, number>();
  for (const p of pages) count.set(host(p.url), (count.get(host(p.url)) ?? 0) + 1);
  const top = [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const site = pages.filter((p) => host(p.url) === top);
  return [...site, ...(await newestPosts(site, seen))];
}

const host = (u: string) => new URL(u).hostname.replace(/^www\./, '');

/** Search indexes lag; the site's RSS feed has this week's posts. WordPress school sites all expose /feed/. */
async function newestPosts(site: SchoolPage[], seen: Map<string, SchoolPage>): Promise<SchoolPage[]> {
  if (!site.length) return [];
  const u = new URL(site[0].url);
  const seg = u.pathname.split('/').filter(Boolean)[0];
  const feedUrl = `${u.origin}/${seg ? `${seg}/` : ''}feed/`;
  let xml: string;
  try {
    const res = await fetch(feedUrl, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return [];
    xml = await res.text();
  } catch { return []; }
  const links = [...xml.matchAll(/<item>[\s\S]*?<link>\s*([^<\s]+)\s*<\/link>/g)]
    .map((m) => m[1])
    .filter((l) => host(l) === host(site[0].url) && !seen.has(l))
    .slice(0, 5);
  if (!links.length) return [];
  const { results } = await client().getContents(links, { text: { maxCharacters: 8000 } });
  return results.filter((r) => r.text).map((r) => ({ url: r.url, title: r.title ?? r.url, text: r.text! }));
}
