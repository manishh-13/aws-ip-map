// Static site generator: data/*.json -> dist/
import fs from 'node:fs/promises';
import path from 'node:path';
import { SITE } from './site.mjs';
import { layout, crumbs, crumbsLD, downloads, datasetLD, esc, fmt, fmtAddrs, fmtDate, fmtMonth, href, abs } from './templates.mjs';
import { growthChart, lineChart } from './charts.mjs';
import { encodeIndexedPNG } from './png.mjs';
import { groupByPrefix, summarize, createDateToISO } from '../src/lib/stats.js';
import { parseTarget, unionSize } from '../src/lib/ip.js';
import { GEOS, geoOf, regionLabel, serviceLabel, slug } from '../src/lib/regions.js';
import { buildCells, hilbertTable, regionPalette, MAP_SIDE } from '../src/lib/map.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DIST = path.resolve(ROOT, process.env.OUT_DIR || 'dist');
const DATA = process.env.DATA_DIR || path.join(ROOT, 'data');
const readJSON = async (f, fb) => JSON.parse(await fs.readFile(path.join(DATA, f), 'utf8').catch(() => JSON.stringify(fb)));
const pages = [];
async function write(rel, content) {
  const f = path.join(DIST, rel);
  await fs.mkdir(path.dirname(f), { recursive: true });
  await fs.writeFile(f, content);
}
async function page(rel, html, priority = 0.6) {
  await write(rel + 'index.html', html);
  pages.push({ loc: abs(rel), priority });
}

// ---------- data model ----------
const raw = await readJSON('ip-ranges.json', null);
if (!raw) throw new Error('data/ip-ranges.json missing: run `npm run update` first');
const history = await readJSON('history.json', { snapshots: [], regionsFirstSeen: {}, servicesFirstSeen: {} });
const prefixHist = await readJSON('prefix-history.json', {});
const changes = await readJSON('changes.json', []);
const UPDATED = createDateToISO(raw.createDate);
const SUM = summarize(raw);
const ARCHIVE_START = history.snapshots[0]?.t || UPDATED;

const rows = groupByPrefix(raw).map((r) => ({ ...r, t: parseTarget(r.cidr) })).filter((r) => r.t);
const cmp = (a, b) => a.t.v - b.t.v || (a.t.start < b.t.start ? -1 : a.t.start > b.t.start ? 1 : a.t.len - b.t.len);
rows.sort(cmp);

const geoRank = Object.fromEntries(GEOS.map((g, i) => [g.id, i]));
const REGIONS = [...new Set(rows.map((r) => r.region))].sort((a, b) => geoRank[geoOf(a)] - geoRank[geoOf(b)] || a.localeCompare(b));
const SERVICES = [...new Set(rows.flatMap((r) => r.services))].sort((a, b) => (a === 'AMAZON' ? -1 : b === 'AMAZON' ? 1 : a.localeCompare(b)));
const NBGS = [...new Set(rows.map((r) => r.nbg))].sort();
const RI = Object.fromEntries(REGIONS.map((r, i) => [r, i]));
const PAL = regionPalette(REGIONS, geoOf, GEOS);
const rgb = (c) => `rgb(${c.join(' ')})`;

function stats(list) {
  const v4 = list.filter((r) => r.t.v === 4), v6 = list.filter((r) => r.t.v === 6);
  return { v4p: new Set(v4.map((r) => r.cidr)).size, v6p: new Set(v6.map((r) => r.cidr)).size, v4a: Number(unionSize(v4.map((r) => r.t))) };
}
const firstSeen = (cidr) => prefixHist[cidr]?.f;

// ---------- static data files ----------
function files(dir, list, meta) {
  const uniq = (v) => [...new Set(list.filter((r) => r.t.v === v).map((r) => r.cidr))];
  const json = { source: SITE.source, syncToken: String(raw.syncToken), createDate: raw.createDate, ...meta,
    prefixes: list.map((r) => ({ prefix: r.cidr, region: r.region, network_border_group: r.nbg, services: r.services })) };
  const csv = ['prefix,ip_version,region,network_border_group,services', ...list.map((r) => `${r.cidr},${r.t.v},${r.region},${r.nbg},${r.services.join(' ')}`)].join('\n') + '\n';
  return Promise.all([
    write(dir + 'ipv4.txt', uniq(4).join('\n') + '\n'),
    write(dir + 'ipv6.txt', uniq(6).join('\n') + '\n'),
    write(dir + 'ranges.csv', csv),
    write(dir + 'ranges.json', JSON.stringify(json, null, 1)),
  ]);
}

// ---------- shared fragments ----------
const svcChips = (services, linkable = true) => services.filter((s) => s !== 'AMAZON' || services.length === 1)
  .map((s) => linkable ? `<a class="tag" href="${href(`services/${slug(s)}/`)}">${esc(s)}</a>` : `<span class="tag">${esc(s)}</span>`).join('') ;

function prefixList(list, { showServices = true, showRegion = false } = {}) {
  const items = list.map((r) => {
    const fs = firstSeen(r.cidr);
    const meta = [
      showRegion ? `<a class="tag region" href="${href(`regions/${r.region}/`)}">${esc(r.region)}</a>` : '',
      showServices ? svcChips(r.services) : '',
      r.nbg !== r.region ? `<span class="nbg" title="Network border group">${esc(r.nbg)}</span>` : '',
      fs && fs > ARCHIVE_START.slice(0, 10) ? `<span class="since" title="First seen in the archive">since ${fmtMonth(fs)}</span>` : '',
    ].join('');
    return `<li data-v="${r.t.v}"><code data-copy>${esc(r.cidr)}</code>${meta}</li>`;
  }).join('');
  return `<div class="prefix-block">
  <div class="list-tools"><input type="search" class="filter" placeholder="Filter ${fmt(list.length)} prefixes" aria-label="Filter prefixes">
  <div class="seg" role="group" aria-label="IP version"><button type="button" data-fam="all" aria-pressed="true">All</button><button type="button" data-fam="4" aria-pressed="false">IPv4</button><button type="button" data-fam="6" aria-pressed="false">IPv6</button></div>
  <button type="button" class="btn ghost" data-copy-list>Copy visible</button></div>
  <ol class="prefixes">${items}</ol></div>`;
}

