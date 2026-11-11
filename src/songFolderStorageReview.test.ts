// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { storedFolder } from './songFolder';
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
it('aborts an active write transaction on timeout instead of allowing a late put', async () => {
  vi.useFakeTimers();
  const request = {} as IDBOpenDBRequest;
  const operation = {result:undefined,onsuccess:undefined as (()=>void)|undefined};
  const put = vi.fn(), close = vi.fn(), abort = vi.fn();
  const tx = {objectStore:()=>({get:()=>operation,put}),abort};
  vi.stubGlobal('indexedDB',{open:()=>request});
  const result = storedFolder({id:'new',handle:{kind:'directory',name:'Songs',async *values(){},queryPermission:async()=> 'granted'}}).catch(e=>e);
  Object.assign(request,{result:{close,transaction:()=>tx}}); request.onsuccess!({} as Event);
  await vi.advanceTimersByTimeAsync(3000);
  expect(await result).toBeInstanceOf(Error);
  operation.onsuccess!();
  expect(put).not.toHaveBeenCalled();
  expect(abort).toHaveBeenCalled();
});
