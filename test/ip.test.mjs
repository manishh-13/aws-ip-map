import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIPv4, parseIPv6, formatIPv6, parseTarget, cidrString, unionSize, aggregate, tokenize, addressCount } from '../src/lib/ip.js';

test('IPv4 parsing rejects junk', () => {
  assert.equal(parseIPv4('52.95.110.1'), 0x345f6e01n);
  for (const bad of ['256.1.1.1', '1.2.3', '1.2.3.4.5', '01.2.3.a', '', ' ']) assert.equal(parseIPv4(bad), null, bad);
});

test('IPv6 parsing handles ::, embedded IPv4, brackets, zones', () => {
  assert.equal(parseIPv6('::'), 0n);
  assert.equal(parseIPv6('::1'), 1n);
  assert.equal(parseIPv6('2600:1f18::1'), (0x26001f18n << 96n) | 1n);
  assert.equal(parseIPv6('[2600:1f18::1]'), parseIPv6('2600:1f18::1'));
  assert.equal(parseIPv6('fe80::1%en0'), parseIPv6('fe80::1'));
  assert.equal(parseIPv6('::ffff:1.2.3.4'), (0xffffn << 32n) | 0x01020304n);
  for (const bad of ['1::2::3', '12345::', 'g::1', '1:2:3:4:5:6:7:8:9', '1.2.3.4']) assert.equal(parseIPv6(bad), null, bad);
});

test('IPv6 formatting compresses the longest zero run', () => {
  assert.equal(formatIPv6(parseIPv6('2600:1f18:0:0:0:0:0:1')), '2600:1f18::1');
  assert.equal(formatIPv6(0n), '::');
  assert.equal(formatIPv6(parseIPv6('1:0:0:2:0:0:0:3')), '1:0:0:2::3');
  assert.equal(formatIPv6(parseIPv6('1:0:2:3:4:5:6:7')), '1:0:2:3:4:5:6:7');
});

test('parseTarget masks host bits and reports ranges', () => {
  const t = parseTarget('52.95.110.77/24');
  assert.equal(cidrString(t), '52.95.110.0/24');
  assert.equal(t.isRange, true);
  assert.equal(t.end - t.start + 1n, 256n);
  assert.equal(parseTarget('1.2.3.4').len, 32);
  assert.equal(parseTarget('2600::/16').v, 6);
  assert.equal(parseTarget('1.2.3.4/33'), null);
  assert.equal(parseTarget('nope'), null);
  assert.equal(addressCount(4, 20), 4096n);
});

test('unionSize de-duplicates overlaps and nesting', () => {
  const r = ['10.0.0.0/24', '10.0.0.0/25', '10.0.1.0/24', '10.0.0.128/26'].map(parseTarget);
  assert.equal(unionSize(r), 512n);
});

test('aggregate merges to the minimal CIDR set', () => {
  const merged = aggregate(['10.0.0.0/25', '10.0.0.128/25', '10.0.1.0/24', '10.0.3.0/24'].map(parseTarget), 4).map(cidrString);
  assert.deepEqual(merged, ['10.0.0.0/23', '10.0.3.0/24']);
  // non-aligned union must split, and cover exactly the same addresses
  const odd = ['10.0.1.0/24', '10.0.2.0/24'].map(parseTarget);
  const out = aggregate(odd, 4);
  assert.deepEqual(out.map(cidrString), ['10.0.1.0/24', '10.0.2.0/24']);
  assert.equal(unionSize(out), unionSize(odd));
  assert.deepEqual(aggregate(['2600::/33', '2600:0:8000::/33'].map(parseTarget), 6).map(cidrString), ['2600::/32']);
});

test('tokenize pulls IPs out of messy pastes', () => {
  assert.deepEqual(tokenize('src=3.5.140.2, dst="13.32.0.1"; 8.8.8.8\n[2600::1]'), ['src=3.5.140.2', 'dst=', '13.32.0.1', '8.8.8.8', '2600::1']);
});
