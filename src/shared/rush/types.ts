/** Target Rush: the shapes shared by the server, the client and the network (plain data only). */

export type Phase = "lobby" | "countdown" | "round" | "results";
export type Grade = "perfect" | "great" | "good";
export type HitVia = "click" | "touch";

/** CollectionService tags (attributes carry the data, so clients render what the server decided). */
export const TARGET_TAG = "TargetRush:Target";
export const PAD_TAG = "TargetRush:Pad";

/** Where the round is. Times are server times (Workspace.GetServerTimeNow()), so every client draws the same timer. */
export interface PhaseInfo {
	readonly phase: Phase;
	/** Round number in this server (counts up across hot-swaps). */
	readonly round: number;
	readonly startedAt: number;
	readonly endsAt: number;
	/** Hot-swaps this round survived. */
	readonly swaps: number;
}

/** One player's live numbers. */
export interface MyStats {
	readonly score: number;
	readonly combo: number;
	readonly multiplier: number;
	readonly bestCombo: number;
	/** Server time the combo runs out (0 = no combo). */
	readonly comboEndsAt: number;
	readonly personalBest: number;
}

export interface BoardRow {
	readonly userId: number;
	readonly name: string;
	readonly score: number;
	readonly combo: number;
}

/** The reply to a hit. */
export interface HitResult {
	readonly targetId: number;
	readonly grade: Grade;
	readonly points: number;
	readonly combo: number;
	readonly multiplier: number;
	readonly golden: boolean;
	readonly score: number;
	readonly coins: number;
}

/** Someone else popped a target (for the effect). */
export interface PopEvent {
	readonly targetId: number;
	readonly userId: number;
	readonly grade: Grade;
	readonly points: number;
	readonly golden: boolean;
	readonly x: number;
	readonly y: number;
	readonly z: number;
}

export interface ResultRow {
	readonly userId: number;
	readonly name: string;
	readonly score: number;
	readonly bestCombo: number;
	readonly perfects: number;
	readonly hits: number;
}

export interface RoundResults {
	readonly round: number;
	/** Best first. */
	readonly rows: ResultRow[];
	readonly swaps: number;
}

export interface PersonalResult {
	readonly rank: number;
	readonly score: number;
	readonly bestCombo: number;
	readonly perfects: number;
	readonly hits: number;
	readonly golds: number;
	readonly coins: number;
	readonly newBest: boolean;
	readonly personalBest: number;
}

/** Everything a client needs to draw the game from scratch (on join and after its own hot-swap). */
export interface RushSnapshot {
	readonly phase: PhaseInfo;
	readonly me: MyStats;
	readonly live: BoardRow[];
	readonly session: BoardRow[];
	readonly results?: { readonly results: RoundResults; readonly mine: PersonalResult };
}

export const EMPTY_STATS: MyStats = {
	score: 0,
	combo: 0,
	multiplier: 1,
	bestCombo: 0,
	comboEndsAt: 0,
	personalBest: 0,
};
