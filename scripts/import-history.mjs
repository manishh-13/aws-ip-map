// Rebuild the full history by merging every public record of ip-ranges.json, matched on AWS's own createDate:
//   s  github.com/seligman/aws-ip-ranges  yearly archives in history/YYYY.tar.gz (SNS-triggered since Jul 2020, backfilled to 2015)
//   j  github.com/joetek/aws-ip-ranges-json  every commit of ip-ranges.json (2017-07 onward)
//   w  Internet Archive captures (.cache/wayback, from scripts/backfill-wayback.mjs)
//   l  the current data/ip-ranges.json
// Writes data/timeline.json (every entry's lifetime) and data/history.json (chart snapshots, first-seen dates).
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { summarize } from '../src/lib/stats.js';
import { emptyTimeline, appendVersion, stringifyTimeline } from '../src/lib/timeline.js';
import { stringifyHistory } from '../src/lib/jsonlines.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CACHE = path.join(ROOT, '.cache');
const JOE = path.join(CACHE, 'joetek'), SEL = path.join(CACHE, 'seligman'), WB = path.join(CACHE, 'wayback');
const DATA = process.env.DATA_DIR || path.join(ROOT, 'data');
const SELIGMAN_RAW = 'https://raw.githubusercontent.com/seligman/aws-ip-ranges/master/history';
const CD = /"createDate"\s*:\s*"(\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2})"/;

async function ensureSources() {
  try { await fs.access(path.join(JOE, '.git')); } catch {
    console.log('cloning github.com/joetek/aws-ip-ranges-json (about 150 MB)...');
    execFileSync('git', ['clone', '--quiet', 'https://github.com/joetek/aws-ip-ranges-json.git', JOE], { stdio: 'inherit' });
  }
  await fs.mkdir(SEL, { recursive: true });
  for (let y = 2015; y <= new Date().getUTCFullYear(); y++) { // the current year 404s until seligman archives it
    const f = path.join(SEL, `${y}.tar.gz`);
    try { await fs.access(f); } catch {
      console.log(`downloading seligman ${y}.tar.gz...`);
      const res = await fetch(`${SELIGMAN_RAW}/${y}.tar.gz`);
      if (res.ok) await fs.writeFile(f, Buffer.from(await res.arrayBuffer()));
    }
  }
}

function gitBlobs() {
  const out = execFileSync('git', ['-C', JOE, 'log', '--reverse', '--format=C %H', '--raw', '--no-abbrev', '--', 'ip-ranges.json'], { maxBuffer: 1 << 28 }).toString();
  return out.split('\n').filter((l) => l.startsWith(':')).map((l) => l.split(/\s+/)[3]).filter((b) => b && !/^0+$/.test(b));
}
async function* catBlobs(hashes) {
  const p = spawn('git', ['-C', JOE, 'cat-file', '--batch'], { stdio: ['pipe', 'pipe', 'inherit'] });
  (async () => { for (const h of hashes) { if (!p.stdin.write(h + '\n')) await new Promise((r) => p.stdin.once('drain', r)); } p.stdin.end(); })();
  let buf = Buffer.alloc(0);
  for await (const chunk of p.stdout) {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    for (;;) {
      const nl = buf.indexOf(10); if (nl < 0) break;
      const header = buf.subarray(0, nl).toString(), size = Number(header.split(' ')[2]);
      if (!Number.isFinite(size)) throw new Error('git cat-file: ' + header); // e.g. '<hash> missing'
      if (buf.length < nl + 1 + size + 1) break;
      yield buf.subarray(nl + 1, nl + 1 + size).toString();
      buf = buf.subarray(nl + 1 + size + 1);
    }
  }
}
const weekKey = (iso) => { const d = new Date(iso); const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7)); return t.toISOString().slice(0, 10); };

