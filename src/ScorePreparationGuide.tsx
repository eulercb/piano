import "./scorePreparationGuide.css";

/** Guidance only: no file access, recognition, persistence, downloads or uploads. */
export function ScorePreparationGuide() {
  return (
    <details className="score-preparation-guide">
      <summary>Have a PDF or photo? Prepare a score locally</summary>
      <p>Piano Studio does not recognize notes from PDFs or photos. Importing MusicXML is not optical music recognition (OMR).</p>
      <ol>
        <li>Keep your original and a backup of your current song. Use only scores you have permission to process.</li>
        <li>If your notation editor already has the notes, export MusicXML directly. For a scan, use a separate local desktop OMR tool such as Audiveris, then inspect and correct its result.</li>
        <li>Install the tool and any required language or model files before going offline. For private scores, disconnect from the network while converting and keep input and output outside cloud-synced folders. Do not use an online converter. Review the tool’s privacy settings and handling of temporary files; disconnecting alone is not a complete privacy audit.</li>
        <li>Export a self-contained .musicxml, .xml or .mxl file without linked images. Return here and use Import song. A PDF, photo or Audiveris .omr project is not a MusicXML file.</li>
        <li>Compare every measure with the original before practicing: clefs, key and time signatures, pitches and accidentals, rests and durations, chords, voices and hands, ties, repeats, and page boundaries. Unfold repeats in the source editor before export; repeat-marked scores are rejected. Check playback slowly; a successful import does not prove recognition is correct.</li>
        <li>Fix complex notation in the source editor and export again. Save the checked song separately until you are satisfied; keep the original scan and editable project.</li>
      </ol>
      <p>This guide does not read, upload or convert files, install software, or change saved songs. External documentation opens only when you follow a link; those sites receive ordinary visit information.</p>
      <p><a href="https://audiveris.github.io/audiveris/_pages/handbook/" target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Audiveris handbook (external, new tab)</a>{" · "}<a href="https://github.com/Audiveris/audiveris/releases" target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Official desktop releases (external, new tab)</a></p>
      <p>Desktop recognition and offline behavior have not been verified on your device. Recognition can require substantial correction, especially for dense piano scores or poor photos.</p>
    </details>
  );
}
