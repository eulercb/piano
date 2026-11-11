# Synthetic trim regression fixtures

These contain only original synthetic notation used for public-browser acceptance on 2026-11-11, not private scores.

- `trim-pickup-tie-tuplet.musicxml`: original generated four-measure piano score, with pickup, crossing tie, triplets and a simple chord.
- `trim-edited.musicxml`: actual public-browser export after editing the tied D4 to MIDI 63/finger 3 and resizing all three chord tones to two beats from the middle tone.
- `trim-failed.musicxml`: actual public-browser export after trimming that edited score to displayed measure 2 (zero-based index 2). Playback remained correct but the score failed to render. The inherited tempo direction precedes the initial copied attributes.

The regression derives corrected passages through the production trim function. It uses the failed export only as an unchanged playback/source-mapping/timeline baseline. Real OSMD is invoked with simulated jsdom canvas metrics; this does not verify browser typography or device layout.
