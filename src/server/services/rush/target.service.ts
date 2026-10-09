import { CollectionService, Players, Workspace } from "@rbxts/services";
import {
	Module,
	Service,
	setNetworkLimits,
	TypeTorch,
	type OnInit,
	type OnTick,
	type ProperReturns,
} from "@typetorch/framework";
import { $print, $warn } from "rbxts-transform-debug";
import { EVENTS } from "../../../shared/analytics/catalog";
import { network } from "../../../shared/net";
import {
	CLICK_RANGE,
	GOLDEN_CHANCE,
	HIT_GRACE,
	LOW_TARGET_CHANCE,
	MAX_LAG_COMPENSATION,
	MIN_REACTION,
	TOUCH_SLACK,
} from "../../../shared/rush/config";
import { PALETTE, TARGET_COLORS } from "../../../shared/rush/palette";
import { diameterFor, gradeFor, lifetimeFor, maxTargets, perfectAt, scaleAt, spawnEvery } from "../../../shared/rush/rules";
import { TARGET_TAG, type HitResult, type HitVia } from "../../../shared/rush/types";
import { AnalyticsService } from "../analytics/analytics.service";
import { ArenaService } from "./arena.service";
import { rootOf } from "./characters";
import { RoundService } from "./round.service";

/** A target as plain data: what the next generation needs to put it back exactly where it was. */
interface SavedTarget {
	id: number;
	x: number;
	y: number;
	z: number;
	spawnedAt: number;
	lifetime: number;
	golden: boolean;
	/** A low target (run into it): the only kind a touch hit counts on. Handovers from older builds have none. */
	low?: boolean;
	/** Index into TARGET_COLORS (1-based). */
	color: number;
}

interface LiveTarget extends SavedTarget {
	part?: BasePart;
	position: Vector3;
	/** Vanished (its part is gone), but hits still in flight get HIT_GRACE. */
	gone: boolean;
}

/** Written by onSwapOut, read once by the next generation. */
interface Handover {
	saved?: { round: number; nextSpawnAt: number; targets: SavedTarget[] };
}

function now() {
	return Workspace.GetServerTimeNow();
}

function round2(value: number) {
	return math.round(value * 100) / 100;
}

/** Recently popped target ids remembered (to tell "someone else took it" from "it was gone anyway"). */
const RECENT_POPS = 32;
/** A miss is logged (target_missed) only when a player was this close to it; every miss counts in round_summary. */
const MISS_LOG_STUDS = 15;

/**
 * Spawns targets during a round and validates every hit on the server: the target exists, the timing fits (with lag
 * compensation from the player's ping, capped), the player is close enough (any distance in the arena for a click,
 * touching distance for running into a low target, the only kind a touch can pop), and the per-player cooldown; the
 * network layer already rate-limited and type-checked the message.
 *
 * Target parts belong to this generation (its trove), so a hot-swap removes them. `TypeTorch.onSwapOut` saves the
 * live ones as plain data and the next generation puts them back with the same ids and timers.
 */
@Service()
export class TargetService extends Module implements OnInit, OnTick {
	private folder!: Folder;
	private readonly targets = new Map<number, LiveTarget>();
	private readonly random = new Random();
	private readonly recentPops = new Array<number>();
	private nextSpawnAt = 0;
	/** Target ids never repeat within a server (clients key effects by id), so the counter lives in persist. */
	private ids!: { next: number };
	private handover!: Handover;

	constructor(
		private readonly arena: ArenaService,
		private readonly round: RoundService,
		private readonly analytics: AnalyticsService,
	) {
		super();
	}

	onInit() {
		const folder = this.trove.add(new Instance("Folder"));
		folder.Name = "TargetRushTargets";
		folder.Parent = Workspace;
		this.folder = folder;
		this.ids = this.ctx.persist("rush.targetIds.v1", () => ({ next: 1 }));
		this.handover = this.ctx.persist<Handover>("rush.targets.v1", () => ({}));

		setNetworkLimits({ "rush.hit": { rate: [10, 8], maxString: 8 }, "rush.whiff": { rate: [5, 4] } });
		this.trove.add(network.server.rush.hit.handle((player, targetId, via) => this.hit(player, targetId, via)));
		this.trove.add(network.server.rush.whiff.on((player) => this.round.breakCombo(player)));
		this.trove.add(TypeTorch.onSwapOut(() => this.saveForNextGeneration()));
		this.trove.add(
			this.round.onPhaseChanged((phase) => {
				this.clear();
				if (phase === "round") this.nextSpawnAt = now() + 0.4;
			}),
		);
		this.restore();
	}