const statLine = (s) => `<dl class="facts">
  <div><dt>IPv4 prefixes</dt><dd>${fmt(s.v4p)}</dd></div>
  <div><dt>IPv6 prefixes</dt><dd>${fmt(s.v6p)}</dd></div>
  <div><dt>IPv4 addresses</dt><dd>${fmtAddrs(s.v4a)}</dd></div>
</dl>`;

function regionSeries(code) {
  return history.snapshots.filter((s) => s.regions && s.regions[code] !== undefined).map((s) => ({ t: s.t, v: s.regions[code] }));
}

// ---------- map.png + og.png ----------
async function maps() {
  const cells = buildCells(rows.filter((r) => r.t.v === 4).map((r) => ({ cidr: r.cidr, ri: RI[r.region] })));
  const { xs, ys } = hilbertTable();
  // palette: 0 = transparent, 1 = faint /8 checker tile; then per region full/partial
  const palette = [[0, 0, 0], [128, 136, 160]];
  for (const r of REGIONS) palette.push(PAL[r].full, PAL[r].partial);
  const px = new Uint8Array(MAP_SIDE * MAP_SIDE);
  for (let d = 0; d < cells.length; d++) {
    const c = cells[d];
    const idx = c === 0 ? ((d >> 12) & 1) : 1 + c; // /8 = 4096 cells; alternate paper tone
    px[ys[d] * MAP_SIDE + xs[d]] = idx;
  }
  await write('map.png', encodeIndexedPNG(MAP_SIDE, MAP_SIDE, px, palette, [0, 22]));
  return { cells, palette };
}

// ---------- home ----------
function faq() {
  const q = [
    ['Where does AWS publish its IP address ranges?', `AWS publishes its current IP address ranges as a JSON file at <a href="${SITE.source}">ip-ranges.amazonaws.com/ip-ranges.json</a>. Each entry has a CIDR prefix, a region, a network border group and a service code. This site mirrors that file, indexes it, and keeps its history.`],
    ['How often do AWS IP ranges change?', `AWS republishes the file whenever its address space changes, and it can change more than once a day. Every version carries a <code>syncToken</code> (the publication time in Unix epoch format). This site checks for a new token every hour and records exactly which prefixes were added or removed on the <a href="${href('changes/')}">change log</a>.`],
    ['How do I check whether an IP address belongs to AWS?', `Paste it into the search box at the top of this page. You get every published AWS prefix that contains it, with region, service and network border group. Paste a whole list (logs, firewall exports) to check many at once. If an address isn't in any published prefix, it isn't in AWS's published ranges today; the search also tells you if it used to be.`],
    ['What is the difference between the AMAZON service code and EC2 or S3?', `AWS's documentation says every subset is also in the AMAZON subset, so AMAZON is the superset; some ranges appear only under AMAZON. When one service uses another's resources, a range can appear under both codes: S3 uses EC2 resources, so some ranges are listed under both S3 and EC2 but are used only by S3. To find ranges used only by EC2, take the EC2 ranges that are not also listed under S3. Source: <a href="${SITE.syntaxDocs}">AWS IP range JSON syntax</a>.`],
    ['Are the API_GATEWAY ranges for inbound or outbound traffic?', `Outbound. The AWS documentation states that the addresses listed for API_GATEWAY are egress only.`],
    ['How can I get notified when AWS IP ranges change?', `AWS sends a notification to the Amazon SNS topic <code>${SITE.snsTopic}</code> (in us-east-1) on every change, as described in <a href="${SITE.snsDocs}">AWS IP address ranges notifications</a>. If you'd rather not run anything, subscribe to this site's <a href="${href('changes.xml')}">Atom feed</a>.`],
    ['Why does a prefix in the file not match what I see in BGP?', `AWS notes that it may advertise a prefix in more specific ranges. For example, 96.127.0.0/17 in the file may be advertised as several smaller blocks. Matching on the published prefix still works, because the smaller blocks sit inside it.`],
    ['Why do some region codes say "not yet announced"?', `Region codes sometimes appear in ip-ranges.json before AWS's documentation lists them. This site shows the code exactly as it appears in the file and doesn't guess a name until AWS publishes one.`],
  ];
  const html = `<section class="faq" id="faq"><h2 class="section-title">Questions</h2>${q.map(([a, b]) => `<details><summary>${esc(a)}</summary><p>${b}</p></details>`).join('')}</section>`;
  const ld = { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: q.map(([a, b]) => ({ '@type': 'Question', name: a, acceptedAnswer: { '@type': 'Answer', text: b.replace(/<[^>]+>/g, '') } })) };
  return { html, ld };
}

function regionArrivals() {
  const first = history.regionsFirstSeen || {};
  const startDay = ARCHIVE_START.slice(0, 10);
  const byYear = {};
  for (const r of REGIONS) {
    if (r === 'GLOBAL') continue;
    const d = first[r] || UPDATED.slice(0, 10);
    const y = d <= startDay ? 'before' : d.slice(0, 4);
    (byYear[y] ??= []).push([r, d]);
  }
  const years = Object.keys(byYear).sort((a, b) => (a === 'before' ? -1 : b === 'before' ? 1 : a.localeCompare(b)));
  return `<ol class="arrivals">${years.map((y) => `<li><span class="yr">${y === 'before' ? `By ${fmtMonth(ARCHIVE_START)}` : y}</span><span class="regs">${byYear[y].sort((a, b) => a[1].localeCompare(b[1])).map(([r, d]) => {
    const l = regionLabel(r);
    return `<a href="${href(`regions/${r}/`)}" class="arrival${l.announced ? '' : ' unannounced'}" title="${esc(l.full)}${y === 'before' ? '' : `, first seen ${fmtMonth(d)}`}" style="--c:${rgb(PAL[r].full)}"><i></i>${esc(r)}${l.announced ? '' : '<em>not yet announced</em>'}</a>`;
  }).join('')}</span></li>`).join('')}</ol>`;
}

