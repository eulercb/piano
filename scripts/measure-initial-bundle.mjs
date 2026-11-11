import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Inspect emitted Rollup imports, not chunk names or source-text guesses.
 * Byte counts are build measurements, not browser/device timing evidence.
 */
export function measureInitialBundle(bundle) {
  const chunks = new Map(Object.values(bundle).filter(item => item.type === 'chunk').map(chunk => [chunk.fileName, chunk]));
  const entries = [...chunks.values()].filter(chunk => chunk.isEntry);
  assert.ok(entries.length, 'Missing application entry');
  const initial = new Set();
  function visit(file) {
    if (initial.has(file)) return;
    const chunk = chunks.get(file);
    assert.ok(chunk, `Missing static JavaScript import: ${file}`);
    initial.add(file);
    for (const imported of chunk.imports) visit(imported);
  }
  for (const entry of entries) visit(entry.fileName);
  const deferredModules = [
    '/src/StudioNoteAuthoring.tsx', '/src/StudioScoreAuthoring.tsx',
    '/src/noteAuthoring.ts', '/src/musicxmlAuthoring.ts',
    '/src/scoreImport.ts', '/node_modules/pako/',
  ];
  const matchingChunks = pattern => [...chunks.values()].filter(chunk => Object.keys(chunk.modules).some(id => id.replaceAll('\\', '/').includes(pattern)));
  const deferred = deferredModules.map(module => {
    const matching = matchingChunks(module);
    assert.ok(matching.length, `Missing deferred module: ${module}`);
    assert.ok(matching.every(chunk => !initial.has(chunk.fileName)), `Preparation module is initially loaded: ${module}`);
    return { module, chunks: matching.map(chunk => chunk.fileName) };
  });
  for (const module of ['/src/songLibrary.ts', '/src/scoreSource.ts', '/src/project.ts']) {
    assert.ok(matchingChunks(module).some(chunk => initial.has(chunk.fileName)), `Saved-library validation must remain eager: ${module}`);
  }
  const size = chunk => ({ file: chunk.fileName, bytes: Buffer.byteLength(chunk.code), gzipBytes: gzipSync(chunk.code).length });
  const initialJavaScript = [...initial].map(file => size(chunks.get(file)));
  return {
    initialJavaScript,
    initialBytes: initialJavaScript.reduce((total, chunk) => total + chunk.bytes, 0),
    initialGzipBytes: initialJavaScript.reduce((total, chunk) => total + chunk.gzipBytes, 0),
    deferredJavaScript: [...chunks.values()].filter(chunk => !initial.has(chunk.fileName)).map(size),
    deferred,
    scope: 'Entry and static JavaScript dependencies only. Service-worker registration/runtime, CSS, offline precache downloads and device latency are not included.',
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { build } = await import('vite');
  let measured;
  await build({ plugins: [{
    name: 'verify-preparation-code-splitting',
    writeBundle(_options, bundle) { measured = measureInitialBundle(bundle); },
  }] });
  console.log(JSON.stringify(measured, null, 2));
}
