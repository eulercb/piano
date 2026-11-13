# Practice preparation: browser acceptance

Checked on 2026-11-13 using the original Morning Light demo in the supported
managed preview, with the browser operating the real React UI. The final
production candidate was frozen before the dirty-replacement check. Automated
test totals, exact-head CI and deployment belong to the accompanying PR record.

## Observed

- Initial entry shows a preparation screen, not an already-running practice
  room. Piece, hand, challenge and pace are visible before the explicit
  **Start practice** action.
- Right hand, 50%, Wait for notes, count-in off and muted practice starts at E4.
  Pressing the wrong F4 does not advance; E4 advances. Returning with **Change
  plan** stops practice. A subsequent left-hand, 25% start waits at C3 instead.
- Keyboard Enter activates Start practice. The focused room heading receives
  focus; Change plan returns focus to the preparation heading.
- An ordinary sound-enabled Start enters the visible four-beat count-in.
  Change plan returns to stopped preparation. This is a UI/control observation,
  not an assessment of audible quality or timing.
- Opening Setup pauses at the current position. Done restores focus to Setup
  without resuming. Start and Change plan can be used repeatedly.
- A new, unsaved finger 5 on the demo survives preparation, practice, return to
  the plan and return to Studio. The original library remains unchanged.
- On the frozen candidate, choosing the original demo from Library prompts
  before replacing that dirty draft. Dismissing the native confirmation leaves
  Library open; returning to the plan retains its unsaved-draft notice and
  Studio still displays finger 5. No saved library entry was added.
- Browser window resizing and ordinary browser zoom exercised desktop,
  500×739, 400×591, 333×493, 316×372 and 568×317 CSS-pixel views. The narrow
  preparation page scrolls to all choices and Start. The focused room's
  toolbar and transport remain reachable with no document horizontal overflow.
  The small-landscape title truncates within its allotted space rather than
  displacing the controls. These are desktop responsive-layout checks, not
  physical Android viewport or touch acceptance.

Only ordinary controls and read-only rendered-DOM measurements were used.
There was no browser storage injection, synthetic MIDI permission, private
score import or artificial playback-state manipulation. Early development
hot reloads reset temporary preview state; observations crossing those reloads
were not accepted as draft-preservation evidence.

## Separate gates

Pending-audio cancellation, stale hand selections, empty-hand refusal,
cross-tab/library/bookmark recovery and regression coverage are exercised by
automated tests, not all reproduced in this browser pass. The optional
`scripts/browser-release.py` flow is updated for the new entry screen, but was
not run here.

Real Android/Casio connection, physical touch/keyboard behavior, audio quality
and latency, screen readers, native folder permissions and installed/offline
PWA lifecycle remain separate acceptance gates. This release does not close
those gates or claim Synthesia parity.
Private-score OMR still requires verified outbound-blocked execution on an
authorized target. No private score was used for this change.
