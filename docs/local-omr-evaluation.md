# Experimental local desktop recognition

This is an actual, separately invoked Audiveris PNG-to-MusicXML experiment, not
browser recognition, an Android feature, a model loader, or a localhost service.
It is not yet accepted for private-score processing: network isolation and
network observation were both unavailable in this executor. Use original
synthetic images for evaluation until offline acceptance is completed.

## Baseline measured result

The committed `fixtures/omr/piano-quarter-notes.png` is a visually inspected,
original two-measure piano exercise rendered from its adjacent gold MusicXML.
The captured `audiveris-5.11.0.musicxml` was produced by the real engine from that
PNG, not by copying the gold or by a fake subprocess. The fixture has 16 quarter
notes on two staves. It is clean digital engraving, not a camera-photo benchmark.

`evaluation.json` records 16/16 exact matches by pitch (including octave), onset,
duration, staff and measure index, with precision and recall both 1.0. Voice
partition correspondence passes: upper voice 1 remains 1, lower voice 2 becomes
5, which is an arbitrary identifier change. No notes were manually corrected.
The importer regression also compares the app's resulting pitches, times,
durations and left/right hands against the gold. This is evidence for this one
simple page, not an estimated accuracy rate on real music.

An actual-engine negative control also processed the original all-white 1000×1000
`blank.png`: Audiveris exited 1, the adapter exited 1, and no destination was
created. This tests one unsupported input with the real engine, not all bad-image
failure modes. `provenance.json` retains fixture hashes and the control outcome.

The adapter's measured run is recorded in `run-metrics.json`: wall time includes
engine startup, recognition, export and validation. `child_max_rss_kib_linux` is
Linux's maximum child RSS reported to a fresh Python process, not a total process
tree/cgroup measurement. This cloud Linux executor is not representative of a
phone or low-end desktop. No first-install timing, battery, or thermal measurement
was made. Initial direct invocation also succeeded, but was not timed. Fresh
per-job home/configuration does not flush the OS file cache, so none of these runs
is a verified cold-cache benchmark.

English text OCR warned about missing/incompatible legacy language data in the
first run; the adapter's fresh home also reports missing OCR support. Musical
notes still exported. Titles, lyrics and textual directions are not accepted by
this evaluation. Warning counts are returned, rather than suppressed as success.

## Expanded synthetic matrix

`fixtures/omr/matrix/` adds two original two-bar exercises and one fixed image
perturbation. The PNGs were visually checked before recognition. Exactly three
actual Audiveris 5.11.0 invocations were made, with no retry, manual correction,
gold substitution, or search for a transformation that happened to pass:

| Case | Captured outcome | Wall time | Child maximum RSS (KiB) | Warning lines |
| --- | --- | ---: | ---: | ---: |
| Mixed rhythms/accidentals | 14/14 written events matched | 8.587 s | 462,176 | 2 |
| Simple chords/cross-bar ties | Invalid export: `divisions=0`; no event accuracy assigned | 7.205 s | 446,416 | 3 |
| Same rhythm page, fixed skew/contrast | 14/14 written events matched | 9.145 s | 378,664 | 2 |

The rhythm exercise includes a dotted quarter and half note, flagged and beamed
eighth notes, three quarter rests, a sharp and a flat. The 14 written events
include the rests; the app imports 11 sounding notes. The fixed perturbation
maps grayscale values with `round(45 + pixel * 0.75)`, then rotates 1 degree
counterclockwise using bicubic resampling, an expanded canvas and fill value 236.
It is **not a phone photograph** and tests neither perspective distortion, blur,
shadows, cropping, compression nor camera focus. These are individual fixture
results, not a general accuracy percentage.

The acceptance rule was set before running: exact pitch, onset, duration, staff
and measure index for all written events, a corresponding voice partition, and
matching written note type, dot count, sound ties and visible ties. This is not
full engraving equivalence: beams, slurs, text, clefs, key/time signatures and
layout are not independently scored by the comparison script. The importer
regressions separately compare played pitches, timing, durations, hands and total
duration for the accepted captures.

The chord/tie page is useful negative evidence. Audiveris exited 0 and exported
15 written notes, including chord and tie elements, but emitted zero divisions.
The original adapter published that unusable XML, and the original comparator
stopped with `ZeroDivisionError` before running the third case. The output was
**not repaired**. The app already rejects it. The adapter now checks basic
positive decimal timing before publication, and the comparator returns a
structured, non-comparable failure rather than an accuracy score or traceback.
Tests feed the public failure copy, with unchanged musical content and timing,
through validation and verify that no destination is published. This is a
validation replay, not another engine run.
Only the previously unrun skew/contrast case was then recognized, once.

