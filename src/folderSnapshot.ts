import { supportedSong } from './songFolder';

export const MAX_SNAPSHOT_FILES = 50;
export const MAX_SNAPSHOT_FILE_BYTES = 10 * 1024 * 1024;
const MAX_ENTRIES = 5000;
const MAX_PATH_LENGTH = 4096;
const INVALID_SELECTION = 'Could not verify a single selected folder. Choose a folder again or use Import song.';
const TOO_LARGE = 'This folder selection has too many entries. Choose a smaller folder or use Import song.';
const FILE_TOO_LARGE = 'Please choose a song file smaller than 10 MB.';
const READ_FAILED = 'Could not read this file from the selected folder. Choose it again or use Import song.';

/** Check the complete selection before returning any files that may be read. */
export function selectFolderSnapshot(selection: ArrayLike<File>) {
  const length = selection.length;
  if (!Number.isSafeInteger(length) || length < 0 || length > MAX_ENTRIES) throw Error(TOO_LARGE);
  const topLevel: File[] = [];
  const seen = new Set<string>();
  let root: string | undefined;
  let nested = 0, unsupported = 0, oversized = 0;
  for (let i = 0; i < length; i++) {
    const file = selection[i];
    const path = file?.webkitRelativePath;
    if (typeof path !== 'string' || !path || path.length > MAX_PATH_LENGTH ||
      /^[a-z][a-z0-9+.-]*:/i.test(path) || /[\\\u0000]/.test(path) || seen.has(path)) throw Error(INVALID_SELECTION);
    const parts = path.split('/');
    if (parts.length < 2 || parts.some(part => !part || part === '.' || part === '..') ||
      parts.at(-1) !== file.name || (root !== undefined && root !== parts[0])) throw Error(INVALID_SELECTION);
    root = parts[0];
    seen.add(path);
    if (parts.length > 2) nested++;
    else if (!supportedSong(file.name)) unsupported++;
    else topLevel.push(file);
  }
  topLevel.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const files = topLevel.slice(0, MAX_SNAPSHOT_FILES).filter(file => {
    if (file.size <= MAX_SNAPSHOT_FILE_BYTES) return true;
    oversized++;
    return false;
  });
  return { files, nested, unsupported, overLimit: Math.max(0, topLevel.length - MAX_SNAPSHOT_FILES), oversized };
}

/** Isolate a chosen file's bytes so downstream import cannot expose native path errors. */
export async function readSnapshotFile(file: File): Promise<File> {
  if (file.size > MAX_SNAPSHOT_FILE_BYTES) throw Error(FILE_TOO_LARGE);
  let bytes: ArrayBuffer;
  try {
    bytes = typeof file.arrayBuffer === 'function' ? await file.arrayBuffer() : await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = reader.onabort = () => reject(Error(READ_FAILED));
      reader.readAsArrayBuffer(file);
    });
  } catch {
    throw Error(READ_FAILED);
  }
  if (bytes.byteLength > MAX_SNAPSHOT_FILE_BYTES) throw Error(FILE_TOO_LARGE);
  return new File([bytes], file.name, { type: file.type });
}
