import { listen } from "@rbxts/charm";
import { TweenService } from "@rbxts/services";
import type { Trove } from "@rbxts/trove";
import { bump, Controller, Module, popIn, popOut, type OnStart } from "@typetorch/framework";
import { $warn } from "rbxts-transform-debug";
import { EVENTS, SCREENS } from "../../../shared/analytics/catalog";
import { network } from "../../../shared/net";
import { PALETTE } from "../../../shared/rush/palette";
import { formatNumber } from "../../../shared/rush/rules";
import type { Phase } from "../../../shared/rush/types";
import { COIN_PACK_ITEM, TRAILS, trailById, type ShopState } from "../../../shared/shop/catalog";
import { bagIcon, checkIcon, coinIcon, crossIcon } from "../../../shared/ui/icons";
import { aspect, box, column, corner, FONT_TITLE, make, pad, panel, row, stroke, text, textStroke } from "../../../shared/ui/kit";
import { tagScreen } from "../../ui/screens";
import { AnalyticsController } from "../analytics/analytics.controller";
import { RushStateController } from "../rush/rush-state.controller";
import { UiController } from "../ui/ui.controller";

const COLUMNS = 3;
const GAP = 8;

interface Cell {
	readonly button: TextButton;
	readonly outline: UIStroke;
	readonly price: Frame;
	readonly owned: Frame;
}

/** One open shop card: its trove, widgets and what the player did in it. */
interface ShopCard {
	readonly trove: Trove;
	readonly cells: Map<string, Cell>;
	readonly coins: TextLabel;
	readonly coinChip: Frame;
	readonly action: TextButton;
	readonly actionContent: Frame;
	readonly openedAt: number;
	state?: ShopState;
	selected?: string;
	busy: boolean;
	viewed: number;
	bought: number;
}

/** Shop is open between rounds only. */
function shopPhase(phase: Phase | undefined) {
	return phase === "lobby" || phase === "results";
}

/**
 * The coin shop: a bag button under the coin counter (lobby and results only) opens a card through the PopupQueue:
 * trails as a script-free grid (icons and prices, no words), one action button (BUY / WEAR / off), and the Robux coin
 * pack only when the server says it's set up. Analytics: the "Shop" screen (TTScreen on the card), item_viewed and
 * the shop funnel's item_viewed step from here, shop_closed (how, seconds, views, buys); the server logs the rest.
 */
@Controller()
export class ShopController extends Module implements OnStart {
	private button!: TextButton;
	private queued = false;
	private card?: ShopCard;

	constructor(
		private readonly ui: UiController,
		private readonly rush: RushStateController,
		private readonly analytics: AnalyticsController,
	) {
		super();
	}

	onStart() {
		this.buildButton();
		this.trove.add(
			listen(
				() => (this.rush.ready() ? this.rush.phase().phase : undefined),
				(phase) => {
					const open = shopPhase(phase);
					if (open && !this.button.Visible) popIn(this.button);
					else if (!open && this.button.Visible) popOut(this.button);
				},
			),
		);
		this.trove.connect(this.button.Activated, () => this.request());
		this.trove.add(
			network.client.shop.changed.on((state) => {
				if (this.card) this.redraw(this.card, state);
			}),
		);
		this.trove.add(
			network.client.coins.changed.on((total) => {
				const card = this.card;
				if (!card) return;
				card.coins.Text = formatNumber(total);
				bump(card.coinChip);
			}),
		);
	}

	private buildButton() {
		const button = make("TextButton", this.ui.hud, {
			Name: "ShopButton",
			Text: "",
			AutoButtonColor: true,
			BackgroundColor3: PALETTE.ink,
			BackgroundTransparency: 0.15,
			AnchorPoint: new Vector2(1, 0),
			Position: new UDim2(1, -10, 0, 60),
			Size: UDim2.fromOffset(48, 48),
			Visible: false,
		});
		corner(button);
		stroke(button, PALETTE.lemon, 2, 0.3);
		bagIcon(button, UDim2.fromScale(0.62, 0.62), PALETTE.lemon, 2.5).Position = UDim2.fromScale(0.19, 0.17);
		this.button = button;
	}

	private request() {
		if (this.queued || this.card) return;
		this.queued = true;
		this.ui.popups.enqueue((done) => this.show(done));
	}

