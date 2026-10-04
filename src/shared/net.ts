import { createNetwork, type ProperReturns } from "@typetorch/framework";

/** Client -> server. Every leaf gets a generated type guard; the server also rate- and shape-limits it. */
interface ClientToServer {
	coins: {
		/** Pick up a coin next to the player's character. */
		collect(coinId: string): void;
		/** The player's coin total. */
		balance(): ProperReturns<number>;
	};
}

/** Server -> client. */
interface ServerToClient {
	coins: {
		changed(total: number): void;
	};
}

export const network = createNetwork<ClientToServer, ServerToClient>();
