// The whole history in one structure. Pure ESM, used by the import, the hourly updater, the build and the browser.
//   versions: [[syncToken, isoTime, source], ...]   oldest first; source: 'w' archive (monthly), 'j' git history, 'l' live
//   entries:  { "cidr|region|nbg|service": [start, end, start, end, ...] }   half-open version-index spans, end -1 = still listed
import { entries as docEntries, createDateToISO } from './stats.js';

export const keyOf = (e) => `${e.cidr}|${e.region}|${e.nbg}|${e.service}`;
export const splitKey = (k) => { const [cidr, region, nbg, service] = k.split('|'); return { cidr, region, nbg, service }; };
export const docKeys = (doc) => new Set(docEntries(doc).map(keyOf));

export function emptyTimeline() { return { versions: [], entries: {} }; }

/** Append a document as the newest version. Returns { added, removed } keys, or null if it is not newer. */
export function appendVersion(tl, doc, source) {
  const sync = String(doc.syncToken);
  const last = tl.versions[tl.versions.length - 1];
  if (last && Number(sync) <= Number(last[0])) return null;
  const v = tl.versions.length;
  tl.versions.push([sync, createDateToISO(doc.createDate) || new Date(Number(sync) * 1000).toISOString().replace('.000', ''), source]);
  const cur = docKeys(doc);
  const added = [], removed = [];
  for (const [k, spans] of Object.entries(tl.entries)) {
    const open = spans[spans.length - 1] === -1;
    if (open && !cur.has(k)) { spans[spans.length - 1] = v; removed.push(k); }
  }
  for (const k of cur) {
    const spans = tl.entries[k];
    if (!spans) { tl.entries[k] = [v, -1]; added.push(k); }
    else if (spans[spans.length - 1] !== -1) { spans.push(v, -1); added.push(k); }
  }
  return { added, removed, v };
}

export function isPresent(spans, v) {
  for (let i = 0; i < spans.length; i += 2) if (spans[i] <= v && (spans[i + 1] === -1 || v < spans[i + 1])) return true;
  return false;
}

/** All entry keys listed in version v. */
export function keysAt(tl, v) {
  return Object.keys(tl.entries).filter((k) => isPresent(tl.entries[k], v));
}

/** Change events: for each version v >= 1, the keys whose spans start or end at v. */
export function changeEvents(tl) {
  const ev = tl.versions.map(() => ({ added: [], removed: [] }));
  for (const [k, spans] of Object.entries(tl.entries)) {
    for (let i = 0; i < spans.length; i += 2) {
      if (spans[i] > 0) ev[spans[i]].added.push(k);
      if (spans[i + 1] !== -1) ev[spans[i + 1]].removed.push(k);
    }
  }
  return ev;
}

/** Latest version index whose time is on or before the given ISO date/time. */
export function versionAt(tl, iso) {
  let lo = 0, hi = tl.versions.length - 1, ans = 0;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (tl.versions[mid][1] <= iso) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
  return ans;
}

/** Diff-friendly serialisation: header line, then one entry per line. */
export function stringifyTimeline(tl) {
  const head = JSON.stringify({ sources: tl.sources || {}, versions: tl.versions });
  const keys = Object.keys(tl.entries).sort();
  return `${head.slice(0, -1)},"entries":{\n${keys.map((k) => `${JSON.stringify(k)}:${JSON.stringify(tl.entries[k])}`).join(',\n')}\n}}\n`;
}