async function main() {
  const t0 = Date.now();
  await ensureSources();

  // ---- pass 1: index every source by createDate (first source wins: joetek, then seligman, then archive) ----
  const loc = new Map(); // createDate -> {src, blob?|file?}
  const blobs = gitBlobs();
  let i = 0, jBad = 0;
  for await (const text of catBlobs(blobs)) {
    const m = CD.exec(text.slice(0, 300)) || CD.exec(text.slice(0, 4096)); const b = blobs[i++];
    if (!m || text.length < 1000) { jBad++; continue; }
    if (!loc.has(m[1])) loc.set(m[1], { src: 'j', blob: b });
  }
  console.log(`joetek: ${blobs.length} blobs, ${jBad} empty or broken, ${[...loc.values()].filter((x) => x.src === 'j').length} versions (${((Date.now() - t0) / 1000).toFixed(0)}s)`);

  const tars = (await fs.readdir(SEL)).filter((f) => /^\d{4}\.tar\.gz$/.test(f)).sort();
  const xdir = path.join(SEL, 'x');
  let sNew = 0, sAll = 0;
  for (const t of tars) {
    const members = execFileSync('tar', ['tzf', path.join(SEL, t)], { maxBuffer: 1 << 26 }).toString().split('\n').filter((n) => n.endsWith('.json'));
    const need = [];
    for (const m of members) {
      const cd = path.basename(m, '.json');
      if (!/^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}$/.test(cd)) continue;
      sAll++;
      if (!loc.has(cd)) { need.push(m); loc.set(cd, { src: 's', file: path.join(xdir, m) }); sNew++; }
    }
    if (need.length) { await fs.mkdir(xdir, { recursive: true }); execFileSync('tar', ['xzf', path.join(SEL, t), '-C', xdir, ...need], { maxBuffer: 1 << 26 }); }
  }
  console.log(`seligman: ${sAll} versions in ${tars.length} archives, ${sNew} not in joetek`);

  let wNew = 0;
  for (const f of (await fs.readdir(WB).catch(() => [])).filter((x) => x.endsWith('.json'))) {
    const text = await fs.readFile(path.join(WB, f), 'utf8'); const m = CD.exec(text.slice(0, 300)) || CD.exec(text.slice(0, 4096));
    if (m && !loc.has(m[1])) { loc.set(m[1], { src: 'w', file: path.join(WB, f) }); wNew++; }
  }
  console.log(`archive: ${wNew} versions not in either git source`);

  // ---- pass 2: replay every version in AWS's own order ----
  const order = [...loc.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const gitOrder = order.filter(([, x]) => x.src === 'j').map(([, x]) => x.blob);
  const gitIt = catBlobs(gitOrder)[Symbol.asyncIterator]();
  const tl = emptyTimeline();
  tl.sources = {
    s: 'github.com/seligman/aws-ip-ranges (SNS-triggered since Jul 2020; 2015 to 2020 from its archive of occasional captures)',
    j: 'github.com/joetek/aws-ip-ranges-json (every git commit of ip-ranges.json, polled since Jul 2017)',
    w: 'Internet Archive captures of ip-ranges.json',
    l: 'Fetched live from ip-ranges.amazonaws.com by this site',
  };
  const snapshots = [], regionsFirstSeen = {}, servicesFirstSeen = {};
  const recentCut = new Date(Date.now() - 120 * 864e5).toISOString();
  let prevDoc = null, prevIso = null, skipped = 0, bad = 0, n = 0;
  const take = (doc, src) => {
    const r = appendVersion(tl, doc, src);
    if (!r) {
      // the same version again (one syncToken, a differently formatted createDate, as AWS served in Jul 2017): credit joetek if it has it too
      const last = tl.versions[tl.versions.length - 1];
      if (last && last[0] === String(doc.syncToken) && src === 'j') last[2] = 'j';
      skipped++; return;
    }
    const iso = tl.versions[r.v][1];
    if (prevDoc && (weekKey(prevIso) !== weekKey(iso) || prevIso >= recentCut)) { const s = summarize(prevDoc); snapshots.push({ t: s.t || prevIso, sync: s.sync, v4p: s.v4p, v6p: s.v6p, v4a: s.v4a, regions: s.regions }); }
    const day = iso.slice(0, 10);
    for (const e of doc.prefixes.concat(doc.ipv6_prefixes || [])) { regionsFirstSeen[e.region] ??= day; servicesFirstSeen[e.service] ??= day; }
    prevDoc = doc; prevIso = iso;
  };
  for (const [, x] of order) {
    let text;
    if (x.src === 'j') { const r = await gitIt.next(); if (r.done) throw new Error('joetek blobs ran out before the replay did'); text = r.value; } else text = await fs.readFile(x.file, 'utf8');
    try { const doc = JSON.parse(text); if (!Array.isArray(doc.prefixes)) throw new Error('shape'); take(doc, x.src); } catch { bad++; }
    if (++n % 1000 === 0) console.log(`replayed ${n}/${order.length} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }
  const live = JSON.parse(await fs.readFile(path.join(DATA, 'ip-ranges.json'), 'utf8'));
  take(live, 'l');
  if (prevDoc) { const s = summarize(prevDoc); snapshots.push({ t: s.t || prevIso, sync: s.sync, v4p: s.v4p, v6p: s.v6p, v4a: s.v4a, regions: s.regions }); }

  await fs.writeFile(path.join(DATA, 'timeline.json'), stringifyTimeline(tl));
  await fs.writeFile(path.join(DATA, 'history.json'), stringifyHistory({ source: 'Merged: seligman/aws-ip-ranges, joetek/aws-ip-ranges-json, Internet Archive, live (weekly chart points, all points for the last 120 days)', regionsFirstSeen, servicesFirstSeen, snapshots }));
  const by = (s) => tl.versions.filter((v) => v[2] === s).length;
  console.log(`done in ${((Date.now() - t0) / 1000).toFixed(0)}s: versions=${tl.versions.length} (joetek ${by('j')}, seligman ${by('s')}, archive ${by('w')}, live ${by('l')}) entries=${Object.keys(tl.entries).length} snapshots=${snapshots.length} skipped=${skipped} bad=${bad}`);
  console.log(`first=${tl.versions[0][1]} last=${tl.versions[tl.versions.length - 1][1]}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
