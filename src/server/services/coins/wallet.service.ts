import { Module, Service, setNetworkLimits, type OnInit, type OnPlayerAdded } from "@typetorch/framework";
import { $assert } from "rbxts-transform-debug";
import { network } from "../../../shared/net";

/**
 * Per-player coins, the game's currency: lobby coins pay 1, golden targets pay on the spot, and every round pays out by
 * score. Totals live in the kernel persist store (`ctx.persist`), so a hot-swap keeps them; a new server starts at zero
 * (coins are a session currency in this demo; personal bests are what goes to a DataStore).
 */
@Service()
export class WalletService extends Module implements OnInit, OnPlayerAdded {
	/** userId -> coins. Plain data only: the next generation reads the same table. Key kept from the coin demo. */
	private coins = new Map<number, number>();

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

	add(player: Player, amount: number): number {
		$assert(amount > 0, "coin amounts are positive");
		const total = this.get(player) + amount;
		this.coins.set(player.UserId, total);
		network.server.coins.changed.fire(player, total);
		return total;
	}
}
