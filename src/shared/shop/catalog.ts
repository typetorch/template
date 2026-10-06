import { PALETTE } from "../rush/palette";

/**
 * The coin shop: character trails bought with coins (the game's coin sink), and one optional Robux coin pack.
 *
 * Coins are a per-server currency in this demo (WalletService keeps them in persist, not a DataStore), and so are the
 * trails you own. A real game saves both (DataStore or ProfileStore) before it sells coins for Robux.
 */

export interface TrailItem {
	readonly id: string;
	/** Price in coins. */
	readonly price: number;
	/** The trail's colors along its length (one color is a solid trail). */
	readonly colors: readonly Color3[];
}

export const TRAILS: readonly TrailItem[] = [
	{ id: "mint", price: 30, colors: [PALETTE.mint, PALETTE.white] },
	{ id: "sky", price: 60, colors: [PALETTE.sky, PALETTE.lavender] },
	{ id: "sunset", price: 120, colors: [PALETTE.lemon, PALETTE.peach, PALETTE.hotPink] },
	{ id: "rainbow", price: 250, colors: [PALETTE.pink, PALETTE.lemon, PALETTE.mint, PALETTE.sky, PALETTE.lavender] },
];

export function trailById(id: string): TrailItem | undefined {
	return TRAILS.find((item) => item.id === id);
}

/**
 * The Robux coin pack: a developer product id, or 0 (the placeholder) to keep it switched off.
 *
 * PLACEHOLDER. While this is 0 the pack is hidden, no purchase prompt is ever shown and nothing can be charged; the
 * shop still works with coins. To sell it: create a developer product in Creator Hub (your experience > Monetization >
 * Developer Products), put its id here, and deploy. Test purchases in Studio are free (Studio never charges Robux).
 */
export const COIN_PACK_PRODUCT_ID = 0;
/** Coins the pack gives. */
export const COIN_PACK_COINS = 150;
/** The shop item id of the pack (analytics: item_viewed, purchase prompts). */
export const COIN_PACK_ITEM = "coin_pack";

/** What the shop card draws. */
export interface ShopState {
	readonly coins: number;
	/** Trail ids the player owns (this server session). */
	readonly owned: string[];
	/** The equipped trail id, or "". */
	readonly equipped: string;
	/** The coin pack's Robux price, or 0 when the pack is off (placeholder id) or its price couldn't be read. */
	readonly packRobux: number;
	readonly packCoins: number;
}
