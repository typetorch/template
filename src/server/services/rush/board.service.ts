import { Module, Service, TypeTorch, type OnInit, type OnStart, type OnTick } from "@typetorch/framework";
import { network } from "../../../shared/net";
import { PALETTE } from "../../../shared/rush/palette";
import { formatNumber } from "../../../shared/rush/rules";
import type { BoardRow, Phase, PhaseInfo, ResultRow } from "../../../shared/rush/types";
import { clockIcon, crownIcon, rankBadge, refreshIcon, setRank, targetIcon } from "../../../shared/ui/icons";
import { box, column, corner, FONT_BOLD, FONT_MONO, FONT_TITLE, make, pad, panel, row, stroke, text, textStroke } from "../../../shared/ui/kit";
import { ArenaService } from "./arena.service";

/** Session bests, per server (plain data in persist: a hot-swap keeps the board). */
interface SessionEntry {
	name: string;
	best: number;
	bestCombo: number;
	rounds: number;
}

interface RowRefs {
	frame: Frame;
	badge: Frame;
	name: TextLabel;
	score: TextLabel;
}

const ROWS = 6;
const PHASE_WORDS: Record<Phase, string> = { lobby: "LOBBY", countdown: "READY", round: "GO!", results: "RESULTS" };
const PHASE_COLORS: Record<Phase, Color3> = {
	lobby: PALETTE.sky,
	countdown: PALETTE.lemon,
	round: PALETTE.mint,
	results: PALETTE.lavender,
};

/**
 * The session leaderboard: a SurfaceGui on the arena's board (live round scores and the session's best rounds) and the
 * same rows broadcast to every HUD. Updates are batched to at most four per second.
 */
@Service()
export class BoardService extends Module implements OnInit, OnStart, OnTick {
	private session!: Map<number, SessionEntry>;
	private live = new Array<BoardRow>();
	private phase?: PhaseInfo;
	private dirty = true;
	private nextFlush = 0;
	private liveRows = new Array<RowRefs>();
	private bestRows = new Array<RowRefs>();
	private roundLabel?: TextLabel;
	private phaseChip?: Frame;
	private phaseLabel?: TextLabel;
	private swapChip?: Frame;
	private swapLabel?: TextLabel;
	/** A deploy is on its way (TypeTorch.onUpdatePending): the footer says so until this generation is swapped out. */
	private updating = false;

	constructor(private readonly arena: ArenaService) {
		super();
	}

	onInit() {
		this.session = this.ctx.persist("rush.session.v1", () => new Map<number, SessionEntry>());
		this.trove.add(
			TypeTorch.onUpdatePending((update) => {
				this.updating = !update.cancelled;
				this.dirty = true;
			}),
		);
	}

	onStart() {
		this.build();
		this.flush();
	}

	onTick() {
		if (this.dirty && os.clock() >= this.nextFlush) this.flush();
	}

	setLive(rows: BoardRow[]) {
		this.live = rows;
		this.dirty = true;
	}

	setPhase(info: PhaseInfo) {
		this.phase = info;
		this.dirty = true;
	}

	/** Folds a finished round into the session bests. */
	recordRound(rows: ResultRow[]) {
		for (const result of rows) {
			const entry = this.session.get(result.userId) ?? { name: result.name, best: 0, bestCombo: 0, rounds: 0 };
			entry.name = result.name;
			entry.best = math.max(entry.best, result.score);
			entry.bestCombo = math.max(entry.bestCombo, result.bestCombo);
			entry.rounds += 1;
			this.session.set(result.userId, entry);
		}
		this.dirty = true;
	}

	sessionTop(): BoardRow[] {
		const rows = new Array<BoardRow>();
		for (const [userId, entry] of this.session) {
			if (entry.best > 0) rows.push({ userId, name: entry.name, score: entry.best, combo: entry.bestCombo });
		}
		rows.sort((a, b) => a.score > b.score);
		while (rows.size() > 8) rows.pop();
		return rows;
	}

