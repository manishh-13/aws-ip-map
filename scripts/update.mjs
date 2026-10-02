// Fetch the live ip-ranges.json. If the syncToken changed, record the diff and history.
// Exit code 0 always; prints changed=true|false (and writes it to $GITHUB_OUTPUT in CI).
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { summarize, diffDocs, updatePrefixHistory } from '../src/lib/stats.js';
import { stringifyLines, stringifyHistory } from '../src/lib/jsonlines.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DATA = process.env.DATA_DIR || path.join(ROOT, 'data');
const D = (f) => path.join(DATA, f);
const SOURCE = process.env.IP_RANGES_URL || 'https://ip-ranges.amazonaws.com/ip-ranges.json';
const readJSON = async (f, fallback) => JSON.parse(await fs.readFile(f, 'utf8').catch(() => JSON.stringify(fallback)));
const MAX_EVENTS = 400;

async function output(changed, extra = '') {
  console.log(`changed=${changed}${extra}`);
  if (process.env.GITHUB_OUTPUT) await fs.appendFile(process.env.GITHUB_OUTPUT, `changed=${changed}\n`);
}

/** Keep every snapshot from the last 120 days, then one per month before that. */
export function thin(snapshots, now = Date.now()) {
  const cutoff = new Date(now - 120 * 864e5).toISOString();
  const months = new Map();
  const recent = [];
  for (const s of snapshots) {
    if (s.t >= cutoff) recent.push(s);
    else months.set(s.t.slice(0, 7), s);
  }
  return [...months.values(), ...recent];
}

async function main() {
  const res = await fetch(SOURCE, { headers: { 'user-agent': 'aws-ip-atlas (github.com/manishh-13/aws-ip-atlas)' } });
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
  const text = await res.text();
  const next = JSON.parse(text);
  if (!next.syncToken || !Array.isArray(next.prefixes)) throw new Error('unexpected document shape');

  await fs.mkdir(DATA, { recursive: true });
  const prev = await readJSON(D('ip-ranges.json'), null);
  if (prev && String(prev.syncToken) === String(next.syncToken)) return output(false);
  if (prev && Number(next.syncToken) < Number(prev.syncToken)) return output(false, ' (older token, ignored)');

  const summary = summarize(next);
  const day = summary.t.slice(0, 10);

  if (prev) {
    const { added, removed } = diffDocs(prev, next);
    const changes = await readJSON(D('changes.json'), []);
    changes.unshift({
      sync: summary.sync, t: summary.t, prevSync: String(prev.syncToken),
      added: added.map((e) => [e.cidr, e.region, e.nbg, e.service]),
      removed: removed.map((e) => [e.cidr, e.region, e.nbg, e.service]),
    });
    await fs.writeFile(D('changes.json'), stringifyLines(changes.slice(0, MAX_EVENTS)));
  }

  const history = await readJSON(D('history.json'), { snapshots: [], regionsFirstSeen: {}, servicesFirstSeen: {} });
  history.snapshots = thin([...history.snapshots.filter((s) => s.sync !== summary.sync),
    { t: summary.t, sync: summary.sync, v4p: summary.v4p, v6p: summary.v6p, v4a: summary.v4a, regions: summary.regions }]
    .sort((a, b) => a.t.localeCompare(b.t)));
  for (const r of Object.keys(summary.regionCounts)) history.regionsFirstSeen[r] ??= day;
  for (const s of Object.keys(summary.serviceCounts)) history.servicesFirstSeen[s] ??= day;
  await fs.writeFile(D('history.json'), stringifyHistory(history));

  const ph = await readJSON(D('prefix-history.json'), {});
  await fs.writeFile(D('prefix-history.json'), stringifyLines(updatePrefixHistory(ph, next, day)));

  await fs.writeFile(D('ip-ranges.json'), text);
  const md5 = crypto.createHash('md5').update(text).digest('hex');
  await output(true, ` sync=${summary.sync} md5=${md5}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });
