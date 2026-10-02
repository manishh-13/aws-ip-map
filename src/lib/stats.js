// Turn a raw ip-ranges.json document into summary stats. Pure ESM.
import { parseTarget, unionSize } from './ip.js';

export function createDateToISO(createDate) {
  // "2026-10-02-12-17-06" -> "2026-10-02T12:17:06Z"
  const m = /^(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})$/.exec(createDate || '');
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z` : null;
}

/** Normalise both prefix arrays into one list of {cidr, v, region, nbg, service}. */
export function entries(doc) {
  const out = [];
  for (const p of doc.prefixes || []) {
    out.push({ cidr: p.ip_prefix, v: 4, region: p.region, nbg: p.network_border_group || p.region, service: p.service });
  }
  for (const p of doc.ipv6_prefixes || []) {
    out.push({ cidr: p.ipv6_prefix, v: 6, region: p.region, nbg: p.network_border_group || p.region, service: p.service });
  }
  return out;
}

/** Group entries by CIDR: one row per prefix with the set of services. */
export function groupByPrefix(doc) {
  const map = new Map();
  for (const e of entries(doc)) {
    const key = `${e.cidr}|${e.region}|${e.nbg}`;
    let row = map.get(key);
    if (!row) { row = { cidr: e.cidr, v: e.v, region: e.region, nbg: e.nbg, services: new Set() }; map.set(key, row); }
    row.services.add(e.service);
  }
  return [...map.values()].map((r) => ({ ...r, services: [...r.services].sort() }));
}

export function summarize(doc) {
  const rows = groupByPrefix(doc);
  const v4All = [], perRegion = {}, perService = {};
  const regionCounts = {}, serviceCounts = {};
  for (const r of rows) {
    const t = parseTarget(r.cidr);
    if (!t) continue;
    const bump = (obj, k) => { obj[k] ??= { v4p: 0, v6p: 0 }; obj[k][t.v === 4 ? 'v4p' : 'v6p']++; };
    bump(regionCounts, r.region);
    for (const s of r.services) bump(serviceCounts, s);
    if (t.v !== 4) continue;
    v4All.push(t);
    (perRegion[r.region] ??= []).push(t);
    for (const s of r.services) (perService[s] ??= []).push(t);
  }
  const sizes = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Number(unionSize(v))]));
  return {
    t: createDateToISO(doc.createDate),
    sync: String(doc.syncToken),
    v4p: (doc.prefixes || []).length,
    v6p: (doc.ipv6_prefixes || []).length,
    v4a: Number(unionSize(v4All)),
    regions: sizes(perRegion),
    services: sizes(perService),
    regionCounts,
    serviceCounts,
  };
}

/** Diff two raw docs at the (cidr, region, nbg, service) level. */
export function diffDocs(prev, next) {
  const key = (e) => `${e.cidr}|${e.region}|${e.nbg}|${e.service}`;
  const a = new Map(entries(prev).map((e) => [key(e), e]));
  const b = new Map(entries(next).map((e) => [key(e), e]));
  const added = [], removed = [];
  for (const [k, e] of b) if (!a.has(k)) added.push(e);
  for (const [k, e] of a) if (!b.has(k)) removed.push(e);
  const sort = (x, y) => (x.cidr + x.service).localeCompare(y.cidr + y.service);
  return { added: added.sort(sort), removed: removed.sort(sort) };
}

/** Merge a doc into a prefix history map: cidr -> {f, l, region, services}. */
export function updatePrefixHistory(hist, doc, when) {
  for (const r of groupByPrefix(doc)) {
    const h = hist[r.cidr];
    if (!h) hist[r.cidr] = { f: when, l: when, r: r.region, s: r.services };
    else {
      if (when < h.f) h.f = when;
      if (when >= h.l) { h.l = when; h.r = r.region; h.s = r.services; }
    }
  }
  return hist;
}
