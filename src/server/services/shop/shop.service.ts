import { DataStoreService, MarketplaceService, Players } from "@rbxts/services";
import type { Trove } from "@rbxts/trove";
import { Module, observePlayers, Service, setNetworkLimits, TypeTorch, type OnInit, type OnStart, type ProperReturns } from "@typetorch/framework";
import { $warn } from "rbxts-transform-debug";
import { COIN_REASONS, EVENTS } from "../../../shared/analytics/catalog";
import { network } from "../../../shared/net";
import {
	COIN_PACK_COINS,
	COIN_PACK_ITEM,
	COIN_PACK_PRODUCT_ID,
	trailById,
	type ShopState,
	type TrailItem,
} from "../../../shared/shop/catalog";
import { AnalyticsService } from "../analytics/analytics.service";
import { WalletService } from "../coins/wallet.service";
import { RoundService } from "../rush/round.service";

/** Plain data in persist: a hot-swap keeps what everyone owns and every receipt already granted. */
interface ShopStore {
	/** userId -> trail ids owned (this server session, like the coins). */
	owned: Map<number, string[]>;
	/** userId -> equipped trail id. */
	equipped: Map<number, string>;
	/** Receipt PurchaseIds granted on this server (and recorded in the receipts DataStore): answered at once. */
	granted: Map<string, boolean>;
}

/** One key per PurchaseId in the receipts DataStore: which server recorded (and so granted) the purchase. */
interface ReceiptRecord {
	/** The buyer's UserId. */
	u: number;
	/** The product id. */
	p: number;
	/** The JobId of the server that recorded it. */
	j: string;
	/** os.time() when it was recorded. */
	t: number;
}

const WHERE = "shop";
const RECEIPTS_VERSION = "v1";

/**
 * The coin shop: trails bought with coins (the game's coin sink) and, only when a real developer product id is set in
 * shared/shop/catalog.ts, a Robux coin pack. Analytics: the shop funnel (opened, bought, equipped; the client logs
 * item_viewed), shop_opened / item_bought / item_equipped / buy_failed, coins out (shop_trail) and in (coin_pack), and
 * for the pack: purchase_prompt_shown / _accepted / _cancelled and purchase() once the receipt is granted.
 *
 * With the placeholder id (0) nothing Robux-related runs: no ProcessReceipt, no prompt, nothing to charge.
 *
 * Receipts are recorded durably (a DataStore split by channel) before PurchaseGranted: persist is this server's memory
 * only, and Roblox may send the same receipt again to another server after the player left.
 */
@Service()
export class ShopService extends Module implements OnInit, OnStart {
	private store!: ShopStore;
	/** The receipts DataStore (coin pack only), undefined until it opened. */
	private receipts?: DataStore;
	/** The pack's price in Robux (read once per generation), 0 until known or when the pack is off. */
	private packRobux = 0;
	/** userId -> os.clock() the coin pack prompt opened (per generation: a prompt doesn't outlive a swap's analytics). */
	private readonly promptAt = new Map<number, number>();
	/** userId -> rebuilds the player's trail on their current character. */
	private readonly refreshers = new Map<number, () => void>();

	constructor(
		private readonly wallet: WalletService,
		private readonly analytics: AnalyticsService,
		private readonly round: RoundService,
	) {
		super();
	}

	onInit() {
		this.store = this.ctx.persist<ShopStore>("shop.v1", () => ({ owned: new Map(), equipped: new Map(), granted: new Map() }));
		setNetworkLimits({
			"shop.open": { rate: [4, 1] },
			"shop.buy": { rate: [4, 2], maxString: 32 },
			"shop.equip": { rate: [4, 2], maxString: 32 },
			"shop.pack": { rate: [2, 0.2] },
		});
		this.trove.add(network.server.shop.open.handle((player) => [this.open(player)]));
		this.trove.add(network.server.shop.buy.handle((player, itemId) => this.buy(player, itemId)));
		this.trove.add(network.server.shop.equip.handle((player, itemId) => this.equip(player, itemId)));
		this.trove.add(network.server.shop.pack.handle((player) => this.promptPack(player)));
		if (COIN_PACK_PRODUCT_ID !== 0) this.startCoinPack();
	}

	onStart() {
		observePlayers(this.trove, (player, playerTrove) => this.watchTrail(player, playerTrove));
	}

	stateFor(player: Player): ShopState {
		return {
			coins: this.wallet.get(player),
			owned: [...(this.store.owned.get(player.UserId) ?? [])],
			equipped: this.store.equipped.get(player.UserId) ?? "",
			packRobux: COIN_PACK_PRODUCT_ID !== 0 ? this.packRobux : 0,
			packCoins: COIN_PACK_COINS,
		};
	}

	// Requests ---------------------------------------------------------------------------------------------------------

	private open(player: Player): ShopState {
		const state = this.stateFor(player);
		this.analytics.step(player, "shop", "opened");
		this.analytics.track(player, EVENTS.shopOpened, {
			coins: state.coins,
			owned: state.owned.size(),
			equipped: state.equipped,
			phase: this.round.phase(),
			pack: state.packRobux > 0,
		});
		return state;
	}

