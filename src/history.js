// History page: an IP's full history, the ranges on any date, and compare two dates. Loaded only on /history/.
import { parseTarget } from './lib/ip.js';

const BASE = document.body.dataset.base || '/';
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (n) => Number(n).toLocaleString('en-US');
const day = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const slug = (s) => s.toLowerCase().replace(/_/g, '-');

let dataP;
function load() {
  dataP ??= fetch(`${BASE}data/timeline.min.json`).then((r) => r.json()).then((d) => {
    d.E = d.e.map((row) => ({ cidr: row[0], r: d.regions[row[1]], n: d.nbgs[row[2]], s: d.services[row[3]], spans: row.slice(4) }));
    return d;
  });
  return dataP;
}
const present = (spans, v) => { for (let i = 0; i < spans.length; i += 2) if (spans[i] <= v && (spans[i + 1] === -1 || v < spans[i + 1])) return true; return false; };
function versionAt(d, iso) { let lo = 0, hi = d.versions.length - 1, ans = 0; while (lo <= hi) { const m = (lo + hi) >> 1; if (d.versions[m][1] <= iso) { ans = m; lo = m + 1; } else hi = m - 1; } return ans; }
const endOfDay = (dayStr) => `${dayStr}T23:59:59Z`;
const srcName = { w: 'monthly archive capture', j: 'recorded version', l: 'live fetch' };
function download(name, text, type = 'text/plain') {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function busy(out, msg) { out.innerHTML = `<p class="muted">${esc(msg)}</p>`; }

// ---------- 1. an IP's full history ----------
async function ipHistory(q) {
  const out = $('[data-out="ip"]');
  const t = parseTarget(q);
  if (!t) { out.innerHTML = `<div class="verdict no"><p class="v-head"><span class="dot"></span>That isn't an IP address or CIDR</p><p>Try something like 52.95.110.1 or 3.5.140.0/22.</p></div>`; return; }
  busy(out, 'Loading the full history...');
  const d = await load();
  d.E.forEach((e) => { e.t ??= parseTarget(e.cidr); });
  const hits = d.E.filter((e) => e.t && e.t.v === t.v && e.t.start <= t.start && e.t.end >= t.end);
  if (!hits.length) { out.innerHTML = `<div class="verdict no"><p class="v-head"><span class="dot"></span><code>${esc(q)}</code> has never been in AWS's published ranges</p><p>Not listed in any of the ${fmt(d.versions.length)} versions since ${day(d.versions[0][1])}.</p></div>`; return; }
  // group spans by (cidr, region, nbg, span) and merge services
  const rows = new Map();
  for (const e of hits) for (let i = 0; i < e.spans.length; i += 2) {
    const k = `${e.cidr}|${e.r}|${e.n}|${e.spans[i]}|${e.spans[i + 1]}`;
    const row = rows.get(k) || { cidr: e.cidr, len: e.t.len, r: e.r, n: e.n, a: e.spans[i], b: e.spans[i + 1], s: new Set() };
    row.s.add(e.s); rows.set(k, row);
  }
  const list = [...rows.values()].sort((x, y) => x.a - y.a || y.len - x.len);
  const t0 = Date.parse(d.versions[0][1]), t1 = Date.now();
  const pos = (v) => ((Date.parse(v === -1 ? new Date().toISOString() : d.versions[v][1]) - t0) / (t1 - t0)) * 100;
  const nowListed = list.some((r) => r.b === -1);
  const firstV = Math.min(...list.map((r) => r.a));
  const years = []; for (let y = new Date(t0).getUTCFullYear() + 1; y <= new Date(t1).getUTCFullYear(); y++) years.push(y);
  out.innerHTML = `<div class="verdict ${nowListed ? 'yes' : 'no'}"><p class="v-head"><span class="dot"></span><code>${esc(q)}</code> ${nowListed ? 'is AWS today' : 'is not AWS today'}</p>
  <p>First listed ${firstV === 0 ? `before ${day(d.versions[0][1])}` : `on ${day(d.versions[firstV][1])}`}. ${list.length} listing${list.length === 1 ? '' : 's'} across ${new Set(list.map((r) => r.cidr)).size} prefix${new Set(list.map((r) => r.cidr)).size === 1 ? '' : 'es'}.</p></div>
  <div class="gantt" role="table" aria-label="Listing timeline">
    <div class="g-axis" aria-hidden="true">${years.map((y) => `<span style="left:${((Date.UTC(y, 0, 1) - t0) / (t1 - t0)) * 100}%">${y}</span>`).join('')}</div>
    ${list.map((r) => `<div class="g-row" role="row"><div class="g-label" role="cell"><code>${esc(r.cidr)}</code> <a class="rlink" href="${BASE}regions/${esc(r.r)}/">${esc(r.r)}</a> ${[...r.s].sort().map((s) => `<a class="tag" href="${BASE}services/${slug(s)}/">${esc(s)}</a>`).join('')}</div>
      <div class="g-track" role="cell"><span class="g-bar${r.b === -1 ? ' open' : ''}" style="left:${pos(r.a)}%;width:${Math.max(0.6, pos(r.b) - pos(r.a))}%"></span></div>
      <div class="g-dates" role="cell">${r.a === 0 ? `before ${day(d.versions[0][1])}` : day(d.versions[r.a][1])} to ${r.b === -1 ? 'today' : day(d.versions[r.b][1])}</div></div>`).join('')}
  </div>`;
}

// ---------- 2. the ranges on any date ----------
async function onDate(dayStr, service, region) {
  const out = $('[data-out="date"]');
  busy(out, 'Rebuilding...');
  const d = await load();
  const v = versionAt(d, endOfDay(dayStr));
  const [sync, iso, src] = d.versions[v];
  const list = d.E.filter((e) => (!service || e.s === service) && (!region || e.r === region) && present(e.spans, v));
  const v4 = list.filter((e) => !e.cidr.includes(':')), v6 = list.filter((e) => e.cidr.includes(':'));
  const cd = iso.replace('T', '-').replace(/:/g, '-').replace('Z', '');
  const doc = { syncToken: sync, createDate: cd, prefixes: v4.map((e) => ({ ip_prefix: e.cidr, region: e.r, service: e.s, network_border_group: e.n })), ipv6_prefixes: v6.map((e) => ({ ipv6_prefix: e.cidr, region: e.r, service: e.s, network_border_group: e.n })) };
  const tag = `${dayStr}${service ? `-${slug(service)}` : ''}${region ? `-${region}` : ''}`;
  const files = {
    json: [`ip-ranges-${tag}.json`, () => JSON.stringify(doc, null, 2), 'application/json'],
    v4: [`ipv4-${tag}.txt`, () => [...new Set(v4.map((e) => e.cidr))].join('\n') + '\n'],
    v6: [`ipv6-${tag}.txt`, () => [...new Set(v6.map((e) => e.cidr))].join('\n') + '\n'],
    csv: [`ranges-${tag}.csv`, () => ['prefix,region,network_border_group,service', ...list.map((e) => `${e.cidr},${e.r},${e.n},${e.s}`)].join('\n') + '\n', 'text/csv'],
  };
  out.innerHTML = `<div class="verdict yes"><p class="v-head"><span class="dot"></span>${day(iso)} <span class="muted">${iso.slice(11, 16)} UTC</span></p>
  <dl class="hit"><div><dt>Version</dt><dd><code>syncToken ${esc(sync)}</code> <span class="muted">${srcName[src] || ''}</span></dd></div>
  <div><dt>IPv4 entries</dt><dd>${fmt(v4.length)} <span class="muted">${fmt(new Set(v4.map((e) => e.cidr)).size)} unique prefixes</span></dd></div>
  <div><dt>IPv6 entries</dt><dd>${fmt(v6.length)} <span class="muted">${fmt(new Set(v6.map((e) => e.cidr)).size)} unique prefixes</span></dd></div></dl>
  <p class="dl-row">${Object.entries({ json: 'ip-ranges.json', v4: 'IPv4 .txt', v6: 'IPv6 .txt', csv: 'CSV' }).map(([k, l]) => `<button type="button" class="btn ghost" data-dl="${k}">${l}</button>`).join('')}</p></div>`;
  out.querySelectorAll('[data-dl]').forEach((b) => b.addEventListener('click', () => { const [n, f, ty] = files[b.dataset.dl]; download(n, f(), ty); }));
}

// ---------- 3. compare two dates ----------
async function compare(fromIso, toIso, service) {
  const out = $('[data-out="compare"]');
  busy(out, 'Comparing...');
  const d = await load();
  const a = versionAt(d, fromIso), b = versionAt(d, toIso);
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  const pool = service ? d.E.filter((e) => e.s === service) : d.E;
  const added = [], removed = [];
  for (const e of pool) { const x = present(e.spans, lo), y = present(e.spans, hi); if (!x && y) added.push(e); else if (x && !y) removed.push(e); }
  const group = (l) => { const m = {}; for (const e of l) { const k = `${e.s} in ${e.r}`; m[k] = (m[k] || 0) + 1; } return Object.entries(m).sort((p, q) => q[1] - p[1]); };
  const ga = group(added), gr = group(removed);
  const csv = ['change,prefix,region,network_border_group,service', ...added.map((e) => `added,${e.cidr},${e.r},${e.n},${e.s}`), ...removed.map((e) => `removed,${e.cidr},${e.r},${e.n},${e.s}`)].join('\n') + '\n';
  out.innerHTML = `<div class="verdict ${added.length || removed.length ? 'yes' : 'no'}"><p class="v-head"><span class="dot"></span><span class="pos">+${fmt(added.length)}</span> <span class="neg">-${fmt(removed.length)}</span> <span class="muted">entries</span></p>
  <p>From ${day(d.versions[lo][1])} (syncToken ${esc(d.versions[lo][0])}) to ${day(d.versions[hi][1])} (syncToken ${esc(d.versions[hi][0])}), ${fmt(hi - lo)} version${hi - lo === 1 ? '' : 's'} apart.</p>
  <p class="dl-row"><button type="button" class="btn ghost" data-dl>Download as CSV</button></p></div>
  <div class="cmp-groups"><div><h3 class="sub-title">Added</h3><ul class="delta">${ga.slice(0, 12).map(([k, n]) => `<li class="add"><b>+${fmt(n)}</b> ${esc(k)}</li>`).join('') || '<li class="muted">Nothing</li>'}${ga.length > 12 ? `<li class="more">and ${ga.length - 12} more groups</li>` : ''}</ul></div>
  <div><h3 class="sub-title">Removed</h3><ul class="delta">${gr.slice(0, 12).map(([k, n]) => `<li class="rem"><b>-${fmt(n)}</b> ${esc(k)}</li>`).join('') || '<li class="muted">Nothing</li>'}${gr.length > 12 ? `<li class="more">and ${gr.length - 12} more groups</li>` : ''}</ul></div></div>`;
  out.querySelector('[data-dl]').addEventListener('click', () => download(`aws-ip-changes-${d.versions[lo][1].slice(0, 10)}-to-${d.versions[hi][1].slice(0, 10)}.csv`, csv, 'text/csv'));
}

// ---------- wiring + shareable URLs ----------
const root = $('#tm');
if (root) {
  const params = new URL(location.href).searchParams;
  const setParams = (obj) => { const u = new URL(location.href); for (const k of ['ip', 'date', 'from', 'to', 'service', 'region']) u.searchParams.delete(k); for (const [k, v] of Object.entries(obj)) if (v) u.searchParams.set(k, v); history.replaceState(null, '', u); };
  const fIp = $('[data-form="ip"]'), fDate = $('[data-form="date"]'), fCmp = $('[data-form="compare"]');
  fIp.addEventListener('submit', (e) => { e.preventDefault(); const q = fIp.ip.value.trim(); setParams({ ip: q }); ipHistory(q); });
  fDate.addEventListener('submit', (e) => { e.preventDefault(); setParams({ date: fDate.date.value, service: fDate.service.value, region: fDate.region.value }); onDate(fDate.date.value, fDate.service.value, fDate.region.value); });
  fCmp.addEventListener('submit', (e) => { e.preventDefault(); setParams({ from: fCmp.from.value, to: fCmp.to.value, service: fCmp.service.value }); compare(endOfDay(fCmp.from.value), endOfDay(fCmp.to.value), fCmp.service.value); });
  // default "from" = one year before the latest version
  const max = root.dataset.max; const y = new Date(`${max}T00:00:00Z`); y.setUTCFullYear(y.getUTCFullYear() - 1); fCmp.from.value ||= y.toISOString().slice(0, 10);
  if (params.get('ip')) { fIp.ip.value = params.get('ip'); ipHistory(params.get('ip')); }
  if (params.get('date')) { fDate.date.value = params.get('date').slice(0, 10); fDate.service.value = params.get('service') || ''; fDate.region.value = params.get('region') || ''; onDate(fDate.date.value, fDate.service.value, fDate.region.value); }
  if (params.get('from') && params.get('to')) {
    const f = params.get('from'), t = params.get('to');
    fCmp.from.value = f.slice(0, 10); fCmp.to.value = t.slice(0, 10); fCmp.service.value = params.get('service') || '';
    compare(f.length > 10 ? f : endOfDay(f), t.length > 10 ? t : endOfDay(t), fCmp.service.value);
  }
}