function changeSummary(ev, limit = 6) {
  const group = (list) => {
    const m = {};
    for (const [, region, , service] of list) { const k = `${region} ${service}`; m[k] = (m[k] || 0) + 1; }
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  };
  const a = group(ev.added), r = group(ev.removed);
  const line = (sign, [k, n]) => { const [region, service] = k.split(' '); return `<li class="${sign === '+' ? 'add' : 'rem'}"><b>${sign}${n}</b> ${esc(service)} in <a href="${href(`regions/${region}/`)}">${esc(region)}</a></li>`; };
  const lines = [...a.map((x) => line('+', x)), ...r.map((x) => line('-', x))];
  return `<ul class="delta">${lines.slice(0, limit).join('')}${lines.length > limit ? `<li class="more">and ${lines.length - limit} more groups</li>` : ''}</ul>`;
}

function monthlyLedger(limit) {
  const s = history.snapshots;
  const monthly = new Map();
  for (const x of s) monthly.set(x.t.slice(0, 7), x);
  const m = [...monthly.values()];
  const out = [];
  for (let i = m.length - 1; i > 0 && out.length < limit; i--) {
    const cur = m[i], prev = m[i - 1];
    const deltas = Object.keys({ ...cur.regions, ...prev.regions }).map((r) => [r, (cur.regions[r] || 0) - (prev.regions[r] || 0)]).filter(([, d]) => d !== 0).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
    out.push({ cur, prev, dp: cur.v4p - prev.v4p, da: cur.v4a - prev.v4a, top: deltas.slice(0, 3) });
  }
  return out;
}
const signed = (n, f = fmt) => (n > 0 ? `+${f(n)}` : n < 0 ? `-${f(-n)}` : '0');

function ledgerTable(limit, compact = false) {
  const rowsL = monthlyLedger(limit);
  if (!rowsL.length) return '';
  if (compact) return `<div class="tw"><table class="ledger compact"><thead><tr><th>Month</th><th class="num">Prefixes</th><th class="num">Addresses</th></tr></thead><tbody>${rowsL.map((x) => `<tr><td>${fmtMonth(x.cur.t)}</td><td class="num ${x.dp >= 0 ? 'pos' : 'neg'}">${signed(x.dp)}</td><td class="num ${x.da >= 0 ? 'pos' : 'neg'}">${signed(x.da, fmtAddrs)}</td></tr>`).join('')}</tbody></table></div>`;
  return `<div class="tw"><table class="ledger"><thead><tr><th>Month</th><th>IPv4 prefixes</th><th>Change</th><th>IPv4 addresses</th><th>Biggest movers</th></tr></thead><tbody>${rowsL.map((x) => `<tr><td>${fmtMonth(x.cur.t)}</td><td>${fmt(x.cur.v4p)}</td><td class="${x.dp >= 0 ? 'pos' : 'neg'}">${signed(x.dp)}</td><td class="${x.da >= 0 ? 'pos' : 'neg'}">${signed(x.da, fmtAddrs)}</td><td>${x.top.map(([r, d]) => `<a href="${href(`regions/${r}/`)}">${esc(r)}</a> <span class="${d >= 0 ? 'pos' : 'neg'}">${signed(d, fmtAddrs)}</span>`).join(', ')}</td></tr>`).join('')}</tbody></table></div>`;
}

