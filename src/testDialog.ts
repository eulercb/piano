import { vi } from "vitest";

/** jsdom does not implement the native modal/inert/focus APIs. This supplies
 * open/close state for DOM wiring tests, not browser focus-trap verification. */
export function stubDialogs() {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: vi.fn(function (this: HTMLDialogElement) {
    this.open = true;
    this.querySelector<HTMLButtonElement>("button")?.focus();
  }) });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: vi.fn(function (this: HTMLDialogElement) { this.open = false; }) });
}