	private show(done: () => void) {
		this.queued = false;
		const phase = this.rush.ready() ? this.rush.phase().phase : undefined;
		if (!shopPhase(phase)) {
			done(); // the round started while the card waited its turn: nothing to show
			return;
		}
		const popup = this.trove.extend();
		const dim = popup.add(panel(this.ui.modal, "Dim", PALETTE.ink, { Size: UDim2.fromScale(1, 1), BackgroundTransparency: 1 }));
		tagScreen(dim, SCREENS.shop);
		TweenService.Create(dim, new TweenInfo(0.2), { BackgroundTransparency: 0.55 }).Play();

		const cardFrame = box(dim, "Card", {
			AnchorPoint: new Vector2(0.5, 0.5),
			Position: UDim2.fromScale(0.5, 0.52),
			Size: UDim2.fromOffset(380, 0),
			AutomaticSize: Enum.AutomaticSize.Y,
			Visible: false,
		});
		const body = panel(cardFrame, "Body", PALETTE.navy, { Size: UDim2.fromScale(1, 0), AutomaticSize: Enum.AutomaticSize.Y });
		corner(body, new UDim(0, 22));
		stroke(body, PALETTE.lemon, 3);
		pad(body, 18, 16);
		column(body, 12);

		// Header: the bag and the player's coins.
		const header = box(body, "Header", { Size: new UDim2(1, 0, 0, 44), LayoutOrder: 1 });
		row(header, 12, Enum.HorizontalAlignment.Center);
		bagIcon(header, UDim2.fromOffset(40, 40)).LayoutOrder = 1;
		const coinChip = panel(header, "Coins", PALETTE.ink, { Size: UDim2.fromOffset(0, 40), AutomaticSize: Enum.AutomaticSize.X, LayoutOrder: 2 });
		corner(coinChip);
		pad(coinChip, 12, 0);
		row(coinChip, 6);
		coinIcon(coinChip, UDim2.fromOffset(26, 26), 2).LayoutOrder = 1;
		const coins = text(coinChip, "Amount", "", 26, FONT_TITLE, PALETTE.white, { LayoutOrder: 2 });

		// The items: a script-free grid (AutomaticCanvasSize, cells sized by a UIAspectRatioConstraint on the layout).
		const grid = make("ScrollingFrame", body, {
			Name: "Grid",
			Size: new UDim2(1, 0, 0, 236),
			BackgroundTransparency: 1,
			BorderSizePixel: 0,
			CanvasSize: UDim2.fromOffset(0, 0),
			AutomaticCanvasSize: Enum.AutomaticSize.Y,
			ScrollingDirection: Enum.ScrollingDirection.Y,
			VerticalScrollBarInset: Enum.ScrollBarInset.Always,
			ScrollBarThickness: 6,
			ElasticBehavior: Enum.ElasticBehavior.WhenScrollable,
			LayoutOrder: 2,
		});
		const layout = make("UIGridLayout", grid, {
			CellSize: new UDim2(1 / COLUMNS, -math.ceil((GAP * (COLUMNS - 1)) / COLUMNS), 0, 10000),
			CellPadding: UDim2.fromOffset(GAP, GAP),
			FillDirection: Enum.FillDirection.Horizontal,
			FillDirectionMaxCells: 0,
			SortOrder: Enum.SortOrder.LayoutOrder,
			HorizontalAlignment: Enum.HorizontalAlignment.Left,
		});
		aspect(layout, 1).DominantAxis = Enum.DominantAxis.Width;

		// The one action for the selected item.
		const action = make("TextButton", body, {
			Name: "Action",
			Text: "",
			AutoButtonColor: true,
			BackgroundColor3: PALETTE.hotPink,
			Size: new UDim2(1, 0, 0, 50),
			LayoutOrder: 3,
			Visible: false,
		});
		corner(action);
		const actionContent = box(action, "Content", { Size: UDim2.fromScale(1, 1) });
		row(actionContent, 8, Enum.HorizontalAlignment.Center);

		const close = make("TextButton", cardFrame, {
			Name: "Close",
			Text: "",
			AutoButtonColor: true,
			BackgroundColor3: PALETTE.ink,
			AnchorPoint: new Vector2(0.5, 0.5),
			Position: new UDim2(1, -10, 0, 10),
			Size: UDim2.fromOffset(40, 40),
			ZIndex: 2,
		});
		corner(close);
		stroke(close, PALETTE.lemon, 2);
		crossIcon(close, UDim2.fromScale(0.6, 0.6), PALETTE.white).Position = UDim2.fromScale(0.2, 0.2);

		const card: ShopCard = {
			trove: popup,
			cells: new Map(),
			coins,
			coinChip,
			action,
			actionContent,
			openedAt: os.clock(),
			busy: false,
			viewed: 0,
			bought: 0,
		};
		this.card = card;
		TRAILS.forEach((item, index) =>
			this.buildCell(card, grid, item.id, index + 1, (swatch) => {
				// The trail's colors left to right on a white swatch (a UIGradient tints it).
				const last = math.max(item.colors.size() - 1, 1);
				const keys = item.colors.map((color, at) => new ColorSequenceKeypoint(at / last, color));
				if (keys.size() === 1) keys.push(new ColorSequenceKeypoint(1, item.colors[0]));
				make("UIGradient", swatch, { Color: new ColorSequence(keys) });
			}),
		);

		let finished = false;
		const finish = (how: "button" | "round") => {
			if (finished) return;
			finished = true;
			this.analytics.track(EVENTS.shopClosed, {
				how,
				secs: math.floor((os.clock() - card.openedAt) * 10) / 10,
				viewed: card.viewed,
				bought: card.bought,
			});
			close.Active = false;
			TweenService.Create(dim, new TweenInfo(0.15), { BackgroundTransparency: 1 }).Play();
			popOut(cardFrame, () => {
				if (this.card === card) this.card = undefined;
				this.trove.remove(popup);
				done();
			});
		};
		popup.connect(close.Activated, () => finish("button"));
		popup.connect(action.Activated, () => this.act(card));
		// The countdown closes the shop: nobody misses the start of a round.
		popup.add(
			listen(
				() => this.rush.phase().phase,
				(now) => {
					if (!shopPhase(now)) finish("round");
				},
			),
		);
		popup.add(() => {
			if (this.card === card) this.card = undefined;
		});

		popIn(cardFrame);
		this.ui.sound("whoosh", 1.4, 0.4);
		popup.addPromise(
			network.client.shop.open
				.invoke()
				.then((reply) => {
					if (reply[0] === false) return;
					const state = reply[0];
					if (state.packRobux > 0 && !card.cells.has(COIN_PACK_ITEM)) {
						this.buildCell(card, grid, COIN_PACK_ITEM, TRAILS.size() + 1, (swatch) => {
							swatch.BackgroundTransparency = 1;
							const icon = coinIcon(swatch, UDim2.fromScale(1, 1), 3);
							icon.AnchorPoint = new Vector2(0.5, 0.5);
							icon.Position = UDim2.fromScale(0.5, 0.5);
						});
					}
					this.redraw(card, state);
				})
				.catch((err) => $warn(`shop open failed: ${err}`)),
		);
	}