async function home(cellsInfo) {
  const share = ((SUM.v4a / 2 ** 32) * 100).toFixed(2);
  const firstSnap = history.snapshots[0];
  const growth = firstSnap ? (SUM.v4a / firstSnap.v4a).toFixed(1) : null;
  const unannounced = REGIONS.filter((r) => !regionLabel(r).announced);
  const { html: faqHtml, ld: faqLD } = faq();
  const geoTotals = GEOS.map((g) => ({ ...g, a: Number(unionSize(rows.filter((r) => r.t.v === 4 && geoOf(r.region) === g.id).map((r) => r.t))), mid: PAL[REGIONS.find((r) => geoOf(r) === g.id)]?.full }));
  const latest = changes.slice(0, 4);

  const body = `
<section class="hero">
  <p class="status"><span class="lamp on" aria-hidden="true"></span>Live, synced with AWS <time datetime="${UPDATED}" data-ago>${fmtDate(UPDATED)}</time></p>
  <h1>AWS IP address ranges, made easy to look up.</h1>
  <p class="lede">AWS publishes all ${fmt(SUM.v4p + SUM.v6p)} of its public IP ranges as one 2.7&nbsp;MB JSON file. Search them here instead: paste an IP, a CIDR or a whole list and get the region, service and network border group instantly.</p>
  <form class="search" role="search" action="${href()}" method="get" autocomplete="off">
    <label for="q" class="sr">IP address, CIDR, region or service</label>
    <svg class="search-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="m16 16 4.5 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
    <textarea id="q" name="q" rows="1" spellcheck="false" placeholder="Paste an IP, CIDR, or a list..."></textarea>
    <button type="submit" class="btn primary">Look up</button>
  </form>
  <p class="try">Try <button type="button" data-q="18.180.88.10">18.180.88.10</button><button type="button" data-q="2600:1f18::1">2600:1f18::1</button><button type="button" data-q="52.94.0.0/16">52.94.0.0/16</button><button type="button" data-q="ap-south-1">ap-south-1</button><button type="button" data-q="3.5.140.2&#10;13.32.0.1&#10;8.8.8.8">a list of IPs</button></p>
  <div id="results" class="results" aria-live="polite"></div>
</section>

<section class="band dark map-band" id="map-section">
  <div class="band-inner">
    <div class="band-head">
      <h2 class="section-title">The whole IPv4 internet, with AWS lit up.</h2>
      <p>All 4.3 billion addresses on one Hilbert curve, where neighbouring addresses stay neighbours. Each tile is a /8, each pixel a /20. AWS holds ${fmtAddrs(SUM.v4a)} of them, ${share}% of the space. Click a tile to zoom in; search an IP and the map goes straight to it.</p>
    </div>
    <figure class="atlas" id="map">
      <div class="map-wrap">
        <img class="map-img" src="${href('map.png')}?v=${SUM.sync}" width="1024" height="1024" alt="Hilbert-curve map of the entire IPv4 internet with AWS's published ranges coloured by region">
        <canvas class="map-zoom" width="1024" height="1024" aria-hidden="true"></canvas>
        <canvas class="map-overlay" width="1024" height="1024" aria-hidden="true"></canvas>
        <button type="button" class="map-back" hidden>Show whole internet</button>
        <div class="loupe" aria-hidden="true"><canvas width="176" height="176"></canvas></div>
        <div class="map-tip" role="status" hidden></div>
      </div>
      <figcaption>
        <p class="map-where">The whole IPv4 internet</p>
        <ul class="legend">${geoTotals.filter((g) => g.a > 0).map((g) => `<li><button type="button" data-geo="${g.id}" style="--c:${g.mid ? rgb(g.mid) : 'gray'}"><i></i>${esc(g.label)}<span>${fmtAddrs(g.a)}</span></button></li>`).join('')}</ul>
      </figcaption>
    </figure>
  </div>
</section>

<section class="band gray builder" id="allowlist">
  <div class="band-inner">
    <div class="section-head"><h2 class="section-title">Build an allowlist in seconds.</h2><p>Pick a service and region, choose a format, copy. Turn on merging to collapse overlapping and adjacent prefixes into the smallest CIDR list, which helps when security groups or prefix lists cap your entries.</p></div>
    <form class="builder-form">
      <label>Service<select name="service">${SERVICES.map((s) => `<option value="${s}"${s === 'CLOUDFRONT' ? ' selected' : ''}>${esc(s)}: ${esc(serviceLabel(s))}</option>`).join('')}</select></label>
      <label>Region<select name="region"><option value="">All regions</option>${REGIONS.map((r) => `<option value="${r}">${esc(r)}: ${esc(regionLabel(r).name)}</option>`).join('')}</select></label>
      <label>IP version<select name="fam"><option value="4">IPv4</option><option value="6">IPv6</option><option value="all">Both</option></select></label>
      <label>Format<select name="format"><option value="plain">One per line</option><option value="csv">CSV</option><option value="json">JSON array</option><option value="terraform">Terraform list</option><option value="nginx">nginx allow</option><option value="apache">Apache Require ip</option><option value="iptables">iptables</option><option value="prefixlist">AWS managed prefix list (CLI)</option></select></label>
      <label class="check"><input type="checkbox" name="merge" role="switch"><span class="switch" aria-hidden="true"></span> Merge overlapping and adjacent ranges</label>
    </form>
    <div class="builder-out"><div class="out-head"><span class="out-count">Loading ranges...</span><span><button type="button" class="btn ghost" data-out-copy>Copy</button><button type="button" class="btn ghost" data-out-download>Download</button></span></div><textarea readonly spellcheck="false" aria-label="Generated allowlist"></textarea></div>
  </div>
</section>

<section class="stats" id="stats">
  <div class="section-head"><h2 class="section-title">AWS's IPv4 space grew ${growth ? `${growth}x` : ''} since ${firstSnap ? fmtMonth(firstSnap.t) : '2015'}.</h2><p>From ${firstSnap ? fmtAddrs(firstSnap.v4a) : ''} to ${fmtAddrs(SUM.v4a)} public addresses. Reconstructed from ${fmt(history.snapshots.length)} archived versions of ip-ranges.json; hover the chart to read any month.</p></div>
  <dl class="plate" aria-label="Current totals">
    <div><dt>IPv4 addresses</dt><dd>${fmtAddrs(SUM.v4a)}</dd></div>
    <div><dt>IPv4 prefixes</dt><dd>${fmt(SUM.v4p)}</dd></div>
    <div><dt>IPv6 prefixes</dt><dd>${fmt(SUM.v6p)}</dd></div>
    <div><dt>Region codes</dt><dd>${REGIONS.length - 1}${unannounced.length ? ` <small>${unannounced.length} unannounced</small>` : ''}</dd></div>
    <div><dt>Service codes</dt><dd>${SERVICES.length}</dd></div>
  </dl>
  ${history.snapshots.length > 1 ? growthChart(history.snapshots) : ''}
  <div class="split">
    <div class="arrivals-wrap">
      <h3 class="sub-title">When each region code first appeared</h3>
      ${regionArrivals()}
    </div>
    <div class="changes-preview">
      <h3 class="sub-title">Recent changes <a class="more-link" href="${href('changes/')}">Full log</a></h3>
      ${latest.length ? `<ol class="events">${latest.map((ev) => `<li><time datetime="${ev.t}" data-ago>${fmtDate(ev.t)}</time><span class="counts"><b class="pos">+${fmt(ev.added.length)}</b> <b class="neg">-${fmt(ev.removed.length)}</b></span>${changeSummary(ev, 3)}</li>`).join('')}</ol>` : `<p class="empty">Live tracking starts with the next update. Monthly net change from the archive:</p>${ledgerTable(8, true)}`}
    </div>
  </div>
</section>

<section class="browse">
  <div class="browse-col">
    <h2 class="section-title">Browse by region</h2>
    ${GEOS.map((g) => { const rs = REGIONS.filter((r) => geoOf(r) === g.id); return rs.length ? `<h3>${esc(g.label)}</h3><ul class="index">${rs.map((r) => { const l = regionLabel(r); const n = rows.filter((x) => x.region === r).length; return `<li><a href="${href(`regions/${r}/`)}"><code>${esc(r)}</code><span>${esc(l.name)}</span><small>${fmt(n)}</small></a></li>`; }).join('')}</ul>` : ''; }).join('')}
  </div>
  <div class="browse-col">
    <h2 class="section-title">Browse by service</h2>
    <ul class="index">${SERVICES.map((s) => { const n = rows.filter((x) => x.services.includes(s)).length; return `<li><a href="${href(`services/${slug(s)}/`)}"><code>${esc(s)}</code><span>${esc(serviceLabel(s))}</span><small>${fmt(n)}</small></a></li>`; }).join('')}</ul>
    <div class="api-teaser">
      <h3>For scripts and pipelines</h3>
      <p>Every region, service and region-service pair has plain-text and CSV files at a stable URL, regenerated on every change.</p>
      <code data-copy>curl -s ${abs('services/cloudfront/ipv4.txt')}</code>
      <code data-copy>curl -s ${abs('regions/ap-south-1/s3/ipv4.txt')}</code>
      <p><a href="${href('api/')}">See all endpoints</a></p>
    </div>
  </div>
</section>
${faqHtml}`;

  const ld = [
    { '@context': 'https://schema.org', '@type': 'WebSite', name: SITE.name, url: abs(''), potentialAction: { '@type': 'SearchAction', target: `${abs('')}?q={search_term_string}`, 'query-input': 'required name=search_term_string' } },
    datasetLD({ name: 'AWS IP address ranges (live mirror and history)', description: 'Every public IPv4 and IPv6 prefix in AWS ip-ranges.json, indexed by region and service, with history reconstructed from archived versions since 2015.', path: '', dir: '', modified: UPDATED, temporal: `${ARCHIVE_START.slice(0, 10)}/..` }),
    faqLD,
  ];
  await page('', layout({
    title: 'AWS IP address ranges lookup: search any AWS IP, CIDR, region or service | AWS IP Atlas',
    description: `Check if an IP address belongs to AWS. Instant AWS IP lookup with region, service and network border group, across all ${fmt(SUM.v4p + SUM.v6p)} AWS IPv4 and IPv6 ranges. Allowlist builder, downloads and live change tracking.`,
    path: '', body, jsonld: ld, updated: UPDATED, bodyClass: 'home',
  }), 1.0);
  await files('', rows, { scope: 'all' });
}

