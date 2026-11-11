# Experimental local desktop recognition

This is an actual, separately invoked Audiveris PNG-to-MusicXML experiment, not
browser recognition, an Android feature, a model loader, or a localhost service.
It is not yet accepted for private-score processing: network isolation and
network observation were both unavailable in this executor. Use original
synthetic images for evaluation until offline acceptance is completed.

## Measured result

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

The PNG, gold XML and captured recognized XML contain only this newly authored
exercise, no private score or existing composition. They can be used as project
regression fixtures. Recognition output is retained unchanged, including engine
metadata; it is not a hand-corrected expected-output file.

## Reproduce

On a supported Linux machine, separately obtain Audiveris from its official
release and verify the package hash. Do not use similarly named third-party
sites. Choose a new output filename, since the adapter refuses replacements:

```sh
python scripts/omr/recognize.py \
  --audiveris /path/to/trusted/Audiveris \
  --input fixtures/omr/piano-quarter-notes.png \
  --output /path/to/new-recognized.musicxml --timeout 180
python scripts/omr/compare.py fixtures/omr/piano-quarter-notes.musicxml /path/to/new-recognized.musicxml
python -m unittest discover -s scripts/omr -p 'test_*.py' -v
npm test -- --run src/localOmrFixture.test.ts
```

Optional fixture regeneration after installing the pinned rendering tools in a
separate virtual environment: `python scripts/omr/render_fixture.py`. Rendering
may depend on fonts/platform. Visually inspect regeneration before replacing the
fixture; never silently update the captured recognized output to match gold.

Correct recognition mistakes in Audiveris or a source notation editor before
importing. The captured output has positioned `default-x` note attributes, which
the app's bounded structural editor may intentionally refuse to edit. Existing
pitch/finger/transposition tools do not imply arbitrary notation correction.

Import an exported result through the app's existing Import song path, after
reviewing it against the image. The adapter does not modify saved songs, invoke
the browser, or bypass importer restrictions. App support for this fixture is
verified; a successful conversion does not guarantee import of arbitrary scores.

## Safeguards and limits

- Single explicit PNG, at most 20 MiB / 20 million pixels; no PDF/multipage support.
- Fresh temporary input copy, home, cache and output per job. No persistent daemon.
- Argument array, no shell interpolation; fixed temporary input filename.
- 1–600 second wall timeout, CPU-time limit, 1536 MiB Java heap and two JVM
  processors. 64 MiB per-file write limit, core dumps disabled. These are not a
  complete memory/process/disk sandbox and do not constrain arbitrary untrusted
  executables. Only supply a trusted installed Audiveris launcher.
- Timeout, Ctrl-C and SIGTERM kill the process group and remove temporary state.
  Abrupt SIGKILL, OS crashes or power loss cannot guarantee cleanup. Avoid
  cloud-synced output/temp directories.
- One bounded MXL output is read in memory; ZIP entry paths are never extracted.
  Only UTF-8 score-partwise XML with notes is accepted. Entity declarations and
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
shipping general recognition, evaluate original fixtures with chords, multiple
voices, rests, accidentals, ties, repeats, tuplets, page breaks, rotation, contrast
loss and camera distortion. Set quality thresholds in advance and report failures
and correction effort. Verify cancellation with the actual engine on each target
platform, resource limits, bad images, missing models, repeated runs, and current
licenses. Desktop workflow acceptance does not establish browser/mobile support.
