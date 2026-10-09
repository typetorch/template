import { Players, Workspace } from "@rbxts/services";
import { Module, observePlayers, Service, type OnInit, type OnStart, type OnStop, type OnTick } from "@typetorch/framework";
import { EVENTS, type Activity } from "../../../shared/analytics/catalog";
import type { Phase } from "../../../shared/rush/types";
import { ArenaService } from "../rush/arena.service";
import { rootOf } from "../rush/characters";
import { RoundService } from "../rush/round.service";
import { AnalyticsService } from "./analytics.service";

/** Studs a character has to get from where it first spawned to count as "moved". */
const MOVED_STUDS = 6;
const SCAN_EVERY = 0.25;

/** Where a player is in their session. Plain data in persist (a swap keeps it); dropped when they leave. */
interface Journey {
	/** Where the character first stood this session (flat), until it moved. */
	spawnX?: number;
	spawnZ?: number;
	moved: boolean;
	/** Standing on the start pad in the lobby (activity "queued"), and since when (os.clock). */
	onPad: boolean;
	padSince: number;
}

/**
 * The player's journey for the node graph and the funnels, driven by the round's phases and by where characters are:
 * - activities (per player): lobby -> queued (on the start pad) -> countdown -> round -> results -> lobby, and
 *   "waiting" for a player who joined during the results (no result card); the server's own activity is the phase;
 * - onboarding steps spawned, moved, reached_pad, round_joined, second_round (RoundService logs first_hit and
 *   round_finished, TargetService first_click);
 * - round-funnel steps lobby, countdown, started (RoundService logs first_hit and finished), pad_start and
 *   round_joined_late.
 * RoundService doesn't know about this service; it only listens.
 */
@Service()
export class JourneyService extends Module implements OnInit, OnStart, OnTick, OnStop {
	private journeys!: Map<number, Journey>;
	private nextScan = 0;
	private stopping = false;

	constructor(
		private readonly analytics: AnalyticsService,
		private readonly arena: ArenaService,
		private readonly round: RoundService,
	) {
		super();
	}

	onInit() {
		this.journeys = this.ctx.persist("analytics.journey.v1", () => new Map<number, Journey>());
		// Players who left while no generation ran (the gap of a swap) never got their journey dropped.
		for (const [userId] of this.journeys) if (!Players.GetPlayerByUserId(userId)) this.journeys.delete(userId);
	}

	onStart() {
		this.analytics.serverActivity(this.round.phase());
		this.trove.add(this.round.onPhaseChanged((phase) => this.onPhase(phase)));

		// Every player, including the ones already here when this generation starts (then every step below is a no-op:
		// the funnels are deduplicated per session and per round, and the activity only logs a change).
		observePlayers(this.trove, (player, playerTrove) => {
			this.journeyOf(player);
			this.joinedNow(player);
			this.syncActivity(player);
			if (player.Character) this.analytics.step(player, "onboarding", "spawned");
			playerTrove.connect(player.CharacterAdded, () => this.analytics.step(player, "onboarding", "spawned"));
			playerTrove.add(() => {
				if (!this.stopping) this.journeys.delete(player.UserId);
			});
		});
	}

	onStop() {
		this.stopping = true;
	}

	/** Moved, and on or off the start pad, four times a second. */
	onTick() {
		const clock = os.clock();
		if (clock < this.nextScan) return;
		this.nextScan = clock + SCAN_EVERY;
		const lobby = this.round.phase() === "lobby";
		for (const player of Players.GetPlayers()) {
			const journey = this.journeys.get(player.UserId);
			const root = rootOf(player);
			if (!journey || !root) continue;
			const position = root.Position;
			if (!journey.moved) {
				if (journey.spawnX === undefined || journey.spawnZ === undefined) {
					journey.spawnX = position.X;
					journey.spawnZ = position.Z;
				} else if (new Vector2(position.X - journey.spawnX, position.Z - journey.spawnZ).Magnitude >= MOVED_STUDS) {
					journey.moved = true;
					this.analytics.step(player, "onboarding", "moved");
				}
			}
			const onPad = lobby && this.arena.onPad(position);
			if (onPad === journey.onPad) continue;
			journey.onPad = onPad;
			if (onPad) {
				journey.padSince = clock;
				if (this.analytics.step(player, "onboarding", "reached_pad")) player.SetAttribute("FoundPad", true);
			}
			this.syncActivity(player);
		}
	}

	private onPhase(phase: Phase) {
		this.analytics.serverActivity(phase);
		const round = this.round.roundNumber();
		for (const player of Players.GetPlayers()) {
			const journey = this.journeyOf(player);
			if (phase === "lobby") {
				this.analytics.roundStep(player, round + 1, "lobby");
			} else if (phase === "countdown") {
				// Standing on the pad when it filled: this player started the round.
				if (journey.onPad) {
					this.analytics.track(player, EVENTS.padStart, { held: math.floor((os.clock() - journey.padSince) * 10) / 10, players: Players.GetPlayers().size() });
				}
				this.enterRound(player, round, false);
			} else if (phase === "round") {
				this.analytics.roundStep(player, round, "started");
			}
			if (phase !== "lobby") journey.onPad = false;
			this.syncActivity(player);
		}
	}

	/** A player who just joined (or is already here when this generation starts): their place in the round. */
	private joinedNow(player: Player) {
		const phase = this.round.phase();
		const round = this.round.roundNumber();
		if (phase === "lobby") this.analytics.roundStep(player, round + 1, "lobby");
		else if (phase === "countdown") this.enterRound(player, round, false);
		else if (phase === "round") this.enterRound(player, round, true);
	}

	/** The player is in round `round` (RoundService joined them): the countdown, or late, mid-round. */
	private enterRound(player: Player, round: number, late: boolean) {
		if (!late) {
			// Joining during the countdown still counts as waiting for the round.
			this.analytics.roundStep(player, round, "lobby");
			this.analytics.roundStep(player, round, "countdown");
		}
		const [rounds, isNew] = this.analytics.joinRound(player, round);
		if (!isNew) return;
		this.analytics.step(player, "onboarding", "round_joined");
		if (rounds >= 2) this.analytics.step(player, "onboarding", "second_round");
		if (late) {
			const left = math.max(this.round.endsAt() - Workspace.GetServerTimeNow(), 0);
			this.analytics.track(player, EVENTS.roundJoinedLate, { round, secs_left: math.floor(left), players: Players.GetPlayers().size() });
		}
	}

	private syncActivity(player: Player) {
		this.analytics.activity(player, this.activityOf(player));
	}

	private activityOf(player: Player): Activity {
		const phase = this.round.phase();
		if (phase === "lobby") return this.journeys.get(player.UserId)?.onPad ? "queued" : "lobby";
		if (phase === "results") return this.round.hasResult(player) ? "results" : "waiting";
		return phase;
	}

	private journeyOf(player: Player): Journey {
		let journey = this.journeys.get(player.UserId);
		if (!journey) {
			journey = { moved: false, onPad: false, padSince: 0 };
			this.journeys.set(player.UserId, journey);
		}
		return journey;
	}
}
