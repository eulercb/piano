// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { MAX_SNAPSHOT_FILE_BYTES, MAX_SNAPSHOT_FILES, readSnapshotFile, selectFolderSnapshot } from './folderSnapshot';

function item(name: string, path = `Scores/${name}`) {
  const file = new File(['music'], name, { type: 'audio/midi' });
  const read = vi.fn().mockResolvedValue(Uint8Array.of(1, 2, 3).buffer);
  Object.defineProperties(file, {
    webkitRelativePath: { value: path },
    arrayBuffer: { value: read, configurable: true },
  });
  return { file, read };
}

it('selects supported root files in deterministic order and never reads contents when checking metadata', () => {
  const z = item('曲.MID'), a = item('A.mxl'), nested = item('skipped.mid', 'Scores/Nested/skipped.mid'), unsupported = item('notes.txt');
  const entries = [z, nested, unsupported, a];
  const result = selectFolderSnapshot(entries.map(entry => entry.file));
  expect(result).toEqual({ files: [a.file, z.file], nested: 1, unsupported: 1, overLimit: 0, oversized: 0 });
  for (const { read } of entries) expect(read).not.toHaveBeenCalled();
});

it.each(['', 'bad.mid', '/Scores/bad.mid', 'Scores//bad.mid', 'Scores/../bad.mid',
  './bad.mid', 'Scores/./bad.mid', 'C:/bad.mid', 'file:/bad.mid', 'Scores\\bad.mid', 'Scores/other.mid',
  `Scores/${'x'.repeat(4096)}/bad.mid`])('rejects malformed relative paths before any file reads (%s)', path => {
  const first = item('good.mid'), invalid = item('bad.mid', path);
  expect(() => selectFolderSnapshot([first.file, invalid.file])).toThrow(/verify a single selected folder/);
  expect(first.read).not.toHaveBeenCalled();
  expect(invalid.read).not.toHaveBeenCalled();
});

it('rejects absent paths, multiple roots even in skipped entries, and duplicate paths', () => {
  const first = item('good.mid');
  expect(() => selectFolderSnapshot([first.file, new File([], 'missing.mid')])).toThrow(/verify/);
  expect(() => selectFolderSnapshot([first.file, item('other.txt', 'Other/Nested/other.txt').file])).toThrow(/verify/);
  expect(() => selectFolderSnapshot([first.file, item('good.mid').file])).toThrow(/verify/);
  expect(first.read).not.toHaveBeenCalled();
});

it('bounds metadata and chooses the first 50 supported attempts, omitting oversized and over-cap files', async () => {
  const entries = Array.from({ length: MAX_SNAPSHOT_FILES + 1 }, (_, index) => item(`song-${String(index).padStart(2, '0')}.mid`));
  Object.defineProperty(entries[0].file, 'size', { value: MAX_SNAPSHOT_FILE_BYTES + 1 });
  expect(() => selectFolderSnapshot({ length: 5001 })).toThrow(/too many entries/);
  const result = selectFolderSnapshot(entries.map(entry => entry.file).reverse());
  expect(result).toEqual({
    files: entries.slice(1, MAX_SNAPSHOT_FILES).map(entry => entry.file),
    nested: 0, unsupported: 0, overLimit: 1, oversized: 1,
  });
  for (const file of result.files) await readSnapshotFile(file);
  expect(entries[0].read).not.toHaveBeenCalled();
  expect(entries.at(-1)!.read).not.toHaveBeenCalled();
});

it('copies only bytes, a basename, and MIME type without retaining a relative path', async () => {
  const original = item('曲.mid');
  const copy = await readSnapshotFile(original.file);
  expect(original.read).toHaveBeenCalledTimes(1);
  expect(copy).not.toBe(original.file);
  expect(copy.name).toBe(original.file.name);
  expect(copy.type).toBe(original.file.type);
  expect(copy.size).toBe(3);
  expect(copy.webkitRelativePath || '').toBe('');
});

it('reads a normal File via FileReader where arrayBuffer is unavailable', async () => {
  const file = new File([Uint8Array.of(4, 5, 6, 7)], 'legacy.mid');
  Object.defineProperty(file, 'arrayBuffer', { value: undefined });
  const copy = await readSnapshotFile(file);
  expect(copy.name).toBe('legacy.mid');
  expect(copy.size).toBe(4);
  const reader = new FileReader();
  const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = reject;
    reader.readAsArrayBuffer(copy);
  });
  expect(Array.from(new Uint8Array(bytes))).toEqual([4, 5, 6, 7]);
});

it('sanitizes native read errors and enforces the byte limit before and after reading', async () => {
  const original = item('private.mid');
  original.read.mockRejectedValueOnce(new Error('/private/root/native error'));
  await expect(readSnapshotFile(original.file)).rejects.toThrow(/^Could not read this file from the selected folder\./);
  original.read.mockResolvedValueOnce(new ArrayBuffer(MAX_SNAPSHOT_FILE_BYTES + 1));
  await expect(readSnapshotFile(original.file)).rejects.toThrow(/smaller than 10 MB/);
  Object.defineProperty(original.file, 'size', { value: MAX_SNAPSHOT_FILE_BYTES + 1 });
  await expect(readSnapshotFile(original.file)).rejects.toThrow(/smaller than 10 MB/);
  expect(original.read).toHaveBeenCalledTimes(2);
});
