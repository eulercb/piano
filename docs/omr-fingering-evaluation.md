# Fingering recognition: measured failure, not an enabled feature

This hardware-independent experiment adds an original fixture and a strict
attachment evaluator. It does **not** change the recognition adapter, enable a
product default, process a private score, or connect recognition to the browser.
Both captured configurations fail acceptance. No correction is hidden in the
fixtures, and no new recognizer run was made to search for a passing result.

## Verified capability versus actual result

Main `e9207adc` invokes Audiveris batch transcription/export without a fingering
override. In pinned Audiveris 5.11.0, [ProcessingSwitches](https://github.com/Audiveris/audiveris/blob/5.11.0/app/src/main/java/org/audiveris/omr/sheet/ProcessingSwitches.java)
defaults `fingerings` to false; [InterFactory](https://github.com/Audiveris/audiveris/blob/5.11.0/app/src/main/java/org/audiveris/omr/sheet/symbol/InterFactory.java)
only considers digit candidates 0–5 when that switch is on. The
[vendor guide](https://audiveris.github.io/audiveris/_pages/guides/specific/fingering_plucking/)
uses guitar examples. None of this establishes piano accuracy.

The supported experiment override is:

```text
-constant org.audiveris.omr.sheet.ProcessingSwitches.fingerings=true
```

[ConstantSet](https://github.com/Audiveris/audiveris/blob/5.11.0/app/src/main/java/org/audiveris/omr/constant/ConstantSet.java)
derives the declaring class and field name; the [constant registry](https://github.com/Audiveris/audiveris/blob/5.11.0/app/src/main/java/org/audiveris/omr/constant/ConstantManager.java#L182-L199)
reads the CLI property by that qualified name. The
[exporter](https://github.com/Audiveris/audiveris/blob/5.11.0/app/src/main/java/org/audiveris/omr/score/PartwiseBuilder.java#L2539-L2550)
writes a chosen fingering to the associated notehead's MusicXML note. A valid
export therefore preserves the engine's chosen association, not necessarily the
correct association.

## Original input and predeclared acceptance

`fixtures/omr/fingering/piano-fingerings.musicxml` is a newly authored two-bar,
two-staff piano exercise: 17 notes, 13 single finger marks in 1–5, and four
intentionally unmarked notes. It includes repeated pitches at different onsets,
an E4/G4 chord whose respective finger marks are 1/3, and a separate direction
numeral **3**, which is not a finger. Upper/lower staves define written right/left
hand in this fixture, not which physical hand somebody uses.

The adjacent PNG was rendered once and visually checked before recognition. Its
digits, chord and separate direction numeral are visible. The renderer was the
already available Verovio **6.4.0-cb5fcfa** and CairoSVG **2.9.1**, not the older
versions used for the previous matrix. Fontconfig emitted no-writable-cache
warnings. No font or recognizer assets are bundled. This is clean digital
engraving, not a phone photo or a camera-distortion benchmark.

Before running either configuration, the gate required all written events and
all exact finger attachments to match, with no added marks on unmarked notes.
No nearest-note matching, timeline rescaling or manual musical correction is
allowed. Comparison keys are part, measure index, staff, written pitch including
octave/alteration, and exact rational measure-relative onset. Chord order and
arbitrary voice identifiers are not attachment keys. Ambiguous same-key unisons
are unassessable, rather than paired by list order.

## Two actual engine invocations

The retained official Ubuntu package's SHA-256 was rechecked against
`ae714594f40e54b1a4951fc3f914f08ae38fe5d07b7f2283b1a904fdb6e0a318`.
The unchanged Audiveris 5.11.0 launcher ran the same PNG exactly once with its
default and once with the explicit override, using the existing adapter's fresh
job state, timeout, cleanup and cooperative JVM limits. The enabled run used a
small local launcher that inserts only the documented constant and then execs
the same vendor executable; `recognize.py` is unchanged.

| Result | Default | Explicit fingerings on |
| --- | ---: | ---: |
| Engine/adapter exit | 0 | 0 |
| Exported notes | 17 | 17 |
| Exact pitch/onset/duration/staff/measure events | 9/17 | 9/17 |
| Exported finger marks | 0 | 7 |
| Correct marks at exact expected attachments | 0 | 4 |
| Missing marks at exact expected attachments | 13 | 7 |
| Incorrect values at matched attachments | 0 | 2 |
| Extra marks at unexpected attachments | 0 | 1 |
| Correct expected-unmarked attachments | 2/4 | 2/4 |
| Missing / unexpected note keys | 7 / 7 | 7 / 7 |
| Overall acceptance | **Fail** | **Fail** |

The enabled export changes both expected finger **5** marks (first-bar left C3
and second-bar right G4) to **2**. Its upper G4 chord member receives **1** rather
than the expected **3**, while the lower E4 loses its expected **1**. The chord's
onset is also wrong, so that upper-head mark appears in the exact-key report as
an extra attachment, not a matched-note value error. These are distinct retained
errors, not evidence that an extra ink glyph was invented.

Both exports introduce unwritten 3:2 triplet timing in bar 2. The separate
direction numeral is present in the input, but this experiment did not isolate
the cause of the timing error. No causal claim or post-hoc image adjustment is
made. Seven keys disappear and seven unexpected keys appear because of changed
onsets. Missing-note/missing-mark and unexpected-note/extra-mark counts overlap;
they are exact-attachment diagnostics, not independent recognition-error rates.
No fingering accuracy percentage is assigned. Ten note attachments match when
duration is excluded, but only nine complete timing events match.

Observed adapter wall times were 8.893 s and 7.250 s; maximum child RSS was
489,016 KiB and 499,236 KiB respectively. Each log had three warning/error lines.
These Linux observations are not total process-tree memory limits, cold-cache
benchmarks, mobile performance or general accuracy. The existing missing OCR
language limitation remains. Raw logs/exports stay outside the repository.

## Evaluator and importer boundaries

`scripts/omr/compare_fingerings.py` reports the legacy note/timing/voice/written
event comparison separately from fingering attachment. A duration-only error can
fail the event gate while exact fingering attachment still passes. Changing an
onset or pitch cannot earn credit by moving the mark to the nearest expected
note. Unexpected marks on otherwise matching unmarked notes fail the gate.
Digit 0 is counted as incorrect or extra and flagged invalid for piano; complex,
multiple, alternate/substitution marks and ambiguous unisons are unassessable.

The comparator is deliberately limited to UTF-8, unnamespaced, single-part piano
with staff 1/2, at most 1 MiB and 512 written events. It rejects unsupported grace
attachment and entity/internal-DTD declarations. It does not establish fingering
substitution semantics, cross-staff hand reassignment, general engraving fidelity
or notehead association across ambiguous same-pitch unisons. Exact note timing
must still pass the existing event gate for overall acceptance.

The importer regression checks the gold's hand/pitch/onset/finger associations,
including chord heads, repeated pitches and unmarked notes. It also checks both
actual captured exports without correcting them: an import can faithfully retain
the engine's wrong finger or wrong timing. Passing these tests is preservation
evidence, not recognition accuracy.

## Recheck without a recognizer

```sh
python -m unittest discover -s scripts/omr -p 'test_*.py' -v
npm test -- --maxWorkers=2 src/localOmrFingering.test.ts
python scripts/omr/compare_fingerings.py \
  fixtures/omr/fingering/piano-fingerings.musicxml \
  fixtures/omr/fingering/audiveris-5.11.0/fingerings-enabled.public.musicxml
```

The last command must exit **1**, retaining the failed exact gate. Gold against
itself exits 0. Neither command runs recognition or downloads anything.
`render_fingering_fixture.py` regenerates only the original gold/image with
separately provisioned optional renderers. Record versions and inspect pixels
before using a regenerated image; never replace captures to match new gold.

To repeat the actual experiment on an authorized machine, follow the provisioning
and safeguards in [local OMR evaluation](local-omr-evaluation.md). Use the existing
adapter with the trusted vendor launcher for baseline. For enabled evaluation,
create a separate trusted local launcher that executes the same binary with the
constant above before forwarding the adapter's arguments. Keep two fresh output
directories and the raw logs; never overwrite captures or retry until green.

The `*.public.musicxml` files are derived copies removing only local source paths,
miscellaneous source fields and encoding date. Musical part contents are unchanged;
their digests and identical comparison reports are checked. `provenance.json`
records gold/image/raw-export/public-copy hashes and exact run measurements. The
PNG contains only image chunks, with no EXIF/text metadata. Sanitization is not
musical repair. Raw exports and logs are not included in this repository.

## Still required

Do not enable fingering detection by default on this evidence. Before private
score use, actual outbound-blocked recognition remains required on an authorized
target; neither this script nor fresh job state provides network isolation.
Previously denied network-isolation/syscall-observation operations were not
retried or bypassed. No private input, browser, Android/Casio or actual photograph
was used. Future evaluation should retain these failures and separately measure
corrected note attachment, usable timing and a photographed original page, with
quality thresholds declared before the run.
