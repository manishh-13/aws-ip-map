// End to end: serve two fake versions of ip-ranges.json, run update twice, build, and inspect the site.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

test('update + build pipeline', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ipatlas-'));
  const data = path.join(tmp, 'data');
  const v1 = { syncToken: '1000', createDate: '2026-01-01-00-00-00', prefixes: [{ ip_prefix: '3.0.0.0/24', region: 'us-east-1', service: 'AMAZON', network_border_group: 'us-east-1' }, { ip_prefix: '3.0.0.0/24', region: 'us-east-1', service: 'EC2', network_border_group: 'us-east-1' }], ipv6_prefixes: [] };
  const v2 = { ...v1, syncToken: '2000', createDate: '2026-01-02-00-00-00', prefixes: [...v1.prefixes, { ip_prefix: '13.32.0.0/15', region: 'GLOBAL', service: 'CLOUDFRONT', network_border_group: 'GLOBAL' }], ipv6_prefixes: [{ ipv6_prefix: '2600:9000::/28', region: 'GLOBAL', service: 'CLOUDFRONT', network_border_group: 'GLOBAL' }] };
  let current = v1;
  const srv = http.createServer((_, res) => { res.end(JSON.stringify(current)); });
  await new Promise((r) => srv.listen(0, r));
  const url = `http://127.0.0.1:${srv.address().port}/ip-ranges.json`;
  const env = { ...process.env, DATA_DIR: data, IP_RANGES_URL: url, GITHUB_OUTPUT: '' };
  try {
    assert.match((await run(process.execPath, ['scripts/update.mjs'], { cwd: ROOT, env })).stdout, /changed=true/);
    assert.match((await run(process.execPath, ['scripts/update.mjs'], { cwd: ROOT, env })).stdout, /changed=false/);
    current = v2;
    assert.match((await run(process.execPath, ['scripts/update.mjs'], { cwd: ROOT, env })).stdout, /changed=true/);
    const changes = JSON.parse(await fs.readFile(path.join(data, 'changes.json'), 'utf8'));
    assert.equal(changes.length, 1);
    assert.equal(changes[0].added.length, 2);
    assert.equal(changes[0].removed.length, 0);

    const out = path.join(tmp, 'dist');
    await run(process.execPath, ['scripts/build.mjs'], { cwd: ROOT, env: { ...env, DATA_DIR: data, OUT_DIR: out } });
    const home = await fs.readFile(path.join(out, 'index.html'), 'utf8');
    assert.match(home, /<title>AWS IP address ranges lookup/);
    assert.match(home, /application\/ld\+json/);
    assert.match(await fs.readFile(path.join(out, 'services/cloudfront/ipv4.txt'), 'utf8'), /^13\.32\.0\.0\/15\n$/);
    assert.match(await fs.readFile(path.join(out, 'regions/us-east-1/ec2/ipv4.txt'), 'utf8'), /^3\.0\.0\.0\/24\n$/);
    assert.match(await fs.readFile(path.join(out, 'changes.xml'), 'utf8'), /\+2 \/ -0/);
    const sitemap = await fs.readFile(path.join(out, 'sitemap.xml'), 'utf8');
    assert.ok((sitemap.match(/<loc>/g) || []).length >= 8);
    // every generated page: canonical, description, no template leaks
    const walk = async (d) => (await Promise.all((await fs.readdir(d, { withFileTypes: true })).map((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]))).flat();
    for (const f of (await walk(out)).filter((f) => f.endsWith('.html'))) {
      const h = await fs.readFile(f, 'utf8');
      if (!f.endsWith('404.html')) assert.match(h, /<link rel="canonical"/, f);
      assert.match(h, /<meta name="description" content="[^"]{20,}"/, f);
      assert.doesNotMatch(h, /undefined|NaN|\[object Object\]/, f);
    }
  } finally {
    srv.close();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
