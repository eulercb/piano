import assert from 'node:assert/strict';
import { test } from 'node:test';
import { measureInitialBundle } from './measure-initial-bundle.mjs';
const eager = ['/src/songLibrary.ts', '/src/scoreSource.ts', '/src/project.ts'];
const deferred = ['/src/StudioNoteAuthoring.tsx', '/src/StudioScoreAuthoring.tsx', '/src/noteAuthoring.ts', '/src/musicxmlAuthoring.ts', '/src/scoreImport.ts', '/node_modules/pako/dist/pako.esm.mjs'];
const chunk = (fileName, modules, imports = [], isEntry = false) => ({ type: 'chunk', fileName, modules: Object.fromEntries(modules.map(id => [id, {}])), imports, isEntry, code: 'const synthetic = 1;' });
const fixture = () => ({ app: chunk('app.js', eager, [], true), tools: chunk('tools.js', deferred, ['app.js']) });
test('measures static entry bytes and recognizes truly deferred modules', () => {
  const result = measureInitialBundle(fixture());
  assert.equal(result.initialJavaScript.length, 1);
  assert.equal(result.initialBytes, Buffer.byteLength('const synthetic = 1;'));
  assert.equal(result.deferredJavaScript.length, 1);
  assert.equal(result.deferred.length, 6);
});
test('fails when preparation code is statically reachable through a shared chunk', () => {
  const bundle = fixture(); bundle.app.imports = ['shared.js']; bundle.shared = chunk('shared.js', [], ['tools.js']);
  assert.throws(() => measureInitialBundle(bundle), /Preparation module is initially loaded/);
});
test('fails when a deferred module or eager source validator is absent', () => {
  const bundle = fixture(); delete bundle.tools.modules['/src/scoreImport.ts'];
  assert.throws(() => measureInitialBundle(bundle), /Missing deferred module/);
  const changed = fixture(); delete changed.app.modules['/src/scoreSource.ts']; changed.tools.modules['/src/scoreSource.ts'] = {};
  assert.throws(() => measureInitialBundle(changed), /Saved-library validation must remain eager/);
});
test('walks static cycles once and rejects missing entries/imports', () => {
  const bundle = fixture(); bundle.app.imports = ['shared.js']; bundle.shared = chunk('shared.js', [], ['app.js']);
  assert.equal(measureInitialBundle(bundle).initialJavaScript.length, 2);
  bundle.shared.imports = ['missing.js']; assert.throws(() => measureInitialBundle(bundle), /Missing static JavaScript import/);
  assert.throws(() => measureInitialBundle({}), /Missing application entry/);
});
