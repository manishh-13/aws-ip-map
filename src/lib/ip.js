// Pure ESM, shared by the build scripts (Node) and the browser.

const V4_MAX = (1n << 32n) - 1n;
const V6_MAX = (1n << 128n) - 1n;

export function parseIPv4(s) {
  if (typeof s !== 'string') return null;
  const parts = s.trim().split('.');
  if (parts.length !== 4) return null;
  let n = 0n;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = (n << 8n) | BigInt(v);
  }
  return n;
}

export function parseIPv6(s) {
  if (typeof s !== 'string') return null;
  s = s.trim().toLowerCase();
  if (s.startsWith('[') && s.endsWith(']')) s = s.slice(1, -1);
  const zone = s.indexOf('%');
  if (zone !== -1) s = s.slice(0, zone);
  if (!s.includes(':')) return null;
  // embedded IPv4 tail, e.g. ::ffff:1.2.3.4
  let tailV4 = null;
  const lastColon = s.lastIndexOf(':');
  const tail = s.slice(lastColon + 1);
  if (tail.includes('.')) {
    tailV4 = parseIPv4(tail);
    if (tailV4 === null) return null;
    s = s.slice(0, lastColon + 1) + '0:0';
  }
  const dbl = s.split('::');
  if (dbl.length > 2) return null;
  const head = dbl[0] ? dbl[0].split(':') : [];
  const rest = dbl.length === 2 && dbl[1] ? dbl[1].split(':') : [];
  const groups = dbl.length === 2 ? head.length + rest.length : head.length;
  if (dbl.length === 1 && groups !== 8) return null;
  if (dbl.length === 2 && groups > 7) return null;
  const all = dbl.length === 2 ? [...head, ...Array(8 - groups).fill('0'), ...rest] : head;
  let n = 0n;
  for (const g of all) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    n = (n << 16n) | BigInt(parseInt(g, 16));
  }
  if (tailV4 !== null) n = (n & ~0xffffffffn) | tailV4;
  return n;
}

export function formatIPv4(n) {
  n = BigInt(n);
  return [24n, 16n, 8n, 0n].map((s) => Number((n >> s) & 255n)).join('.');
}

export function formatIPv6(n) {
  const g = [];
  for (let i = 7; i >= 0; i--) g.push(Number((n >> BigInt(i * 16)) & 0xffffn));
  // longest run of zero groups (length >= 2) becomes ::
  let best = -1, bestLen = 0;
  for (let i = 0; i < 8; ) {
    if (g[i] !== 0) { i++; continue; }
    let j = i;
    while (j < 8 && g[j] === 0) j++;
    if (j - i > bestLen && j - i >= 2) { best = i; bestLen = j - i; }
    i = j;
  }
  const hex = g.map((x) => x.toString(16));
  if (best === -1) return hex.join(':');
  const left = hex.slice(0, best).join(':');
  const right = hex.slice(best + bestLen).join(':');
  return `${left}::${right}`;
}

export function formatIP(n, v) {
  return v === 4 ? formatIPv4(n) : formatIPv6(n);
}

/** Parse "1.2.3.4", "1.2.3.0/24", "2600::/32" or "2600::1". Returns {v, start, end, len} or null. */
export function parseTarget(input) {
  if (typeof input !== 'string') return null;
  const s = input.trim();
  if (!s) return null;
  const [addr, lenStr, extra] = s.split('/');
  if (extra !== undefined) return null;
  let v, n;
  if ((n = parseIPv4(addr)) !== null) v = 4;
  else if ((n = parseIPv6(addr)) !== null) v = 6;
  else return null;
  const bits = v === 4 ? 32 : 128;
  let len = bits;
  if (lenStr !== undefined) {
    if (!/^\d{1,3}$/.test(lenStr)) return null;
    len = Number(lenStr);
    if (len > bits) return null;
  }
  const hostBits = BigInt(bits - len);
  const mask = ((v === 4 ? V4_MAX : V6_MAX) >> hostBits) << hostBits;
  const start = n & mask;
  const end = start | ((1n << hostBits) - 1n);
  return { v, start, end, len, isRange: lenStr !== undefined };
}

export function cidrString(t) {
  return `${formatIP(t.start, t.v)}/${t.len}`;
}

export function addressCount(v, len) {
  return 1n << BigInt((v === 4 ? 32 : 128) - len);
}

/** Total addresses covered by a list of {start,end} (BigInt) after merging overlaps. */
export function unionSize(ranges) {
  const sorted = [...ranges].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  let total = 0n, curS = null, curE = null;
  for (const r of sorted) {
    if (curS === null) { curS = r.start; curE = r.end; continue; }
    if (r.start <= curE + 1n) { if (r.end > curE) curE = r.end; }
    else { total += curE - curS + 1n; curS = r.start; curE = r.end; }
  }
  if (curS !== null) total += curE - curS + 1n;
  return total;
}

/** Split a free-form paste into candidate tokens (IPs/CIDRs). */
export function tokenize(text) {
  return String(text)
    .split(/[\s,;|"'<>()]+/)
    .map((t) => t.replace(/^\[|\]$/g, '').replace(/[.:]$/, (m) => (m === ':' ? m : '')))
    .filter(Boolean);
}

/** Minimal CIDR list covering exactly the union of the input ranges ({start,end} BigInt, same family). */
export function aggregate(ranges, v) {
  const bits = v === 4 ? 32n : 128n;
  const sorted = [...ranges].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  const merged = [];
  for (const r of sorted) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end + 1n) { if (r.end > last.end) last.end = r.end; }
    else merged.push({ start: r.start, end: r.end });
  }
  const out = [];
  for (const { start, end } of merged) {
    let cur = start;
    while (cur <= end) {
      // largest block aligned at cur that fits before end
      let size = 0n;
      while (size < bits) {
        const next = size + 1n;
        const blk = 1n << next;
        if (cur % blk !== 0n || cur + blk - 1n > end) break;
        size = next;
      }
      out.push({ v, start: cur, end: cur + (1n << size) - 1n, len: Number(bits - size) });
      cur += 1n << size;
    }
  }
  return out;
}
