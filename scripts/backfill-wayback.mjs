// Step 1 of `npm run history`: download the last Internet Archive capture of each month into .cache/wayback.
// scripts/import-history.mjs then merges these with the joetek and seligman records into data/timeline.json and data/history.json.
import fs from 'node:fs/promises';
import path from 'node:path';

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
  console.log(`cached ${(await fs.readdir(CACHE)).length} archive captures in .cache/wayback`);
}
main();
