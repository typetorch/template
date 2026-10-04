/**
 * Target Rush balance knobs. Change a number, deploy, and live servers use it at once, mid-round: the round itself
 * (phase, time, scores, combos) lives in the kernel's persist store, so nobody is reset by the hot-swap.
 *
 * Good live-demo knobs: TARGET_SIZE (every target changes size on the next frame), SPAWN_EVERY_START/END (spawn
 * rate), ROUND_SECONDS (the running round's timer bar jumps), GOLDEN_CHANCE.
 *
 * Distances are in studs, times in seconds.
 */

// Round flow ----------------------------------------------------------------------------------------------------------
/** Length of a round. Changing it mid-round moves the end of the running round. */
export const ROUND_SECONDS = 60;
/** The lobby starts the next round on its own after this long (if anyone is in the server). */
export const LOBBY_SECONDS = 20;
export const COUNTDOWN_SECONDS = 3;
export const RESULTS_SECONDS = 9;
/** Standing on the start pad this long starts the countdown at once. */
export const PAD_HOLD_SECONDS = 1.2;

// Targets -------------------------------------------------------------------------------------------------------------
/** Diameter of a target when it pops up. */
export const TARGET_SIZE = 4.5;
/** A target shrinks to this fraction of its size by the time it vanishes. */
export const TARGET_MIN_SCALE = 0.4;
/** Seconds between spawns at the start and at the end of a round (the difficulty ramps in between). */
export const SPAWN_EVERY_START = 1.1;
export const SPAWN_EVERY_END = 0.45;
/** How long a target lives at the start and at the end of a round. */
export const LIFETIME_START = 2.6;
export const LIFETIME_END = 1.4;
/** Targets alive at once (each extra player adds 2). */
export const MAX_TARGETS = 6;
/** Each extra player makes targets spawn this much faster (0.3 = 30 %). */
export const EXTRA_PLAYER_SPEEDUP = 0.3;
/** Share of targets low enough to run into instead of clicking. */
export const LOW_TARGET_CHANCE = 0.35;

// Golden targets ------------------------------------------------------------------------------------------------------
export const GOLDEN_CHANCE = 0.07;
/** Golden targets are worth this many times the points... */
export const GOLDEN_POINTS = 5;
/** ...and pay coins on the spot. */
export const GOLDEN_COINS = 3;
export const GOLDEN_SIZE_SCALE = 0.8;
export const GOLDEN_LIFETIME_SCALE = 0.75;

// Timing and scoring --------------------------------------------------------------------------------------------------
/** The approach ring closes on the target at this share of its life: hit it then for a PERFECT. */
export const PERFECT_AT = 0.5;
/** Seconds either side of the ring closing that still count as PERFECT / GREAT (later or earlier is GOOD). */
export const PERFECT_WINDOW = 0.13;
export const GREAT_WINDOW = 0.32;
export const POINTS_PERFECT = 30;
export const POINTS_GREAT = 20;
export const POINTS_GOOD = 10;
/** A combo ends if you hit nothing for this long, or click empty air. */
export const COMBO_WINDOW = 3;
/** Combo counts that reach x2, x3 and x4. */
export const COMBO_STEPS = [5, 12, 25];
/** End-of-round coins: one per this many points. */
export const POINTS_PER_COIN = 100;

// Arena ---------------------------------------------------------------------------------------------------------------
/** Changing an arena knob rebuilds the arena on the next deploy (otherwise it is handed over between generations). */
export const ARENA_RADIUS = 40;
export const PAD_RADIUS = 5;
/** Where the start pad sits, from the arena center. */
export const PAD_OFFSET = new Vector3(0, 0, -16);

// Server checks (anti-cheat) ------------------------------------------------------------------------------------------
/** Clicks count from this far away (the whole arena). */
export const CLICK_RANGE = 120;
/** Running into a target: allowed distance beyond its radius (character width + movement during the ping). */
export const TOUCH_SLACK = 6;
/** Hits earlier than this after a spawn are refused (nobody reacts that fast). */
export const MIN_REACTION = 0.1;
/** Grace after a target vanished for hits still on their way. */
export const HIT_GRACE = 0.2;
/** Lag compensation is capped at this many seconds. */
export const MAX_LAG_COMPENSATION = 0.2;
/** Minimum seconds between two hits of one player. */
export const HIT_COOLDOWN = 0.07;

// Personal best -------------------------------------------------------------------------------------------------------
/**
 * Keep personal bests in a DataStore (one key per player, read once per join, written only on a new best). Set false
 * to keep them in-session only (in persist).
 */
export const SAVE_PERSONAL_BEST = true;
