import { Module, Service, type OnInit, type OnPlayerAdded } from "@typetorch/framework";
import { $assert } from "rbxts-transform-debug";
import { network } from "../../shared/net";

/**
 * Per-player coin totals. They live in the kernel persist store (`ctx.persist`), so a hot-swap keeps them; a new
 * server starts at zero (this demo has no DataStore).
 */
@Service()
export class ScoreService extends Module implements OnInit, OnPlayerAdded {
	/** userId -> coins. Plain data only: the next generation reads the same table. */
	private coins = new Map<number, number>();

	onInit() {
		this.coins = this.ctx.persist("coins", () => new Map<number, number>());
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
