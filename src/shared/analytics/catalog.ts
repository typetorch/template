import type { Phase } from "../rush/types";

/**
 * Target Rush analytics catalog (framework AnalyticsEngine, plans/16): every funnel step, experiment, activity, screen,
 * zone and custom event the game logs, in one place, so the names stay stable. The names are part of the data:
 * - a funnel step keeps its index forever: add new steps at the end, never renumber or rename one;
 * - an experiment's first variant is its control: add variants at the end, never reorder;
 * - a retired name is never reused for something else.
 * Pure data and math (no Roblox services, no runtime imports), so `scripts/test-analytics.luau` checks it under Lune.
 * README "Analytics" lists when each one is logged and its props.
 */

// Funnels: step(player, funnel, index, label), index = position in the list + 1 --------------------------------------

export const FUNNELS = {
	/** The first minutes of a session. Logged once per session; read it with the `players: "new"` filter. */
	onboarding: ["spawned", "moved", "reached_pad", "round_joined", "first_hit", "round_finished", "second_round"],
	/**
	 * Every round, per player who waited for it in the lobby (or the countdown). A player who joins mid-round skips
	 * the round funnel for that round (`round_joined_late` instead).
	 */
	round: ["lobby", "countdown", "started", "first_hit", "finished"],
	/** The coin shop, once per session. */
	shop: ["opened", "item_viewed", "bought", "equipped"],
} as const;

export type FunnelName = keyof typeof FUNNELS;
export type FunnelStep<F extends FunnelName> = (typeof FUNNELS)[F][number];

/** The step's index (1-based): its position in the funnel's list. */
export function stepIndex<F extends FunnelName>(funnel: F, step: FunnelStep<F>): number {
	return (FUNNELS[funnel] as readonly string[]).indexOf(step) + 1;
}

// Experiments (per player): experiment(player, name, variants) ------------------------------------------------------

export const EXPERIMENTS = {
	/** Lobby: "arrow" adds floor arrows from the player to the start pad until they first step on it this session. */
	onboarding_hint: ["none", "arrow"],
	/** Round length: "short" rounds last ROUND_SECONDS_SHORT. A round is short only when every player in it is "short". */
	round_length: ["normal", "short"],
	/** Click and tap tolerance around targets: "generous" is AIM_ASSIST_GENEROUS times wider (client-side picking). */
	aim_assist: ["normal", "generous"],
} as const;

export type ExperimentName = keyof typeof EXPERIMENTS;
export type Variant<E extends ExperimentName> = (typeof EXPERIMENTS)[E][number];
export const EXPERIMENT_NAMES: readonly ExperimentName[] = ["onboarding_hint", "round_length", "aim_assist"];

/** The player attribute that carries a variant to the client (the server sets it once the variant is known). */
export function variantAttribute(name: ExperimentName): string {
	return `Exp_${name}`;
}

// Activities (state(player, activity)) and screens (TTScreen tags on the client) ---------------------------------------

/** What a player is doing: the `activity:` part of every row's state, and the nodes of the activity graph. */
export const ACTIVITIES = ["lobby", "queued", "countdown", "round", "results", "waiting"] as const;
export type Activity = (typeof ACTIVITIES)[number];

/** The HUD screen per round phase (a TTScreen marker), and the modal cards above it. */
export const HUD_SCREENS: { readonly [P in Phase]: string } = {
	lobby: "LobbyHud",
	countdown: "CountdownHud",
	round: "RoundHud",
	results: "ResultsHud",
};
export const SCREENS = { results: "Results", shop: "Shop" } as const;
/** The framework's tag for GuiObjects that are screens (name from a `Name` attribute). */
export const SCREEN_TAG = "TTScreen";

// Zones (TTZone parts, built by arena-builder.ts) --------------------------------------------------------------------

export const ZONE_TAG = "TTZone";
export const ZONES = {
	/** The middle of the arena: the spawn, the lobby coin ring and the start pad's surroundings. */
	lobby: "Lobby",
	/** The pink start pad. */
	pad: "StartPad",
	/** The rest of the floor, out to the bumper rim. */
	arena: "Arena",
	/** In front of the leaderboard. */
	board: "Board",
	/** Beyond the rim: wandered off. */
	outskirts: "Outskirts",
} as const;
/** Bump when the zone boxes change: live arenas get new zone parts on the next deploy, without a rebuild. */
export const ZONE_VERSION = 1;
/** Radius of the Lobby zone (the lobby coin ring is at 22 studs). */
export const LOBBY_ZONE_RADIUS = 26;

/** A zone box, centered at (x, y, z) from the arena center on the floor, axis-aligned, `sx` by `sy` by `sz` studs. */
export interface ZoneBox {
	readonly name: string;
	readonly x: number;
	readonly y: number;
	readonly z: number;
	readonly sx: number;
	readonly sy: number;
	readonly sz: number;
}

export interface ZoneLayout {
	readonly arenaRadius: number;
	readonly padX: number;
	readonly padZ: number;
	readonly padRadius: number;
}

