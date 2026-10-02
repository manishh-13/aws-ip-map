import { SITE } from './site.mjs';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const fmt = (n) => Number(n).toLocaleString('en-US');
export function fmtAddrs(n) {
  n = Number(n);
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} billion`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} million`;
  if (n >= 1e4) return `${(n / 1e3).toFixed(1)}k`;
  return fmt(n);
}
export const fmtDate = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
export const fmtMonth = (iso) => new Date(iso).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
export const href = (p = '') => SITE.base + p.replace(/^\//, '');
export const abs = (p = '') => SITE.url + '/' + p.replace(/^\//, '');

export const LOGO = `<svg class="logo-mark" viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 13.5v-3h3v3h5v-3h3v3M13.5 7.5v-5h-3v3h-5v-3h-3v5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square"/></svg>`;

export function layout({ title, description, path, body, jsonld = [], updated, bodyClass = '', ogImage = 'og.png', noindex = false }) {
  const canonical = abs(path);
  const nav = [
    ['', 'Atlas'], ['regions/', 'Regions'], ['services/', 'Services'], ['changes/', 'Changes'], ['api/', 'API'],
  ];
  const cur = path.replace(/^\//, '');
  return `<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
${noindex ? '<meta name="robots" content="noindex">' : `<link rel="canonical" href="${canonical}">`}
<meta name="theme-color" content="#0e1726" media="(prefers-color-scheme: dark)">
<meta name="theme-color" content="#e8eef5" media="(prefers-color-scheme: light)">
<meta name="color-scheme" content="dark light">
<script>(function(){try{var u=new URLSearchParams(location.search).get('theme');var t=(u==='light'||u==='dark')?u:localStorage.getItem('theme');if(!t)t=matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';document.documentElement.dataset.theme=t;}catch(e){}})();</script>
<meta property="og:type" content="website">
<meta property="og:site_name" content="${SITE.name}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${abs(ogImage)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="${href('favicon.svg')}" type="image/svg+xml">
<link rel="alternate" type="application/atom+xml" title="AWS IP range changes" href="${href('changes.xml')}">
<link rel="manifest" href="${href('site.webmanifest')}">
<link rel="stylesheet" href="${href('assets/styles.css')}?v=${updated}">
${jsonld.map((j) => `<script type="application/ld+json">${JSON.stringify(j).replace(/</g, '\\u003c')}</script>`).join('\n')}
<script type="module" src="${href('assets/app.js')}?v=${updated}"></script>
</head>
<body class="${bodyClass}" data-base="${SITE.base}">
<a class="skip" href="#main">Skip to content</a>
<div class="env" aria-hidden="true"></div>
<header class="site-head glass">
  <a class="brand" href="${href()}">${LOGO}<span>AWS IP Atlas</span></a>
  <nav aria-label="Main">${nav.map(([p, l]) => `<a href="${href(p)}"${(p === '' ? cur === '' : cur.startsWith(p)) ? ' aria-current="page"' : ''}>${l}</a>`).join('')}
  <a class="gh" href="${SITE.repo}" rel="noopener" aria-label="Source on GitHub"><svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 0a8 8 0 0 0-2.53 15.59c.4.07.55-.17.55-.38v-1.33c-2.23.48-2.7-1.07-2.7-1.07-.36-.92-.89-1.17-.89-1.17-.73-.5.05-.49.05-.49.8.06 1.23.83 1.23.83.72 1.22 1.87.87 2.33.66.07-.52.28-.87.5-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.28.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48v2.2c0 .21.15.46.55.38A8 8 0 0 0 8 0Z"/></svg></a>
  <button type="button" class="theme-toggle" aria-label="Switch between dark and light theme"><svg class="i-moon" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M20.7 14.6A8.5 8.5 0 0 1 9.4 3.3a8.5 8.5 0 1 0 11.3 11.3Z"/></svg><svg class="i-sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.2" fill="currentColor"/><g stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.5 1.5M17.2 17.2l1.5 1.5M5.3 18.7l1.5-1.5M17.2 6.8l1.5-1.5"/></g></svg></button></nav>
</header>
<main id="main">
${body}
</main>
<footer class="site-foot">
  <div class="foot-grid">
    <div>
      <p class="brand">${LOGO}<span>AWS IP Atlas</span></p>
      <p>A live, searchable map of every public IP range AWS publishes. Rebuilt within the hour whenever <a href="${SITE.source}">ip-ranges.json</a> changes.</p>
    </div>
    <div>
      <h2>Explore</h2>
      <a href="${href('regions/')}">All regions</a><a href="${href('services/')}">All services</a><a href="${href('changes/')}">Change log</a><a href="${href('changes.xml')}">Atom feed</a>
    </div>
    <div>
      <h2>Build with it</h2>
      <a href="${href('api/')}">Plain-text API</a><a href="${href('#allowlist')}">Allowlist builder</a><a href="${SITE.repo}">Source on GitHub</a>
    </div>
    <div>
      <h2>Source</h2>
      <a href="${SITE.docs}">AWS IP address ranges (docs)</a><a href="${SITE.syntaxDocs}">JSON syntax</a><a href="${SITE.snsDocs}">Change notifications</a>
    </div>
  </div>
  <p class="fine">Unofficial project, not affiliated with or endorsed by Amazon Web Services. Data from AWS's public ip-ranges.json, synced ${updated ? `<time datetime="${updated}" data-ago>${fmtDate(updated)}</time>` : ''}. Open source under the MIT license.</p>
</footer>
</body>
</html>`;
}

export function crumbs(items) {
  return `<nav class="crumbs" aria-label="Breadcrumb">${items.map(([p, l], i) => i === items.length - 1 ? `<span aria-current="page">${esc(l)}</span>` : `<a href="${href(p)}">${esc(l)}</a>`).join('<span class="sep">/</span>')}</nav>`;
}

export function crumbsLD(items) {
  return { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: items.map(([p, l], i) => ({ '@type': 'ListItem', position: i + 1, name: l, item: abs(p) })) };
}

export function downloads(dir, label) {
  const files = [['ipv4.txt', 'IPv4 .txt'], ['ipv6.txt', 'IPv6 .txt'], ['ranges.csv', 'CSV'], ['ranges.json', 'JSON']];
  return `<div class="downloads" aria-label="Download ${esc(label)}">
  ${files.map(([f, l]) => `<a class="chip dl" href="${href(dir + f)}" download>${l}</a>`).join('')}
  <code class="curl" data-copy>curl -s ${abs(dir + 'ipv4.txt')}</code>
</div>`;
}

export function datasetLD({ name, description, path, dir, modified, temporal }) {
  return {
    '@context': 'https://schema.org', '@type': 'Dataset', name, description, url: abs(path),
    isBasedOn: SITE.source, dateModified: modified, isAccessibleForFree: true,
    keywords: ['AWS IP ranges', 'AWS IP address ranges', 'Amazon IP ranges', 'ip-ranges.json', 'CIDR', 'allowlist'],
    creator: { '@type': 'Person', name: 'manishh-13', url: 'https://github.com/manishh-13' },
    ...(temporal ? { temporalCoverage: temporal } : {}),
    distribution: dir ? [
      { '@type': 'DataDownload', encodingFormat: 'text/plain', contentUrl: abs(dir + 'ipv4.txt') },
      { '@type': 'DataDownload', encodingFormat: 'text/csv', contentUrl: abs(dir + 'ranges.csv') },
      { '@type': 'DataDownload', encodingFormat: 'application/json', contentUrl: abs(dir + 'ranges.json') },
    ] : undefined,
  };
}
