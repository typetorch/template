import { createNetwork, type ProperReturns } from "@typetorch/framework";
import type {
	BoardRow,
	HitResult,
	HitVia,
	MyStats,
	PersonalResult,
	PhaseInfo,
	PopEvent,
	RoundResults,
	RushSnapshot,
} from "./rush/types";
import type { ShopState } from "./shop/catalog";

/**
 * Client -> server. Every leaf gets a generated type guard; the server also rate- and shape-limits it (see
 * `setNetworkLimits` in the services that handle them). Messages ride the kernel's stable remotes, so a hot-swap
 * never breaks the network.
 */
interface ClientToServer {
	coins: {
		/** Pick up a coin next to the player's character. */
		collect(coinId: string): void;
		/** The player's coin total. */
		balance(): ProperReturns<number>;
	};
	rush: {
		/** Clicked/tapped (or ran into) a target. The server checks timing, distance and rate, then scores it. */
		hit(targetId: number, via: HitVia): ProperReturns<HitResult>;
		/** Clicked empty air during a round: the combo ends (and the round's whiff count goes up). */
		whiff(): void;
		/** Everything needed to draw the game (on join and after the client's own hot-swap). */
		snapshot(): ProperReturns<RushSnapshot>;
	};
	shop: {
		/** The shop card opened: coins, owned and equipped trails, the coin pack's price. */
		open(): ProperReturns<ShopState>;
		/** Buys a trail with coins and equips it. */
		buy(itemId: string): ProperReturns<ShopState>;
		/** Equips an owned trail ("" takes it off). */
		equip(itemId: string): ProperReturns<ShopState>;
		/** Shows the Robux prompt for the coin pack (only when a real product id is set up). */
		pack(): ProperReturns<boolean>;
	};
}

/** Server -> client. */
interface ServerToClient {
	coins: {
		changed(total: number): void;
	};
	rush: {
		phase(info: PhaseInfo): void;
		me(stats: MyStats): void;
		board(live: BoardRow[], session: BoardRow[]): void;
		popped(event: PopEvent): void;
		results(results: RoundResults, mine: PersonalResult): void;
	};
	shop: {
		/** Owned or equipped trails changed (a buy, an equip, a granted coin pack). */
		changed(state: ShopState): void;
	};
}

export const network = createNetwork<ClientToServer, ServerToClient>();