	onTick() {
		if (!this.round.isRound()) return;
		const at = now();
		for (const [id, target] of this.targets) {
			const endsAt = target.spawnedAt + target.lifetime;
			if (!target.gone && at >= endsAt) this.vanish(target);
			if (at >= endsAt + HIT_GRACE) this.targets.delete(id);
		}
		if (at >= this.nextSpawnAt) this.spawn(at);
	}

	/** Positions of the live targets (others use them, e.g. to keep things apart). */
	positions(): Vector3[] {
		const positions = new Array<Vector3>();
		for (const [, target] of this.targets) if (!target.gone) positions.push(target.position);
		return positions;
	}

	private spawn(at: number) {
		const players = math.max(this.round.activePlayers(), 1);
		const progress = this.round.progress(at);
		this.nextSpawnAt = at + spawnEvery(progress, players);
		const alive = this.positions();
		if (alive.size() >= maxTargets(players)) return;

		const golden = this.random.NextNumber() < GOLDEN_CHANCE;
		const low = !golden && this.random.NextNumber() < LOW_TARGET_CHANCE;
		const roots = new Array<Vector3>();
		for (const player of Players.GetPlayers()) {
			const root = rootOf(player);
			if (root) roots.push(root.Position);
		}
		const position = this.arena.targetPosition(this.random, low, alive, roots);
		if (!position) return;
		const id = this.ids.next;
		this.ids.next += 1;
		this.round.noteTargetSpawned();
		this.place({
			id,
			x: position.X,
			y: position.Y,
			z: position.Z,
			spawnedAt: at,
			lifetime: lifetimeFor(progress, golden),
			golden,
			low,
			color: this.random.NextInteger(1, TARGET_COLORS.size()),
		});
	}

	/** Creates the part. The size comes from the knobs now, so a deploy that changes TARGET_SIZE resizes restored ones. */
	private place(saved: SavedTarget) {
		const size = diameterFor(saved.golden);
		const position = new Vector3(saved.x, saved.y, saved.z);
		const part = new Instance("Part");
		part.Name = `Target${saved.id}`;
		part.Shape = Enum.PartType.Ball;
		part.Size = new Vector3(size, size, size);
		part.CFrame = new CFrame(position);
		part.Anchored = true;
		part.CanCollide = false;
		part.CanTouch = false;
		part.CastShadow = false;
		part.Material = saved.golden ? Enum.Material.Neon : Enum.Material.SmoothPlastic;
		part.Color = saved.golden ? PALETTE.gold : TARGET_COLORS[saved.color - 1] ?? PALETTE.pink;
		// Attributes before parenting: clients see the whole target in one replication step.
		part.SetAttribute("TargetId", saved.id);
		part.SetAttribute("SpawnedAt", saved.spawnedAt);
		part.SetAttribute("Lifetime", saved.lifetime);
		part.SetAttribute("Golden", saved.golden);
		part.SetAttribute("Size", size);
		if (saved.low) part.SetAttribute("Low", true);
		CollectionService.AddTag(part, TARGET_TAG);
		part.Parent = this.folder;
		this.targets.set(saved.id, { ...saved, part, position, gone: false });
	}

	private vanish(target: LiveTarget) {
		target.gone = true;
		target.part?.Destroy();
		target.part = undefined;
		// Nobody hit it: a miss for the nearest player, the one it was most likely meant for.
		let nearest: Player | undefined;
		let distance = math.huge;
		for (const player of Players.GetPlayers()) {
			const root = rootOf(player);
			if (!root) continue;
			const away = root.Position.sub(target.position).Magnitude;
			if (away < distance) {
				distance = away;
				nearest = player;
			}
		}
		// Every miss counts in round_summary; the target_missed row only when that player was close enough to go for it.
		const near = nearest !== undefined && distance <= MISS_LOG_STUDS;
		this.round.noteTargetExpired(near);
		if (!near) return;
		this.analytics.track(nearest, EVENTS.targetMissed, {
			kind: this.kindOf(target),
			distance: math.floor(distance),
			life_ms: math.floor(target.lifetime * 1000),
			progress: round2(this.round.progress(now())),
			players: Players.GetPlayers().size(),
			alive: this.positions().size(),
		});
	}

	/** "golden", "low" (run into it) or "high" (click it). */
	private kindOf(target: SavedTarget): string {
		if (target.golden) return "golden";
		return target.y - this.arena.layout.center.Y < 4.5 ? "low" : "high";
	}

