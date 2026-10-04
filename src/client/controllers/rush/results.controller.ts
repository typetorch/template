import { listen } from "@rbxts/charm";
import { Players, TweenService } from "@rbxts/services";
import { Controller, Module, popIn, popOut, type OnStart } from "@typetorch/framework";
import { RESULTS_SECONDS } from "../../../shared/rush/config";
import { PALETTE } from "../../../shared/rush/palette";
import { formatNumber } from "../../../shared/rush/rules";
import { coinIcon, comboIcon, crossIcon, rankBadge, refreshIcon, starIcon, targetIcon } from "../../../shared/ui/icons";
import {
	aspect,
	box,
	column,
	corner,
	FONT_BOLD,
	FONT_TITLE,
	make,
	pad,
	panel,
	row,
	stroke,
	text,
	textStroke,
} from "../../../shared/ui/kit";
import { UiController } from "../ui/ui.controller";
import { RushStateController, type ResultsState } from "./rush-state.controller";

/** Survives this client's hot-swaps: the round whose results were already shown (and closed). */
interface ResultsMemo {
	shownRound: number;
}

/**
 * The end-of-round card, through the single PopupQueue (one modal at a time). Medal, score, a few stat chips, "new best",
 * how many live updates the round survived, and (with friends) everyone's scores in a script-free ScrollingFrame.
 * It closes on its own when the results phase ends, or with the X.
 */
@Controller()
export class ResultsController extends Module implements OnStart {
	private memo!: ResultsMemo;
	private queuedRound = 0;

	constructor(
		private readonly ui: UiController,
		private readonly state: RushStateController,
	) {
		super();
	}

	onStart() {
		this.memo = this.ctx.persist<ResultsMemo>("rush.ui.results.v1", () => ({ shownRound: 0 }));
		this.trove.add(
			listen(
				() => this.state.results(),
				(results) => {
					if (!results) return;
					const round = results.results.round;
					if (round === this.memo.shownRound || round === this.queuedRound) return;
					this.queuedRound = round;
					this.ui.popups.enqueue((done) => this.show(results, done));
				},
			),
		);
	}