	private flush() {
		this.dirty = false;
		this.nextFlush = os.clock() + 0.25;
		const session = this.sessionTop();
		this.render(this.liveRows, this.live);
		this.render(this.bestRows, session);
		const info = this.phase;
		if (info && this.roundLabel && this.phaseLabel && this.phaseChip && this.swapChip && this.swapLabel) {
			this.roundLabel.Text = info.round > 0 ? `ROUND ${info.round}` : "";
			this.phaseLabel.Text = PHASE_WORDS[info.phase];
			this.phaseChip.BackgroundColor3 = PHASE_COLORS[info.phase];
			this.swapChip.Visible = this.updating || (info.swaps > 0 && info.phase !== "lobby");
			this.swapLabel.Text = this.updating ? "Updating..." : `Updated live x${info.swaps}`;
			this.swapLabel.TextColor3 = this.updating ? PALETTE.lemon : PALETTE.mint;
		}
		network.server.rush.board.fireAll(this.live, session);
	}

	private render(refs: RowRefs[], rows: BoardRow[]) {
		refs.forEach((ref, index) => {
			const entry = rows[index];
			ref.frame.Visible = entry !== undefined;
			if (!entry) return;
			setRank(ref.badge, index + 1);
			ref.name.Text = entry.name;
			ref.score.Text = formatNumber(entry.score);
		});
	}

	/** The SurfaceGui: built per generation (it's in this module's trove), on the board part the arena hands over. */
	private build() {
		const gui = this.trove.add(
			make("SurfaceGui", undefined, {
				Name: "TargetRushBoard",
				Face: Enum.NormalId.Front,
				SizingMode: Enum.SurfaceGuiSizingMode.PixelsPerStud,
				PixelsPerStud: 50,
				LightInfluence: 0,
				MaxDistance: 300,
				ZIndexBehavior: Enum.ZIndexBehavior.Sibling,
			}),
		);
		const root = box(gui, "Root", { Size: UDim2.fromScale(1, 1) });
		pad(root, 34, 26);

		// Header: icon + title on the left, round and phase on the right.
		const header = box(root, "Header", { Size: new UDim2(1, 0, 0, 104) });
		const title = box(header, "Title", { Size: UDim2.fromScale(0.62, 1) });
		row(title, 18);
		targetIcon(title, UDim2.fromOffset(84, 84)).LayoutOrder = 1;
		const titleText = text(title, "Text", "TARGET RUSH", 84, FONT_TITLE, PALETTE.white, { LayoutOrder: 2 });
		textStroke(titleText, PALETTE.hotPink, 4);
		const status = box(header, "Status", { Size: UDim2.fromScale(0.38, 1), Position: UDim2.fromScale(0.62, 0) });
		row(status, 16, Enum.HorizontalAlignment.Right);
		this.roundLabel = text(status, "Round", "", 46, FONT_BOLD, PALETTE.cream, { LayoutOrder: 1 });
		const chip = panel(status, "Phase", PALETTE.sky, { Size: UDim2.fromOffset(0, 70), AutomaticSize: Enum.AutomaticSize.X, LayoutOrder: 2 });
		corner(chip);
		pad(chip, 26, 0);
		this.phaseLabel = text(chip, "Label", "LOBBY", 48, FONT_TITLE, PALETTE.ink, { Size: UDim2.fromScale(0, 1) });
		this.phaseChip = chip;

		// Two columns: live round scores and the session's best rounds.
		const columns = box(root, "Columns", { Size: new UDim2(1, 0, 1, -184), Position: UDim2.fromOffset(0, 118) });
		row(columns, 30, Enum.HorizontalAlignment.Center);
		this.liveRows = this.buildColumn(columns, "Live", "LIVE", 1, (parent) => clockIcon(parent, UDim2.fromOffset(52, 52), PALETTE.mint, 5));
		this.bestRows = this.buildColumn(columns, "Best", "BEST", 2, (parent) => crownIcon(parent, UDim2.fromOffset(56, 56)));

		// Footer: hot-swap proof for everyone (updates survived this round) and the running build, small.
		const footer = box(root, "Footer", { Size: new UDim2(1, 0, 0, 52), Position: new UDim2(0, 0, 1, -52) });
		const swapChip = panel(footer, "Swaps", PALETTE.ink, { Size: UDim2.fromOffset(0, 52), AutomaticSize: Enum.AutomaticSize.X, Visible: false });
		corner(swapChip);
		pad(swapChip, 18, 0);
		row(swapChip, 10);
		refreshIcon(swapChip, UDim2.fromOffset(38, 38), PALETTE.mint, 5).LayoutOrder = 1;
		this.swapLabel = text(swapChip, "Label", "", 32, FONT_BOLD, PALETTE.mint, { LayoutOrder: 2 });
		this.swapChip = swapChip;
		const artifact = TypeTorch.artifact;
		text(footer, "Build", `gen ${TypeTorch.generation} | ${artifact.id}`, 28, FONT_MONO, PALETTE.grey, {
			AnchorPoint: new Vector2(1, 0.5),
			Position: UDim2.fromScale(1, 0.5),
			TextTransparency: 0.2,
		});

		gui.Parent = this.arena.board;
	}

