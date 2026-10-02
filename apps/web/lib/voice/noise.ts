/**
 * A best-effort "it sounds noisy where you are" detector (docs/BUILD-PLAN-V3.md V3.6, concern 28). It looks at how loud the
 * room is while the customer is NOT speaking, and only reports noise after the level has stayed high for a while (and
 * stops only after it has stayed low for a while), so a cough or a door never flickers the advisory. It never blocks the
 * call and claims nothing: with no level samples it never says anything.
 */
export interface NoiseOptions {
  /** Ambient level (0 to 1) at or above which the room counts as loud. */
  enterLevel?: number;
  /** Level at or below which it counts as quiet again (lower than enterLevel: the hysteresis). */
  exitLevel?: number;
  /** How long the room must stay loud before the advisory shows. */
  enterAfterMs?: number;
  /** How long it must stay quiet before the advisory goes away. */
  exitAfterMs?: number;
}

export interface NoiseDetector {
  /** Feed one reading. `at` is a timestamp in ms. Returns whether the advisory should show now. */
  sample(level: number, at: number): boolean;
  readonly noisy: boolean;
  reset(): void;
}

export function createNoiseDetector(options: NoiseOptions = {}): NoiseDetector {
  const enterLevel = options.enterLevel ?? 0.35;
  const exitLevel = options.exitLevel ?? 0.2;
  const enterAfterMs = options.enterAfterMs ?? 4000;
  const exitAfterMs = options.exitAfterMs ?? 6000;
  let noisy = false;
  let loudSince: number | null = null;
  let quietSince: number | null = null;

  return {
    sample(level, at) {
      if (!Number.isFinite(level) || !Number.isFinite(at)) return noisy;
      if (level >= enterLevel) {
        quietSince = null;
        loudSince ??= at;
        if (!noisy && at - loudSince >= enterAfterMs) noisy = true;
      } else if (level <= exitLevel) {
        loudSince = null;
        quietSince ??= at;
        if (noisy && at - quietSince >= exitAfterMs) noisy = false;
      } else {
        // Between the two lines: neither building towards noise nor towards quiet.
        loudSince = null;
        quietSince = null;
      }
      return noisy;
    },
    get noisy() {
      return noisy;
    },
    reset() {
      noisy = false;
      loudSince = null;
      quietSince = null;
    },
  };
}
