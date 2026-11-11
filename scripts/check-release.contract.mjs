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
