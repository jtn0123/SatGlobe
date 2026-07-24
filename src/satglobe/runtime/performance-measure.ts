export const LENS_APPLY_MEASURE = 'satglobe:lens:apply';
export const PLAYLIST_APPLY_MEASURE = 'satglobe:playlist:apply';
export const FILTER_APPLY_MEASURE = 'satglobe:visual:filter-apply';
export const RECOLOR_MEASURE = 'satglobe:visual:recolor';
export const COUNT_UPDATE_MEASURE = 'satglobe:visual:count-update';

export const SATGLOBE_INTERACTION_MEASURES = [
  LENS_APPLY_MEASURE,
  PLAYLIST_APPLY_MEASURE,
  FILTER_APPLY_MEASURE,
  RECOLOR_MEASURE,
  COUNT_UPDATE_MEASURE,
] as const;

type MeasureDetail = Readonly<Record<string, string | number | boolean>>;

let measureSequence = 0;

/** Records one synchronous product phase without retaining its unique marks. */
export function measureSync<T>(name: string, detail: MeasureDetail, task: () => T): T {
  const sequence = measureSequence++;
  const startMark = `${name}:start:${sequence}`;
  const endMark = `${name}:end:${sequence}`;
  let startMarked = false;

  try {
    performance.mark(startMark);
    startMarked = true;
  } catch {
    // Diagnostics must never stop the product action they observe.
  }
  try {
    return task();
  } finally {
    if (startMarked) {
      try {
        performance.mark(endMark);
        performance.measure(name, { start: startMark, end: endMark, detail });
      } catch {
        // User Timing is evidence only; preserve the task's result or error.
      } finally {
        try {
          performance.clearMarks(startMark);
          performance.clearMarks(endMark);
        } catch {
          // Some reduced Performance implementations expose incomplete clearing.
        }
      }
    }
  }
}
