// Stable, diff-friendly JSON: one top-level entry per line so git history stays readable and small.
export function stringifyLines(value) {
  if (Array.isArray(value)) return value.length ? `[\n${value.map((v) => JSON.stringify(v)).join(',\n')}\n]\n` : '[]\n';
  if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    return keys.length ? `{\n${keys.map((k) => `${JSON.stringify(k)}:${JSON.stringify(value[k])}`).join(',\n')}\n}\n` : '{}\n';
  }
  return JSON.stringify(value) + '\n';
}

/** history.json: small metadata on one line, then one snapshot per line. */
export function stringifyHistory({ snapshots = [], ...meta }) {
  const head = JSON.stringify(meta).slice(1, -1);
  return `{${head}${head ? ',' : ''}"snapshots":${stringifyLines(snapshots).trimEnd()}}\n`;
}