The combined report records this capture history explicitly. Original exports
and engine/adapter logs are retained locally and are **excluded from this public
artifact set**. Under `matrix/audiveris-5.11.0/`, the files named
`recognized.public.musicxml` are reviewed, derived copies, not raw exports.
They remove the source path, miscellaneous source-file/source-sheet metadata and
encoding date. Musical elements, layout and the invalid `divisions=0` are unchanged.
Per-case reports retain original-export hashes, public-file hashes, musical-content
hashes and minimal reviewed measurements. Platform/kernel/libc and Python
environment identifiers are excluded. The three PNGs are unchanged and contain
only image chunks (IHDR, optional bKGD, IDAT and IEND), with no text/EXIF metadata.
The comparator reports are identical for the private originals and public copies.
Both rhythm runs warned about missing OCR languages; the chord/tie run also
warned that beam height was guessed. No runtime network observation was added. The
resource/cache caveats of the baseline apply equally to these three runs.

## Provisioning and provenance

No engine, model, JRE or renderer is bundled in this repository or added to npm
production dependencies. There are no automatic downloads in the adapter.
The trusted, separately installed executable is an explicit CLI argument.

Evaluation used the project's official [Audiveris 5.11.0 release](https://github.com/Audiveris/audiveris/releases/tag/5.11.0):

