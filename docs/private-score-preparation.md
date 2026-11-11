# Private score preparation and OMR decision

Research date: 2026-11-11. Scope: roadmap #8's later OMR investigation and issue
#6's explicit non-promise of recognition. This slice adds preparation guidance,
not an OMR engine. The existing MusicXML/MXL importer is not recognition.

## Decision

Do not bundle a recognizer or add a conversion server now. Recommend a separate,
user-operated desktop conversion workflow for scans, with Audiveris as the first
candidate to evaluate. Export existing digital notation directly where possible;
recognizing a screenshot of already available notation adds avoidable errors.

A browser port remains research, not a feature commitment. None of the inspected
projects supplied evidence sufficient to promise accurate, fast, offline piano
recognition in this app on mobile browsers. This is not a claim that browser OMR
is impossible. Shipping a model loader alone would not provide the preprocessing,
notation reconstruction, correction UI, and measured acceptance this needs.

## Candidate evidence

- **Audiveris:** Java desktop OMR; repository identifies AGPL-3.0 and MusicXML
  output. Official installer documentation says Windows/Linux/macOS installers
  bundle a JRE; OCR language data is installed separately. Its illustrative
  version 5.7.0 packages are 62.5–68.2 MB, not a current-version size guarantee,
  browser bundle measurement, or installed footprint. It has a documented
  correction workflow. This is the most practical desktop evaluation candidate,
  not a browser dependency. Sources: [repository](https://github.com/Audiveris/audiveris),
  [installers](https://audiveris.github.io/audiveris/_pages/tutorials/install/binaries/),
  [handbook](https://audiveris.github.io/audiveris/_pages/handbook/).
- **oemer:** MIT-labeled Python project using ONNX Runtime by default, with
  TensorFlow optional. Its README describes automatic first-run checkpoint
  downloads and estimates 3–5 minutes with a GPU, with no standardized benchmark
  context. That estimate is not measured browser or target-device performance.
  Exact model bytes, total install size and peak memory were not measured. ONNX
  models alone do not make the complete Python pipeline browser-compatible.
  Code-license labeling is not an audit of every model or training-data right.
  Source: [official project](https://github.com/BreezeWhite/oemer).
- **homr:** Python photo/PDF-to-MusicXML project with AGPL-3.0 code. The project's
  license FAQ also labels weights AGPL but flags unresolved training-data rights,
  including a non-commercial label on a copy of Camera-PrIMuS. Treat model
  redistribution/commercial compatibility as unresolved until reviewed, not as
  cleared by the source-code license. Exact download size, runtime memory and
  browser timing were not measured. No model is included here. Sources:
  [project](https://github.com/liebharc/homr),
  [runtime metadata](https://github.com/liebharc/homr/blob/main/pyproject.toml),
  [license FAQ](https://github.com/liebharc/homr/blob/main/LICENSE_FAQ.md).

These are engineering observations, not legal advice. Before integrating any
engine, audit the pinned release, dependencies, model licenses/provenance and
redistribution obligations. Linking to a separately installed tool is not a
license determination for a future combined product.

## Local workflow

1. Preserve the original scan and export a backup of the current Piano Studio
   song. Use only material you are entitled to process. Do not commit private
   scores, copyrighted arrangements, images or conversion output to this repo.
2. If a notation editor already holds the score, export MusicXML from it. For a
   scan, select a separate desktop recognizer. Obtain Audiveris only through its
   [official releases](https://github.com/Audiveris/audiveris/releases) and follow
   its current installation instructions. This app does not install it for you.
3. Finish installation and required language/model downloads before processing
   private input. Keep originals, intermediate projects, caches, logs and output
   outside cloud-synced directories. For a local-only run, disconnect networking
   during conversion. Do not substitute an online demo, hosted notebook or upload
   service. A tool's name or open-source license alone does not ensure privacy.
4. Start with a clear, straight, evenly lit page. Check the recognized notation
   in the desktop editor and correct errors before export. Retain the editable
   desktop project as well as the original scan.
5. Export self-contained MusicXML (.musicxml/.xml) or compressed MusicXML (.mxl),
   without linked images. An Audiveris .omr project and a PDF are not MusicXML.
   Import using Piano Studio's existing Import song action. Existing import
   safety/size checks remain authoritative; do not bypass them for OMR output.
6. Compare every measure with the original: page transitions, clefs, key/time
   changes, accidentals, rests, durations, chords, voices, hand assignment, ties
   and repeat structure. Unfold repeats in the source editor before export; the
   importer rejects repeat-marked scores. Listen slowly. A parsed score can still have incorrect
   musical meaning; the app's supported playback may differ from engraving.
7. Fix complex notation in the source editor and re-export. Save a checked copy
   separately before replacing anything useful. Verify saved-song persistence
   and offline reopening on the intended device before relying on it.

The separate [Audiveris CLI experiment](local-omr-evaluation.md), merged through
[#22](https://github.com/eulercb/piano/pull/22), exercised actual recognition and
app import on one original clean two-bar fixture: 16/16 quarter-note events
matched, and a blank control failed without output. This is narrow synthetic
evidence, not general-score or phone-photo accuracy. Network isolation and
observation were denied; private-score offline safety remains unverified. Use
synthetic inputs until that acceptance is completed on an authorized machine.
App offline behavior also requires a successful prior PWA install/cache and is
not proven by a unit test or build.

## Implemented boundary

`ScorePreparationGuide.tsx` is a native collapsed `details` disclosure intended
beside Import song. It takes no song/file props, changes no songs, and contains
no file picker, conversion action, storage call or network request. Its only
outbound actions are explicitly labeled documentation/release links opened by
the user, with no referrer or opener access. Those visits still contact external
sites; the guide does not claim the whole application or browser is network-free.

Component tests check the rendered limitations, safe link attributes, absence of
embedded/file-input controls, and no calls to selected fetch/file/storage APIs
when mounting/toggling/unmounting. These are bounded regression checks, not a
network audit or proof of browser privacy. Browser interaction/accessibility and
real device acceptance remain unverified.

## Acceptance before any recognition integration

- Pin engine, runtime and model versions/hashes; document all license and model
  provenance decisions before adding downloads or redistribution.
- Use original synthetic fixtures or explicitly licensed test scores, never
  private songs. Include grand staff, chords, multiple voices, rests, accidentals,
  ties, repeats, tuplets, page breaks, rotation and poor contrast. Keep gold
  MusicXML and rights metadata for each input.
- Measure first-install bytes, warm/cold page latency, peak memory, battery/thermal
  behavior and offline cache requirements on actual low-end mobile and desktop
  devices. Report failures as well as medians and worst cases. Do not reuse
  server/GPU numbers as browser estimates.
- Compare note pitch/onset/duration, voice/staff mapping and measure alignment to
  gold data; report correction effort. Set release thresholds before selecting
  favorable examples. Imported XML validity alone is not an accuracy metric.
- Verify conversion with outbound network blocked after provisioning. Test
  missing/corrupt models, unsupported pages, oversized inputs, cancellation,
  repeated requests and stale results. Conversion must never silently fall back
  to uploading input or overwrite a saved song.
- Use a bounded worker/cancellable job design for browser experimentation, an
  explicit review step before acceptance, and a safe failure path back to the
  untouched song. A localhost service would introduce its own origin/access
  controls and installation burden; it is not included in this slice.