// ---------- region pages ----------
async function regionPages() {
  for (const r of REGIONS) {
    const list = rows.filter((x) => x.region === r);
    const l = regionLabel(r), s = stats(list);
    const svcs = SERVICES.filter((sv) => list.some((x) => x.services.includes(sv)));
    const nbgs = [...new Set(list.map((x) => x.nbg))].sort();
    const fsDate = history.regionsFirstSeen?.[r];
    const series = regionSeries(r);
    const dir = `regions/${r}/`;
    const neighbours = REGIONS.filter((x) => x !== r && geoOf(x) === geoOf(r));
    const title = r === 'GLOBAL' ? 'AWS GLOBAL IP ranges (CloudFront, Route 53, Global Accelerator and more)' : `AWS IP ranges for ${r}${l.announced ? `, ${l.name}` : ''}`;
    const h1 = r === 'GLOBAL' ? esc(title) : `AWS IP ranges for <span class="nw">${esc(r)}</span>${l.announced ? `, ${esc(l.name)}` : ''}`;
    const items = [['', 'Atlas'], ['regions/', 'Regions'], [dir, r]];
    const body = `${crumbs(items)}
<header class="page-head" style="--c:${rgb(PAL[r].full)}">
  <p class="eyebrow">${esc(GEOS.find((g) => g.id === geoOf(r)).label)}, region code <code>${esc(r)}</code></p>
  <h1>${h1}</h1>
  <p class="lede">As of <time datetime="${UPDATED}">${fmtDate(UPDATED)}</time>, AWS publishes ${fmt(s.v4p)} IPv4 prefixes (${fmtAddrs(s.v4a)} addresses) and ${fmt(s.v6p)} IPv6 prefixes ${r === 'GLOBAL' ? 'that are not tied to one region' : `for ${l.announced ? esc(l.name) : `<code>${r}</code>, a region code AWS hasn't published a name for yet`}`}, across ${svcs.length} service codes.${fsDate && fsDate > ARCHIVE_START.slice(0, 10) ? ` It first appeared in ip-ranges.json in ${fmtMonth(fsDate)}.` : ''}</p>
  ${statLine(s)}
  ${downloads(dir, r)}
</header>
${series.length > 2 ? `<section style="--c:${rgb(PAL[r].full)}"><h2 class="section-title">IPv4 addresses over time</h2>${lineChart(series, `IPv4 addresses published for ${r} over time`)}</section>` : ''}
<section><h2 class="section-title">Services in ${esc(r)}</h2>
<div class="tw"><table class="svc-table"><thead><tr><th>Service code</th><th>IPv4 prefixes</th><th>IPv6 prefixes</th><th>IPv4 addresses</th><th></th></tr></thead><tbody>
${svcs.map((sv) => { const ss = stats(list.filter((x) => x.services.includes(sv))); return `<tr><td><a href="${href(`${dir}${slug(sv)}/`)}"><code>${esc(sv)}</code></a> <span class="muted">${esc(serviceLabel(sv))}</span></td><td>${fmt(ss.v4p)}</td><td>${fmt(ss.v6p)}</td><td>${fmtAddrs(ss.v4a)}</td><td><a class="tag" href="${href(`${dir}${slug(sv)}/ipv4.txt`)}">ipv4.txt</a></td></tr>`; }).join('')}
</tbody></table></div></section>
${nbgs.length > 1 ? `<section><h2 class="section-title">Network border groups</h2><p class="muted">A network border group is a set of Availability Zones or Local Zones that AWS advertises addresses from.</p><ul class="nbg-list">${nbgs.map((n) => `<li><code>${esc(n)}</code> <span>${fmt(list.filter((x) => x.nbg === n).length)} prefixes</span></li>`).join('')}</ul></section>` : ''}
<section><h2 class="section-title">All prefixes</h2>${prefixList(list)}</section>
${neighbours.length ? `<section class="related"><h2 class="section-title">Nearby regions</h2><p>${neighbours.map((x) => `<a class="tag" href="${href(`regions/${x}/`)}">${esc(x)} <span>${esc(regionLabel(x).name)}</span></a>`).join('')}</p></section>` : ''}`;
    await page(dir, layout({
      title: `${title} | AWS IP Atlas`,
      description: `${fmt(s.v4p)} IPv4 and ${fmt(s.v6p)} IPv6 AWS prefixes for ${r}${l.announced ? ` (${l.name})` : ''}, by service: ${svcs.slice(0, 6).join(', ')}${svcs.length > 6 ? ' and more' : ''}. Download as text, CSV or JSON. Updated ${fmtDate(UPDATED)}.`,
      path: dir, body, updated: UPDATED,
      jsonld: [crumbsLD(items), datasetLD({ name: `AWS IP ranges for ${r}`, description: `Public AWS IPv4 and IPv6 prefixes published for ${r}.`, path: dir, dir, modified: UPDATED })],
    }), 0.8);
    await files(dir, list, { region: r });

    for (const sv of svcs) {
      const sub = list.filter((x) => x.services.includes(sv));
      const ss = stats(sub);
      const sdir = `${dir}${slug(sv)}/`;
      const t2 = `AWS ${sv} IP ranges in ${r}${l.announced ? ` (${l.name})` : ''}`;
      const items2 = [['', 'Atlas'], ['regions/', 'Regions'], [dir, r], [sdir, sv]];
      const body2 = `${crumbs(items2)}
<header class="page-head" style="--c:${rgb(PAL[r].full)}">
  <p class="eyebrow">${esc(serviceLabel(sv))} in ${esc(l.full)}</p>
  <h1>AWS <span class="nw">${esc(sv)}</span> IP ranges in <span class="nw">${esc(r)}</span>${l.announced ? ` (${esc(l.name)})` : ''}</h1>
  <p class="lede">${fmt(ss.v4p)} IPv4 prefixes (${fmtAddrs(ss.v4a)} addresses) and ${fmt(ss.v6p)} IPv6 prefixes tagged <code>${esc(sv)}</code> in <a href="${href(dir)}">${esc(r)}</a>, as of <time datetime="${UPDATED}">${fmtDate(UPDATED)}</time>. See this service in <a href="${href(`services/${slug(sv)}/`)}">every region</a>.</p>
  ${downloads(sdir, `${sv} in ${r}`)}
</header>
<section><h2 class="section-title">Prefixes</h2>${prefixList(sub, { showServices: sv === 'AMAZON' })}</section>`;
      await page(sdir, layout({
        title: `${t2} | AWS IP Atlas`,
        description: `${fmt(ss.v4p)} IPv4 and ${fmt(ss.v6p)} IPv6 prefixes for ${serviceLabel(sv)} (${sv}) in ${r}. Copy or download for firewall and security group allowlists. Updated ${fmtDate(UPDATED)}.`,
        path: sdir, body: body2, updated: UPDATED, jsonld: [crumbsLD(items2)],
      }), 0.5);
      await files(sdir, sub, { region: r, service: sv });
    }
  }
  // regions index
  const items = [['', 'Atlas'], ['regions/', 'Regions']];
  const body = `${crumbs(items)}<header class="page-head"><h1>AWS IP ranges by region</h1><p class="lede">${REGIONS.length - 1} region codes plus GLOBAL appear in ip-ranges.json today. Pick one for its prefixes, services, history and downloads.</p></header>
<div class="tw"><table class="svc-table"><thead><tr><th>Region</th><th>Name</th><th>IPv4 prefixes</th><th>IPv6 prefixes</th><th>IPv4 addresses</th></tr></thead><tbody>${REGIONS.map((r) => { const s = stats(rows.filter((x) => x.region === r)); const l = regionLabel(r); return `<tr><td><a href="${href(`regions/${r}/`)}"><code>${r}</code></a></td><td>${esc(l.name)}${l.announced ? '' : ' <span class="badge">new</span>'}</td><td>${fmt(s.v4p)}</td><td>${fmt(s.v6p)}</td><td>${fmtAddrs(s.v4a)}</td></tr>`; }).join('')}</tbody></table></div>`;
  await page('regions/', layout({ title: 'AWS IP ranges by region (all regions) | AWS IP Atlas', description: `IPv4 and IPv6 address ranges for every AWS region, from us-east-1 to the newest region codes in ip-ranges.json. Updated ${fmtDate(UPDATED)}.`, path: 'regions/', body, updated: UPDATED, jsonld: [crumbsLD(items)] }), 0.9);
}