	private buy(player: Player, itemId: string): ProperReturns<ShopState> {
		const item = trailById(itemId);
		const owned = this.ownedBy(player);
		let reason: string | undefined;
		if (!item) reason = "unknown";
		else if (owned.includes(item.id)) reason = "owned";
		else if (!this.wallet.spend(player, item.price, COIN_REASONS.shopTrail)) reason = "coins";
		if (!item || reason !== undefined) {
			this.analytics.track(player, EVENTS.buyFailed, {
				item: itemId.sub(1, 32),
				reason: reason ?? "unknown",
				price: item?.price ?? 0,
				coins: this.wallet.get(player),
			});
			return [false, reason === "coins" ? "Not enough coins" : reason === "owned" ? "Owned" : "Unknown item"];
		}
		owned.push(item.id);
		this.analytics.step(player, "shop", "bought");
		this.analytics.track(player, EVENTS.itemBought, {
			item: item.id,
			price: item.price,
			coins_after: this.wallet.get(player),
			owned: owned.size(),
			session_rounds: this.analytics.roundsJoined(player),
		});
		this.wear(player, item);
		return [this.changed(player)];
	}

	private equip(player: Player, itemId: string): ProperReturns<ShopState> {
		if (itemId === "") {
			this.wear(player, undefined);
			return [this.changed(player)];
		}
		const item = trailById(itemId);
		if (!item || !this.ownedBy(player).includes(item.id)) return [false, "Not owned"];
		this.wear(player, item);
		return [this.changed(player)];
	}

	private promptPack(player: Player): ProperReturns<boolean> {
		if (COIN_PACK_PRODUCT_ID === 0) return [false, "Not set up"];
		this.promptAt.set(player.UserId, os.clock());
		this.analytics.track(player, EVENTS.promptShown, { product: COIN_PACK_PRODUCT_ID, item: COIN_PACK_ITEM, robux: this.packRobux, where: WHERE });
		MarketplaceService.PromptProductPurchase(player, COIN_PACK_PRODUCT_ID);
		return [true];
	}

	// Trails -----------------------------------------------------------------------------------------------------------

	private ownedBy(player: Player): string[] {
		let owned = this.store.owned.get(player.UserId);
		if (!owned) {
			owned = [];
			this.store.owned.set(player.UserId, owned);
		}
		return owned;
	}

	/** Equips `item` (undefined: none) and logs it. */
	private wear(player: Player, item: TrailItem | undefined) {
		const from = this.store.equipped.get(player.UserId) ?? "";
		const to = item?.id ?? "";
		if (from === to) return;
		if (item) this.store.equipped.set(player.UserId, item.id);
		else this.store.equipped.delete(player.UserId);
		if (item) this.analytics.step(player, "shop", "equipped");
		this.analytics.track(player, EVENTS.itemEquipped, { item: to, from });
		this.refreshers.get(player.UserId)?.();
	}

	private changed(player: Player): ShopState {
		const state = this.stateFor(player);
		network.server.shop.changed.fire(player, state);
		return state;
	}

	/** Keeps the equipped trail on the player's character (a trail per character, in a trove per player). */
	private watchTrail(player: Player, playerTrove: Trove) {
		const trailTrove = playerTrove.extend();
		let alive = true;
		playerTrove.add(() => (alive = false));
		const refresh = () => {
			if (!alive) return; // a CharacterAdded wait that outlived the player (or the generation)
			trailTrove.clean();
			const item = trailById(this.store.equipped.get(player.UserId) ?? "");
			const root = player.Character?.FindFirstChild("HumanoidRootPart");
			if (!item || !root || !root.IsA("BasePart")) return;
			const top = trailTrove.add(new Instance("Attachment"));
			top.Name = "TrailTop";
			top.Position = new Vector3(0, 0.9, 0);
			top.Parent = root;
			const bottom = trailTrove.add(new Instance("Attachment"));
			bottom.Name = "TrailBottom";
			bottom.Position = new Vector3(0, -0.9, 0);
			bottom.Parent = root;
			const trail = trailTrove.add(new Instance("Trail"));
			trail.Name = "ShopTrail";
			trail.Attachment0 = top;
			trail.Attachment1 = bottom;
			const steps = item.colors.size();
			trail.Color =
				steps === 1
					? new ColorSequence(item.colors[0])
					: new ColorSequence(item.colors.map((color, index) => new ColorSequenceKeypoint(index / (steps - 1), color)));
			trail.Transparency = new NumberSequence([new NumberSequenceKeypoint(0, 0.15), new NumberSequenceKeypoint(1, 1)]);
			trail.Lifetime = 0.55;
			trail.MinLength = 0.1;
			trail.LightEmission = 0.35;
			trail.FaceCamera = true;
			trail.Parent = root;
		};
		this.refreshers.set(player.UserId, refresh);
		playerTrove.add(() => this.refreshers.delete(player.UserId));
		playerTrove.connect(player.CharacterAdded, (character) => {
			character.WaitForChild("HumanoidRootPart", 10);
			refresh();
		});
		refresh();
	}