	private buildColumn(parent: Instance, name: string, word: string, order: number, icon: (parent: Instance) => Frame): RowRefs[] {
		const frame = panel(parent, name, PALETTE.ink, { Size: new UDim2(0.5, -15, 1, 0), LayoutOrder: order, BackgroundTransparency: 0.25 });
		corner(frame, new UDim(0, 28));
		stroke(frame, PALETTE.lavender, 3, 0.4);
		pad(frame, 22, 14);
		column(frame, 6, Enum.HorizontalAlignment.Center);
		const head = box(frame, "Head", { Size: new UDim2(1, 0, 0, 62), LayoutOrder: 0 });
		row(head, 12);
		icon(head).LayoutOrder = 1;
		text(head, "Word", word, 44, FONT_TITLE, PALETTE.cream, { LayoutOrder: 2 });

		const refs = new Array<RowRefs>();
		for (let index = 1; index <= ROWS; index++) {
			const line = panel(frame, `Row${index}`, PALETTE.white, {
				Size: new UDim2(1, 0, 0, 58),
				BackgroundTransparency: index % 2 === 0 ? 0.94 : 0.88,
				LayoutOrder: index,
				Visible: false,
			});
			corner(line, new UDim(0, 16));
			const badge = rankBadge(line, UDim2.fromOffset(46, 46), index);
			badge.AnchorPoint = new Vector2(0, 0.5);
			badge.Position = new UDim2(0, 8, 0.5, 0);
			const nameLabel = make("TextLabel", line, {
				Name: "Name",
				BackgroundTransparency: 1,
				Position: UDim2.fromOffset(66, 0),
				Size: new UDim2(1, -230, 1, 0),
				Font: FONT_BOLD,
				TextSize: 36,
				TextColor3: PALETTE.white,
				TextXAlignment: Enum.TextXAlignment.Left,
				TextTruncate: Enum.TextTruncate.AtEnd,
			});
			const scoreLabel = make("TextLabel", line, {
				Name: "Score",
				BackgroundTransparency: 1,
				AnchorPoint: new Vector2(1, 0),
				Position: new UDim2(1, -14, 0, 0),
				Size: new UDim2(0, 150, 1, 0),
				Font: FONT_TITLE,
				TextSize: 40,
				TextColor3: PALETTE.lemon,
				TextXAlignment: Enum.TextXAlignment.Right,
			});
			refs.push({ frame: line, badge, name: nameLabel, score: scoreLabel });
		}
		return refs;
	}
}
