// Server-rendered SVG charts (no client JS needed to see them).
import { GEOS, geoOf } from '../src/lib/regions.js';
import { esc } from './templates.mjs';

const W = 960, H = 340, PAD = { l: 56, r: 16, t: 16, b: 34 };

function scales(points, maxY) {
  const t0 = Date.parse(points[0].t), t1 = Date.parse(points[points.length - 1].t);
  const x = (t) => PAD.l + ((Date.parse(t) - t0) / Math.max(1, t1 - t0)) * (W - PAD.l - PAD.r);
  const y = (v) => H - PAD.b - (v / maxY) * (H - PAD.t - PAD.b);
  return { x, y, t0, t1 };
}

function niceMax(v) {
  const p = 10 ** Math.floor(Math.log10(v));
  const step = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((m) => m * p >= v * 1.04);
  return step * p;
}

function axes({ x, y, t0, t1 }, maxY, unit) {
  let out = '';
  for (let i = 0; i <= 4; i++) {
    const v = (maxY / 4) * i, yy = y(v);
    out += `<line class="grid" x1="${PAD.l}" x2="${W - PAD.r}" y1="${yy}" y2="${yy}"/>`;
    out += `<text class="tick" x="${PAD.l - 8}" y="${yy + 4}" text-anchor="end">${unit(v)}</text>`;
  }
  const y0 = new Date(t0).getUTCFullYear(), y1 = new Date(t1).getUTCFullYear();
  for (let yr = y0 + 1; yr <= y1; yr++) {
    const xx = x(`${yr}-01-01T00:00:00Z`);
    out += `<text class="tick" x="${xx}" y="${H - 10}" text-anchor="middle">${yr}</text>`;
  }
  return out;
}

const millions = (v) => (v === 0 ? '0' : `${Math.round(v / 1e6)}M`);

export function growthChart(snapshots) {
  const order = GEOS.map((g) => g.id);
  const pts = snapshots.map((s) => {
    const by = Object.fromEntries(order.map((g) => [g, 0]));
    for (const [r, a] of Object.entries(s.regions || {})) by[geoOf(r)] += a;
    return { t: s.t, by, total: s.v4a };
  });
  // stacked sums can exceed the de-duplicated total (GLOBAL overlaps); scale on the stack
  const maxStack = Math.max(...pts.map((p) => order.reduce((a, g) => a + p.by[g], 0)));
  const maxY = niceMax(maxStack);
  const sc = scales(pts, maxY);
  let acc = pts.map(() => 0);
  let areas = '';
  for (const g of order) {
    const lower = acc.slice();
    const upper = acc.map((a, i) => a + pts[i].by[g]);
    const top = pts.map((p, i) => `${sc.x(p.t).toFixed(1)},${sc.y(upper[i]).toFixed(1)}`);
    const bottom = pts.map((p, i) => `${sc.x(p.t).toFixed(1)},${sc.y(lower[i]).toFixed(1)}`).reverse();
    areas += `<path class="area geo-${g}" data-geo="${g}" d="M${top.join('L')}L${bottom.join('L')}Z"/>`;
    acc = upper;
  }
  const data = pts.map((p) => ({ t: p.t, by: p.by, total: p.total }));
  return `<div class="chart" data-chart='${esc(JSON.stringify(data))}'>
<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Stacked area chart of AWS public IPv4 addresses by geography, ${esc(pts[0].t.slice(0, 7))} to ${esc(pts[pts.length - 1].t.slice(0, 7))}">
${axes(sc, maxY, millions)}${areas}<line class="cursor" y1="${PAD.t}" y2="${H - PAD.b}" x1="-10" x2="-10"/>
</svg><div class="chart-tip" hidden></div></div>`;
}

export function lineChart(points, label) {
  if (points.length < 2) return '';
  const maxY = niceMax(Math.max(1, ...points.map((p) => p.v)));
  const sc = scales(points, maxY);
  const unit = (v) => (v === 0 ? '0' : maxY >= 2e6 ? `${+(v / 1e6).toFixed(1)}M` : maxY >= 2000 ? `${+(v / 1e3).toFixed(1)}k` : String(Math.round(v)));
  const line = points.map((p) => `${sc.x(p.t).toFixed(1)},${sc.y(p.v).toFixed(1)}`).join('L');
  const area = `M${sc.x(points[0].t).toFixed(1)},${sc.y(0)}L${line}L${sc.x(points[points.length - 1].t).toFixed(1)},${sc.y(0)}Z`;
  return `<div class="chart small" data-chart='${esc(JSON.stringify(points.map((p) => ({ t: p.t, total: p.v }))))}'>
<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">${axes(sc, maxY, unit)}<path class="single-area" d="${area}"/><path class="single-line" d="M${line}"/><line class="cursor" y1="${PAD.t}" y2="${H - PAD.b}" x1="-10" x2="-10"/></svg><div class="chart-tip" hidden></div></div>`;
}
