import { Players, Workspace } from "@rbxts/services";
import {
	Module,
	observePlayers,
	Service,
	setNetworkLimits,
	TypeTorch,
	type OnInit,
	type OnStart,
	type OnTick,
} from "@typetorch/framework";
import { $print, $warn } from "rbxts-transform-debug";
import { COIN_REASONS, COMBO_LOST_MIN, EVENTS } from "../../../shared/analytics/catalog";
import { network } from "../../../shared/net";
import { COMBO_WINDOW, GOLDEN_COINS, HIT_COOLDOWN, PAD_HOLD_SECONDS, POINTS_PER_COIN } from "../../../shared/rush/config";
import { multiplierFor, phaseSeconds, pointsFor, roundProgress } from "../../../shared/rush/rules";
import type {
	BoardRow,
	Grade,
	HitResult,
	MyStats,
	PersonalResult,
	Phase,
	PhaseInfo,
	ResultRow,
	RoundResults,
	RushSnapshot,
} from "../../../shared/rush/types";
import { AnalyticsService } from "../analytics/analytics.service";
import { WalletService } from "../coins/wallet.service";
import { ArenaService } from "./arena.service";
import { BestService } from "./best.service";
import { BoardService } from "./board.service";
import { rootOf } from "./characters";

/** One player's round. Plain data in persist. */
interface PlayerRound {
	name: string;
	score: number;
	combo: number;
	bestCombo: number;
	/** Server time of the last hit (combo window, hit cooldown). */
	lastHitAt: number;
	hits: number;
	perfects: number;
	golds: number;
	// Analytics tallies (optional: a round persisted by an older generation has none yet).
	greats?: number;
	/** Clicks or taps on empty air. */
	whiffs?: number;
	/** Hits the server refused, and how many of those were taken by someone else first. */
	refused?: number;
	contested?: number;
	/** Server time the player joined the round, and whether that was after it started. */
	joinedAt?: number;
	late?: boolean;
}

/**
 * The whole round, in the kernel persist store: a hot-swap mid-round hands this exact table to the next generation,
 * which carries on with the same phase, timer, scores and combos. Times are server times, so they mean the same thing
 * in every generation. Durations are NOT stored: they come from the knobs (config.ts), so a deploy can retune the
 * running round.
 */
interface RoundStore {
	phase: Phase;
	round: number;
	phaseStartedAt: number;
	/** Hot-swaps this round survived (shown on the board and in the results). */
	swaps: number;
	/** Server time someone stepped on the start pad, 0 when nobody stands on it. */
	padSince: number;
	players: Map<number, PlayerRound>;
	results?: RoundResults;
	mine: Map<number, PersonalResult>;
	/** Experiment round_length: this round is a short one (every player in it had the "short" variant). */
	short?: boolean;
	/** Targets spawned and targets nobody hit, this round (analytics). */
	targets?: number;
	expired?: number;
	/** Misses a player was within reach of (one target_missed row each). */
	missedNear?: number;
}

function now() {
	return Workspace.GetServerTimeNow();
}

function round2(value: number) {
	return math.round(value * 100) / 100;
}

/**
 * Target Rush rounds, server-authoritative: lobby -> countdown -> round -> results -> lobby. Owns the scores and
 * combos; TargetService validates hits and asks this service to score them. Analytics: the round_length experiment
 * (decided at the countdown), combo milestones and lost combos, first hits, round_end per player and a server-only
 * round_queued / round_started / round_summary per round (JourneyService does the phase-driven activities and steps).
 */
@Service()
export class RoundService extends Module implements OnInit, OnStart, OnTick {
	private store!: RoundStore;
	private readonly listeners = new Set<(phase: Phase) => void>();
	private nextPadCheck = 0;

	constructor(
		private readonly arena: ArenaService,
		private readonly wallet: WalletService,
		private readonly best: BestService,
		private readonly board: BoardService,
		private readonly analytics: AnalyticsService,
	) {
		super();
	}

