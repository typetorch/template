import { Module, Service, setNetworkLimits, type OnInit, type OnPlayerAdded } from "@typetorch/framework";
import { $assert } from "rbxts-transform-debug";
import type { CoinReason } from "../../../shared/analytics/catalog";
import { network } from "../../../shared/net";
import { AnalyticsService } from "../analytics/analytics.service";

/**
 * Per-player coins, the game's currency: lobby coins pay 1, golden targets pay on the spot, every round pays out by
 * score, and the Robux coin pack (when set up) pays a bundle; the shop's trails take coins out. Every change is logged
 * as currency("coins", delta, reason). Totals live in the kernel persist store (`ctx.persist`), so a hot-swap keeps
 * them; a new server starts at zero (coins are a session currency in this demo; personal bests go to a DataStore).
 */
@Service()
export class WalletService extends Module implements OnInit, OnPlayerAdded {
	/** userId -> coins. Plain data only: the next generation reads the same table. Key kept from the coin demo. */
	private coins = new Map<number, number>();

	constructor(private readonly analytics: AnalyticsService) {
		super();
	}

	onInit() {
		this.coins = this.ctx.persist("coins", () => new Map<number, number>());
		setNetworkLimits({ "coins.balance": { rate: [3, 0.5] } });
		this.trove.add(network.server.coins.balance.handle((player) => [this.get(player)]));
	}

	onPlayerAdded(player: Player) {
		// Also runs for players already in the server when this generation starts.
		network.server.coins.changed.fire(player, this.get(player));
	}

	get(player: Player): number {
		return this.coins.get(player.UserId) ?? 0;
	}

	/** Pays coins in. `reason` is the source in the economy data. */
	add(player: Player, amount: number, reason: CoinReason): number {
		$assert(amount > 0, "coin amounts are positive");
		const total = this.get(player) + amount;
		this.coins.set(player.UserId, total);
		this.analytics.coins(player, amount, reason);
		network.server.coins.changed.fire(player, total);
		return total;
	}

	/** Takes coins out if the player has enough. `reason` is the sink in the economy data. */
	spend(player: Player, amount: number, reason: CoinReason): boolean {
		$assert(amount > 0, "coin amounts are positive");
		const balance = this.get(player);
		if (balance < amount) return false;
		this.coins.set(player.UserId, balance - amount);
		this.analytics.coins(player, -amount, reason);
		network.server.coins.changed.fire(player, balance - amount);
		return true;
	}
}
