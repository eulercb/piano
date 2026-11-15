# Temporary practice ranges

A preparation-screen window is practice configuration, not a Studio trim or a
new song. Whole piece is the default. First half selects half the source duration;
Custom time range accepts finite start/end seconds with `0 <= start < end <=
duration`. Times stay on the original source clock at every playback speed.
Invalid fields and hands without eligible note attacks cannot start practice.

## Preserved data and transport

- The selected Song snapshot, ID, notes, fingering, duration, source MusicXML,
  score mappings and tempo map are not rewritten. Save/export still use the
  full piece, including unsaved Studio edits.
- Attacks at the start are included; attacks at the end are excluded. Notes and
  ties already held at the start are not reattacked. This applies to targets
  and accompaniment. Only emitted audio envelopes and falling-note geometry
  are clipped at the end; original note durations remain intact.
- Listen, wait-for-notes, Rhythm and Recital use the same source-time window.
  Final Rhythm/Recital notes retain their existing real-time late-hit window,
  without additional accompaniment or metronome attacks after the endpoint.
- Restart and Repeat return to the selected start, even after seeking. Seek
  controls support exact fractional endpoints. Change plan cancels playback
  and pending audio, retains the range, and never automatically resumes.
- Studio preview is whole-song. Visiting Studio without editing retains the
  plan. Editing, replacing the piece, or restoring a bookmark clears the old
  range. A canceled dirty-replacement prompt preserves both draft and range.
- The reading score remains complete. Cursor and tempo changes keep absolute
  source coordinates; at the endpoint the cursor can show the next written
  position, which is still excluded from playback/grading. No partial score
  document is generated.
- Count-in retains four quarter-note beats at the piece's starting tempo and
  selected speed. It does not infer a new tempo or meter for the range start.

## History and bookmarks

Only completed passes create history. The existing schema stores original
piece ID/revision and actual start/end source seconds. A seek can make the
recorded start later than the selected window start. Repeat uses the whole
selected window for the following pass. Fractional intervals are displayed
without calling a partial interval a whole-piece accomplishment.

Results suggestions only offer hands containing attacks in the selected window.
They restart paused at its start. Bookmark v1 cannot represent a temporary
range: saving is disabled with an explanation, rather than silently bookmarking
other music. Existing bookmarks still restore whole-piece plans unchanged.

## Validation boundary

New automated coverage exercises all modes, exact boundaries, long/tied notes,
25/50/125% final late windows, tempo-map integration, repeat after seek, history
identity and endpoints, source-linked score/fingering preservation, exact
project/MusicXML/MIDI export equality, unchanged library bytes, dirty cancellation,
bookmark restore, invalid fields, fractional seeking and pending audio cancellation.
Independent review added regressions for sub-centisecond seeking and unavailable
Setup hands. Audio assertions inspect scheduled envelopes, not audible quality.

The real-browser narrow-layout check for this change was **not completed**:
the managed preview was denied before page access. The previous preparation-screen
browser record does not establish acceptance for these new controls. No physical
Android/Casio, touch, screen-reader, audible timing or installed/offline PWA
acceptance is claimed. Final aggregate totals and exact-head CI belong to the PR.