	/** A grid cell: a swatch on top, the price (or a check when owned) below. */
	private buildCell(card: ShopCard, grid: ScrollingFrame, id: string, order: number, drawSwatch: (swatch: Frame) => void) {
		const button = make("TextButton", grid, {
			Name: id,
			Text: "",
			AutoButtonColor: true,
			BackgroundColor3: PALETTE.ink,
			LayoutOrder: order,
		});
		corner(button, new UDim(0.16, 0));
		const outline = stroke(button, PALETTE.lemon, 3);
		outline.Enabled = false;
		const swatch = panel(button, "Swatch", PALETTE.white, {
			AnchorPoint: new Vector2(0.5, 0),
			Position: UDim2.fromScale(0.5, 0.12),
			Size: UDim2.fromScale(0.64, 0.42),
		});
		corner(swatch, new UDim(0.3, 0));
		drawSwatch(swatch);

		const price = box(button, "Price", { AnchorPoint: new Vector2(0.5, 1), Position: UDim2.fromScale(0.5, 0.92), Size: UDim2.fromScale(0.86, 0.3) });
		row(price, 4, Enum.HorizontalAlignment.Center);
		const amount = make("TextLabel", price, {
			Name: "Amount",
			BackgroundTransparency: 1,
			Size: UDim2.fromScale(0.62, 1),
			Font: FONT_TITLE,
			TextScaled: true,
			TextColor3: PALETTE.lemon,
			LayoutOrder: 2,
			Text: id === COIN_PACK_ITEM ? "" : tostring(trailById(id)?.price ?? 0),
		});
		textStroke(amount, PALETTE.ink, 1.5);
		if (id !== COIN_PACK_ITEM) coinIcon(price, UDim2.fromScale(1, 0.8), 2).LayoutOrder = 1;
		const owned = box(button, "Owned", { AnchorPoint: new Vector2(0.5, 1), Position: UDim2.fromScale(0.5, 0.94), Size: UDim2.fromScale(0.34, 0.34), Visible: false });
		checkIcon(owned, UDim2.fromScale(1, 1), PALETTE.mint);

		card.cells.set(id, { button, outline, price, owned });
		card.trove.connect(button.Activated, () => this.select(card, id));
	}