	private clear() {
		for (const [, target] of this.targets) target.part?.Destroy();
		this.targets.clear();
	}

	private hit(player: Player, targetId: number, via: HitVia): ProperReturns<HitResult> {
		const reply = this.judge(player, targetId, via);
		if (reply[0] === false) {
			// Analytics: refusals per round (lag, distance, contested targets) go into round_end.
			const contested = reply[1] === "Gone" && this.recentPops.includes(targetId);
			this.round.noteRefused(player, contested);
		}
		return reply;
	}

	private judge(player: Player, targetId: number, via: HitVia): ProperReturns<HitResult> {
		if (!this.round.isRound()) return [false, "No round"];
		if (targetId % 1 !== 0) return [false, "Bad target"];
		const target = this.targets.get(targetId);
		if (!target) return [false, "Gone"];
		const root = rootOf(player);
		if (!root) return [false, "No character"];

		const at = now();
		// Lag compensation: judge the hit at the moment the player saw it (half the round trip, capped).
		const lag = math.clamp(player.GetNetworkPing() / 2, 0, MAX_LAG_COMPENSATION);
		const age = at - lag - target.spawnedAt;
		if (age < MIN_REACTION) return [false, "Too early"];
		if (age > target.lifetime + HIT_GRACE) return [false, "Too late"];

		const distance = root.Position.sub(target.position).Magnitude;
		if (via === "touch") {
			// Running into a target only pops a low one: a player standing still can't pop the high ones.
			if (!target.low) return [false, "Not low"];
			const radius = (diameterFor(target.golden) * scaleAt(age, target.lifetime)) / 2;
			if (distance > radius + TOUCH_SLACK) return [false, "Too far"];
		} else if (distance > CLICK_RANGE) {
			$warn(`${player.Name} clicked target ${targetId} from ${math.floor(distance)} studs`);
			return [false, "Too far"];
		}
		if (!this.round.canHit(player, at)) return [false, "Slow down"];

		this.targets.delete(targetId);
		target.part?.Destroy();
		this.recentPops.push(targetId);
		if (this.recentPops.size() > RECENT_POPS) this.recentPops.shift();
		const result = this.round.scoreHit(player, targetId, gradeFor(age, target.lifetime), target.golden, at);
		this.analytics.track(player, EVENTS.targetHit, {
			kind: this.kindOf(target),
			via,
			free: via === "touch",
			grade: result.grade,
			points: result.points,
			combo: result.combo,
			multiplier: result.multiplier,
			distance: math.floor(distance),
			// Lag-compensated time from the spawn to the hit, and how far off the PERFECT moment it was (- early, + late).
			reaction_ms: math.floor(age * 1000),
			off_ms: math.floor((age - perfectAt(target.lifetime)) * 1000),
			life: round2(age / target.lifetime),
			progress: round2(this.round.progress(at)),
			ping_ms: math.floor(player.GetNetworkPing() * 1000),
		});
		if (via === "click") this.analytics.step(player, "onboarding", "first_click");
		network.server.rush.popped.fireExcept(player, {
			targetId,
			userId: player.UserId,
			grade: result.grade,
			points: result.points,
			golden: result.golden,
			x: target.x,
			y: target.y,
			z: target.z,
		});
		return [result];
	}

	private saveForNextGeneration() {
		if (!this.round.isRound()) {
			this.handover.saved = undefined;
			return;
		}
		const targets = new Array<SavedTarget>();
		for (const [, target] of this.targets) {
			if (target.gone) continue;
			const { id, x, y, z, spawnedAt, lifetime, golden, low, color } = target;
			targets.push({ id, x, y, z, spawnedAt, lifetime, golden, low, color });
		}
		this.handover.saved = { round: this.round.roundNumber(), nextSpawnAt: this.nextSpawnAt, targets };
	}

	private restore() {
		const saved = this.handover.saved;
		this.handover.saved = undefined;
		if (!saved || !this.round.isRound() || saved.round !== this.round.roundNumber()) return;
		const at = now();
		let restored = 0;
		for (const target of saved.targets) {
			if (at >= target.spawnedAt + target.lifetime) continue;
			// A handover from a build before the Low flag: the height tells, as kindOf does.
			this.place({ ...target, low: target.low ?? (this.kindOf(target) === "low") });
			restored += 1;
		}
		this.nextSpawnAt = saved.nextSpawnAt;
		$print(`restored ${restored} targets from the previous generation`);
	}
}
