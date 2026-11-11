import { act, fireEvent } from "@testing-library/react";
import { expect, vi } from "vitest";

/** Exercise delayed download cleanup before the test restores jsdom's URL,
 * which has no object-URL methods. Keep FileReader and other async work real. */
export function clickDownload(button: HTMLElement) {
  const create = vi.spyOn(URL, "createObjectURL"), revoke = vi.spyOn(URL, "revokeObjectURL");
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    fireEvent.click(button);
    expect(create).toHaveBeenCalledOnce();
    expect(revoke).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(999));
    expect(revoke).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(revoke).toHaveBeenCalledExactlyOnceWith(create.mock.results[0].value);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.clearAllTimers();
    vi.useRealTimers();
    create.mockRestore(); revoke.mockRestore();
  }
}
