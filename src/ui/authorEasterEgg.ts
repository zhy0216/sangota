import type { CombatPhase } from '../combat/types';

/** The hidden chord is deliberately exact: hold Space, then click the empty qi orb five times. */
export const AUTHOR_EASTER_EGG_CLICKS = 5;
/** Normal-speed hold before the full-screen author page advances by itself. */
export const AUTHOR_EASTER_EGG_HOLD_MS = 8_800;

export interface AuthorEasterEggClickContext {
  phase: CombatPhase;
  energy: number;
  busy: boolean;
  finished: boolean;
  spaceHeld: boolean;
}

export interface AuthorEasterEggClickResult {
  clicks: number;
  triggered: boolean;
}

/**
 * Advances the hidden click sequence, or breaks it as soon as one condition is
 * no longer true. Keeping this pure makes the secret input contract testable
 * without loading Phaser.
 */
export function advanceAuthorEasterEgg(
  clicks: number,
  context: AuthorEasterEggClickContext,
): AuthorEasterEggClickResult {
  const eligible =
    context.phase === 'player' &&
    context.energy === 0 &&
    !context.busy &&
    !context.finished &&
    context.spaceHeld;

  if (!eligible) return { clicks: 0, triggered: false };

  const next = clicks + 1;
  return next >= AUTHOR_EASTER_EGG_CLICKS
    ? { clicks: 0, triggered: true }
    : { clicks: next, triggered: false };
}
