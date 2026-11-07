const LONG_FRAME_MS = 50;

export interface FrameStats {
  longestFrameMs: number;
  longFrames: number;
  frames: number;
}

/**
 * `times` are `performance.now()` values in milliseconds: the start of the measured span first, then the time of each
 * requestAnimationFrame callback after it. A gap counts as a long frame when it is over `LONG_FRAME_MS`.
 */
export function frameStats(times: readonly number[]): FrameStats {
  let longestFrameMs = 0;
  let longFrames = 0;
  for (let i = 1; i < times.length; i++) {
    const gap = times[i]! - times[i - 1]!;
    longestFrameMs = Math.max(longestFrameMs, gap);
    if (gap > LONG_FRAME_MS) longFrames++;
  }
  return { longestFrameMs, longFrames, frames: Math.max(0, times.length - 1) };
}
