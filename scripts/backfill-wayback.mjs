// One-off: rebuild AWS IP history from Internet Archive snapshots of ip-ranges.json.
// Writes data/history.json and data/prefix-history.json. Cached downloads in .cache/wayback.
import fs from 'node:fs/promises';
import path from 'node:path';
import { summarize, updatePrefixHistory, createDateToISO } from '../src/lib/stats.js';
import { stringifyLines, stringifyHistory } from '../src/lib/jsonlines.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CACHE = path.join(ROOT, '.cache', 'wayback');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, tries = 5) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': 'aws-rangefinder-backfill (github.com/manishh-13/aws-rangefinder)' } });
      if (res.ok) return await res.text();
      if (res.status === 404) return null;
    } catch {}
    await sleep(2000 * (i + 1));
  }
  return null;
}

async function main() {
  await fs.mkdir(CACHE, { recursive: true });
  const cdx = JSON.parse(await get('https://web.archive.org/cdx/search/cdx?url=ip-ranges.amazonaws.com/ip-ranges.json&output=json&collapse=digest&filter=statuscode:200&fl=timestamp,original'));
  const rows = cdx.slice(1);
  // keep the last capture of each month
  const byMonth = new Map();
  for (const [ts, original] of rows) byMonth.set(ts.slice(0, 6), [ts, original]);
  const picks = [...byMonth.values()];
  console.log(`captures=${rows.length} months=${picks.length}`);

  const docs = [];
  for (const [i, [ts, original]] of picks.entries()) {
    const file = path.join(CACHE, `${ts}.json`);
    let text = await fs.readFile(file, 'utf8').catch(() => null);
    if (!text) {
      text = await get(`https://web.archive.org/web/${ts}id_/${original}`);
      if (!text) { console.log(`skip ${ts}`); continue; }
      await fs.writeFile(file, text);
      await sleep(800);
    }
    try {
      const doc = JSON.parse(text);
      if (!doc.prefixes) throw new Error('no prefixes');
      docs.push(doc);
      if (i % 10 === 0) console.log(`${i + 1}/${picks.length} ${ts} ok`);
    } catch (e) { console.log(`bad ${ts}: ${e.message}`); }
  }
  // add the live file as the newest point
  const live = await get('https://ip-ranges.amazonaws.com/ip-ranges.json');
  if (live) docs.push(JSON.parse(live));

  // de-dup by syncToken and sort oldest first
  const uniq = [...new Map(docs.map((d) => [String(d.syncToken), d])).values()]
    .sort((a, b) => Number(a.syncToken) - Number(b.syncToken));

  const snapshots = [], prefixHist = {}, regionsFirstSeen = {}, servicesFirstSeen = {};
  for (const doc of uniq) {
    const s = summarize(doc);
    snapshots.push({ t: s.t, sync: s.sync, v4p: s.v4p, v6p: s.v6p, v4a: s.v4a, regions: s.regions });
    const day = (s.t || createDateToISO(doc.createDate) || '').slice(0, 10);
    for (const r of Object.keys(s.regionCounts)) regionsFirstSeen[r] ??= day;
    for (const sv of Object.keys(s.serviceCounts)) servicesFirstSeen[sv] ??= day;
    updatePrefixHistory(prefixHist, doc, day);
  }
  await fs.mkdir(path.join(ROOT, 'data'), { recursive: true });
  await fs.writeFile(path.join(ROOT, 'data', 'history.json'),
    stringifyHistory({ source: 'Internet Archive captures of ip-ranges.json (last capture per month) plus live updates', regionsFirstSeen, servicesFirstSeen, snapshots }));
  await fs.writeFile(path.join(ROOT, 'data', 'prefix-history.json'), stringifyLines(prefixHist));
  console.log(`done snapshots=${snapshots.length} prefixesEverSeen=${Object.keys(prefixHist).length}`);
}
main();
