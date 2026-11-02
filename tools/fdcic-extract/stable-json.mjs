// JSON laid out so diffs between pack versions stay readable: arrays of plain values and short
// flat objects sit on one line; everything else gets one entry per line.
const isPlain = x => x === null || typeof x !== 'object';

export function stableJson(value, indent = '') {
  if (isPlain(value)) return JSON.stringify(value);
  if (Array.isArray(value) && value.every(isPlain)) return JSON.stringify(value);
  if (!Array.isArray(value) && Object.values(value).every(isPlain) && JSON.stringify(value).length <= 120) return JSON.stringify(value);
  const next = indent + '  ';
  if (Array.isArray(value)) return `[\n${value.map(v => next + stableJson(v, next)).join(',\n')}\n${indent}]`;
  return `{\n${Object.entries(value).map(([k, v]) => `${next}${JSON.stringify(k)}: ${stableJson(v, next)}`).join(',\n')}\n${indent}}`;
}
