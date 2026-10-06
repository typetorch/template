import { listen } from "@rbxts/charm";
import { Workspace } from "@rbxts/services";
import { bump, Controller, Module, popIn, popOut, type OnRender, type OnStart } from "@typetorch/framework";
import { HUD_SCREENS } from "../../../shared/analytics/catalog";
import { COMBO_WINDOW } from "../../../shared/rush/config";
import { PALETTE } from "../../../shared/rush/palette";
import { formatNumber } from "../../../shared/rush/rules";
import type { MyStats, Phase, PhaseInfo } from "../../../shared/rush/types";
import { chevronIcon, clockIcon, comboIcon, crownIcon, targetIcon } from "../../../shared/ui/icons";
import { box, column, corner, FONT_BOLD, FONT_TITLE, make, pad, panel, row, stroke, text, textStroke } from "../../../shared/ui/kit";
import { UiController } from "../ui/ui.controller";
import { RushStateController } from "./rush-state.controller";

const PHASE_COLORS: Record<Phase, Color3> = {
	lobby: PALETTE.sky,
	countdown: PALETTE.lemon,
	round: PALETTE.mint,
	results: PALETTE.lavender,
};

/**
 * The Target Rush HUD, drawn from the state atoms: a timer bar for every phase, big countdown numbers, the score with
 * a combo meter that drains, the personal best, and a lobby hint pointing at the start pad. Few words, mostly shapes.
 */
@Controller()
export class RushHudController extends Module implements OnStart, OnRender {
	private timer!: Frame;
	private timerFill!: Frame;
	private timerSeconds!: TextLabel;
	private roundLabel!: TextLabel;
	private big!: TextLabel;
	private scorePanel!: Frame;
	private scoreLabel!: TextLabel;
	private comboChip!: Frame;
	private comboLabel!: TextLabel;
	private comboCount!: TextLabel;
	private comboFill!: Frame;
	private bestLabel!: TextLabel;
	private hint!: Frame;
	private lastCount = -1;
	private lastTick = -1;
	private bigUntil = 0;
	private bigShown = false;

	constructor(
		private readonly ui: UiController,
		private readonly state: RushStateController,
	) {
		super();
	}

	onStart() {
		this.buildTimer();
		this.buildScore();
		this.buildHint();
		this.big = text(this.ui.hud, "Big", "", 110, FONT_TITLE, PALETTE.white, {
			AnchorPoint: new Vector2(0.5, 0.5),
			Position: UDim2.fromScale(0.5, 0.38),
			Visible: false,
			ZIndex: 3,
		});
		textStroke(this.big, PALETTE.hotPink, 5);

		this.trove.add(listen(() => this.state.phase(), (info, previous) => this.onPhase(info, previous)));
		this.trove.add(listen(() => this.state.me(), (me, previous) => this.showMe(me, previous)));
		this.trove.add(listen(() => this.state.ready(), (ready) => (this.timer.Visible = ready)));

		// Analytics screens: one HUD screen per phase (LobbyHud, CountdownHud, RoundHud, ResultsHud), from the first
		// real phase on (not the placeholder before the snapshot). Cards (Results, Shop) open above them.
		const markers = new Map<Phase, Frame>();
		for (const [phase, name] of pairs(HUD_SCREENS)) markers.set(phase, this.ui.screenMarker(name));
		this.trove.add(
			listen(
				() => (this.state.ready() ? this.state.phase().phase : undefined),
				(phase) => {
					for (const [markerPhase, marker] of markers) marker.Visible = markerPhase === phase;
				},
			),
		);
	}

