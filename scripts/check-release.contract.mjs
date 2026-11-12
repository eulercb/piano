import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkRelease } from './check-release.mjs';

function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'piano-release-'));
  try { cpSync('dist', root, { recursive: true }); run(root); }
  finally { rmSync(root, { recursive: true, force: true }); }
}
const changeWorker = (root, transform) => {
  const path = join(root, 'sw.js');
  writeFileSync(path, transform(readFileSync(path, 'utf8')));
};
test('production build satisfies offline artifact contract', () => assert.ok(checkRelease().cachedAssets >= 5));
test('rejects an absent install icon', () => fixture(root => {
  unlinkSync(join(root, 'icon-192.png'));
  assert.throws(() => checkRelease(root));
}));
test('rejects stale cached bytes', () => fixture(root => {
  writeFileSync(join(root, 'index.html'), readFileSync(join(root, 'index.html'), 'utf8') + '<!-- changed -->');
  assert.throws(() => checkRelease(root), /Stale revision/);
}));
test('rejects automatic update activation', () => fixture(root => {
  changeWorker(root, text => `self.skipWaiting();${text}`);
  assert.throws(() => checkRelease(root), /explicit consent/);
}));
test('rejects missing cached lazy assets', () => fixture(root => {
  writeFileSync(join(root, 'assets/new-score-renderer.js'), 'export default 1');
  assert.throws(() => checkRelease(root), /not precached/);
}));
test('rejects broken explicit update action', () => fixture(root => {
  changeWorker(root, text => text.replace('SKIP_WAITING', 'IGNORED'));
  assert.throws(() => checkRelease(root));
}));

test('rejects a constructed but unregistered navigation fallback', () => fixture(root => {
  // Constructing a route alone does not make Workbox serve offline navigations.
  changeWorker(root, text => text.replace(/\w+\.registerRoute\(new (\w+\.NavigationRoute)\(/, 'void(new $1('));
  assert.throws(() => checkRelease(root), /offline app-shell navigation/);
}));

const prependEntry = (root, entry) => changeWorker(root, text => text.replace('precacheAndRoute([', `precacheAndRoute([${JSON.stringify(entry)},`));
test('rejects data files in the app-shell cache', () => fixture(root => {
  writeFileSync(join(root, 'saved-song.json'), '{}');
  prependEntry(root, { url: 'saved-song.json', revision: null });
  assert.throws(() => checkRelease(root), /app shell only/);
}));
for (const url of ['https://example.invalid/score.js', '//example.invalid/score.js', '../outside.js', '/index.html', 'assets/../index.html', '%2e%2e/outside.js', 'index.html?revision=old']) {
  test(`rejects noncanonical precache URL ${url}`, () => fixture(root => {
    prependEntry(root, { url, revision: null });
    assert.throws(() => checkRelease(root), /Invalid local artifact path/);
  }));
}
test('rejects unexpected runtime cache routes', () => fixture(root => {
  changeWorker(root, text => text.replace(/(\w+)\.cleanupOutdatedCaches\(\)/, '$1.registerRoute({}),$1.cleanupOutdatedCaches()'));
  assert.throws(() => checkRelease(root), /runtime cache route/);
}));
test('rejects extra fetch handlers', () => fixture(root => {
  changeWorker(root, text => `self.addEventListener('fetch', () => {});${text}`);
  assert.throws(() => checkRelease(root), /custom worker event/);
}));
test('rejects automatic clientsClaim', () => fixture(root => {
  changeWorker(root, text => text.replace(/(\w+)\.cleanupOutdatedCaches\(\)/, '$1.clientsClaim(),$1.cleanupOutdatedCaches()'));
  assert.throws(() => checkRelease(root), /claim active pages/);
}));
test('rejects a worker without stale-cache cleanup', () => fixture(root => {
  changeWorker(root, text => text.replace(/\w+\.cleanupOutdatedCaches\(\)/, 'void 0'));
  assert.throws(() => checkRelease(root), /old-cache cleanup/);
}));
test('rejects a manifest reference that does not link the manifest', () => fixture(root => {
  const path = join(root, 'index.html');
  writeFileSync(path, readFileSync(path, 'utf8').replace('rel="manifest"', 'rel="alternate"'));
  assert.throws(() => checkRelease(root), /manifest link/);
}));
test('rejects icons outside the deployed root', () => fixture(root => {
  const path = join(root, 'manifest.webmanifest');
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  manifest.icons[0].src = '../icon-192.png';
  writeFileSync(path, JSON.stringify(manifest));
  assert.throws(() => checkRelease(root), /deployed root path/);
}));
for (const field of ['scope', 'start_url']) {
  test(`rejects manifest ${field} outside the custom-domain root`, () => fixture(root => {
    const path = join(root, 'manifest.webmanifest');
    const manifest = JSON.parse(readFileSync(path, 'utf8'));
    manifest[field] = '/piano/';
    writeFileSync(path, JSON.stringify(manifest));
    assert.throws(() => checkRelease(root));
  }));
}
