// Fetch the live ip-ranges.json. If the syncToken is newer, append it to the timeline and the chart history.
// Prints changed=true|false (and writes it to $GITHUB_OUTPUT in CI).
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { summarize } from '../src/lib/stats.js';
import { emptyTimeline, appendVersion, stringifyTimeline } from '../src/lib/timeline.js';
import { stringifyHistory } from '../src/lib/jsonlines.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DATA = process.env.DATA_DIR || path.join(ROOT, 'data');
const D = (f) => path.join(DATA, f);
const SOURCE = process.env.IP_RANGES_URL || 'https://ip-ranges.amazonaws.com/ip-ranges.json';
const readJSON = async (f, fallback) => JSON.parse(await fs.readFile(f, 'utf8').catch(() => JSON.stringify(fallback)));

async function output(changed, extra = '') {
  console.log(`changed=${changed}${extra}`);
  if (process.env.GITHUB_OUTPUT) await fs.appendFile(process.env.GITHUB_OUTPUT, `changed=${changed}\n`);
}

/** Keep every snapshot from the last 120 days, then one per ISO week before that. */
export function thin(snapshots, now = Date.now()) {
  const cutoff = new Date(now - 120 * 864e5).toISOString();
  const weeks = new Map();
  const recent = [];
  for (const s of snapshots) {
    if (s.t >= cutoff) { recent.push(s); continue; }
    const d = new Date(s.t); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    weeks.set(d.toISOString().slice(0, 10), s);
  }
  return [...weeks.values(), ...recent];
}

async function main() {
  const res = await fetch(SOURCE, { headers: { 'user-agent': 'aws-ip-map (github.com/manishh-13/aws-ip-map)' } });
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
  const text = await res.text();
  const next = JSON.parse(text);
  if (!next.syncToken || !Array.isArray(next.prefixes)) throw new Error('unexpected document shape');

  await fs.mkdir(DATA, { recursive: true });
  const tl = await readJSON(D('timeline.json'), emptyTimeline());
  const last = tl.versions[tl.versions.length - 1];
  const current = await readJSON(D('ip-ranges.json'), null);
  const fileIsCurrent = current && String(current.syncToken) === String(next.syncToken);
  if (last && Number(next.syncToken) <= Number(last[0])) {
    // the timeline already has this version (for example from an imported history); only refresh the mirror if it lags
    if (fileIsCurrent || Number(next.syncToken) < Number(last[0])) return output(false);
    await fs.writeFile(D('ip-ranges.json'), text);
    return output(true, ` sync=${next.syncToken} (mirror refreshed, timeline already had it)`);
  }
  const r = appendVersion(tl, next, 'l');

  const s = summarize(next);
  const history = await readJSON(D('history.json'), { snapshots: [], regionsFirstSeen: {}, servicesFirstSeen: {} });
  history.snapshots = thin([...history.snapshots.filter((x) => x.sync !== s.sync), { t: s.t, sync: s.sync, v4p: s.v4p, v6p: s.v6p, v4a: s.v4a, regions: s.regions }].sort((a, b) => a.t.localeCompare(b.t)));
  const day = s.t.slice(0, 10);
  for (const k of Object.keys(s.regionCounts)) history.regionsFirstSeen[k] ??= day;
  for (const k of Object.keys(s.serviceCounts)) history.servicesFirstSeen[k] ??= day;

  await fs.writeFile(D('timeline.json'), stringifyTimeline(tl));
  await fs.writeFile(D('history.json'), stringifyHistory(history));
  await fs.writeFile(D('ip-ranges.json'), text);
  const md5 = crypto.createHash('md5').update(text).digest('hex');
  await output(true, ` sync=${s.sync} added=${r.added.length} removed=${r.removed.length} md5=${md5}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });
