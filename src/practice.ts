import type { Note } from "./music";
/** Match one physical key press to the current onset, including doubled unisons. */
export function matchMelodyPitch(
  notes: Note[],
  matched: ReadonlySet<string>,
  pitch: number,
  time: number,
): string[] {
  const pending = notes.filter((n) => !matched.has(n.id));
  const first = pending[0];
  if (!first || Math.abs(first.start - time) > 0.15) return [];
  return pending
    .filter((n) => Math.abs(n.start - first.start) < 0.035 && n.pitch === pitch)
    .map((n) => n.id);
}
/** Never move past an unplayed onset in melody mode. */
export function melodyPosition(
  notes: Note[],
  matched: ReadonlySet<string>,
  proposed: number,
): number {
  const pending = notes.find((n) => !matched.has(n.id));
  return pending ? Math.min(proposed, pending.start) : proposed;
}
