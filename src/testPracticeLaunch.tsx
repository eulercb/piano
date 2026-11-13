import { fireEvent, render as renderView, screen } from "@testing-library/react";
import type { ReactNode } from "react";

/** Existing room/Studio regressions enter through the real plan UI, then reset
 * paused. Muting first avoids introducing audio into unrelated test fixtures.
 * Dedicated launcher tests exercise the ordinary audible start separately. */
export function openPracticeRoom() {
  if (!document.querySelector(".practice-launch")) return;
  const start = screen.queryByRole('button', { name: /Start practice/ });
  if (!start) return;
  const wasMuted = !!screen.queryByRole('button', { name: 'Unmute' });
  if (!wasMuted) fireEvent.click(screen.getByRole('button', { name: 'Mute' }));
  fireEvent.click(start);
  fireEvent.click(screen.getByRole('button', { name: 'Restart' }));
  if (!wasMuted) fireEvent.click(screen.getByRole('button', { name: 'Unmute' }));
}
export function renderPractice(node: ReactNode) {
  const result = renderView(node);
  openPracticeRoom();
  return result;
}