	private show(state: ResultsState, done: () => void) {
		const { results, mine } = state;
		// Everything this card owns lives in its own trove, removed when the card closes.
		const popup = this.trove.extend();
		const dim = popup.add(panel(this.ui.modal, "Dim", PALETTE.ink, { Size: UDim2.fromScale(1, 1), BackgroundTransparency: 1 }));
		TweenService.Create(dim, new TweenInfo(0.2), { BackgroundTransparency: 0.55 }).Play();

		// The card holds the body (a vertical list) and the X button (outside the list, on the corner).
		const card = box(dim, "Card", {
			AnchorPoint: new Vector2(0.5, 0.5),
			Position: UDim2.fromScale(0.5, 0.52),
			Size: UDim2.fromOffset(380, 0),
			AutomaticSize: Enum.AutomaticSize.Y,
			Visible: false,
		});
		const body = panel(card, "Body", PALETTE.navy, { Size: UDim2.fromScale(1, 0), AutomaticSize: Enum.AutomaticSize.Y });
		corner(body, new UDim(0, 22));
		stroke(body, PALETTE.lavender, 3);
		pad(body, 18, 16);
		column(body, 10);

		// Medal and score.
		rankBadge(body, UDim2.fromOffset(66, 66), mine.rank).LayoutOrder = 1;
		const score = text(body, "Score", formatNumber(mine.score), 58, FONT_TITLE, PALETTE.lemon, { LayoutOrder: 2 });
		textStroke(score, PALETTE.ink, 3);
		if (mine.newBest) {
			const ribbon = panel(body, "NewBest", PALETTE.hotPink, { Size: UDim2.fromOffset(0, 34), AutomaticSize: Enum.AutomaticSize.X, LayoutOrder: 3 });
			corner(ribbon);
			pad(ribbon, 14, 0);
			row(ribbon, 6);
			starIcon(ribbon, UDim2.fromOffset(24, 24), PALETTE.lemon).LayoutOrder = 1;
			text(ribbon, "Text", "NEW BEST", 22, FONT_TITLE, PALETTE.white, { LayoutOrder: 2 });
		}

		// Stat chips: icon + number, no words.
		const stats = box(body, "Stats", { Size: new UDim2(1, 0, 0, 40), LayoutOrder: 4 });
		row(stats, 8, Enum.HorizontalAlignment.Center);
		const chip = (order: number, icon: (parent: Instance) => Frame, value: string, color: Color3) => {
			const frame = panel(stats, "Stat", PALETTE.ink, { Size: UDim2.fromOffset(0, 38), AutomaticSize: Enum.AutomaticSize.X, LayoutOrder: order });
			corner(frame);
			pad(frame, 10, 0);
			row(frame, 5);
			icon(frame).LayoutOrder = 1;
			text(frame, "Value", value, 22, FONT_TITLE, color, { LayoutOrder: 2 });
		};
		chip(1, (parent) => comboIcon(parent, UDim2.fromOffset(22, 22)), tostring(mine.bestCombo), PALETTE.lemon);
		chip(2, (parent) => starIcon(parent, UDim2.fromOffset(22, 22)), tostring(mine.perfects), PALETTE.lemon);
		chip(3, (parent) => targetIcon(parent, UDim2.fromOffset(22, 22)), tostring(mine.hits), PALETTE.white);
		chip(4, (parent) => coinIcon(parent, UDim2.fromOffset(22, 22), 2), `+${mine.coins}`, PALETTE.gold);

		// Proof that the round lived through deploys.
		if (results.swaps > 0) {
			const swaps = panel(body, "Swaps", PALETTE.ink, { Size: UDim2.fromOffset(0, 32), AutomaticSize: Enum.AutomaticSize.X, LayoutOrder: 5 });
			corner(swaps);
			pad(swaps, 12, 0);
			row(swaps, 6);
			refreshIcon(swaps, UDim2.fromOffset(22, 22), PALETTE.mint, 2.5).LayoutOrder = 1;
			text(swaps, "Text", `Updated live x${results.swaps}`, 18, FONT_BOLD, PALETTE.mint, { LayoutOrder: 2 });
		}

		// Everyone's scores (with friends): a script-free ScrollingFrame. AutomaticCanvasSize + a list layout; rows keep
		// their shape through a UIAspectRatioConstraint (Width dominant, a large height cap); no UIPadding on it.
		if (results.rows.size() > 1) {
			const list = make("ScrollingFrame", body, {
				Name: "Players",
				Size: new UDim2(1, 0, 0, 150),
				BackgroundTransparency: 1,
				BorderSizePixel: 0,
				CanvasSize: UDim2.fromOffset(0, 0),
				AutomaticCanvasSize: Enum.AutomaticSize.Y,
				ScrollingDirection: Enum.ScrollingDirection.Y,
				VerticalScrollBarInset: Enum.ScrollBarInset.Always,
				ScrollBarThickness: 6,
				ElasticBehavior: Enum.ElasticBehavior.WhenScrollable,
				LayoutOrder: 6,
			});
			column(list, 4);
			const me = Players.LocalPlayer.UserId;
			results.rows.forEach((entry, index) => {
				const line = panel(list, `Row${index + 1}`, PALETTE.white, {
					Size: new UDim2(1, 0, 0, 10000),
					BackgroundTransparency: entry.userId === me ? 0.75 : 0.9,
					LayoutOrder: index + 1,
				});
				const ratio = aspect(line, 9);
				ratio.DominantAxis = Enum.DominantAxis.Width;
				corner(line, new UDim(0.3, 0));
				const badge = rankBadge(line, UDim2.fromScale(0.11, 0.8), index + 1);
				badge.AnchorPoint = new Vector2(0, 0.5);
				badge.Position = UDim2.fromScale(0.015, 0.5);
				make("TextLabel", line, {
					BackgroundTransparency: 1,
					Position: UDim2.fromScale(0.14, 0.12),
					Size: UDim2.fromScale(0.56, 0.76),
					Font: FONT_BOLD,
					TextScaled: true,
					TextColor3: PALETTE.white,
					TextXAlignment: Enum.TextXAlignment.Left,
					TextTruncate: Enum.TextTruncate.AtEnd,
					Text: entry.name,
				});
				make("TextLabel", line, {
					BackgroundTransparency: 1,
					AnchorPoint: new Vector2(1, 0),
					Position: UDim2.fromScale(0.97, 0.1),
					Size: UDim2.fromScale(0.26, 0.8),
					Font: FONT_TITLE,
					TextScaled: true,
					TextColor3: PALETTE.lemon,
					TextXAlignment: Enum.TextXAlignment.Right,
					Text: formatNumber(entry.score),
				});
			});
		}

		// Auto-close bar (a progress fill: the one place a Size tween is right).
		const track = panel(body, "Timer", PALETTE.white, { Size: new UDim2(1, 0, 0, 5), BackgroundTransparency: 0.85, LayoutOrder: 9 });
		corner(track);
		const fill = panel(track, "Fill", PALETTE.lavender, { Size: UDim2.fromScale(1, 1) });
		corner(fill);
		const seconds = math.max(RESULTS_SECONDS - 1, 3);
		TweenService.Create(fill, new TweenInfo(seconds, Enum.EasingStyle.Linear), { Size: UDim2.fromScale(0, 1) }).Play();

		const close = make("TextButton", card, {
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
		stroke(close, PALETTE.lavender, 2);
		crossIcon(close, UDim2.fromScale(0.6, 0.6), PALETTE.white).Position = UDim2.fromScale(0.2, 0.2);

		let finished = false;
		const finish = () => {
			if (finished) return;
			finished = true;
			this.memo.shownRound = results.round;
			close.Active = false;
			TweenService.Create(dim, new TweenInfo(0.15), { BackgroundTransparency: 1 }).Play();
			popOut(card, () => {
				this.trove.remove(popup);
				done();
			});
		};
		popup.connect(close.Activated, finish);
		popup.add(task.delay(seconds, finish));
		popup.add(
			listen(
				() => this.state.phase().phase,
				(phase) => {
					if (phase !== "results") finish();
				},
			),
		);
		popIn(card);
		this.ui.sound("whoosh", 1.25, 0.5);
	}
}
