export const MAX_SONG_TITLE_LENGTH = 500;

/** Keep the original title intact when the optional passage label cannot fit. */
export function passageTitle(title: string): string {
  const labeled = title + " · passage";
  return labeled.length <= MAX_SONG_TITLE_LENGTH ? labeled : title;
}
