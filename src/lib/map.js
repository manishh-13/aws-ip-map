// Shared IPv4 Hilbert map model: 1024 x 1024 pixels, one pixel per /20 (4,096 addresses).
import { d2xy } from './hilbert.js';
import { parseIPv4 } from './ip.js';

export const MAP_ORDER = 10;
export const MAP_SIDE = 1 << MAP_ORDER; // 1024
export const PIXEL_BITS = 32 - 2 * MAP_ORDER; // 12 -> each pixel is a /20
export const PIXEL_PREFIX = 32 - PIXEL_BITS; // 20

/**
 * rows: [{cidr, ri}] IPv4 only. Returns Uint16Array(side*side) indexed by Hilbert d:
 * 0 = no AWS space, otherwise ri*2 + 1 (fully covered) or ri*2 + 2 (partially covered).
 */
export function buildCells(rows) {
  const cells = new Uint16Array(MAP_SIDE * MAP_SIDE);
  const parsed = rows
    .map((r) => {
      const [a, l] = r.cidr.split('/');
      const n = parseIPv4(a);
      return n === null ? null : { n: Number(n), len: Number(l), ri: r.ri };
    })
    .filter(Boolean)
    .sort((a, b) => a.len - b.len); // broad first, specific prefixes overwrite
  for (const p of parsed) {
    const d0 = Math.floor(p.n / 2 ** PIXEL_BITS);
    if (p.len <= PIXEL_PREFIX) {
      const count = 2 ** (PIXEL_PREFIX - p.len);
      for (let d = d0; d < d0 + count; d++) cells[d] = p.ri * 2 + 1;
    } else if (cells[d0] === 0 || cells[d0] % 2 === 0) {
      cells[d0] = p.ri * 2 + 2;
    }
  }
  return cells;
}

/** Precomputed d -> (x, y) table for fast painting. */
export function hilbertTable() {
  const xs = new Uint16Array(MAP_SIDE * MAP_SIDE);
  const ys = new Uint16Array(MAP_SIDE * MAP_SIDE);
  for (let d = 0; d < xs.length; d++) {
    const [x, y] = d2xy(MAP_SIDE, d);
    xs[d] = x; ys[d] = y;
  }
  return { xs, ys };
}

// OKLCH -> sRGB (0..255), for a consistent palette in the PNG and the browser.
export function oklchToRgb(L, C, H) {
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h), b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return lin.map((c) => {
    const v = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
    return Math.round(Math.min(1, Math.max(0, v)) * 255);
  });
}

/** Region colours: hue from the geography, lightness stepped per region inside it. */
export function regionPalette(regions, geoOf, geos) {
  const byGeo = {};
  regions.forEach((r) => (byGeo[geoOf(r)] ??= []).push(r));
  const pal = {};
  for (const g of geos) {
    const list = byGeo[g.id] || [];
    list.forEach((r, i) => {
      const t = list.length > 1 ? i / (list.length - 1) : 0.5;
      const L = 0.5 + t * 0.22;
      const C = g.id === 'global' ? 0.075 : g.id === 'gov' ? 0.055 : 0.125;
      const H = g.hue + (t - 0.5) * 18;
      pal[r] = { full: oklchToRgb(L, C, H), partial: oklchToRgb(Math.min(0.9, L + 0.16), C * 0.6, H) };
    });
  }
  return pal;
}

export const PAPER = [oklchToRgb(0.965, 0.012, 85), oklchToRgb(0.94, 0.014, 85)];