	onInit() {
		this.store = this.ctx.persist<RoundStore>("rush.round.v1", () => ({
			phase: "lobby",
			round: 0,
			phaseStartedAt: now(),
			swaps: 0,
			padSince: 0,
			players: new Map(),
			mine: new Map(),
		}));
		setNetworkLimits({ "rush.snapshot": { rate: [4, 1] } });
		this.trove.add(network.server.rush.snapshot.handle((player) => [this.snapshotFor(player)]));

		// The round state is already in persist; onSwapOut only records that this round survived one more swap.
		this.trove.add(
			TypeTorch.onSwapOut(() => {
				if (this.store.phase === "countdown" || this.store.phase === "round") this.store.swaps += 1;
			}),
		);
		// Another branch may play by other rules: start it from a clean lobby (the session board stays).
		this.trove.add(
			TypeTorch.onBranchChanged(({ from, to }) => {
				$print(`branch ${from} -> ${to}: back to the lobby`);
				this.setPhase("lobby", now());
			}),
		);
	}

	onStart() {
		const start = TypeTorch.startInfo;
		if (start.kind === "swap") {
			$print(
				`hot-swap (${start.reason}): round ${this.store.round} carries on in phase ${this.store.phase} with ${this.store.players.size()} players`,
			);
		}
		const info = this.phaseInfo();
		this.board.setPhase(info);
		this.board.setLive(this.liveRows());
		network.server.rush.phase.fireAll(info);
		// A personal best finished loading: the HUD shows it.
		this.trove.add(this.best.onLoaded((player) => network.server.rush.me.fire(player, this.statsFor(player))));

		observePlayers(this.trove, (player, playerTrove) => {
			if (this.store.phase === "countdown" || this.store.phase === "round") this.join(player);
			network.server.rush.phase.fire(player, this.phaseInfo());
			network.server.rush.me.fire(player, this.statsFor(player));
			this.board.setLive(this.liveRows());
			playerTrove.add(() => this.board.setLive(this.liveRows(player)));
		});
	}

	onTick() {
		const at = now();
		const store = this.store;
		const players = Players.GetPlayers().size();
		if (store.phase === "lobby") {
			if (players === 0) {
				store.phaseStartedAt = at; // nobody here: the lobby clock waits
				this.setPad(0);
				return;
			}
			this.checkPad(at);
			const held = store.padSince > 0 && at - store.padSince >= PAD_HOLD_SECONDS;
			if (held || at >= this.endsAt()) this.setPhase("countdown", at, held ? "pad" : "timer");
		} else if (store.phase === "countdown") {
			if (at >= this.endsAt()) this.setPhase("round", at);
		} else if (store.phase === "round") {
			if (at >= this.endsAt() || players === 0) this.finishRound(at);
		} else if (at >= this.endsAt()) {
			this.setPhase("lobby", at);
		}
	}

	// Queries ------------------------------------------------------------------------------------------------------------

	phase(): Phase {
		return this.store.phase;
	}

	isRound(): boolean {
		return this.store.phase === "round";
	}

	roundNumber(): number {
		return this.store.round;
	}

	/** 0..1 through the running round (drives the difficulty ramp). */
	progress(at: number): number {
		return roundProgress(at, this.store.phaseStartedAt, this.isShort());
	}

	activePlayers(): number {
		return Players.GetPlayers().size();
	}

	endsAt(): number {
		return this.store.phaseStartedAt + phaseSeconds(this.store.phase, this.isShort());
	}

	/** The running (or last) round is a short one (experiment round_length). */
	isShort(): boolean {
		return this.store.short === true;
	}

	/** The player has a result card this results phase (false: they joined after the round). */
	hasResult(player: Player): boolean {
		return this.store.phase === "results" && this.store.mine.has(player.UserId);
	}

	// Analytics tallies (TargetService reports; round_end and round_summary carry them) ------------------------------------

	noteTargetSpawned() {
		this.store.targets = (this.store.targets ?? 0) + 1;
	}

	/** A target nobody hit vanished; `near`: a player was close enough for a target_missed row. */
	noteTargetExpired(near: boolean) {
		this.store.expired = (this.store.expired ?? 0) + 1;
		if (near) this.store.missedNear = (this.store.missedNear ?? 0) + 1;
	}

