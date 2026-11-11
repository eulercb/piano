// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
// @ts-expect-error Node builtin is available to Vitest; production uses browser crypto.
import { webcrypto } from 'node:crypto';
import { fileDigest, readPermission, storedFolder, supportedSong, validFolderSource } from './songFolder';
import { normalizeSong } from './project';
import { demoSong } from './music';
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
it('hashes file contents, not names or timestamps', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const first = await fileDigest(new File(['one'], 'a.mid'));
  expect(first).toMatch(/^[a-f0-9]{64}$/);
  expect(await fileDigest(new File(['one'], 'b.mid'))).toBe(first);
  expect(await fileDigest(new File(['two'], 'a.mid'))).not.toBe(first);
});
it('bounds reads and refuses insecure hashing', async () => {
  const read = vi.fn();
  await expect(fileDigest({size:11 * 1024 * 1024, arrayBuffer:read} as unknown as File)).rejects.toThrow('smaller');
  expect(read).not.toHaveBeenCalled();
  vi.stubGlobal('crypto', {subtle:undefined});
  await expect(fileDigest(new File(['one'],'a.mid'))).rejects.toThrow('secure');
});
it('validates source metadata and preserves it in local normalization', () => {
  const folderSource = { folderId:'folder', name:'song.mid', digest:'a'.repeat(64) };
  expect(normalizeSong({...demoSong, folderSource: {...folderSource, extra: 'discard'}}).folderSource).toEqual(folderSource);
  expect(validFolderSource({...folderSource,digest:'bad'})).toBe(false);
  expect(() => normalizeSong({...demoSong,folderSource:{...folderSource,digest:'bad'}})).toThrow('damaged');
  expect(supportedSong('music.MXL')).toBe(true); expect(supportedSong('image.png')).toBe(false);
});
it('queries read permission before explicitly requesting it', async () => {
  const handle = {name:'folder', async *values(){}, queryPermission:vi.fn().mockResolvedValue('granted'),requestPermission:vi.fn().mockResolvedValue('denied')};
  expect(await readPermission(handle)).toBe(true); expect(handle.requestPermission).not.toHaveBeenCalled();
  handle.queryPermission.mockResolvedValue('prompt'); expect(await readPermission(handle)).toBe(false);
  expect(handle.requestPermission).toHaveBeenCalledWith({mode:'read'});
});
it('falls back when IndexedDB is absent and reports open errors without deleting data', async () => {
  vi.stubGlobal('indexedDB',undefined); expect(await storedFolder()).toBeUndefined();
  const deleteDatabase = vi.fn();
  vi.stubGlobal('indexedDB',{open:()=>{throw Error('Denied');},deleteDatabase});
  await expect(storedFolder()).rejects.toThrow('unavailable'); expect(deleteDatabase).not.toHaveBeenCalled();
});
it('times out blocked storage and closes a late connection without reading it', async () => {
  vi.useFakeTimers(); const request = {} as IDBOpenDBRequest;
  const close = vi.fn(), transaction = vi.fn();
  vi.stubGlobal('indexedDB',{open:()=>request});
  const result = storedFolder().catch(e=>e);
  await vi.advanceTimersByTimeAsync(3000); expect(await result).toBeInstanceOf(Error);
  Object.assign(request,{result:{close,transaction}}); request.onsuccess!({} as Event);
  expect(close).toHaveBeenCalled(); expect(transaction).not.toHaveBeenCalled();
});
it('does not overwrite a malformed stored handle when reconnecting', async () => {
  const request = {} as IDBOpenDBRequest;
  const operation = {result:{id:'damaged',handle:null},onsuccess:undefined as (()=>void)|undefined};
  const put = vi.fn(), close = vi.fn(), abort = vi.fn();
  const tx = {objectStore:()=>({get:()=>operation,put}),abort};
  vi.stubGlobal('indexedDB',{open:()=>request});
  const promise = storedFolder({id:'new',handle:{kind:'directory',name:'Songs',async *values(){},queryPermission:async()=> 'granted'}}).catch(e=>e);
  Object.assign(request,{result:{close,transaction:()=>tx}}); request.onsuccess!({} as Event);
  operation.onsuccess!();
  expect(await promise).toBeInstanceOf(Error); expect(put).not.toHaveBeenCalled(); expect(abort).toHaveBeenCalled();
});
it('cancels an older pending handle write before touching storage', async () => {
  const request = {} as IDBOpenDBRequest, close = vi.fn(), transaction = vi.fn();
  vi.stubGlobal('indexedDB',{open:()=>request});
  let current = true;
  const promise = storedFolder({id:'old',handle:{name:'Old',async *values(){}}},()=>current);
  current = false;
  Object.assign(request,{result:{close,transaction}}); request.onsuccess!({} as Event);
  expect(await promise).toBeUndefined(); expect(transaction).not.toHaveBeenCalled(); expect(close).toHaveBeenCalled();
});
