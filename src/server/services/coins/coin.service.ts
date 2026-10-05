import { CollectionService, Workspace } from "@rbxts/services";
import { Module, Service, setNetworkLimits, type OnStart, type OnTick } from "@typetorch/framework";
import { $print, $warn } from "rbxts-transform-debug";
import { COIN_REASONS, EVENTS } from "../../../shared/analytics/catalog";
import { network } from "../../../shared/net";
import type { Phase } from "../../../shared/rush/types";
import { AnalyticsService } from "../analytics/analytics.service";
import { ArenaService } from "../rush/arena.service";
import { RoundService } from "../rush/round.service";
import { WalletService } from "./wallet.service";

const COIN_TAG = "Coin";
const COIN_COUNT = 12;
const RING_RADIUS = 22;
const MAX_DISTANCE = 14;
const RESPAWN_SECONDS = 4;

/**
 * Lobby coins: a ring around the spawn, collectable between rounds (hidden while a round runs). WalletService,
 * RoundService and ArenaService come in through the constructor.
 */
@Service()
export class CoinService extends Module implements OnStart, OnTick {
	private readonly coins = new Map<string, BasePart>();
	private readonly respawnAt = new Map<string, number>();
	private folder?: Folder;
	private hidden = false;

	constructor(
		private readonly wallet: WalletService,
		private readonly round: RoundService,
		private readonly analytics: AnalyticsService,
		private readonly arena: ArenaService,
	) {
		super();
	}

	onStart() {
		// Everything this generation puts in the world lives in its trove, so a swap leaves no coins behind.
		const folder = this.trove.add(new Instance("Folder"));
		folder.Name = "Coins";
		folder.Parent = Workspace;
		this.folder = folder;

		// Around the arena center, on its floor (which sits on the place's ground, not inside a thick baseplate).
		const center = this.arena.layout.center;
		for (let index = 0; index < COIN_COUNT; index++) {
			const angle = (index / COIN_COUNT) * math.pi * 2;
			const position = center.add(new Vector3(math.cos(angle) * RING_RADIUS, 3, math.sin(angle) * RING_RADIUS));
			this.spawnCoin(`coin-${index + 1}`, position);
		}
		setNetworkLimits({ "coins.collect": { rate: [6, 4], maxString: 16 } });
		this.trove.add(network.server.coins.collect.on((player, coinId) => this.collect(player, coinId)));
		this.trove.add(this.round.onPhaseChanged((phase) => this.showFor(phase)));
		this.showFor(this.round.phase());
		$print(`spawned ${COIN_COUNT} coins (generation ${this.ctx.generation})`);
	}

	onTick() {
		if (this.respawnAt.size() === 0 || this.hidden) return;
		const now = os.clock();
		for (const [coinId, at] of this.respawnAt) {
			if (now < at) continue;
			this.respawnAt.delete(coinId);
			const coin = this.coins.get(coinId);
			if (coin) coin.Parent = this.folder;
		}
	}

	/** Coins belong to the lobby: out of the way during the countdown and the round. */
	private showFor(phase: Phase) {
		this.hidden = phase === "countdown" || phase === "round";
		for (const [coinId, coin] of this.coins) {
			coin.Parent = this.hidden || this.respawnAt.has(coinId) ? undefined : this.folder;
		}
	}

	private spawnCoin(coinId: string, position: Vector3) {
		const coin = new Instance("Part");
		coin.Name = coinId;
		coin.Shape = Enum.PartType.Cylinder;
		coin.Size = new Vector3(0.5, 3, 3);
		coin.CFrame = new CFrame(position);
		coin.Color = Color3.fromRGB(255, 196, 46);
		coin.Material = Enum.Material.SmoothPlastic;
		coin.Anchored = true;
		coin.CanCollide = false;
		coin.SetAttribute("CoinId", coinId);
		CollectionService.AddTag(coin, COIN_TAG);
		coin.Parent = this.folder;
		// Parts parented to nil (collected or hidden) still need the trove to clean them up.
		this.trove.add(coin);
		this.coins.set(coinId, coin);
	}

	private collect(player: Player, coinId: string) {
		const coin = this.coins.get(coinId);
		if (!coin || coin.Parent === undefined || this.hidden) return;
		const root = player.Character?.FindFirstChild("HumanoidRootPart") as BasePart | undefined;
		if (!root) return;
		const distance = root.Position.sub(coin.Position).Magnitude;
		if (distance > MAX_DISTANCE) {
			$warn(`${player.Name} tried to collect ${coinId} from ${math.floor(distance)} studs`);
			return;
		}
		coin.Parent = undefined;
		this.respawnAt.set(coinId, os.clock() + RESPAWN_SECONDS);
		const balance = this.wallet.add(player, 1, COIN_REASONS.lobbyCoin);
		// `taken`: coins of the ring still waiting to respawn (how picked-over the ring is).
		this.analytics.track(player, EVENTS.coinPickup, { coin: coinId, balance, taken: this.respawnAt.size(), phase: this.round.phase() });
	}
}