// ---------- service pages ----------
async function servicePages() {
  for (const sv of SERVICES) {
    const list = rows.filter((x) => x.services.includes(sv));
    const s = stats(list);
    const regs = REGIONS.filter((r) => list.some((x) => x.region === r));
    const dir = `services/${slug(sv)}/`;
    const first = history.servicesFirstSeen?.[sv];
    const title = `AWS ${sv} IP ranges${sv === 'AMAZON' ? ' (every AWS range)' : `: ${serviceLabel(sv)}`}`;
    const items = [['', 'Atlas'], ['services/', 'Services'], [dir, sv]];
    const note = {
      AMAZON: 'AMAZON is the superset: every other service code is also in it, and some ranges appear only here.',
      API_GATEWAY: 'AWS documents these addresses as egress only: they are where API Gateway calls your backends from, not where clients connect to.',
      EC2: 'Some EC2 ranges are also listed under S3 because S3 uses EC2 resources; AWS says those overlapping ranges are used only by S3.',
      S3: 'S3 uses EC2 resources, so some of these ranges also appear under EC2. AWS says the overlapping ranges are used only by S3.',
    }[sv];
    const body = `${crumbs(items)}
<header class="page-head">
  <p class="eyebrow">Service code <code>${esc(sv)}</code></p>
  <h1>${esc(title)}</h1>
  <p class="lede">${fmt(s.v4p)} IPv4 prefixes (${fmtAddrs(s.v4a)} addresses) and ${fmt(s.v6p)} IPv6 prefixes across ${regs.length} region codes, as of <time datetime="${UPDATED}">${fmtDate(UPDATED)}</time>.${first && first > ARCHIVE_START.slice(0, 10) ? ` This service code first appeared in the file in ${fmtMonth(first)}.` : ''}${note ? ` ${note}` : ''}</p>
  ${statLine(s)}
  ${downloads(dir, sv)}
</header>
<section><h2 class="section-title">${esc(sv)} by region</h2>
<div class="tw"><table class="svc-table"><thead><tr><th>Region</th><th>Name</th><th>IPv4 prefixes</th><th>IPv6 prefixes</th><th>IPv4 addresses</th><th></th></tr></thead><tbody>
${regs.map((r) => { const ss = stats(list.filter((x) => x.region === r)); return `<tr><td><a href="${href(`regions/${r}/${slug(sv)}/`)}"><code>${r}</code></a></td><td>${esc(regionLabel(r).name)}</td><td>${fmt(ss.v4p)}</td><td>${fmt(ss.v6p)}</td><td>${fmtAddrs(ss.v4a)}</td><td><a class="tag" href="${href(`regions/${r}/${slug(sv)}/ipv4.txt`)}">ipv4.txt</a></td></tr>`; }).join('')}
</tbody></table></div></section>
<section><h2 class="section-title">All ${esc(sv)} prefixes</h2>${prefixList(list, { showServices: sv === 'AMAZON', showRegion: true })}</section>`;
    await page(dir, layout({
      title: `${title} | AWS IP Atlas`,
      description: `Every ${serviceLabel(sv)} (${sv}) IP range AWS publishes: ${fmt(s.v4p)} IPv4 and ${fmt(s.v6p)} IPv6 prefixes in ${regs.length} regions. Search, copy or download as text, CSV or JSON. Updated ${fmtDate(UPDATED)}.`,
      path: dir, body, updated: UPDATED,
      jsonld: [crumbsLD(items), datasetLD({ name: `AWS ${sv} IP ranges`, description: `Public prefixes AWS publishes under the ${sv} service code.`, path: dir, dir, modified: UPDATED })],
    }), 0.8);
    await files(dir, list, { service: sv });
  }
  const items = [['', 'Atlas'], ['services/', 'Services']];
  const body = `${crumbs(items)}<header class="page-head"><h1>AWS IP ranges by service</h1><p class="lede">${SERVICES.length} service codes appear in ip-ranges.json. AMAZON contains all of them.</p></header>
<div class="tw"><table class="svc-table"><thead><tr><th>Service code</th><th>Service</th><th>IPv4 prefixes</th><th>IPv6 prefixes</th><th>IPv4 addresses</th></tr></thead><tbody>${SERVICES.map((sv) => { const s = stats(rows.filter((x) => x.services.includes(sv))); return `<tr><td><a href="${href(`services/${slug(sv)}/`)}"><code>${sv}</code></a></td><td>${esc(serviceLabel(sv))}</td><td>${fmt(s.v4p)}</td><td>${fmt(s.v6p)}</td><td>${fmtAddrs(s.v4a)}</td></tr>`; }).join('')}</tbody></table></div>`;
  await page('services/', layout({ title: 'AWS IP ranges by service (S3, CloudFront, EC2 and more) | AWS IP Atlas', description: `IP ranges for every AWS service code in ip-ranges.json: CloudFront, S3, EC2, Route 53, API Gateway, DynamoDB and more. Updated ${fmtDate(UPDATED)}.`, path: 'services/', body, updated: UPDATED, jsonld: [crumbsLD(items)] }), 0.9);
}

