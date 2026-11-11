import type { Song } from "./music";
import type { PracticePass } from "./practiceHistory";
import type { PracticeHand, PracticeMode } from "./session";

export type PracticeStep = {
  id: string;
  title: string;
  hand: PracticeHand;
  mode: PracticeMode;
  speed: number;
};

export const practiceHandName = (hand: PracticeHand) =>
  hand === "both" ? "Both hands" : hand === "left" ? "Left hand" : "Right hand";
export const practiceModeName = (mode: PracticeMode) =>
  mode === "listen" ? "Listen" : mode === "melody" ? "Wait for notes" : mode === "recital" ? "Recital" : "Rhythm";

/** Choices, not an automatic lesson plan or a claim that a skill was mastered. */
export function practiceNextSteps(pass: PracticePass, song: Song, speed: number): PracticeStep[] {
  const steps: PracticeStep[] = [];
  const hasHand = (hand: PracticeHand) => song.notes.some(note => hand === "both" || note.hand === hand);
  const add = (id: string, title: string, hand = pass.hand, mode = pass.mode, nextSpeed = speed) => {
    if (hasHand(hand)) steps.push({ id, title, hand, mode, speed: nextSpeed });
  };
  add("repeat", "Repeat from beginning");
  if (pass.mode === "listen") {
    const hand = pass.hand === "both" ? (hasHand("right") ? "right" : "left") : pass.hand;
    add("melody", "Try waiting for notes", hand, "melody", Math.min(speed, 50));
  } else {
    if (speed > 25) add("slower", "Take it a little slower", pass.hand, pass.mode, Math.max(25, speed - 5));
    if (speed < 125) add("faster", "Try a small speed increase", pass.hand, pass.mode, Math.min(125, speed + 5));
    if (pass.mode === "melody") add("rhythm", "Try note-start timing", pass.hand, "rhythm");
    else add("melody", "Return to waiting for notes", pass.hand, "melody");
    if (pass.mode === "rhythm") add("recital", "Try an uninterrupted pass", pass.hand, "recital");
    if (pass.mode === "recital") add("rhythm", "Return to live timing feedback", pass.hand, "rhythm");
    if (pass.hand === "both") {
      add("left", "Focus on the left hand", "left", "melody", Math.min(speed, 50));
      add("right", "Focus on the right hand", "right", "melody", Math.min(speed, 50));
    } else {
      const otherHand = pass.hand === "right" ? "left" : "right";
      add("other", "Explore the other hand", otherHand, "melody", Math.min(speed, 50));
      if (hasHand(otherHand)) add("both", "Bring both hands together", "both", "melody", Math.min(speed, 50));
    }
  }
  return steps;
}