/**
 * Boxes whose union is close to a disc: rectangles inscribed in the circle at 5 degree steps (none pokes outside it,
 * together they cover more than 95% of the radius). The engine treats a zone part as a box, so a round zone is many.
 */
export function discBoxes(name: string, radius: number, bottom: number, height: number): ZoneBox[] {
	const boxes = new Array<ZoneBox>();
	for (let degrees = 5; degrees <= 85; degrees += 5) {
		const angle = math.rad(degrees);
		boxes.push({
			name,
			x: 0,
			y: bottom + height / 2,
			z: 0,
			sx: 2 * radius * math.cos(angle),
			sy: height,
			sz: 2 * radius * math.sin(angle),
		});
	}
	return boxes;
}

/**
 * Every zone box, from the arena's layout. The engine puts a player in the SMALLEST box that contains them, so the
 * sizes nest on purpose: StartPad < Board < every Lobby box < every Arena box (taller) < Outskirts.
 * scripts/test-analytics.luau checks the nesting and where sample spots land.
 */
export function zoneBoxes(layout: ZoneLayout): ZoneBox[] {
	const radius = layout.arenaRadius;
	const boxes = new Array<ZoneBox>();
	const pad = layout.padRadius + 1;
	boxes.push({ name: ZONES.pad, x: layout.padX, y: 4, z: layout.padZ, sx: pad * 2, sy: 10, sz: pad * 2 });
	// The board stands at the far edge (-Z), 4 studs in from the rim; the zone is the strip in front of it.
	boxes.push({ name: ZONES.board, x: 0, y: 4, z: -(radius - 10), sx: 28, sy: 12, sz: 12 });
	const lobbyRadius = math.min(LOBBY_ZONE_RADIUS, radius * 0.7);
	const lobbyHeight = 20;
	for (const box of discBoxes(ZONES.lobby, lobbyRadius, -2, lobbyHeight)) boxes.push(box);
	// Tall enough that the thinnest arena box still outweighs the biggest lobby box (2 r^2 sin(2a) is a box's floor).
	const lobbyMost = 2 * lobbyRadius * lobbyRadius * lobbyHeight;
	const arenaLeast = 2 * radius * radius * math.sin(math.rad(10));
	const arenaHeight = math.max(80, math.ceil((lobbyMost * 1.25) / arenaLeast));
	for (const box of discBoxes(ZONES.arena, radius, -2, arenaHeight)) boxes.push(box);
	const outskirts = radius * 2 + 80;
	boxes.push({ name: ZONES.outskirts, x: 0, y: arenaHeight / 2, z: 0, sx: outskirts, sy: arenaHeight + 80, sz: outskirts });
	return boxes;
}

/** The engine's rule (framework analytics/server.ts zoneAt): the smallest box containing the point, or "". */
export function zoneAt(boxes: readonly ZoneBox[], x: number, y: number, z: number): string {
	let best = "";
	let bestVolume = math.huge;
	for (const box of boxes) {
		const inside =
			math.abs(x - box.x) <= box.sx / 2 && math.abs(y - box.y) <= box.sy / 2 && math.abs(z - box.z) <= box.sz / 2;
		const volume = box.sx * box.sy * box.sz;
		if (inside && volume < bestVolume) {
			bestVolume = volume;
			best = box.name;
		}
	}
	return best;
}

// Custom events: track(player, name, props) ---------------------------------------------------------------------------

export const EVENTS = {
	// Rounds (server)
	targetHit: "target_hit",
	targetMissed: "target_missed",
	comboMilestone: "combo_milestone",
	comboLost: "combo_lost",
	padStart: "pad_start",
	roundJoinedLate: "round_joined_late",
	roundEnd: "round_end",
	personalBest: "personal_best",
	/** Server-only (no player): one per round. */
	roundQueued: "round_queued",
	roundStarted: "round_started",
	roundSummary: "round_summary",
	// Lobby and shop (server)
	coinPickup: "coin_pickup",
	shopOpened: "shop_opened",
	itemBought: "item_bought",
	itemEquipped: "item_equipped",
	buyFailed: "buy_failed",
	promptShown: "purchase_prompt_shown",
	promptCancelled: "purchase_prompt_cancelled",
	promptAccepted: "purchase_prompt_accepted",
	// Client
	clientReady: "client_ready",
	itemViewed: "item_viewed",
	shopClosed: "shop_closed",
	resultsClosed: "results_closed",
	guideShown: "guide_shown",
} as const;

// Economy: currency(player, "coins", delta, reason) -------------------------------------------------------------------

export const CURRENCY = "coins";
/** Every way coins come in (+) and go out (-). */
export const COIN_REASONS = {
	lobbyCoin: "lobby_coin",
	goldenTarget: "golden_target",
	roundReward: "round_reward",
	coinPack: "coin_pack",
	shopTrail: "shop_trail",
} as const;
export type CoinReason = (typeof COIN_REASONS)[keyof typeof COIN_REASONS];

/** Combos reach these counts when the multiplier steps up (config COMBO_STEPS); a lost combo this long is logged. */
export const COMBO_LOST_MIN = 5;
