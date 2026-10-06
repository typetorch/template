import { Players } from "@rbxts/services";
import type { Trove } from "@rbxts/trove";
import {
	AnalyticsEngine,
	Module,
	Service,
	type AnalyticsProps,
	type AnalyticsPurchase,
	type OnInit,
	type OnPlayerAdded,
	type OnStop,
} from "@typetorch/framework";
import {
	CURRENCY,
	EXPERIMENT_NAMES,
	EXPERIMENTS,
	stepIndex,
	variantAttribute,
	type Activity,
	type CoinReason,
	type ExperimentName,
	type FunnelName,
	type FunnelStep,
	type Variant,
} from "../../../shared/analytics/catalog";

/** One player's analytics this session. Plain data in persist (a hot-swap keeps it); dropped when the player leaves. */
interface PlayerMemo {
	/** Once-per-session funnel steps already logged, as "funnel:index". */
	steps: string[];
	/** The round the round-funnel steps in `roundSteps` belong to. */
	round: number;
	roundSteps: number[];
	/** Rounds joined this session, and the last one counted. */
	rounds: number;
	joinedRound: number;
	/** Experiment variants, once the engine assigned them. */
	variants: Map<string, string>;
}

/**
 * Analytics (framework README "Analytics"; the names are in shared/analytics/catalog.ts, README "Analytics" says when
 * each is logged). Joins, devices, tech health, zones (TTZone parts from arena-builder.ts), screens (client) and new
 * players' first sessions are automatic; this service adds the game's side: typed helpers for funnels (once per
 * session or per round), activities, coins, purchases and custom events, and the per-player experiments, which it
 * assigns on join and hands to the client as player attributes (`Exp_<name>`).
 *
 * The sink comes from the ConfigService key TypeTorchAnalytics; without it the engine keeps only the newest rows.
 */
@Service({ loadOrder: -20 })
export class AnalyticsService extends Module implements OnInit, OnPlayerAdded, OnStop {
	engine!: AnalyticsEngine;
	private memos!: Map<number, PlayerMemo>;
	/** Set in onStop: player troves are also cleaned when the generation stops, which is not a player leaving. */
	private stopping = false;

	onInit() {
		this.engine = new AnalyticsEngine();
		this.memos = this.ctx.persist("analytics.players.v1", () => new Map<number, PlayerMemo>());
		// Players who left while no generation ran (the gap of a swap) never got their memo dropped.
		for (const [userId] of this.memos) if (!Players.GetPlayerByUserId(userId)) this.memos.delete(userId);
	}

	onStop() {
		this.stopping = true;
	}

	onPlayerAdded(player: Player, playerTrove: Trove) {
		this.memo(player);
		// experiment() may yield until the player's analytics id is read: never in the join path itself. Re-run by every
		// generation, so a live settings change (a forced variant, `active: false`) reaches players already here.
		playerTrove.add(task.spawn(() => this.assignExperiments(player)));
		playerTrove.add(() => {
			if (!this.stopping) this.memos.delete(player.UserId);
		});
	}

	// Experiments ------------------------------------------------------------------------------------------------------

	/** The player's variant; the control (first variant) until the engine assigned one. Never yields. */
	variant<E extends ExperimentName>(player: Player, name: E): Variant<E> {
		const known = this.memos.get(player.UserId)?.variants.get(name);
		return (known ?? EXPERIMENTS[name][0]) as Variant<E>;
	}

	private assignExperiments(player: Player) {
		for (const name of EXPERIMENT_NAMES) {
			const variant = this.engine.experiment(player, name, [...EXPERIMENTS[name]]);
			if (player.Parent !== Players) return;
			this.memo(player).variants.set(name, variant);
			player.SetAttribute(variantAttribute(name), variant);
		}
	}

	// Funnels ----------------------------------------------------------------------------------------------------------

	/** A funnel step, at most once per session. True when it was logged now. */
	step<F extends FunnelName>(player: Player, funnel: F, step: FunnelStep<F>): boolean {
		const index = stepIndex(funnel, step);
		const memo = this.memo(player);
		const key = `${funnel}:${index}`;
		if (memo.steps.includes(key)) return false;
		memo.steps.push(key);
		this.engine.step(player, funnel, index, step);
		return true;
	}

	/** True once `step(player, funnel, step)` was logged this session. */
	reached<F extends FunnelName>(player: Player, funnel: F, step: FunnelStep<F>): boolean {
		return this.memo(player).steps.includes(`${funnel}:${stepIndex(funnel, step)}`);
	}

	/**
	 * A round-funnel step, at most once per round. A round's funnel starts at "lobby": later steps of a round the player
	 * didn't wait for (they joined mid-round) are left out. True when it was logged now.
	 */
	roundStep(player: Player, round: number, step: FunnelStep<"round">): boolean {
		const index = stepIndex("round", step);
		const memo = this.memo(player);
		if (memo.round !== round) {
			if (index !== 1) return false;
			memo.round = round;
			memo.roundSteps = [];
		}
		if (memo.roundSteps.includes(index)) return false;
		memo.roundSteps.push(index);
		this.engine.step(player, "round", index, step);
		return true;
	}

	/** Counts a round the player joined (once per round). Returns the rounds joined this session, and whether it's new. */
	joinRound(player: Player, round: number): LuaTuple<[number, boolean]> {
		const memo = this.memo(player);
		if (memo.joinedRound === round) return $tuple(memo.rounds, false);
		memo.joinedRound = round;
		memo.rounds += 1;
		return $tuple(memo.rounds, true);
	}

	/** Rounds joined this session. */
	roundsJoined(player: Player): number {
		return this.memo(player).rounds;
	}

	// Events -----------------------------------------------------------------------------------------------------------

	/** A custom event about `player`, or a server-only one (no player id) with `undefined`. */
	track(player: Player | undefined, name: string, props?: AnalyticsProps) {
		if (player) this.engine.track(player, name, props);
		else this.engine.track(name, props);
	}

	/** What the player is doing (the `activity:` of their rows; a change logs a state/activity row). */
	activity(player: Player, activity: Activity) {
		this.engine.state(player, activity);
	}

	/** The server's own activity: the state of server-only rows (tech, round summaries), and of players without one. */
	serverActivity(activity: string) {
		this.engine.state(activity);
	}

	/** Coins in (+) or out (-). */
	coins(player: Player, delta: number, reason: CoinReason) {
		if (delta !== 0) this.engine.currency(player, CURRENCY, delta, reason);
	}

	/** A Robux purchase, once its receipt was granted. */
	purchase(player: Player, purchase: AnalyticsPurchase) {
		this.engine.purchase(player, purchase);
	}

	private memo(player: Player): PlayerMemo {
		let memo = this.memos.get(player.UserId);
		if (!memo) {
			memo = { steps: [], round: -1, roundSteps: [], rounds: 0, joinedRound: -1, variants: new Map() };
			this.memos.set(player.UserId, memo);
		}
		return memo;
	}
}
