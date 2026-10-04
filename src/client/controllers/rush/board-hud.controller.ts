import { listen } from "@rbxts/charm";
import { Players } from "@rbxts/services";
import { Controller, Module, type OnStart } from "@typetorch/framework";
import { PALETTE } from "../../../shared/rush/palette";
import { formatNumber } from "../../../shared/rush/rules";
import type { BoardRow } from "../../../shared/rush/types";
import { clockIcon, crownIcon, rankBadge, setRank } from "../../../shared/ui/icons";
import { box, column, corner, FONT_BOLD, FONT_TITLE, make, pad, panel, row, stroke, text } from "../../../shared/ui/kit";
import { UiController } from "../ui/ui.controller";
import { RushStateController } from "./rush-state.controller";

const ROWS = 5;

interface Line {
	frame: Frame;
	badge: Frame;
	name: TextLabel;
	score: TextLabel;
	outline: UIStroke;
}

/**
 * The session leaderboard in the HUD (the world board shows the same rows): live round scores while a round is on,
 * the session's best rounds in the lobby. Your own row is outlined.
 */
@Controller()
export class BoardHudController extends Module implements OnStart {
	private panel!: Frame;
	private liveIcon!: Frame;
	private bestIcon!: Frame;
	private word!: TextLabel;
	private readonly lines = new Array<Line>();

	constructor(
		private readonly ui: UiController,
		private readonly state: RushStateController,
	) {
		super();
	}

	onStart() {
		this.build();
		this.trove.add(
			listen(
				() => {
					const phase = this.state.phase().phase;
					const showLive = phase !== "lobby";
					return { showLive, rows: showLive ? this.state.live() : this.state.session() };
				},
				({ showLive, rows }) => this.draw(showLive, rows),
			),
		);
	}

	private draw(showLive: boolean, rows: BoardRow[]) {
		this.panel.Visible = rows.size() > 0;
		this.liveIcon.Visible = showLive;
		this.bestIcon.Visible = !showLive;
		this.word.Text = showLive ? "LIVE" : "BEST";
		const me = Players.LocalPlayer.UserId;
		this.lines.forEach((line, index) => {
			const entry = rows[index];
			line.frame.Visible = entry !== undefined;
			if (!entry) return;
			setRank(line.badge, index + 1);
			line.name.Text = entry.name;
			line.score.Text = formatNumber(entry.score);
			line.outline.Enabled = entry.userId === me;
		});
	}

	private build() {
		const board = panel(this.ui.hud, "Board", PALETTE.ink, {
			AnchorPoint: new Vector2(1, 0.5),
			Position: new UDim2(1, -10, 0.42, 0),
			Size: UDim2.fromOffset(214, 0),
			AutomaticSize: Enum.AutomaticSize.Y,
			BackgroundTransparency: 0.25,
			Visible: false,
		});
		corner(board, new UDim(0, 14));
		pad(board, 8, 8);
		column(board, 4);

		const head = box(board, "Head", { Size: new UDim2(1, 0, 0, 26), LayoutOrder: 0 });
		row(head, 6);
		this.liveIcon = clockIcon(head, UDim2.fromOffset(22, 22), PALETTE.mint, 2.5);
		this.liveIcon.LayoutOrder = 1;
		this.bestIcon = crownIcon(head, UDim2.fromOffset(24, 24));
		this.bestIcon.LayoutOrder = 1;
		this.word = text(head, "Word", "LIVE", 20, FONT_TITLE, PALETTE.cream, { LayoutOrder: 2 });

		for (let index = 1; index <= ROWS; index++) {
			const frame = panel(board, `Row${index}`, PALETTE.white, {
				Size: new UDim2(1, 0, 0, 30),
				BackgroundTransparency: 0.9,
				LayoutOrder: index,
				Visible: false,
			});
			corner(frame, new UDim(0, 10));
			const outline = stroke(frame, PALETTE.lemon, 2);
			outline.Enabled = false;
			const badge = rankBadge(frame, UDim2.fromOffset(24, 24), index);
			badge.AnchorPoint = new Vector2(0, 0.5);
			badge.Position = new UDim2(0, 4, 0.5, 0);
			const name = make("TextLabel", frame, {
				Name: "Name",
				BackgroundTransparency: 1,
				Position: UDim2.fromOffset(34, 0),
				Size: new UDim2(1, -100, 1, 0),
				Font: FONT_BOLD,
				TextSize: 16,
				TextColor3: PALETTE.white,
				TextXAlignment: Enum.TextXAlignment.Left,
				TextTruncate: Enum.TextTruncate.AtEnd,
			});
			const score = make("TextLabel", frame, {
				Name: "Score",
				BackgroundTransparency: 1,
				AnchorPoint: new Vector2(1, 0),
				Position: new UDim2(1, -6, 0, 0),
				Size: UDim2.fromOffset(62, 30),
				Font: FONT_TITLE,
				TextSize: 18,
				TextColor3: PALETTE.lemon,
				TextXAlignment: Enum.TextXAlignment.Right,
			});
			this.lines.push({ frame, badge, name, score, outline });
		}
		this.panel = board;
	}
}