- [Ubuntu 22.04 x86_64 package](https://github.com/Audiveris/audiveris/releases/download/5.11.0/Audiveris-5.11.0-ubuntu22.04-x86_64.deb), 78,048,872 bytes.
- SHA-256: `ae714594f40e54b1a4951fc3f914f08ae38fe5d07b7f2283b1a904fdb6e0a318`.
- Extracted with `dpkg-deb -x` into a temporary directory, not installed system-wide.
  Approximately 187 MiB extracted (`du -sh`, allocated blocks).
- The launcher uses bundled Java **25.0.3**, not the executor's system Java 21.
- Packaged `res/basic-classifier.zip` in `audiveris.jar`: 396,100 bytes,
  SHA-256 `327194c47116a8ebf5771d04cea08a4e563ec93d2955e1efd990a54a9245f29e`.
- [Audiveris source license](https://github.com/Audiveris/audiveris/blob/5.11.0/LICENSE): AGPL-3.0;
  source headers specify version 3 or later. The vendor package contains its
  classifier and third-party dependencies. This experiment does not independently
  clear training-data rights or redistribution of the whole package. Do not copy
  those assets into the app without that review.
- Rendering used PyPI Verovio 6.4.1 (`6.4.1-fbe8f46`, LGPL-3.0-only package metadata)
  and CairoSVG 2.8.2 (LGPL-3.0-or-later package metadata), installed only in a
  temporary evaluation directory. These are optional fixture development tools,
  not needed for the CLI or app. No renderer code/font is redistributed here.
- The matrix uses those same renderer versions plus Pillow 13.0.0 (MIT-CMU
  package metadata) for its deterministic grayscale/rotation transform. These
  existing temporary developer tools were reused without new downloads.
  Rendering emitted Fontconfig no-writable-cache warnings; the inspected PNGs
  had no missing musical glyph observed. Matrix provenance records these limits
  and confirms the same package hash and bundled Java 25.0.3 runtime.

The PNGs, gold XML and captured recognized XML contain only these newly authored
exercises, no private score or existing composition. They can be used as project
regression fixtures. The matrix's public MusicXML files are explicitly derived
copies with nonmusical local metadata removed; no musical content was corrected
to match the gold. Original exports and logs are preserved locally, not published.

## Reproduce

On a supported Linux machine, separately obtain Audiveris from its official
release and verify the package hash. Do not use similarly named third-party
sites. Choose a new output filename, since the adapter refuses replacements:

```sh
python scripts/omr/recognize.py \
  --audiveris /path/to/trusted/Audiveris \
  --input fixtures/omr/piano-quarter-notes.png \
  --output /path/to/new-recognized.musicxml --log /path/to/new-engine.log --timeout 180
python scripts/omr/compare.py fixtures/omr/piano-quarter-notes.musicxml /path/to/new-recognized.musicxml
python -m unittest discover -s scripts/omr -p 'test_*.py' -v
npm test -- --run src/localOmrFixture.test.ts
```

Optional fixture regeneration after installing the pinned rendering tools in a
separate virtual environment: `python scripts/omr/render_fixture.py`. Rendering
may depend on fonts/platform. Visually inspect regeneration before replacing the
fixture; never silently update the captured recognized output to match gold.

To render the expanded originals, use `python scripts/omr/render_matrix.py` in
the separate environment with the pinned optional renderers above. Recognition
does not require those renderers. To run just the three committed PNGs, with a
new result directory, sequentially and without retries:

```sh
python scripts/omr/evaluate_matrix.py \
  --audiveris /path/to/trusted/Audiveris \
  --output-dir /path/to/new-matrix-results --timeout 180
```

`--case rhythm-accidentals`, `--case chords-ties` or
`--case rhythm-skew-contrast` selects a single case. The harness exits 1 when any
case fails its exact gate; that is a retained result, not a request to rerun until
green. It caps each engine wait at 180 seconds, starts a fresh adapter process per case,
saves results incrementally, and keeps uncensored raw logs **locally**. These
private harness outputs must not be copied directly into public fixtures or
published; the committed public evidence is separately reviewed and labeled.
New runs with the hardened adapter reject invalid timing rather than creating the historical
invalid chord/tie export. `compare.py` can recheck captured XML without invoking
the engine; invalid XML produces structured JSON and exit 1.
The fixture comparator accepts only unnamespaced `score-partwise` documents
with at least one written note/rest event; unsupported or empty documents cannot
pass the gate. Each note must explicitly contain exactly one pitch or rest.
Unpitched notes, missing/mixed categories, malformed pitches and fractional
semitone alterations are outside this fixture comparator's supported subset.
Adapter startup, input copying, validation and report writing add overhead beyond
the engine wait; this is not a total-job wall-time sandbox.

Correct recognition mistakes in Audiveris or a source notation editor before
importing. Captured outputs retain their original positioned note attributes,
beams and ties. The app's bounded structural editor supports only its declared
subset; existing pitch/finger/transposition tools do not imply arbitrary notation
correction. In particular, do not guess a replacement for invalid divisions.

Import an exported result through the app's existing Import song path, after
reviewing it against the image. The adapter does not modify saved songs, invoke
the browser, or bypass importer restrictions. Import of the successful fixtures
and rejection of the invalid export are verified; a successful conversion does
not guarantee import of arbitrary scores.

## Practical photo-to-score path: still a desktop experiment

The shortest plausible path is an explicitly installed desktop engine, a locally
prepared single-page PNG, an inspected/corrected MusicXML export, then the app's
existing Import song path. This patch improves the first experiment and its
failure reporting; it does not connect the app's photo picker to recognition.
There is no camera capture, JPEG/PDF conversion, automatic crop/deskew service,
upload endpoint, browser/WASM engine, or Android integration here.

Do not run private photographs through this experiment yet. Outbound-blocked
recognition still needs to be verified on an authorized target machine, including
its executable, models and OCR dependencies. A two-case rhythm success does not
resolve the invalid chord/tie export, establish correction effort, or establish
accuracy for a real photographed page. Once privacy acceptance is complete, the
next evidence should include purpose-written, actually photographed pages and
usable chord/tie timing, with failures retained rather than repaired invisibly.

## Code validation

On 2026-11-11, this OMR change with the reviewed public copies, based on main
`777357ce`, passed the following checks sequentially; this
does not include the separate authoring/performance branches or establish
browser/device acceptance:

- `npm test -- --maxWorkers=2`: 931 tests across 61 files, including the four
  captured-output importer cases.
- `python -m unittest discover -s scripts/omr -p 'test_*.py' -v`: 22 tests,
  including invalid/empty/unsupported comparison rejection, explicit pitch/rest
  category checks, original fixture generation, public content/report hashes,
  raw log retention, timeout/cancellation and no-publication boundaries.
- `npm run build`: TypeScript check and production build passed. The existing
  app/OSMD chunks over 500 kB still produce the normal size warning.
- `npm run check:release`: production artifact check and all seven release
  contracts passed. `git diff --check` also passed.

An additional three-case local check against the retained original
exports confirmed identical complete importer outcomes, excluding only the
generated song ID and intentionally changed stored XML text. The chord/tie
original and public copy return the same invalid-divisions error. Musical-content
digests and comparison reports match for every pair; all PNG bytes are identical.

The Python fake-engine transports remain boundary tests only. No engine run was
added for these checks. Public packaging removes only the metadata listed above;
it neither corrects musical recognition nor publishes raw logs.

## Safeguards and limits

- Single explicit PNG, at most 20 MiB / 20 million pixels; no PDF/multipage support.
- Fresh temporary input copy, home, cache and output per job. No persistent daemon.
  Native `TMPDIR`/`TMP`/`TEMP` and Java `java.io.tmpdir` point to a private
  per-job `tmp` directory, removed along with the job on success, engine failure,
  timeout or cancellation. Previously these defaults were not redirected and
  could leave cooperative engine intermediates outside the cleanup directory.
  Fake-engine tests verify native temporary-file placement and cleanup for all
  four outcomes, plus the Java option supplied to the child. JVM path options
  are double-quoted so spaces and apostrophes do not split them. Temporary
  parents containing double quotes are rejected before launch rather than
  applying unverified escaping. These fake-engine tests do not verify
  actual Java/Audiveris temporary writes or prevent a program from choosing a
  different path. This is cleanup configuration, not filesystem isolation.
- `--log` is opt-in and creates a new owner-only `.log` file exclusively, refusing existing
  files and symlinks. It retains raw stdout/stderr on success, failure, timeout or
  cancellation. Logs can contain local paths and score-derived details; keep
  them local and delete them when no longer needed. They are not uploaded. The
  existing per-file limit bounds engine logs to 64 MiB. The matrix harness also
  bounds each adapter stdout/stderr file to 64 MiB. These are individual file
  limits, not an aggregate disk quota.
- Argument array, no shell interpolation; fixed temporary input filename.
- 1–600 second wall timeout, CPU-time limit, 1536 MiB Java heap and two JVM
  processors. 64 MiB per-file write limit, core dumps disabled. These are not a
  complete memory/process/disk sandbox and do not constrain arbitrary untrusted
  executables. Only supply a trusted installed Audiveris launcher.
- Timeout, Ctrl-C and SIGTERM kill the process group and remove temporary state.
  Abrupt SIGKILL, OS crashes or power loss cannot guarantee cleanup. Avoid
  cloud-synced output/temp directories.
- One bounded MXL output is read in memory; ZIP entry paths are never extracted.
  Only UTF-8 score-partwise XML with notes and basic positive decimal timing is
  accepted. Divisions must precede timed events; divisions and durations are
  bounded to 64-character decimals greater than zero and at most 10,000,000.
  This is not a full MusicXML validator. Entity declarations and
  internal DTD subsets are rejected; the standard external MusicXML DOCTYPE is
  not fetched. The app's stricter importer remains authoritative.
- Output is staged in the destination directory, flushed, then published with an
  exclusive atomic hard link, so a pre-existing file is never replaced and partial
  destination files are not exposed. Cancellation just after publication can
  leave a complete result. Filesystems without hard links fail safely.
  This adapter is an experiment, not a hardened parser for adversarial images.
- Fake executables in Python tests exercise boundaries only. They are expressly
  not recognition acceptance. The captured engine artifact and importer test
  provide separate actual recognition evidence.

## Network evidence and remaining release gates

No network isolation is provided by this script. It neither uploads images nor
starts a service itself, but it invokes another program. Its environment cleanup
and headless flags are not proof that program cannot access the network.

A `bwrap --unshare-net` preflight failed creating a NETLINK_ROUTE socket with
`Operation not permitted`. A separate `strace -f -e trace=network` observation
failed at PTRACE_TRACEME with `Operation not permitted`; that traced recognition
never ran. Neither denial was retried or bypassed. Therefore **no blocked-network
or syscall-observed recognition result is claimed**.

A narrow source inspection of pinned release
[Main.java](https://github.com/Audiveris/audiveris/blob/5.11.0/app/src/main/java/org/audiveris/omr/Main.java)
shows update polling disabled in batch mode.
[Languages.java](https://github.com/Audiveris/audiveris/blob/5.11.0/app/src/main/java/org/audiveris/omr/text/tesseract/Languages.java)
shows missing language support warns in headless mode rather than opening the
GUI installer. The project also has network-capable language-download code;
these observations are not a full dependency/source audit or runtime proof.

Before private use, repeat provisioning separately from recognition and verify a
run with outbound traffic genuinely blocked on an authorized machine. Before
shipping general recognition, expand beyond this tiny matrix to usable chord/tie
exports, multiple voices, more rhythm/accidental patterns, repeats, tuplets, page
breaks, rotation/contrast ranges and actual camera distortion. Set quality
thresholds in advance and report failures and correction effort. Verify
cancellation with the actual engine on each target
platform, resource limits, bad images, missing models, repeated runs, and current
licenses. Desktop workflow acceptance does not establish browser/mobile support.

## Temporary-state regression check

On 2026-11-11, the job-local temporary-directory change passed all 24 Python OMR
boundary/fixture tests (`python -m unittest discover -s scripts/omr -p 'test_*.py' -v`).
No actual recognizer, private score, network observation or isolation operation
was run for this check. The original captured recognition results above are
unchanged. Actual-engine temporary writes and cleanup still require verification
in the authorized, outbound-blocked target environment before private-score use.

A separate locally authored Java probe, using the same sanitized environment and
JVM options with a synthetic temporary parent containing spaces and an apostrophe,
verified the exact `user.home` and `java.io.tmpdir` properties and that
`Files.createTempFile` created its file in the job's `tmp` directory. The file and
whole probe directory were removed. This used the already-installed OpenJDK
21.0.13, build `21.0.13+9-1-deb13u2-Debian`, not the pinned Audiveris Java 25.0.3.
It proves this quoting/default-temp behavior for that system JVM only. It does
not test Audiveris dependencies, arbitrary path choices, actual-engine
cancellation, filesystem confinement or network access.
