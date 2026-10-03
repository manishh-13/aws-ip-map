// One-off: rebuild the full history from (1) Internet Archive monthly captures for 2015-11..2017-07 (.cache/wayback),
// (2) every version in github.com/joetek/aws-ip-ranges-json (cloned at .cache/joetek), (3) the current data/ip-ranges.json.
// Writes data/timeline.json (every entry's lifetime) and data/history.json (chart snapshots, first-seen dates).
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { summarize } from '../src/lib/stats.js';
import { emptyTimeline, appendVersion, stringifyTimeline } from '../src/lib/timeline.js';
import { stringifyHistory } from '../src/lib/jsonlines.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const JOE = path.join(ROOT, '.cache', 'joetek');
const WB = path.join(ROOT, '.cache', 'wayback');
const DATA = process.env.DATA_DIR || path.join(ROOT, 'data');

// ---- stream blobs out of git in commit order (oldest first) ----
function blobList() {
  const out = execFileSync('git', ['-C', JOE, 'log', '--reverse', '--format=C %H', '--raw', '--no-abbrev', '--', 'ip-ranges.json'], { maxBuffer: 1 << 28 }).toString();
  const blobs = [];
  for (const line of out.split('\n')) {
    if (!line.startsWith(':')) continue;
    const f = line.split(/\s+/);
    const blob = f[3];
    if (blob && !/^0+$/.test(blob)) blobs.push(blob);
  }
  return blobs;
}

async function* catBlobs(hashes) {
  const p = spawn('git', ['-C', JOE, 'cat-file', '--batch'], { stdio: ['pipe', 'pipe', 'inherit'] });
  (async () => { for (const h of hashes) { if (!p.stdin.write(h + '\n')) await new Promise((r) => p.stdin.once('drain', r)); } p.stdin.end(); })();
  let buf = Buffer.alloc(0);
  for await (const chunk of p.stdout) {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    while (true) {
      const nl = buf.indexOf(10);
      if (nl < 0) break;
      const header = buf.subarray(0, nl).toString();
      const size = Number(header.split(' ')[2]);
      if (buf.length < nl + 1 + size + 1) break;
      yield buf.subarray(nl + 1, nl + 1 + size).toString();
      buf = buf.subarray(nl + 1 + size + 1);
    }
  }
}

const weekKey = (iso) => { const d = new Date(iso); const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7)); return t.toISOString().slice(0, 10); };

async function main() {
  const t0 = Date.now();
  try { await fs.access(path.join(JOE, '.git')); } catch {
    console.log('cloning github.com/joetek/aws-ip-ranges-json into .cache/joetek (about 150 MB)...');
    execFileSync('git', ['clone', '--quiet', 'https://github.com/joetek/aws-ip-ranges-json.git', JOE], { stdio: 'inherit' });
  }
  const tl = emptyTimeline();
  tl.sources = {
    w: 'Internet Archive captures of ip-ranges.json, last capture per month (2015-11 to 2017-07)',
    j: 'Every version recorded in github.com/joetek/aws-ip-ranges-json (2017-07 onward)',
    l: 'Fetched live from ip-ranges.amazonaws.com by this site',
  };
  const snapshots = [], regionsFirstSeen = {}, servicesFirstSeen = {};
  let prevDoc = null, prevIso = null, skipped = 0, bad = 0;
  const recentCut = new Date(Date.now() - 120 * 864e5).toISOString();

  const take = (doc, src) => {
    const r = appendVersion(tl, doc, src);
    if (!r) { skipped++; return; }
    const iso = tl.versions[r.v][1];
    // chart: the last version of each week, plus every version in the last 120 days
    if (prevDoc && (weekKey(prevIso) !== weekKey(iso) || prevIso >= recentCut)) { const s = summarize(prevDoc); snapshots.push({ t: s.t, sync: s.sync, v4p: s.v4p, v6p: s.v6p, v4a: s.v4a, regions: s.regions }); }
    const day = iso.slice(0, 10);
    for (const e of doc.prefixes.concat(doc.ipv6_prefixes || [])) { regionsFirstSeen[e.region] ??= day; servicesFirstSeen[e.service] ??= day; }
    prevDoc = doc; prevIso = iso;
  };

  // (1) archive months before the git history starts
  const blobs = blobList();
  let firstJoe = null;
  {
    const it = catBlobs(blobs.slice(0, 1));
    for await (const text of it) firstJoe = JSON.parse(text);
  }
  const wb = (await fs.readdir(WB).catch(() => [])).filter((f) => f.endsWith('.json')).sort();
  for (const f of wb) {
    try {
      const doc = JSON.parse(await fs.readFile(path.join(WB, f), 'utf8'));
      if (Number(doc.syncToken) < Number(firstJoe.syncToken)) take(doc, 'w');
    } catch { bad++; }
  }
  console.log(`archive versions: ${tl.versions.length}`);

  // (2) every git version
  let n = 0;
  for await (const text of catBlobs(blobs)) {
    n++;
    try { take(JSON.parse(text), 'j'); } catch { bad++; }
    if (n % 500 === 0) console.log(`git ${n}/${blobs.length} versions=${tl.versions.length} entries=${Object.keys(tl.entries).length} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }

  // (3) the live file, if newer
  const live = JSON.parse(await fs.readFile(path.join(DATA, 'ip-ranges.json'), 'utf8'));
  take(live, 'l');
  if (prevDoc) { const s = summarize(prevDoc); snapshots.push({ t: s.t, sync: s.sync, v4p: s.v4p, v6p: s.v6p, v4a: s.v4a, regions: s.regions }); }

  await fs.writeFile(path.join(DATA, 'timeline.json'), stringifyTimeline(tl));
  await fs.writeFile(path.join(DATA, 'history.json'), stringifyHistory({ source: 'Archive monthly 2015-11 to 2017-07, then every version (weekly points for the chart, all points for the last 120 days)', regionsFirstSeen, servicesFirstSeen, snapshots }));
  const spans = Object.values(tl.entries).reduce((a, s) => a + s.length / 2, 0);
  console.log(`done in ${((Date.now() - t0) / 1000).toFixed(0)}s: versions=${tl.versions.length} (archive ${tl.versions.filter((v) => v[2] === 'w').length}, git ${tl.versions.filter((v) => v[2] === 'j').length}, live ${tl.versions.filter((v) => v[2] === 'l').length}) entries=${Object.keys(tl.entries).length} spans=${spans} snapshots=${snapshots.length} skipped=${skipped} bad=${bad}`);
  console.log(`first=${tl.versions[0][1]} last=${tl.versions[tl.versions.length - 1][1]}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
