import { CollectionService, Workspace } from "@rbxts/services";
import { Module, Service, type OnStart, type OnTick } from "@typetorch/framework";
import { $print, $warn } from "rbxts-transform-debug";
import { network } from "../../shared/net";
import { ScoreService } from "./score.service";

const COIN_TAG = "Coin";
const COIN_COUNT = 12;
const RING_RADIUS = 22;
const MAX_DISTANCE = 14;
const RESPAWN_SECONDS = 4;

/** Spawns coins around the spawn point and pays for them. ScoreService comes in through the constructor. */
@Service()
export class CoinService extends Module implements OnStart, OnTick {
	private readonly coins = new Map<string, BasePart>();
	private readonly respawnAt = new Map<string, number>();
	private folder?: Folder;

	constructor(private readonly score: ScoreService) {
		super();
	}

	onStart() {
		// Everything this generation puts in the world lives in its trove, so a swap leaves no coins behind.
		const folder = this.trove.add(new Instance("Folder"));
		folder.Name = "Coins";
		folder.Parent = Workspace;
		this.folder = folder;

		const spawn = Workspace.FindFirstChildWhichIsA("SpawnLocation", true);
		const center = spawn ? spawn.Position : new Vector3(0, 0, 0);
		for (let index = 0; index < COIN_COUNT; index++) {
			const angle = (index / COIN_COUNT) * math.pi * 2;
			const position = center.add(new Vector3(math.cos(angle) * RING_RADIUS, 3, math.sin(angle) * RING_RADIUS));
			this.spawnCoin(`coin-${index + 1}`, position);
		}
		this.trove.add(network.server.coins.collect.on((player, coinId) => this.collect(player, coinId)));
		$print(`spawned ${COIN_COUNT} coins (generation ${this.ctx.generation})`);
	}

	onTick() {
		if (this.respawnAt.size() === 0) return;
		const now = os.clock();
		for (const [coinId, at] of this.respawnAt) {
			if (now < at) continue;
			this.respawnAt.delete(coinId);
			const coin = this.coins.get(coinId);
			if (coin) coin.Parent = this.folder;
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
		this.coins.set(coinId, coin);
	}

	private collect(player: Player, coinId: string) {
		const coin = this.coins.get(coinId);
		if (!coin || coin.Parent === undefined) return;
		const root = player.Character?.FindFirstChild("HumanoidRootPart") as BasePart | undefined;
		if (!root) return;
		const distance = root.Position.sub(coin.Position).Magnitude;
		if (distance > MAX_DISTANCE) {
			$warn(`${player.Name} tried to collect ${coinId} from ${math.floor(distance)} studs`);
			return;
		}
		coin.Parent = undefined;
		this.respawnAt.set(coinId, os.clock() + RESPAWN_SECONDS);
		this.score.add(player, 1);
	}
}