	private select(card: ShopCard, id: string) {
		card.selected = id;
		card.viewed += 1;
		const state = card.state;
		const trail = trailById(id);
		const owned = state !== undefined && state.owned.includes(id);
		this.analytics.track(EVENTS.itemViewed, {
			item: id,
			price: trail?.price ?? (state?.packRobux ?? 0),
			currency: trail ? "coins" : "robux",
			owned,
			equipped: state !== undefined && state.equipped === id,
			affordable: trail === undefined || (state !== undefined && state.coins >= trail.price),
		});
		this.analytics.step("shop", "item_viewed");
		this.ui.sound("tick", 1.2, 0.35);
		if (state) this.redraw(card, state);
	}

	private act(card: ShopCard) {
		const id = card.selected;
		const state = card.state;
		if (id === undefined || !state || card.busy) return;
		if (id === COIN_PACK_ITEM) {
			card.trove.addPromise(network.client.shop.pack.invoke().catch((err) => $warn(`coin pack failed: ${err}`)));
			return;
		}
		const trail = trailById(id);
		if (!trail) return;
		const owned = state.owned.includes(id);
		if (!owned && state.coins < trail.price) {
			bump(card.coinChip);
			this.ui.sound("thud", 1, 0.45);
			// Still asked: the server logs buy_failed (not enough coins), the shop's main confusion signal.
		}
		card.busy = true;
		const request = owned
			? network.client.shop.equip.invoke(state.equipped === id ? "" : id)
			: network.client.shop.buy.invoke(id);
		card.trove.addPromise(
			request
				.then((reply) => {
					card.busy = false;
					if (reply[0] === false) return;
					if (!owned) {
						card.bought += 1;
						this.ui.sound("splash", 1.3, 0.45);
					} else this.ui.sound("tick", 1.5, 0.4);
					this.redraw(card, reply[0]);
				})
				.catch((err) => {
					card.busy = false;
					$warn(`shop request failed: ${err}`);
				}),
		);
	}

	private redraw(card: ShopCard, state: ShopState) {
		card.state = state;
		card.coins.Text = formatNumber(state.coins);
		for (const [id, cell] of card.cells) {
			const owned = state.owned.includes(id);
			cell.price.Visible = !owned;
			cell.owned.Visible = owned;
			cell.outline.Enabled = card.selected === id || state.equipped === id;
			cell.outline.Color = card.selected === id ? PALETTE.lemon : PALETTE.mint;
			if (id === COIN_PACK_ITEM) {
				const amount = cell.price.FindFirstChild("Amount") as TextLabel | undefined;
				if (amount) amount.Text = `+${state.packCoins}`;
			}
		}
		this.drawAction(card, state);
	}

	/** BUY + coin + price, WEAR (owned), a cross (take it off), or BUY + R$ price for the coin pack. */
	private drawAction(card: ShopCard, state: ShopState) {
		const id = card.selected;
		card.action.Visible = id !== undefined;
		if (id === undefined) return;
		for (const child of card.actionContent.GetChildren()) if (!child.IsA("UIListLayout")) child.Destroy();
		const content = card.actionContent;
		const label = (value: string, order: number, color: Color3 = PALETTE.white) => {
			const word = text(content, "Text", value, 26, FONT_TITLE, color, { LayoutOrder: order });
			textStroke(word, PALETTE.ink, 1.5);
		};
		if (id === COIN_PACK_ITEM) {
			card.action.BackgroundColor3 = PALETTE.mint;
			label("BUY", 1);
			label(`R$ ${state.packRobux}`, 2, PALETTE.ink);
			return;
		}
		const trail = trailById(id);
		if (!trail) return;
		if (state.equipped === id) {
			card.action.BackgroundColor3 = PALETTE.grey;
			crossIcon(content, UDim2.fromOffset(28, 28), PALETTE.white).LayoutOrder = 1;
		} else if (state.owned.includes(id)) {
			card.action.BackgroundColor3 = PALETTE.mint;
			checkIcon(content, UDim2.fromOffset(28, 28), PALETTE.white).LayoutOrder = 1;
			label("WEAR", 2);
		} else {
			const affordable = state.coins >= trail.price;
			card.action.BackgroundColor3 = affordable ? PALETTE.hotPink : PALETTE.grey;
			label("BUY", 1);
			coinIcon(content, UDim2.fromOffset(26, 26), 2).LayoutOrder = 2;
			label(tostring(trail.price), 3, affordable ? PALETTE.lemon : PALETTE.red);
		}
	}
}