	onRender() {
		const info = this.state.phase();
		const now = Workspace.GetServerTimeNow();
		const total = math.max(info.endsAt - info.startedAt, 0.001);
		const left = math.max(info.endsAt - now, 0);
		// A progress fill is the one place a Size change is right.
		this.timerFill.Size = UDim2.fromScale(math.clamp(left / total, 0, 1), 1);
		this.timerSeconds.Text = tostring(math.ceil(left));
		const urgent = info.phase === "round" && left <= 10;
		this.timerFill.BackgroundColor3 = urgent ? PALETTE.red : PHASE_COLORS[info.phase];

		const count = math.ceil(left);
		if (info.phase === "countdown" && count !== this.lastCount && count > 0) {
			this.flash(tostring(count), PALETTE.white, 1.2);
			this.ui.sound("tick", 0.9, 0.6);
		}
		if (urgent && count !== this.lastTick && count <= 5 && count > 0) {
			this.lastTick = count;
			this.ui.sound("tick", 0.75, 0.45);
			bump(this.timer);
		}
		this.lastCount = count;
		if (this.bigShown && os.clock() > this.bigUntil && info.phase !== "countdown") {
			this.bigShown = false;
			popOut(this.big);
		}

		// The combo meter drains until the combo runs out.
		const me = this.state.me();
		const comboLeft = me.comboEndsAt - now;
		const comboLive = me.combo > 0 && comboLeft > 0;
		this.comboChip.Visible = comboLive;
		if (comboLive) this.comboFill.Size = UDim2.fromScale(math.clamp(comboLeft / COMBO_WINDOW, 0, 1), 1);
	}

	private onPhase(info: PhaseInfo, previous?: PhaseInfo) {
		this.roundLabel.Text = info.round > 0 ? `ROUND ${info.round}` : "";
		const changed = previous === undefined || previous.phase !== info.phase;
		if (!changed) return;
		this.hint.Visible = info.phase === "lobby";
		if (info.phase === "lobby") popIn(this.hint);
		if (info.phase === "round" && previous?.phase === "countdown") {
			this.flash("GO!", PALETTE.lemon, 0.8);
			this.ui.sound("whoosh", 1.1, 0.6);
		}
		if (info.phase === "results" && previous?.phase === "round") {
			this.flash("TIME!", PALETTE.pink, 1);
			this.ui.sound("whoosh", 0.8, 0.6);
		}
		this.lastTick = -1;
	}

	private flash(value: string, color: Color3, seconds: number) {
		this.big.Text = value;
		this.big.TextColor3 = color;
		this.bigUntil = os.clock() + seconds;
		if (this.bigShown) bump(this.big);
		else popIn(this.big);
		this.bigShown = true;
	}

	private showMe(me: MyStats, previous?: MyStats) {
		this.scoreLabel.Text = formatNumber(me.score);
		this.bestLabel.Text = formatNumber(me.personalBest);
		this.comboLabel.Text = `x${me.multiplier}`;
		this.comboCount.Text = tostring(me.combo);
		if (previous && me.score > previous.score) bump(this.scorePanel);
		if (previous && me.multiplier > previous.multiplier) bump(this.comboChip);
	}

	private buildTimer() {
		const timer = box(this.ui.hud, "Timer", {
			AnchorPoint: new Vector2(0.5, 0),
			Position: new UDim2(0.5, 0, 0, 8),
			Size: UDim2.fromOffset(400, 52),
			Visible: false,
		});
		const bar = panel(timer, "Bar", PALETTE.ink, { Size: UDim2.fromOffset(400, 36), BackgroundTransparency: 0.15 });
		corner(bar);
		stroke(bar, PALETTE.white, 2, 0.6);
		clockIcon(bar, UDim2.fromOffset(26, 26), PALETTE.white, 2.5).Position = UDim2.fromOffset(8, 5);
		const track = panel(bar, "Track", PALETTE.white, {
			AnchorPoint: new Vector2(0, 0.5),
			Position: new UDim2(0, 42, 0.5, 0),
			Size: new UDim2(1, -100, 0, 14),
			BackgroundTransparency: 0.82,
		});
		corner(track);
		this.timerFill = panel(track, "Fill", PALETTE.sky, { Size: UDim2.fromScale(1, 1) });
		corner(this.timerFill);
		this.timerSeconds = make("TextLabel", bar, {
			Name: "Seconds",
			BackgroundTransparency: 1,
			AnchorPoint: new Vector2(1, 0.5),
			Position: new UDim2(1, -10, 0.5, 0),
			Size: UDim2.fromOffset(46, 30),
			Font: FONT_TITLE,
			TextSize: 26,
			TextColor3: PALETTE.white,
			TextXAlignment: Enum.TextXAlignment.Right,
			Text: "",
		});
		this.roundLabel = text(timer, "Round", "", 15, FONT_BOLD, PALETTE.cream, {
			AnchorPoint: new Vector2(0.5, 0),
			Position: new UDim2(0.5, 0, 0, 37),
			TextTransparency: 0.15,
		});
		textStroke(this.roundLabel, PALETTE.ink, 1.5);
		this.timer = timer;
	}

