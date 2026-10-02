import { parseTarget, formatIPv4, formatIP, tokenize, aggregate, addressCount, cidrString } from './lib/ip.js';
import { xy2d, d2xy } from './lib/hilbert.js';
import { buildCells, MAP_SIDE, PIXEL_BITS } from './lib/map.js';

const BASE = document.body.dataset.base || '/';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (n) => Number(n).toLocaleString('en-US');
const fmtAddrs = (n) => { n = Number(n); return n >= 1e9 ? `${(n / 1e9).toFixed(2)} billion` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} million` : fmt(n); };
const month = (d) => (d ? new Date(d + (d.length === 10 ? 'T00:00:00Z' : '')).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : '');
const slug = (s) => s.toLowerCase().replace(/_/g, '-');
const prefersReduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
let mapApi = null;

// ---------- small global helpers ----------
function ago(iso) {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return 'just now';
  const units = [[86400 * 365, 'year'], [86400 * 30, 'month'], [86400, 'day'], [3600, 'hour'], [60, 'minute']];
  for (const [n, u] of units) if (s >= n) { const v = Math.floor(s / n); return `${v} ${u}${v > 1 ? 's' : ''} ago`; }
  return 'just now';
}
function tickAgo() { $$('time[data-ago]').forEach((t) => { t.textContent = ago(t.dateTime); t.title = new Date(t.dateTime).toUTCString(); }); }
tickAgo(); setInterval(tickAgo, 30000);

let toastEl;
function toast(msg) {
  toastEl ??= Object.assign(document.body.appendChild(document.createElement('div')), { className: 'toast', role: 'status' });
  toastEl.textContent = msg; toastEl.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => toastEl.classList.remove('show'), 1600);
}
async function copy(text, label = 'Copied') {
  try { await navigator.clipboard.writeText(text); toast(label); } catch { toast('Copy failed: select and copy manually'); }
}
document.addEventListener('click', (e) => {
  const c = e.target.closest('[data-copy]');
  if (c && !e.target.closest('a')) copy(c.textContent.trim(), `Copied ${c.textContent.trim().length > 40 ? '' : c.textContent.trim()}`.trim());
});
function download(name, text) {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([text], { type: 'text/plain' })), download: name });
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- theme + glass ----------
const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
$('.theme-toggle')?.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('theme', next); } catch {}
  dispatchEvent(new Event('themechange'));
});

// ---------- prefix lists (region/service pages) ----------
$$('.prefix-block').forEach((block) => {
  const input = $('.filter', block), items = $$('.prefixes li', block);
  let fam = 'all';
  const apply = () => {
    const q = input.value.trim().toLowerCase();
    let shown = 0;
    for (const li of items) {
      const ok = (fam === 'all' || li.dataset.v === fam) && (!q || li.textContent.toLowerCase().includes(q));
      li.hidden = !ok; if (ok) shown++;
    }
    input.placeholder = `Filter ${fmt(items.length)} prefixes`;
    block.dataset.shown = shown;
  };
  input.addEventListener('input', apply);
  $$('[data-fam]', block).forEach((b) => b.addEventListener('click', () => {
    fam = b.dataset.fam; $$('[data-fam]', block).forEach((x) => x.setAttribute('aria-pressed', String(x === b))); apply();
  }));
  $('[data-copy-list]', block).addEventListener('click', () => {
    const list = items.filter((li) => !li.hidden).map((li) => $('code', li).textContent);
    copy(list.join('\n'), `Copied ${fmt(list.length)} prefixes`);
  });
});

// ---------- charts ----------
$$('.chart').forEach((chart) => {
  const data = JSON.parse(chart.dataset.chart);
  const svg = $('svg', chart), tip = $('.chart-tip', chart), cursor = $('.cursor', chart);
  const [W, H] = svg.viewBox.baseVal ? [svg.viewBox.baseVal.width, svg.viewBox.baseVal.height] : [960, 340];
  const L = 56, R = Number(chart.dataset.pr || 16);
  const t0 = Date.parse(data[0].t), t1 = Date.parse(data[data.length - 1].t);
  const xOf = (t) => L + ((Date.parse(t) - t0) / (t1 - t0 || 1)) * (W - L - R);
  const labels = { na: 'North America', sa: 'South America', eu: 'Europe', mea: 'Middle East and Africa', ap: 'Asia Pacific', cn: 'China', gov: 'GovCloud', global: 'Global' };
  svg.addEventListener('pointermove', (e) => {
    const r = svg.getBoundingClientRect();
    const vx = ((e.clientX - r.left) / r.width) * W;
    let best = 0;
    data.forEach((p, i) => { if (Math.abs(xOf(p.t) - vx) < Math.abs(xOf(data[best].t) - vx)) best = i; });
    const p = data[best], x = xOf(p.t);
    cursor.setAttribute('x1', x); cursor.setAttribute('x2', x);
    const parts = p.by ? Object.entries(p.by).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([g, v]) => `<li><i class="sw geo-${g}"></i>${labels[g]}<b>${fmtAddrs(v)}</b></li>`).join('') : '';
    tip.innerHTML = `<strong>${month(p.t.slice(0, 10))}</strong><span>${fmtAddrs(p.total)} IPv4 addresses</span>${parts ? `<ul>${parts}</ul>` : ''}`;
    tip.hidden = false;
    const left = (x / W) * r.width;
    tip.style.left = `${Math.min(Math.max(left, 90), r.width - 90)}px`;
  });
  svg.addEventListener('pointerleave', () => { tip.hidden = true; cursor.setAttribute('x1', -10); cursor.setAttribute('x2', -10); });
});

// ---------- data for the home page ----------
let atlasP;
function loadAtlas() {
  atlasP ??= fetch(`${BASE}data/atlas.json`).then((r) => r.json()).then((a) => {
    a.parsed = a.rows.map(([cidr, ri, ni, sv, f]) => {
      const t = parseTarget(cidr);
      return { cidr, ri, ni, sv, f, t, s4: t.v === 4 ? Number(t.start) : 0, e4: t.v === 4 ? Number(t.end) : 0 };
    });
    a.v4 = a.parsed.filter((r) => r.t.v === 4);
    a.v6 = a.parsed.filter((r) => r.t.v === 6);
    return a;
  });
  return atlasP;
}

function containing(a, t) {
  if (t.v === 4) { const s = Number(t.start), e = Number(t.end); return a.v4.filter((r) => r.s4 <= s && r.e4 >= e); }
  return a.v6.filter((r) => r.t.start <= t.start && r.t.end >= t.end);
}
function inside(a, t) {
  const list = t.v === 4 ? a.v4 : a.v6;
  return list.filter((r) => r.t.start >= t.start && r.t.end <= t.end && !(r.t.start === t.start && r.t.end === t.end));
}
const bySpecific = (x, y) => y.t.len - x.t.len;
function formerHit(a, t) {
  a.formerParsed ??= a.former.map(([c, r, s, f, l]) => ({ c, r, s, f, l, t: parseTarget(c) })).filter((x) => x.t);
  return a.formerParsed.filter((x) => x.t.v === t.v && x.t.start <= t.start && x.t.end >= t.end).sort((x, y) => y.t.len - x.t.len)[0];
}

const regionLink = (a, ri) => { const [code, name, announced] = a.regions[ri]; return `<a href="${BASE}regions/${code}/">${esc(code)}</a> <span class="muted">${announced ? esc(name) : 'name not yet published'}</span>`; };
const svcTags = (a, sv) => sv.map((i) => a.services[i][0]).filter((s, _, all) => s !== 'AMAZON' || all.length === 1).map((s) => `<a class="tag" href="${BASE}services/${slug(s)}/">${esc(s)}</a>`).join('');

// ---------- search ----------
const form = $('.search');
if (form) {
  const q = $('#q'), out = $('#results');
  const grow = () => { q.style.height = 'auto'; q.style.height = `${Math.min(q.scrollHeight, 220)}px`; };
  q.addEventListener('input', () => { grow(); schedule(); });
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); run(true); } });
  form.addEventListener('submit', (e) => { e.preventDefault(); run(true); });
  $$('[data-q]').forEach((b) => b.addEventListener('click', () => { q.value = b.dataset.q; grow(); run(true); q.focus(); }));
  let timer; const schedule = () => { clearTimeout(timer); timer = setTimeout(() => run(false), 160); };

  async function run(push) {
    const text = q.value.trim();
    const url = new URL(location.href);
    if (text) url.searchParams.set('q', text); else url.searchParams.delete('q');
    history.replaceState(null, '', url);
    if (!text) { out.innerHTML = ''; mapApi?.mark(null); return; }
    const a = await loadAtlas();
    const tokens = tokenize(text);
    const targets = tokens.map((tok) => [tok, parseTarget(tok)]).filter(([, t]) => t);
    if (targets.length > 1) out.innerHTML = bulk(a, targets);
    else if (targets.length === 1 && tokens.length <= 2) out.innerHTML = single(a, targets[0][1]);
    else out.innerHTML = textSearch(a, text);
    out.classList.remove('in'); void out.offsetWidth; out.classList.add('in');
    $('[data-copy-csv]', out)?.addEventListener('click', (e) => copy(e.currentTarget.dataset.csv, 'Copied results as CSV'));
    $('.copy-result', out)?.addEventListener('click', (e) => copy(e.currentTarget.dataset.result, 'Copied result'));
    if (push && innerWidth < 900) out.scrollIntoView({ behavior: prefersReduced ? 'auto' : 'smooth', block: 'start' });
  }

  function single(a, t) {
    const hits = containing(a, t).sort(bySpecific);
    const within = t.isRange ? inside(a, t).sort((x, y) => (x.t.start < y.t.start ? -1 : 1)) : [];
    const label = t.isRange ? cidrString(t) : formatIP(t.start, t.v);
    if (t.v === 4) mapApi?.mark(Number(t.start));
    if (!hits.length && !within.length) {
      const was = formerHit(a, t);
      return `<div class="verdict no"><p class="v-head"><span class="dot"></span><code>${esc(label)}</code> is not in AWS's published ranges</p><button type="button" class="btn ghost copy-result" data-result="${esc(`${label}: not in AWS ip-ranges.json (syncToken ${a.sync})`)}">Copy result</button>
      ${was ? `<p>It used to be: <code>${esc(was.c)}</code> was listed for <a href="${BASE}regions/${esc(was.r)}/">${esc(was.r)}</a> (${esc(was.s.join(', '))}) from ${month(was.f)} until ${month(was.l)}.</p>` : `<p class="muted">Not listed in ip-ranges.json today${a.archiveStart ? `, and not in any archived version since ${month(a.archiveStart.slice(0, 10))}` : ''}. AWS customers can also bring their own IP ranges, which AWS doesn't publish.</p>`}</div>`;
    }
    const top = hits[0];
    const headline = top
      ? `<div class="verdict yes"><p class="v-head"><span class="dot"></span><code>${esc(label)}</code> is AWS</p>
        <button type="button" class="btn ghost copy-result" data-result="${esc(`${label}: AWS, ${[...new Set(hits.flatMap((h) => h.sv))].map((i) => a.services[i][0]).filter((x, _, l) => x !== 'AMAZON' || l.length === 1).join(' + ')}, ${a.regions[top.ri][0]} (${top.cidr}, border group ${a.nbgs[top.ni]})`)}">Copy result</button>
        <dl class="hit">
          <div><dt>Most specific prefix</dt><dd><code data-copy>${esc(top.cidr)}</code> <span class="muted">${fmtAddrs(addressCount(top.t.v, top.t.len))} addresses</span></dd></div>
          <div><dt>Region</dt><dd>${regionLink(a, top.ri)}</dd></div>
          <div><dt>Service codes</dt><dd>${[...new Set(hits.flatMap((h) => h.sv))].length ? svcTags(a, [...new Set(hits.flatMap((h) => h.sv))]) : ''}</dd></div>
          <div><dt>Network border group</dt><dd><code>${esc(a.nbgs[top.ni])}</code></dd></div>
          ${top.f ? `<div><dt>In the file since</dt><dd>${top.f.slice(0, 10) <= a.archiveStart.slice(0, 10) ? `at least ${month(a.archiveStart.slice(0, 10))}` : month(top.f)}</dd></div>` : ''}
        </dl></div>`
      : `<div class="verdict partial"><p class="v-head"><span class="dot"></span><code>${esc(label)}</code> is partly AWS</p><p>${fmt(within.length)} AWS prefixes sit inside this range.</p></div>`;
    const all = hits.length > 1 ? `<h3 class="r-sub">Every published prefix containing it</h3><table class="mini"><tbody>${hits.map((h) => `<tr><td><code data-copy>${esc(h.cidr)}</code></td><td>${regionLink(a, h.ri)}</td><td>${svcTags(a, h.sv)}</td></tr>`).join('')}</tbody></table>` : '';
    const inner = within.length ? `<h3 class="r-sub">${fmt(within.length)} prefixes inside ${esc(label)}</h3><table class="mini"><tbody>${within.slice(0, 60).map((h) => `<tr><td><code data-copy>${esc(h.cidr)}</code></td><td>${regionLink(a, h.ri)}</td><td>${svcTags(a, h.sv)}</td></tr>`).join('')}</tbody></table>${within.length > 60 ? `<p class="muted">Showing 60 of ${fmt(within.length)}.</p>` : ''}` : '';
    return headline + all + inner;
  }

  function bulk(a, targets) {
    mapApi?.mark(null);
    const res = targets.slice(0, 5000).map(([tok, t]) => ({ tok, t, h: containing(a, t).sort(bySpecific)[0] }));
    const yes = res.filter((r) => r.h).length;
    const csv = ['input,is_aws,prefix,region,network_border_group,services', ...res.map((r) => r.h ? `${r.tok},yes,${r.h.cidr},${a.regions[r.h.ri][0]},${a.nbgs[r.h.ni]},${r.h.sv.map((i) => a.services[i][0]).join(' ')}` : `${r.tok},no,,,,`)].join('\n');
    return `<div class="bulk-head"><p><b>${fmt(yes)}</b> of ${fmt(res.length)} are AWS</p><button type="button" class="btn ghost" data-copy-csv data-csv="${esc(csv)}">Copy as CSV</button></div>
    <table class="mini bulk"><thead><tr><th>Input</th><th>Prefix</th><th>Region</th><th>Services</th></tr></thead><tbody>${res.slice(0, 500).map((r) => `<tr class="${r.h ? 'is' : 'not'}"><td><code>${esc(r.tok)}</code></td>${r.h ? `<td><code>${esc(r.h.cidr)}</code></td><td>${regionLink(a, r.h.ri)}</td><td>${svcTags(a, r.h.sv)}</td>` : '<td colspan="3" class="muted">Not AWS</td>'}</tr>`).join('')}</tbody></table>${res.length > 500 ? `<p class="muted">Showing 500 rows; the CSV has all ${fmt(res.length)}.</p>` : ''}`;
  }

  function textSearch(a, text) {
    mapApi?.mark(null);
    const s = text.toLowerCase();
    const regs = a.regions.filter(([c, n]) => c.toLowerCase().includes(s) || n.toLowerCase().includes(s));
    const svcs = a.services.filter(([c, n]) => c.toLowerCase().includes(s) || c.toLowerCase().replace(/_/g, ' ').includes(s) || n.toLowerCase().includes(s));
    if (!regs.length && !svcs.length) return `<div class="verdict no"><p class="v-head"><span class="dot"></span>No IP, region or service matches "${esc(text)}"</p><p class="muted">Try an address like 3.5.140.2, a CIDR like 52.94.0.0/16, a region code like eu-west-1, or a service like S3.</p></div>`;
    const count = (pred) => a.parsed.filter(pred).length;
    return `<div class="matches">${regs.map(([c, n, ann]) => { const ri = a.regions.findIndex((r) => r[0] === c); return `<a class="match" href="${BASE}regions/${c}/"><span class="k">Region</span><code>${esc(c)}</code><span>${ann ? esc(n) : 'Not yet announced'}</span><small>${fmt(count((r) => r.ri === ri))} prefixes</small></a>`; }).join('')}
    ${svcs.map(([c, n]) => { const si = a.services.findIndex((x) => x[0] === c); return `<a class="match" href="${BASE}services/${slug(c)}/"><span class="k">Service</span><code>${esc(c)}</code><span>${esc(n)}</span><small>${fmt(count((r) => r.sv.includes(si)))} prefixes</small></a>`; }).join('')}</div>`;
  }

  const initial = new URL(location.href).searchParams.get('q');
  if (initial) { q.value = initial; grow(); run(false); }
  else q.focus({ preventScroll: true });
}

// ---------- map ----------
const mapEl = $('#map');
if (mapEl) mapApi = initMap(mapEl);

function initMap(root) {
  const wrap = $('.map-wrap', root), img = $('.map-img', root), overlay = $('.map-overlay', root), zoomC = $('.map-zoom', root);
  const loupe = $('.loupe', root), lctx = $('canvas', loupe).getContext('2d'), tip = $('.map-tip', root);
  const back = $('.map-back', root), where = $('.map-where', root);
  const ctx = overlay.getContext('2d'), zctx = zoomC.getContext('2d');
  let cells = null, a = null, focusGeo = null, marker = null, table = null, zoom = null;
  const dimCache = {};

  loadAtlas().then((atlas) => { a = atlas; cells = buildCells(a.v4.map((r) => ({ cidr: r.cidr, ri: r.ri }))); draw(); });

  function hilbert() {
    if (table) return table;
    const n = MAP_SIDE * MAP_SIDE, xs = new Uint16Array(n), ys = new Uint16Array(n);
    for (let d = 0; d < n; d++) { const [x, y] = d2xy(MAP_SIDE, d); xs[d] = x; ys[d] = y; }
    return (table = { xs, ys });
  }
  function dimLayer(geo) {
    if (dimCache[geo]) return dimCache[geo];
    const { xs, ys } = hilbert();
    const im = ctx.createImageData(MAP_SIDE, MAP_SIDE), px = im.data;
    const bg = cssVar('--map-bg').split(/[ ,]+/).map(Number);
    for (let d = 0; d < cells.length; d++) {
      const c = cells[d]; const i = (ys[d] * MAP_SIDE + xs[d]) * 4;
      if (!c || a.regions[(c - 1) >> 1][3] === geo) continue;
      px[i] = bg[0]; px[i + 1] = bg[1]; px[i + 2] = bg[2]; px[i + 3] = 215;
    }
    return (dimCache[geo] = im);
  }

  // ---- zoomed view: one /8, 256 x 256 grid of /24s, 4 px each ----
  const Z = 256, ZP = MAP_SIDE / Z;
  function paintZoom(octet) {
    const base = octet * 2 ** 24, end = base + 2 ** 24 - 1;
    zctx.clearRect(0, 0, MAP_SIDE, MAP_SIDE);
    // faint /16 tiles
    zctx.fillStyle = 'rgba(128, 136, 160, 0.09)';
    for (let o = 0; o < 256; o++) { const [x, y] = d2xy(16, o); if ((o & 1) === 0) zctx.fillRect(x * 64, y * 64, 64, 64); }
    const rows = a.v4.filter((r) => r.s4 <= end && r.e4 >= base).sort((p, q) => p.t.len - q.t.len);
    for (const r of rows) {
      const s = Math.max(r.s4, base), e = Math.min(r.e4, end);
      const d0 = Math.floor((s - base) / 256), d1 = Math.floor((e - base) / 256);
      const [full, part] = a.palette[r.ri];
      const geo = a.regions[r.ri][3];
      const dim = focusGeo && geo !== focusGeo;
      const c = r.t.len <= 24 ? full : part;
      zctx.fillStyle = dim ? 'rgba(128, 136, 160, 0.22)' : `rgb(${c.join(',')})`;
      for (let d = d0; d <= d1; d++) { const [x, y] = d2xy(Z, d); zctx.fillRect(x * ZP, y * ZP, ZP, ZP); }
    }
    zctx.font = '500 14px "Atkinson Hyperlegible Mono", ui-monospace, monospace'; zctx.textBaseline = 'top'; zctx.fillStyle = cssVar('--map-label');
    for (let o = 0; o < 256; o++) { const [x, y] = d2xy(16, o); zctx.fillText(`${octet}.${o}`, x * 64 + 3, y * 64 + 3); }
  }
  function setZoom(octet, animate = true) {
    if (octet === zoom) return;
    zoom = octet;
    wrap.classList.toggle('zoomed', octet !== null);
    back.hidden = octet === null;
    where.textContent = octet === null ? 'The whole IPv4 internet' : `${octet}.0.0.0/8, each pixel a /24`;
    if (octet !== null && a) {
      paintZoom(octet);
      if (animate && !prefersReduced) {
        const [tx, ty] = d2xy(16, octet);
        zoomC.style.transformOrigin = `${((tx * 64 + 32) / MAP_SIDE) * 100}% ${((ty * 64 + 32) / MAP_SIDE) * 100}%`;
        zoomC.animate([{ transform: 'scale(0.0625)', opacity: 0.2 }, { transform: 'scale(1)', opacity: 1 }], { duration: 650, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
      }
    }
    draw();
  }
  back.addEventListener('click', (e) => { e.stopPropagation(); setZoom(null); });

  function pixelOf(ip) {
    if (zoom !== null && Math.floor(ip / 2 ** 24) === zoom) { const [x, y] = d2xy(Z, Math.floor((ip - zoom * 2 ** 24) / 256)); return [x * ZP + ZP / 2, y * ZP + ZP / 2]; }
    const [x, y] = d2xy(MAP_SIDE, Math.floor(ip / 2 ** PIXEL_BITS)); return [x + 0.5, y + 0.5];
  }
  function draw(pulse = 1) {
    ctx.clearRect(0, 0, MAP_SIDE, MAP_SIDE);
    if (zoom === null) {
      if (focusGeo && cells) ctx.putImageData(dimLayer(focusGeo), 0, 0);
      ctx.font = '500 15px "Atkinson Hyperlegible Mono", ui-monospace, monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillStyle = cssVar('--map-label');
      for (let o = 0; o < 256; o++) { const [x, y] = d2xy(16, o); ctx.fillText(String(o), x * 64 + 4, y * 64 + 3); }
    }
    if (marker !== null) {
      const [x, y] = pixelOf(marker);
      ctx.strokeStyle = cssVar('--accent'); ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(x, y, 12 + 48 * (1 - pulse), 0, Math.PI * 2); ctx.stroke();
      ctx.lineWidth = 2; ctx.beginPath();
      ctx.moveTo(x - 26, y); ctx.lineTo(x - 8, y); ctx.moveTo(x + 8, y); ctx.lineTo(x + 26, y);
      ctx.moveTo(x, y - 26); ctx.lineTo(x, y - 8); ctx.moveTo(x, y + 8); ctx.lineTo(x, y + 26); ctx.stroke();
    }
  }
  async function mark(ip) {
    marker = ip;
    if (ip !== null) { await loadAtlas(); if (!cells) { a = await loadAtlas(); cells = buildCells(a.v4.map((r) => ({ cidr: r.cidr, ri: r.ri }))); } setZoom(Math.floor(ip / 2 ** 24)); }
    if (ip === null || prefersReduced) return draw();
    const t0 = performance.now();
    const step = (now) => { const p = Math.min(1, (now - t0) / 900); draw(1 - (1 - p) ** 4); if (p < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }

  function at(e) {
    const r = wrap.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * MAP_SIDE), y = Math.floor(((e.clientY - r.top) / r.height) * MAP_SIDE);
    if (x < 0 || y < 0 || x >= MAP_SIDE || y >= MAP_SIDE) return null;
    return { x, y, r, px: e.clientX - r.left, py: e.clientY - r.top };
  }
  function blockAt(p) {
    let start, size, label;
    if (zoom === null) { const d = xy2d(MAP_SIDE, p.x, p.y); start = d * 2 ** PIXEL_BITS; size = 2 ** PIXEL_BITS; label = 20; }
    else { const d = xy2d(Z, Math.floor(p.x / ZP), Math.floor(p.y / ZP)); start = zoom * 2 ** 24 + d * 256; size = 256; label = 24; }
    const end = start + size - 1;
    const hits = a ? a.v4.filter((r) => r.s4 <= end && r.e4 >= start).sort(bySpecific) : [];
    return { start, end, hits, label };
  }
  wrap.addEventListener('pointermove', (e) => {
    if (e.target.closest('.map-back')) return;
    const p = at(e); if (!p) return;
    const { start, hits, label } = blockAt(p);
    lctx.imageSmoothingEnabled = false;
    lctx.clearRect(0, 0, 176, 176);
    const src = zoom === null ? img : zoomC, span = zoom === null ? 22 : 44;
    lctx.drawImage(src, p.x - span / 2, p.y - span / 2, span, span, 0, 0, 176, 176);
    lctx.strokeStyle = cssVar('--accent'); lctx.lineWidth = 1.5; lctx.strokeRect(84, 84, 8, 8);
    const lx = p.px + 24 + 176 > p.r.width ? p.px - 24 - 176 : p.px + 24;
    const ly = Math.max(0, Math.min(p.py - 88, p.r.height - 176));
    loupe.style.transform = `translate(${lx}px, ${ly}px)`; loupe.classList.add('on');
    const octet = Math.floor(start / 2 ** 24);
    const cidr = `${formatIPv4(start)}/${label}`;
    tip.innerHTML = hits.length
      ? `<code>${cidr}</code><span class="tip-region" style="--c:rgb(${a.palette[hits[0].ri][0].join(' ')})">${esc(a.regions[hits[0].ri][0])}</span>${hits.slice(0, 3).map((h) => `<span class="tip-line"><code>${esc(h.cidr)}</code> ${esc(h.sv.map((i) => a.services[i][0]).filter((s, _, l) => s !== 'AMAZON' || l.length === 1).join(', '))}</span>`).join('')}${hits.length > 3 ? `<span class="muted">+${hits.length - 3} more</span>` : ''}${zoom === null ? '<span class="muted">Click to zoom into this /8</span>' : ''}`
      : `<code>${cidr}</code><span class="muted">${octet >= 224 ? 'multicast and reserved space' : octet === 10 || octet === 127 || octet === 0 ? 'private or reserved space' : 'not AWS'}</span>${zoom === null ? '<span class="muted">Click to zoom into this /8</span>' : ''}`;
    tip.hidden = false;
    const tx = lx < p.px ? Math.max(0, lx) : Math.min(lx, p.r.width - 220);
    tip.style.transform = `translate(${tx}px, ${Math.min(ly + 184, p.r.height - 10)}px)`;
  });
  wrap.addEventListener('pointerleave', () => { loupe.classList.remove('on'); tip.hidden = true; });
  wrap.addEventListener('click', (e) => {
    if (e.target.closest('.map-back')) return;
    const p = at(e); if (!p || !a) return;
    const { start, hits } = blockAt(p);
    if (zoom === null) { setZoom(Math.floor(start / 2 ** 24)); return; }
    const q = $('#q'); if (!q) return;
    q.value = hits.length ? (hits[0].t.len >= 24 ? hits[0].cidr : formatIPv4(start + 1)) : `${formatIPv4(start)}/24`;
    q.dispatchEvent(new Event('input'));
    $('.search button')?.click();
  });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && zoom !== null) setZoom(null); });
  addEventListener('themechange', () => { for (const k in dimCache) delete dimCache[k]; if (zoom !== null && a) paintZoom(zoom); draw(); });
  $$('.legend button', root).forEach((b) => {
    const on = () => { if (!cells) return; focusGeo = b.dataset.geo; if (zoom !== null) paintZoom(zoom); draw(); $$('.area, .dlabel').forEach((ar) => ar.classList.toggle('faded', ar.dataset.geo !== focusGeo)); b.classList.add('on'); };
    const off = () => { focusGeo = null; if (zoom !== null) paintZoom(zoom); draw(); $$('.area, .dlabel').forEach((ar) => ar.classList.remove('faded')); b.classList.remove('on'); };
    b.addEventListener('pointerenter', on); b.addEventListener('focus', on);
    b.addEventListener('pointerleave', off); b.addEventListener('blur', off);
  });
  return { mark };
}

// ---------- allowlist builder ----------
const builder = $('.builder-form');
if (builder) {
  const outText = $('.builder-out textarea'), count = $('.out-count');
  let last = { text: '', name: 'aws-ranges.txt' };
  const render = async () => {
    const a = await loadAtlas();
    const f = Object.fromEntries(new FormData(builder));
    const si = a.services.findIndex((s) => s[0] === f.service);
    const ri = f.region ? a.regions.findIndex((r) => r[0] === f.region) : -1;
    const fams = f.fam === 'all' ? [4, 6] : [Number(f.fam)];
    let picked = a.parsed.filter((r) => r.sv.includes(si) && (ri < 0 || r.ri === ri) && fams.includes(r.t.v));
    const meta = new Map(picked.map((r) => [r.cidr, r]));
    let list;
    if (f.merge) list = fams.flatMap((v) => aggregate(picked.filter((r) => r.t.v === v).map((r) => r.t), v).map(cidrString));
    else list = [...new Set(picked.map((r) => r.cidr))];
    const v4n = picked.filter((r) => r.t.v === 4).map((r) => r.t);
    const v4a = aggregate(v4n, 4).reduce((s, t) => s + Number(addressCount(4, t.len)), 0);
    const tag = `aws-${slug(f.service)}${f.region ? `-${f.region}` : ''}`;
    const fmtOut = {
      plain: () => list.join('\n'),
      csv: () => f.merge ? ['prefix', ...list].join('\n') : ['prefix,region,network_border_group,service', ...list.map((c) => { const r = meta.get(c); return `${c},${a.regions[r.ri][0]},${a.nbgs[r.ni]},${f.service}`; })].join('\n'),
      json: () => JSON.stringify(list, null, 2),
      terraform: () => `# ${f.service}${f.region ? ` in ${f.region}` : ''}, from ip-ranges.json syncToken ${a.sync}\n${tag.replace(/-/g, '_')}_cidrs = [\n${list.map((c) => `  "${c}",`).join('\n')}\n]`,
      nginx: () => `# ${f.service}${f.region ? ` in ${f.region}` : ''} (syncToken ${a.sync})\n${list.map((c) => `allow ${c};`).join('\n')}\ndeny all;`,
      apache: () => { const lines = []; for (let i = 0; i < list.length; i += 8) lines.push(`Require ip ${list.slice(i, i + 8).join(' ')}`); return `<RequireAny>\n  ${lines.join('\n  ')}\n</RequireAny>`; },
      iptables: () => list.map((c) => `${c.includes(':') ? 'ip6tables' : 'iptables'} -A INPUT -s ${c} -j ACCEPT`).join('\n'),
      prefixlist: () => fams.length > 1 ? '# A managed prefix list holds one address family: choose IPv4 or IPv6.' : `aws ec2 create-managed-prefix-list \\\n  --prefix-list-name ${tag} \\\n  --address-family IPv${fams[0]} \\\n  --max-entries ${list.length} \\\n  --entries ${list.map((c) => `Cidr=${c},Description=${f.service}`).join(' \\\n    ')}`,
    }[f.format];
    last = { text: fmtOut(), name: `${tag}-${f.fam === 'all' ? 'ipv4-ipv6' : `ipv${f.fam}`}.${f.format === 'json' ? 'json' : f.format === 'csv' ? 'csv' : f.format === 'terraform' ? 'tf' : 'txt'}` };
    outText.value = last.text;
    count.textContent = `${fmt(list.length)} ${f.merge ? 'merged ' : ''}range${list.length === 1 ? '' : 's'}${v4n.length ? `, ${fmtAddrs(v4a)} IPv4 addresses` : ''}`;
  };
  builder.addEventListener('input', render);
  $('[data-out-copy]').addEventListener('click', () => copy(last.text, `Copied ${count.textContent}`));
  $('[data-out-download]').addEventListener('click', () => download(last.name, last.text));
  // only load the data once the builder is close to the viewport
  new IntersectionObserver((ents, obs) => { if (ents.some((e) => e.isIntersecting)) { obs.disconnect(); render(); } }, { rootMargin: '400px' }).observe(builder);
}