// ---------- changes + feed ----------
async function changePages() {
  const items = [['', 'Atlas'], ['changes/', 'Changes']];
  const body = `${crumbs(items)}<header class="page-head"><h1>AWS IP range change log</h1><p class="lede">Every time AWS republishes ip-ranges.json, this page records which prefixes were added and removed. Subscribe with the <a href="${href('changes.xml')}">Atom feed</a>.</p></header>
<section><h2 class="section-title">Live changes</h2>${changes.length ? `<ol class="events full">${changes.map((ev) => `<li id="sync-${ev.sync}"><time datetime="${ev.t}" data-ago>${fmtDate(ev.t)}</time><span class="counts"><b class="pos">+${fmt(ev.added.length)}</b> <b class="neg">-${fmt(ev.removed.length)}</b> <code class="muted">syncToken ${ev.sync}</code></span>${changeSummary(ev, 8)}<details><summary>Show prefixes</summary><ul class="raw">${ev.added.map((e) => `<li class="add">+ <code>${esc(e[0])}</code> ${esc(e[1])} ${esc(e[3])}</li>`).join('')}${ev.removed.map((e) => `<li class="rem">- <code>${esc(e[0])}</code> ${esc(e[1])} ${esc(e[3])}</li>`).join('')}</ul></details></li>`).join('')}</ol>` : `<p class="empty">Tracking started; the first live change will appear here.</p>`}</section>
<section><h2 class="section-title">Month by month since ${fmtMonth(ARCHIVE_START)}</h2><p class="muted">Reconstructed from archived copies of the file, comparing the last capture of each month.</p>${ledgerTable(200)}</section>`;
  await page('changes/', layout({ title: 'AWS IP range changes: live log of ip-ranges.json updates | AWS IP Atlas', description: 'See which AWS IP prefixes were added or removed each time ip-ranges.json changes, plus a month-by-month history since 2015. Atom feed available.', path: 'changes/', body, updated: UPDATED, jsonld: [crumbsLD(items)] }), 0.9);

  const entries = changes.slice(0, 50).map((ev) => `<entry><id>${abs(`changes/#sync-${ev.sync}`)}</id><title>AWS IP ranges changed: +${ev.added.length} / -${ev.removed.length}</title><updated>${ev.t}</updated><link href="${abs(`changes/#sync-${ev.sync}`)}"/><content type="html">${esc(changeSummary(ev, 20))}</content></entry>`).join('');
  await write('changes.xml', `<?xml version="1.0" encoding="utf-8"?><feed xmlns="http://www.w3.org/2005/Atom"><title>AWS IP range changes (AWS IP Atlas)</title><id>${abs('changes.xml')}</id><link rel="self" href="${abs('changes.xml')}"/><link href="${abs('changes/')}"/><updated>${UPDATED}</updated><author><name>AWS IP Atlas</name></author>${entries}</feed>`);
}

// ---------- API page ----------
async function apiPage() {
  const items = [['', 'Atlas'], ['api/', 'API']];
  const ep = [
    ['ip-ranges.json', 'Byte-for-byte mirror of the latest AWS file.'],
    ['ipv4.txt', 'Every AWS IPv4 prefix, one per line.'],
    ['ipv6.txt', 'Every AWS IPv6 prefix, one per line.'],
    ['ranges.csv', 'prefix, IP version, region, network border group, services.'],
    ['regions/{region}/ipv4.txt', 'One region, for example regions/eu-west-1/ipv4.txt. Also ipv6.txt, ranges.csv, ranges.json.'],
    ['services/{service}/ipv4.txt', 'One service code in lowercase with dashes, for example services/cloudfront-origin-facing/ipv4.txt.'],
    ['regions/{region}/{service}/ipv4.txt', 'One service in one region, for example regions/ap-south-1/s3/ipv4.txt.'],
    ['data/atlas.json', 'Compact index used by the search on this site.'],
    ['data/history.json', 'IPv4 address totals per region per snapshot since 2015.'],
    ['changes.xml', 'Atom feed of every change.'],
  ];
  const body = `${crumbs(items)}<header class="page-head"><h1>AWS IP ranges API</h1><p class="lede">Static files at stable URLs, rebuilt within the hour of every change. No key, no rate limit beyond GitHub Pages, and the files are small enough to fetch in a deploy step.</p></header>
<section><div class="tw"><table class="svc-table api"><thead><tr><th>Endpoint</th><th>What you get</th></tr></thead><tbody>${ep.map(([p, d]) => `<tr><td><code data-copy>${abs(p)}</code></td><td>${esc(d)}</td></tr>`).join('')}</tbody></table></div></section>
<section><h2 class="section-title">Examples</h2>
<h3>Shell</h3><pre><code data-copy>curl -s ${abs('services/cloudfront-origin-facing/ipv4.txt')}</code></pre>
<h3>Terraform</h3><pre><code data-copy>data "http" "cloudfront" {
  url = "${abs('services/cloudfront-origin-facing/ipv4.txt')}"
}

locals {
  cloudfront_cidrs = compact(split("\\n", data.http.cloudfront.response_body))
}</code></pre>
<h3>Python</h3><pre><code data-copy>import ipaddress, urllib.request

url = "${abs('ipv4.txt')}"
nets = [ipaddress.ip_network(l) for l in urllib.request.urlopen(url).read().decode().split()]
print(any(ipaddress.ip_address("52.95.110.1") in n for n in nets))</code></pre>
<p class="muted">For production allowlists that must react within minutes, subscribe to AWS's own SNS topic <code>${SITE.snsTopic}</code> and read the <a href="${SITE.source}">source file</a> directly; this site is a convenience layer on top.</p></section>`;
  await page('api/', layout({ title: 'AWS IP ranges API: plain-text, CSV and JSON endpoints | AWS IP Atlas', description: 'Stable URLs for AWS IP ranges by region and service in text, CSV and JSON, plus an Atom feed of changes. Ready for curl, Terraform and Python.', path: 'api/', body, updated: UPDATED, jsonld: [crumbsLD(items)] }), 0.7);
}

// ---------- client data ----------
async function clientData() {
  const S = Object.fromEntries(SERVICES.map((s, i) => [s, i]));
  const N = Object.fromEntries(NBGS.map((n, i) => [n, i]));
  const current = new Set(rows.map((r) => r.cidr));
  const former = Object.entries(prefixHist).filter(([c]) => !current.has(c)).map(([c, h]) => [c, h.r, h.s, h.f, h.l]);
  const atlas = {
    sync: String(raw.syncToken), t: UPDATED, archiveStart: ARCHIVE_START,
    regions: REGIONS.map((r) => [r, regionLabel(r).name, regionLabel(r).announced ? 1 : 0, geoOf(r)]),
    services: SERVICES.map((s) => [s, serviceLabel(s)]),
    nbgs: NBGS,
    rows: rows.map((r) => [r.cidr, RI[r.region], N[r.nbg], r.services.map((s) => S[s]), prefixHist[r.cidr]?.f || '']),
    former,
    palette: REGIONS.map((r) => [PAL[r].full, PAL[r].partial]),
  };
  await write('data/atlas.json', JSON.stringify(atlas));
  await write('data/history.json', JSON.stringify(history));
  await write('ip-ranges.json', JSON.stringify(raw));
}

// ---------- assets + meta ----------
async function assets() {
  await fs.cp(path.join(ROOT, 'src', 'lib'), path.join(DIST, 'assets', 'lib'), { recursive: true });
  for (const f of ['app.js', 'styles.css']) await fs.copyFile(path.join(ROOT, 'src', f), path.join(DIST, 'assets', f));
  const stat = path.join(ROOT, 'src', 'static');
  await fs.cp(stat, DIST, { recursive: true }).catch(() => {});
  await write('robots.txt', `User-agent: *\nAllow: /\nSitemap: ${abs('sitemap.xml')}\n`);
  await write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages.map((p) => `<url><loc>${p.loc}</loc><lastmod>${UPDATED.slice(0, 10)}</lastmod><priority>${p.priority.toFixed(1)}</priority></url>`).join('\n')}\n</urlset>\n`);
  await write('site.webmanifest', JSON.stringify({ name: SITE.name, short_name: 'IP Atlas', start_url: SITE.base, display: 'standalone', background_color: '#f6f1e7', theme_color: '#f6f1e7', icons: [{ src: `${SITE.base}favicon.svg`, sizes: 'any', type: 'image/svg+xml' }] }));
  await write('404.html', layout({ title: 'Not found | AWS IP Atlas', description: 'This page is not on the map. Search AWS IP ranges or browse by region and service.', path: '404.html', noindex: true, updated: UPDATED, body: `<header class="page-head"><h1>That page isn't on the map.</h1><p class="lede">Try the <a href="${href()}">search</a>, or browse <a href="${href('regions/')}">regions</a> and <a href="${href('services/')}">services</a>.</p></header>` }));
  await write('.nojekyll', '');
}

await fs.rm(DIST, { recursive: true, force: true });
const t0 = Date.now();
const mapInfo = await maps();
await home(mapInfo);
await regionPages();
await servicePages();
await changePages();
await apiPage();
await clientData();
await assets();
console.log(`built ${pages.length} pages in ${Date.now() - t0} ms -> ${path.relative(ROOT, DIST)}/ (sync ${raw.syncToken})`);
