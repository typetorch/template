import * as Knobs from "./config";
import type { Grade, Phase } from "./types";

/**
 * Target Rush rules as pure functions of the knobs, shared by the server (which decides) and the client (which draws
 * the same thing). Nothing here keeps state.
 */

export function lerp(from: number, to: number, alpha: number) {
	return from + (to - from) * alpha;
}

/** How long a phase lasts. Read from the knobs every time, so a deploy can stretch the running phase. */
export function phaseSeconds(phase: Phase): number {
	if (phase === "lobby") return Knobs.LOBBY_SECONDS;
	if (phase === "countdown") return Knobs.COUNTDOWN_SECONDS;
	if (phase === "round") return Knobs.ROUND_SECONDS;
	return Knobs.RESULTS_SECONDS;
}

/** 0 at the start of a round, 1 at its end: drives the difficulty ramp. */
export function roundProgress(now: number, startedAt: number): number {
	return math.clamp((now - startedAt) / math.max(Knobs.ROUND_SECONDS, 1), 0, 1);
}

export function spawnEvery(progress: number, players: number): number {
	const base = lerp(Knobs.SPAWN_EVERY_START, Knobs.SPAWN_EVERY_END, progress);
	return base / (1 + Knobs.EXTRA_PLAYER_SPEEDUP * math.max(players - 1, 0));
}

export function maxTargets(players: number): number {
	return Knobs.MAX_TARGETS + 2 * math.max(players - 1, 0);
}

export function lifetimeFor(progress: number, golden: boolean): number {
	return lerp(Knobs.LIFETIME_START, Knobs.LIFETIME_END, progress) * (golden ? Knobs.GOLDEN_LIFETIME_SCALE : 1);
}

export function diameterFor(golden: boolean): number {
	return Knobs.TARGET_SIZE * (golden ? Knobs.GOLDEN_SIZE_SCALE : 1);
}

/** The target's size at `age` as a share of its full size (it shrinks over its life). */
export function scaleAt(age: number, lifetime: number): number {
	return lerp(1, Knobs.TARGET_MIN_SCALE, math.clamp(age / lifetime, 0, 1));
}

/** Seconds after the spawn when the approach ring closes on the target. */
export function perfectAt(lifetime: number): number {
	return lifetime * Knobs.PERFECT_AT;
}

export function gradeFor(age: number, lifetime: number): Grade {
	const off = math.abs(age - perfectAt(lifetime));
	if (off <= Knobs.PERFECT_WINDOW) return "perfect";
	if (off <= Knobs.GREAT_WINDOW) return "great";
	return "good";
}

export function multiplierFor(combo: number): number {
	let multiplier = 1;
	for (const step of Knobs.COMBO_STEPS) {
		if (combo >= step) multiplier += 1;
	}
	return multiplier;
}

export function pointsFor(grade: Grade, golden: boolean, multiplier: number): number {
	const base = grade === "perfect" ? Knobs.POINTS_PERFECT : grade === "great" ? Knobs.POINTS_GREAT : Knobs.POINTS_GOOD;
	return base * (golden ? Knobs.GOLDEN_POINTS : 1) * multiplier;
}

/** 12345 -> "12,345" */
export function formatNumber(value: number): string {
	const digits = tostring(math.floor(math.abs(value)));
	let out = "";
	for (let index = 0; index < digits.size(); index++) {
		if (index > 0 && (digits.size() - index) % 3 === 0) out += ",";
		out += digits.sub(index + 1, index + 1);
	}
	return value < 0 ? `-${out}` : out;
}