	private buildScore() {
		// Left side, below the dev menu button's spot and above the mobile thumbstick.
		const scorePanel = panel(this.ui.hud, "Score", PALETTE.ink, {
			Position: new UDim2(0, 10, 0.22, 0),
			Size: UDim2.fromOffset(0, 0),
			AutomaticSize: Enum.AutomaticSize.XY,
			BackgroundTransparency: 0.2,
		});
		corner(scorePanel, new UDim(0, 16));
		pad(scorePanel, 12, 8);
		column(scorePanel, 4, Enum.HorizontalAlignment.Left);

		const scoreRow = box(scorePanel, "ScoreRow", { Size: UDim2.fromOffset(0, 40), AutomaticSize: Enum.AutomaticSize.X, LayoutOrder: 1 });
		row(scoreRow, 8);
		targetIcon(scoreRow, UDim2.fromOffset(30, 30)).LayoutOrder = 1;
		this.scoreLabel = text(scoreRow, "Value", "0", 34, FONT_TITLE, PALETTE.white, { LayoutOrder: 2 });

		// Combo: the multiplier chip, the count, and a meter that drains over COMBO_WINDOW.
		const combo = box(scorePanel, "Combo", { Size: UDim2.fromOffset(150, 30), LayoutOrder: 2, Visible: false });
		const chip = panel(combo, "Chip", PALETTE.lemon, { Size: UDim2.fromOffset(46, 26) });
		corner(chip);
		this.comboLabel = make("TextLabel", chip, {
			BackgroundTransparency: 1,
			Size: UDim2.fromScale(1, 1),
			Font: FONT_TITLE,
			TextSize: 20,
			TextColor3: PALETTE.ink,
			Text: "x1",
		});
		comboIcon(combo, UDim2.fromOffset(20, 20), PALETTE.lemon).Position = UDim2.fromOffset(52, 3);
		this.comboCount = make("TextLabel", combo, {
			BackgroundTransparency: 1,
			Position: UDim2.fromOffset(74, 0),
			Size: UDim2.fromOffset(70, 26),
			Font: FONT_TITLE,
			TextSize: 22,
			TextColor3: PALETTE.lemon,
			TextXAlignment: Enum.TextXAlignment.Left,
			Text: "0",
		});
		const track = panel(combo, "Track", PALETTE.white, {
			Position: UDim2.fromOffset(0, 27),
			Size: UDim2.fromOffset(150, 4),
			BackgroundTransparency: 0.8,
		});
		corner(track);
		this.comboFill = panel(track, "Fill", PALETTE.lemon, { Size: UDim2.fromScale(1, 1) });
		corner(this.comboFill);
		this.comboChip = combo;

		const best = box(scorePanel, "Best", { Size: UDim2.fromOffset(0, 24), AutomaticSize: Enum.AutomaticSize.X, LayoutOrder: 3 });
		row(best, 6);
		crownIcon(best, UDim2.fromOffset(22, 22)).LayoutOrder = 1;
		this.bestLabel = text(best, "Value", "0", 20, FONT_TITLE, PALETTE.cream, { LayoutOrder: 2 });
		this.scorePanel = scorePanel;
	}

	private buildHint() {
		// Lobby: a pink dot (the pad's color) and a short line. The pad itself has a bobbing arrow in the world.
		const hint = panel(this.ui.hud, "Hint", PALETTE.ink, {
			AnchorPoint: new Vector2(0.5, 1),
			Position: new UDim2(0.5, 0, 1, -34),
			Size: UDim2.fromOffset(0, 44),
			AutomaticSize: Enum.AutomaticSize.X,
			BackgroundTransparency: 0.15,
			Visible: false,
		});
		corner(hint);
		stroke(hint, PALETTE.hotPink, 2, 0.2);
		pad(hint, 16, 0);
		row(hint, 10);
		const dot = panel(hint, "Pad", PALETTE.hotPink, { Size: UDim2.fromOffset(24, 24), LayoutOrder: 1 });
		corner(dot);
		stroke(dot, PALETTE.white, 2);
		chevronIcon(hint, UDim2.fromOffset(22, 22), PALETTE.white).LayoutOrder = 0;
		text(hint, "Text", "Step on the pad", 22, FONT_BOLD, PALETTE.white, { LayoutOrder: 2 });
		this.hint = hint;
	}
}
