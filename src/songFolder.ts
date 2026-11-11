/** Explicit, read-only folder access. No polling, writes or recursive scanning. */
export type FolderSource = { folderId: string; name: string; digest: string };
export type Directory = {
  kind?: string; name: string;
  values(): AsyncIterable<{ kind: string; name: string; getFile(): Promise<File> }>;
  queryPermission?(options: { mode: 'read' }): Promise<PermissionState>;
  requestPermission?(options: { mode: 'read' }): Promise<PermissionState>;
  isSameEntry?(other: Directory): Promise<boolean>;
};
export type FolderConnection = { id: string; handle: Directory };
export const supportedSong = (name: string) => /\.(mid|midi|musicxml|xml|mxl|json)$/i.test(name);
export function validFolderSource(value: unknown): value is FolderSource {
  if (!value || typeof value !== 'object') return false;
  const v = value as FolderSource;
  return typeof v.folderId === 'string' && v.folderId.length > 0 && v.folderId.length <= 200 &&
    typeof v.name === 'string' && v.name.length > 0 && v.name.length <= 500 &&
    typeof v.digest === 'string' && /^[a-f0-9]{64}$/.test(v.digest);
}
export async function fileDigest(file: File): Promise<string> {
  if (file.size > 10 * 1024 * 1024) throw Error('Please choose a song file smaller than 10 MB.');
  const bytes = file.arrayBuffer ? await file.arrayBuffer() : await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(Error('Could not read this song file.')); reader.readAsArrayBuffer(file);
  });
  if (!crypto.subtle) throw Error('Safe folder refresh needs a secure browser connection. Use Import song instead.');
  return contentDigest(bytes);
}
export async function contentDigest(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function readPermission(handle: Directory, isCurrent = () => true): Promise<boolean> {
  if (!isCurrent()) return false;
  if (!handle.queryPermission) return true; // Fresh picker handles on implementations without permission methods.
  const permission = await handle.queryPermission({ mode: 'read' });
  if (!isCurrent()) return false;
  if (permission === 'granted') return true;
  if (!handle.requestPermission) return false;
  const granted = await handle.requestPermission({ mode: 'read' });
  return isCurrent() && granted === 'granted';
}
/** Fail closed on unreadable records. Never delete/recreate a damaged database. */
export function storedFolder(write?: FolderConnection, isCurrent = () => true): Promise<FolderConnection | undefined> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(undefined);
  return new Promise((resolve, reject) => {
    let db: IDBDatabase | undefined, activeTransaction: IDBTransaction | undefined, settled = false;
    const finish = (error?: Error, result?: FolderConnection) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      // Closing a database does not cancel its active transactions. Abort before
      // reporting failure/cancellation so a late read cannot persist a handle.
      try { activeTransaction?.abort(); } catch { /* Already completed/aborted. */ }
      activeTransaction = undefined;
      db?.close();
      if (error) reject(error); else resolve(result);
    };
    const timer = setTimeout(() => finish(Error('Folder storage is unavailable.')), 3000);
    let request: IDBOpenDBRequest;
    try { request = indexedDB.open('piano-folder-access', 1); }
    catch { finish(Error('Folder storage is unavailable.')); return; }
    request.onupgradeneeded = () => {
      if (settled || !isCurrent()) { request.transaction?.abort(); return; }
      request.result.createObjectStore('connections');
    };
    request.onerror = () => finish(Error('Folder storage could not be read.'));
    request.onblocked = () => finish(Error('Folder storage is blocked by another tab.'));
    request.onsuccess = () => {
      db = request.result;
      if (settled) { db.close(); return; }
      if (!isCurrent()) { finish(); return; }
      db.onversionchange = () => finish(Error('Folder storage changed in another tab. Please try again.'));
      try {
        const tx = db.transaction('connections', write ? 'readwrite' : 'readonly');
        activeTransaction = tx;
        const store = tx.objectStore('connections');
        const op = store.get('current');
        let result: FolderConnection | undefined;
        const valid = (v: FolderConnection) => !!v && typeof v.id === 'string' && !!v.id &&
          v.handle?.kind === 'directory' && typeof v.handle.values === 'function' &&
          typeof v.handle.queryPermission === 'function';
        op.onsuccess = () => {
          if (settled) return;
          if (!isCurrent()) { finish(); return; }
          if (op.result !== undefined && !valid(op.result)) {
            finish(Error('Saved folder connection is unreadable and was not overwritten.')); return;
          }
          result = write ?? op.result;
          if (write) {
            try { store.put(write, 'current'); }
            catch { finish(Error('Folder handles cannot be saved in this browser.')); }
          }
        };
        tx.oncomplete = () => {
          activeTransaction = undefined;
          if (settled) return;
          if (result && (typeof result.id !== 'string' || !result.id || !result.handle ||
            result.handle.kind !== 'directory' || typeof result.handle.values !== 'function' ||
            typeof result.handle.queryPermission !== 'function')) {
            finish(Error('Saved folder connection is unreadable. Choose the folder again.')); return;
          }
          finish(undefined, result);
        };
        tx.onerror = tx.onabort = () => finish(Error('Folder connection could not be saved or read.'));
      } catch { finish(Error('Folder storage is unavailable; choose the folder again next time.')); }
    };
  });
}