	// Robux coin pack (only with a real developer product id) ---------------------------------------------------------

	private startCoinPack() {
		// Split by channel like every store: dev servers never touch prod receipts.
		const name = TypeTorch.channel === "prod" ? `TargetRushReceipts_${RECEIPTS_VERSION}` : `TargetRushReceipts_${RECEIPTS_VERSION}_${TypeTorch.channel}`;
		const [opened, dataStore] = pcall(() => DataStoreService.GetDataStore(name));
		if (opened) this.receipts = dataStore;
		else $warn(`coin pack: no receipts DataStore (${dataStore}); receipts wait until a server can record them`);
		MarketplaceService.ProcessReceipt = (receipt) => this.receipt(receipt);
		// The callback belongs to this generation: the next one sets its own. A receipt in between waits and is retried.
		this.trove.add(() => {
			(MarketplaceService as unknown as { ProcessReceipt?: unknown }).ProcessReceipt = undefined;
		});
		this.trove.connect(MarketplaceService.PromptProductPurchaseFinished, (userId, productId, purchased) => {
			if (productId !== COIN_PACK_PRODUCT_ID) return;
			const player = Players.GetPlayerByUserId(userId);
			const openedAt = this.promptAt.get(userId);
			this.promptAt.delete(userId);
			if (!player) return;
			const secs = openedAt !== undefined ? math.floor((os.clock() - openedAt) * 10) / 10 : -1;
			this.analytics.track(player, purchased ? EVENTS.promptAccepted : EVENTS.promptCancelled, {
				product: productId,
				item: COIN_PACK_ITEM,
				robux: this.packRobux,
				where: WHERE,
				secs,
			});
		});
		this.trove.add(
			task.spawn(() => {
				const [ok, info] = pcall(() => MarketplaceService.GetProductInfo(COIN_PACK_PRODUCT_ID, Enum.InfoType.Product));
				if (ok && typeIs((info as { PriceInRobux?: unknown }).PriceInRobux, "number")) {
					this.packRobux = (info as { PriceInRobux: number }).PriceInRobux;
				} else $warn(`coin pack ${COIN_PACK_PRODUCT_ID}: no price (${ok ? "not a product?" : info})`);
			}),
		);
	}

	/**
	 * Grants the pack once per PurchaseId, across servers and swaps. NotProcessedYet makes Roblox send the receipt again
	 * later (the next join, or a while after), so every "not now" below is safe.
	 */
	private receipt(receipt: ReceiptInfo): Enum.ProductPurchaseDecision {
		if (receipt.ProductId !== COIN_PACK_PRODUCT_ID) return Enum.ProductPurchaseDecision.NotProcessedYet;
		const id = receipt.PurchaseId;
		if (this.store.granted.has(id)) return Enum.ProductPurchaseDecision.PurchaseGranted;
		// Coins live in this server: grant only while the player is here.
		const player = Players.GetPlayerByUserId(receipt.PlayerId);
		const receipts = this.receipts;
		if (!player || !receipts) return Enum.ProductPurchaseDecision.NotProcessedYet;
		if (DataStoreService.GetRequestBudgetForRequestType(Enum.DataStoreRequestType.UpdateAsync) < 1) {
			return Enum.ProductPurchaseDecision.NotProcessedYet;
		}
		// Record first, grant second. The record names the server that wrote it: another server's record means it was
		// granted there; this server's record without a grant means a swap cut the previous try off right after the
		// write (the hard stop ends a yielding thread), so it is granted now.
		let recordedBy: string | undefined;
		const [ok, err] = pcall(() =>
			receipts.UpdateAsync<unknown, ReceiptRecord>(`receipt_${id}`, (old) => {
				if (typeIs(old, "table")) {
					recordedBy = (old as ReceiptRecord).j;
					return $tuple(undefined); // already recorded: no write
				}
				recordedBy = game.JobId;
				const record: ReceiptRecord = { u: receipt.PlayerId, p: receipt.ProductId, j: game.JobId, t: os.time() };
				return $tuple(record, [receipt.PlayerId]);
			}),
		);
		if (!ok) {
			$warn(`receipt ${id} not recorded (${err}); Roblox sends it again later`);
			return Enum.ProductPurchaseDecision.NotProcessedYet;
		}
		this.store.granted.set(id, true);
		if (recordedBy !== game.JobId) return Enum.ProductPurchaseDecision.PurchaseGranted; // granted on another server
		this.wallet.add(player, COIN_PACK_COINS, COIN_REASONS.coinPack);
		this.analytics.purchase(player, { product: receipt.ProductId, robux: receipt.CurrencySpent, where: WHERE });
		this.changed(player);
		return Enum.ProductPurchaseDecision.PurchaseGranted;
	}
}
