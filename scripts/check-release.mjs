import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { pathToFileURL } from 'node:url';

/** Inspect the emitted worker, not a source/config approximation. No browser claim. */
export function checkRelease(directory = 'dist') {
  const root = resolve(directory);
  // URL paths and filesystem paths must agree. Reject aliases, queries and escapes
  // before reading anything, including manifest icons and Workbox dependencies.
  const localPath = name => {
    assert.ok(typeof name === 'string' && /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(name)
      && name.split('/').every(part => part !== '.' && part !== '..'), `Invalid local artifact path: ${name}`);
    return resolve(root, name);
  };
  const read = name => readFileSync(localPath(name));
  const manifest = JSON.parse(read('manifest.webmanifest'));
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.scope, '/');
  assert.ok(manifest.name && manifest.short_name);
  for (const size of [192, 512]) {
    const icon = manifest.icons.find(icon => icon.sizes === `${size}x${size}` && icon.type === 'image/png');
    assert.ok(icon, `Missing ${size}px install icon`);
    assert.equal(icon.src, `/icon-${size}.png`, 'Install icons must use the deployed root path');
    const png = read(icon.src.slice(1));
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(png.readUInt32BE(16), size);
    assert.equal(png.readUInt32BE(20), size);
  }
  assert.equal(read('CNAME').toString().trim(), 'piano.zen.dev.br');
  const html = read('index.html').toString();
  assert.match(html, /<link\b[^>]*rel="manifest"[^>]*href="\/manifest\.webmanifest"[^>]*>/, 'Missing root manifest link');
  assert.match(html, /name="viewport"/);
  const entries = [], listeners = new Map();
  let immediateActivation = 0, cleanup = false, navigation = false;
  let navigationRoutes = 0;
  class NavigationRoute {
    constructor(handler, options = {}) {
      assert.equal(handler, 'index.html');
      assert.equal(Object.keys(options).length, 0, 'Unexpected navigation restrictions');
    }
  }
  const self = { define: (deps, factory) => {
    for (const dep of deps) {
      assert.match(dep, /^\.\/workbox-[A-Za-z0-9_-]+$/, 'Unexpected worker dependency');
      assert.ok(read(`${dep.slice(2)}.js`).length, 'Missing Workbox runtime');
    }
    factory({
      precacheAndRoute: items => entries.push(...items),
      cleanupOutdatedCaches: () => { cleanup = true; },
      registerRoute: route => {
        assert.ok(route instanceof NavigationRoute, 'Unexpected runtime cache route');
        navigationRoutes++;
        navigation = true;
      },
      NavigationRoute,
      createHandlerBoundToURL: url => url,
      clientsClaim: () => { throw Error('Update must not claim active pages automatically'); },
    });
  }, addEventListener: (event, handler) => {
    assert.equal(event, 'message', 'Unexpected custom worker event handler');
    assert.ok(!listeners.has(event), 'Duplicate worker event handler');
    listeners.set(event, handler);
  }, skipWaiting: () => immediateActivation++ };
  runInNewContext(read('sw.js').toString(), { self, define: self.define }, { timeout: 1000 });
  assert.equal(immediateActivation, 0, 'Updates must wait for explicit consent');
  assert.ok(cleanup && navigation, 'Missing old-cache cleanup or offline app-shell navigation');
  assert.equal(navigationRoutes, 1, 'Expected exactly one app-shell navigation route');
  assert.ok(listeners.has('message'), 'Missing explicit update activation message');
  listeners.get('message')({});
  listeners.get('message')({ data: null });
  listeners.get('message')({ data: { type: 'UNRELATED' } });
  assert.equal(immediateActivation, 0);
  listeners.get('message')({ data: { type: 'SKIP_WAITING' } });
  assert.equal(immediateActivation, 1);
  const cached = new Set();
  for (const entry of entries) {
    const file = localPath(entry.url);
    assert.ok(/^(?:index\.html|manifest\.webmanifest|icon(?:-192|-512)?\.(?:svg|png)|assets\/[A-Za-z0-9_.-]+\.(?:js|css))$/.test(entry.url),
      `Unexpected precache asset (app shell only): ${entry.url}`);
    const bytes = readFileSync(file);
    if (entry.revision) assert.equal(createHash('md5').update(bytes).digest('hex'), entry.revision, `Stale revision: ${entry.url}`);
    cached.add(entry.url);
  }
  const files = directory => readdirSync(resolve(root, directory), { withFileTypes: true }).flatMap(entry => {
    const name = directory ? `${directory}/${entry.name}` : entry.name;
    return entry.isDirectory() ? files(name) : [name];
  });
  for (const name of files('')) {
    if (/\.(?:js|css|html|svg|png|webmanifest)$/.test(name) && name !== 'sw.js' && !/^workbox-[^/]+\.js$/.test(name)) {
      assert.ok(cached.has(name), `Offline asset not precached: ${name}`);
    }
  }
  assert.ok([...cached].some(name => /opensheetmusicdisplay.*\.js$/.test(name)), 'Notation renderer must be available offline');
  return { cachedAssets: cached.size, status: 'Production artifact checks passed (not browser/device acceptance)' };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log(JSON.stringify(checkRelease(process.argv[2]), null, 2));
}