	/** A hit the server refused (`contested`: someone else took the target first). */
	noteRefused(player: Player, contested: boolean) {
		const entry = this.store.players.get(player.UserId);
		if (!entry || this.store.phase !== "round") return;
		entry.refused = (entry.refused ?? 0) + 1;
		if (contested) entry.contested = (entry.contested ?? 0) + 1;
	}

	phaseInfo(): PhaseInfo {
		const store = this.store;
		return { phase: store.phase, round: store.round, startedAt: store.phaseStartedAt, endsAt: this.endsAt(), swaps: store.swaps };
	}

	/** Calls `listener` on every phase change. Returns a disconnect function (put it in a trove). */
	onPhaseChanged(listener: (phase: Phase) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	// Scoring --------------------------------------------------------------------------------------------------------------

	/** Per-player hit cooldown (on top of the network rate limit). */
	canHit(player: Player, at: number): boolean {
		const entry = this.store.players.get(player.UserId);
		return entry === undefined || at - entry.lastHitAt >= HIT_COOLDOWN;
	}

	/** Scores a validated hit: combo, multiplier, points, coins for golden targets. */
	scoreHit(player: Player, targetId: number, grade: Grade, golden: boolean, at: number): HitResult {
		const entry = this.join(player);
		this.expireCombo(player, entry, at);
		const before = multiplierFor(entry.combo);
		entry.combo += 1;
		entry.bestCombo = math.max(entry.bestCombo, entry.combo);
		const multiplier = multiplierFor(entry.combo);
		const points = pointsFor(grade, golden, multiplier);
		entry.score += points;
		entry.hits += 1;
		entry.lastHitAt = at;
		if (grade === "perfect") entry.perfects += 1;
		if (grade === "great") entry.greats = (entry.greats ?? 0) + 1;
		if (golden) entry.golds += 1;
		const coins = golden ? GOLDEN_COINS : 0;
		if (coins > 0) this.wallet.add(player, coins, COIN_REASONS.goldenTarget);
		if (multiplier > before) {
			this.analytics.track(player, EVENTS.comboMilestone, { combo: entry.combo, multiplier, progress: round2(this.progress(at)) });
		}
		if (entry.hits === 1) {
			this.analytics.roundStep(player, this.store.round, "first_hit");
			this.analytics.step(player, "onboarding", "first_hit");
		}
		this.board.setLive(this.liveRows());
		network.server.rush.me.fire(player, this.statsFor(player));
		return { targetId, grade, points, combo: entry.combo, multiplier, golden, score: entry.score, coins };
	}

	/** A click on empty air: counted, and it ends the combo. */
	breakCombo(player: Player) {
		if (this.store.phase !== "round") return;
		const entry = this.store.players.get(player.UserId);
		if (!entry) return;
		entry.whiffs = (entry.whiffs ?? 0) + 1;
		this.expireCombo(player, entry, now());
		if (entry.combo === 0) return;
		if (entry.combo >= COMBO_LOST_MIN) this.analytics.track(player, EVENTS.comboLost, { combo: entry.combo, why: "whiff" });
		entry.combo = 0;
		network.server.rush.me.fire(player, this.statsFor(player));
	}

	/** A combo that ran out of time ends here (a long one is logged as lost). */
	private expireCombo(player: Player, entry: PlayerRound, at: number) {
		if (entry.combo === 0 || at - entry.lastHitAt <= COMBO_WINDOW) return;
		if (entry.combo >= COMBO_LOST_MIN) this.analytics.track(player, EVENTS.comboLost, { combo: entry.combo, why: "timeout" });
		entry.combo = 0;
	}

	statsFor(player: Player): MyStats {
		const entry = this.store.players.get(player.UserId);
		const personalBest = this.best.get(player);
		if (!entry) return { score: 0, combo: 0, multiplier: 1, bestCombo: 0, comboEndsAt: 0, personalBest };
		const live = entry.combo > 0 && now() - entry.lastHitAt <= COMBO_WINDOW;
		return {
			score: entry.score,
			combo: live ? entry.combo : 0,
			multiplier: live ? multiplierFor(entry.combo) : 1,
			bestCombo: entry.bestCombo,
			comboEndsAt: live ? entry.lastHitAt + COMBO_WINDOW : 0,
			personalBest,
		};
	}

	snapshotFor(player: Player): RushSnapshot {
		const store = this.store;
		const mine = store.mine.get(player.UserId);
		return {
			phase: this.phaseInfo(),
			me: this.statsFor(player),
			live: this.liveRows(),
			session: this.board.sessionTop(),
			results: store.phase === "results" && store.results && mine ? { results: store.results, mine } : undefined,
		};
	}

	// Flow -----------------------------------------------------------------------------------------------------------------

	private join(player: Player): PlayerRound {
		let entry = this.store.players.get(player.UserId);
		if (!entry) {
			entry = {
				name: player.DisplayName,
				score: 0,
				combo: 0,
				bestCombo: 0,
				lastHitAt: 0,
				hits: 0,
				perfects: 0,
				golds: 0,
				joinedAt: now(),
				late: this.store.phase === "round",
			};
			this.store.players.set(player.UserId, entry);
		}
		return entry;
	}

	/** Players in the server with a round entry, best first (top 8). */
	private liveRows(leaving?: Player): BoardRow[] {
		const rows = new Array<BoardRow>();
		for (const [userId, entry] of this.store.players) {
			const player = Players.GetPlayerByUserId(userId);
			if (!player || player === leaving) continue;
			rows.push({ userId, name: entry.name, score: entry.score, combo: entry.bestCombo });
		}
		rows.sort((a, b) => a.score > b.score);
		while (rows.size() > 8) rows.pop();
		return rows;
	}

	private setPad(since: number) {
		if (this.store.padSince === since && this.arena.pad.GetAttribute("HeldSince") === since) return;
		this.store.padSince = since;
		this.arena.pad.SetAttribute("HeldSince", since);
	}

	private checkPad(at: number) {
		if (at < this.nextPadCheck) return;
		this.nextPadCheck = at + 0.1;
		const anyone = Players.GetPlayers().some((player) => {
			const root = rootOf(player);
			return root !== undefined && this.arena.onPad(root.Position);
		});
		if (!anyone) this.setPad(0);
		else if (this.store.padSince === 0) this.setPad(at);
	}

	/** `by`: what started a countdown (the start pad or the lobby timer). */
	private setPhase(phase: Phase, at: number, by?: "pad" | "timer") {
		const store = this.store;
		const lobbySeconds = at - store.phaseStartedAt;
		store.phase = phase;
		store.phaseStartedAt = at;
		this.setPad(0);
		if (phase === "countdown") {
			store.round += 1;
			store.swaps = 0;
			store.players.clear();
			store.results = undefined;
			store.mine.clear();
			store.targets = 0;
			store.expired = 0;
			store.missedNear = 0;
			const players = Players.GetPlayers();
			// Experiment round_length: short only when everyone here has the short variant (a player whose variant isn't
			// known yet counts as the control), so a mixed server plays normal rounds.
			store.short = players.size() > 0 && players.every((player) => this.analytics.variant(player, "round_length") === "short");
			players.forEach((player, index) => {
				this.join(player);
				// Only players who wandered off are brought back; everyone else stays where they are.
				const root = rootOf(player);
				if (root && !this.arena.inside(root.Position)) player.Character?.PivotTo(this.arena.spot(index, players.size()));
			});
			this.analytics.track(undefined, EVENTS.roundQueued, {
				round: store.round,
				by: by ?? "timer",
				lobby_secs: math.floor(lobbySeconds),
				players: players.size(),
				length: store.short ? "short" : "normal",
			});
		} else if (phase === "round") {
			this.analytics.track(undefined, EVENTS.roundStarted, {
				round: store.round,
				players: store.players.size(),
				length: this.isShort() ? "short" : "normal",
				secs: phaseSeconds("round", this.isShort()),
			});
		} else if (phase === "lobby") {
			store.results = undefined;
			store.mine.clear();
		}
		const info = this.phaseInfo();
		network.server.rush.phase.fireAll(info);
		if (phase === "countdown") {
			for (const player of Players.GetPlayers()) network.server.rush.me.fire(player, this.statsFor(player));
		}
		this.board.setPhase(info);
		this.board.setLive(this.liveRows());
		for (const listener of [...this.listeners]) {
			const [ok, err] = pcall(listener, phase);
			if (!ok) $warn(`phase listener threw: ${err}`);
		}
	}

	private finishRound(at: number) {
		const store = this.store;
		const rows = new Array<ResultRow>();
		for (const [userId, entry] of store.players) {
			rows.push({ userId, name: entry.name, score: entry.score, bestCombo: entry.bestCombo, perfects: entry.perfects, hits: entry.hits });
		}
		rows.sort((a, b) => a.score > b.score);
		const results: RoundResults = { round: store.round, rows, swaps: store.swaps };
		store.results = results;

		const length = this.isShort() ? "short" : "normal";
		const played = at - store.phaseStartedAt;
		for (const player of Players.GetPlayers()) {
			const entry = store.players.get(player.UserId);
			if (!entry) continue;
			const coins = math.floor(entry.score / POINTS_PER_COIN);
			if (coins > 0) this.wallet.add(player, coins, COIN_REASONS.roundReward);
			const previousBest = this.best.get(player);
			const newBest = this.best.submit(player, entry.score);
			const rank = rows.findIndex((result) => result.userId === player.UserId) + 1;
			store.mine.set(player.UserId, {
				rank,
				score: entry.score,
				bestCombo: entry.bestCombo,
				perfects: entry.perfects,
				hits: entry.hits,
				golds: entry.golds,
				coins: coins + entry.golds * GOLDEN_COINS,
				newBest,
				personalBest: this.best.get(player),
			});
			this.expireCombo(player, entry, at);
			this.analytics.roundStep(player, store.round, "finished");
			this.analytics.step(player, "onboarding", "round_finished");
			this.analytics.track(player, EVENTS.roundEnd, {
				round: store.round,
				score: entry.score,
				placement: rank,
				players: rows.size(),
				duration: math.floor(played),
				played: math.floor(at - math.max(entry.joinedAt ?? 0, store.phaseStartedAt)),
				length,
				late: entry.late === true,
				hits: entry.hits,
				perfects: entry.perfects,
				greats: entry.greats ?? 0,
				goods: entry.hits - entry.perfects - (entry.greats ?? 0),
				golds: entry.golds,
				best_combo: entry.bestCombo,
				whiffs: entry.whiffs ?? 0,
				refused: entry.refused ?? 0,
				contested: entry.contested ?? 0,
				targets: store.targets ?? 0,
				expired: store.expired ?? 0,
				coins: coins + entry.golds * GOLDEN_COINS,
				personal_best: this.best.get(player),
				new_best: newBest,
				swaps: store.swaps,
				session_rounds: this.analytics.roundsJoined(player),
			});
			if (newBest) {
				this.analytics.track(player, EVENTS.personalBest, {
					score: entry.score,
					previous: previousBest,
					gain: entry.score - previousBest,
					first: previousBest === 0,
					session_rounds: this.analytics.roundsJoined(player),
				});
			}
		}
		this.analytics.track(undefined, EVENTS.roundSummary, {
			round: store.round,
			players: rows.size(),
			left: rows.filter((row) => Players.GetPlayerByUserId(row.userId) === undefined).size(),
			duration: math.floor(played),
			length,
			top: rows[0]?.score ?? 0,
			targets: store.targets ?? 0,
			expired: store.expired ?? 0,
			missed_near: store.missedNear ?? 0,
			swaps: store.swaps,
		});
		this.board.recordRound(rows);
		this.setPhase("results", at);
		for (const player of Players.GetPlayers()) {
			const mine = store.mine.get(player.UserId);
			if (mine) network.server.rush.results.fire(player, results, mine);
			network.server.rush.me.fire(player, this.statsFor(player));
		}
		$print(`round ${store.round} over: ${rows.size()} players, top score ${rows[0]?.score ?? 0}, ${store.swaps} hot-swaps survived`);
	}
}
