import type { Song } from "./music";
import { formatTime } from "./music";
import type { PracticePass } from "./practiceHistory";
import { practiceHandName, practiceModeName, practiceNextSteps, type PracticeStep } from "./practiceNextSteps";

export function PracticeNextSteps({ pass, song, speed, onChoose, onPrepare }: {
  pass: PracticePass; song: Song; speed: number;
  onChoose: (step: PracticeStep) => void; onPrepare: () => void;
}) {
  return <section className="practice-next-steps" aria-label="Next practice step">
    <h3>A small next step</h3>
    <p>Last completed pass: {practiceHandName(pass.hand)} · {practiceModeName(pass.mode)} · {pass.speedMin === pass.speedMax ? `${pass.speedMin}%` : `${pass.speedMin}–${pass.speedMax}%`} · {formatTime(pass.startSeconds)}–{formatTime(pass.endSeconds)}.</p>
    <p>{pass.mode === "listen"
      ? "Listening helps you get to know the piece. It is not a performance score. Try one hand with the music waiting for you."
      : pass.mode === "melody"
        ? "You reached the selected notes. Timing was not graded. Repeat until comfortable, then choose one small change."
        : "Let comfort guide your next step. Repeating or slowing down is useful practice; timing counts do not judge your musical ability."}</p>
    <div className="next-step-actions">{practiceNextSteps(pass, song, speed).map(step =>
      <button type="button" className="button light" key={step.id} onClick={() => onChoose(step)}>
        <b>{step.title}</b>
        <span>{practiceHandName(step.hand)} · {step.speed}% · {practiceModeName(step.mode)}</span>
      </button>)}</div>
    <button type="button" className="text-button" onClick={onPrepare}>Choose a shorter passage in Studio</button>
    <p className="room-hint">These choices restart the selected piece or prepared passage from its beginning. Nothing starts automatically: press Play when ready. Your song, source tempo and saved passes stay unchanged. New hand combinations use wait-for-notes practice at 50% or slower.</p>
  </section>;
}
