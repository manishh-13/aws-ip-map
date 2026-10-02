import test from 'node:test';
import assert from 'node:assert/strict';
import { d2xy, xy2d } from '../src/lib/hilbert.js';
import { buildCells, MAP_SIDE } from '../src/lib/map.js';
import { summarize, diffDocs, groupByPrefix, updatePrefixHistory, createDateToISO } from '../src/lib/stats.js';
import { stringifyLines, stringifyHistory } from '../src/lib/jsonlines.js';
import { thin } from '../scripts/update.mjs';

const doc = (sync, prefixes, v6 = []) => ({ syncToken: String(sync), createDate: '2026-10-02-12-17-06', prefixes, ipv6_prefixes: v6 });
const p4 = (ip_prefix, region, service, nbg = region) => ({ ip_prefix, region, service, network_border_group: nbg });

test('hilbert round-trips and keeps neighbours adjacent', () => {
  for (const n of [16, 1024]) {
    for (let d = 0; d < Math.min(n * n, 50000); d += 7) {
      const [x, y] = d2xy(n, d);
      assert.equal(xy2d(n, x, y), d);
    }
    for (let d = 0; d < Math.min(n * n - 1, 4096); d++) {
      const [x1, y1] = d2xy(n, d), [x2, y2] = d2xy(n, d + 1);
      assert.equal(Math.abs(x1 - x2) + Math.abs(y1 - y2), 1);
    }
  }
});

test('/8 blocks map to 64x64 squares on the 1024 map', () => {
  const xs = new Set(), ys = new Set();
  for (let d = 52 * 4096; d < 53 * 4096; d++) { const [x, y] = d2xy(MAP_SIDE, d); xs.add(x >> 6); ys.add(y >> 6); }
  assert.equal(xs.size, 1); assert.equal(ys.size, 1);
});

test('buildCells marks full and partial /20 pixels', () => {
  const cells = buildCells([{ cidr: '52.0.0.0/19', ri: 3 }, { cidr: '52.0.64.0/24', ri: 1 }]);
  const d = 52 * 4096;
  assert.equal(cells[d], 3 * 2 + 1);
  assert.equal(cells[d + 1], 3 * 2 + 1);
  assert.equal(cells[d + 2], 0);
  assert.equal(cells[d + 4], 1 * 2 + 2);
});

test('summarize counts unique addresses per region and service', () => {
  const s = summarize(doc(1, [p4('3.0.0.0/24', 'us-east-1', 'AMAZON'), p4('3.0.0.0/24', 'us-east-1', 'EC2'), p4('3.0.1.0/24', 'eu-west-1', 'S3')], [{ ipv6_prefix: '2600::/32', region: 'us-east-1', service: 'AMAZON', network_border_group: 'us-east-1' }]));
  assert.equal(s.v4a, 512);
  assert.equal(s.regions['us-east-1'], 256);
  assert.equal(s.services.EC2, 256);
  assert.equal(s.regionCounts['us-east-1'].v6p, 1);
  assert.equal(s.t, '2026-10-02T12:17:06Z');
  assert.equal(groupByPrefix(doc(1, [p4('3.0.0.0/24', 'us-east-1', 'AMAZON'), p4('3.0.0.0/24', 'us-east-1', 'EC2')]))[0].services.join(), 'AMAZON,EC2');
});

test('diffDocs reports added and removed entries', () => {
  const a = doc(1, [p4('3.0.0.0/24', 'us-east-1', 'EC2'), p4('3.0.1.0/24', 'us-east-1', 'EC2')]);
  const b = doc(2, [p4('3.0.1.0/24', 'us-east-1', 'EC2'), p4('3.0.2.0/24', 'ap-south-1', 'S3')]);
  const { added, removed } = diffDocs(a, b);
  assert.deepEqual(added.map((e) => e.cidr), ['3.0.2.0/24']);
  assert.deepEqual(removed.map((e) => e.cidr), ['3.0.0.0/24']);
});

test('prefix history tracks first and last seen', () => {
  const h = {};
  updatePrefixHistory(h, doc(1, [p4('3.0.0.0/24', 'us-east-1', 'EC2')]), '2020-01-01');
  updatePrefixHistory(h, doc(2, [p4('3.0.0.0/24', 'us-west-2', 'EC2')]), '2021-01-01');
  assert.deepEqual(h['3.0.0.0/24'], { f: '2020-01-01', l: '2021-01-01', r: 'us-west-2', s: ['EC2'] });
});

test('thin keeps recent snapshots and one per older month', () => {
  const now = Date.parse('2026-10-02T00:00:00Z');
  const snaps = ['2025-01-03', '2025-01-20', '2025-02-10', '2026-09-01', '2026-09-02'].map((d) => ({ t: `${d}T00:00:00Z` }));
  assert.deepEqual(thin(snaps, now).map((s) => s.t.slice(0, 10)), ['2025-01-20', '2025-02-10', '2026-09-01', '2026-09-02']);
});

test('line-oriented JSON round-trips', () => {
  const v = { a: [1, 2], 'b/c': { d: 1 } };
  assert.deepEqual(JSON.parse(stringifyLines(v)), v);
  assert.deepEqual(JSON.parse(stringifyLines([])), []);
  assert.deepEqual(JSON.parse(stringifyHistory({ snapshots: [{ t: 1 }] })), { snapshots: [{ t: 1 }] });
  assert.deepEqual(JSON.parse(stringifyHistory({ x: 1, snapshots: [] })), { x: 1, snapshots: [] });
  assert.equal(createDateToISO('bad'), null);
});
