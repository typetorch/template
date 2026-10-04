import { Players } from "@rbxts/services";
import { Controller, Module, TypeTorch, type OnStart } from "@typetorch/framework";
import { PALETTE } from "../../../shared/rush/palette";
import { corner, FONT_MONO, make, pad, panel } from "../../../shared/ui/kit";
import { UiController } from "../ui/ui.controller";

/**
 * Devs only (`TypeTorch.isDev`, cosmetic on the client: the server re-checks everything): a one-line overlay in the
 * bottom-left corner with the running generation, branch and channel, artifact, and how this generation started. It
 * follows dev status changes live (`TypeTorch.onPlayerDevChanged`).
 */
@Controller()
export class DevOverlayController extends Module implements OnStart {
	constructor(private readonly ui: UiController) {
		super();
	}

	onStart() {
		const start = TypeTorch.startInfo;
		const artifact = TypeTorch.artifact;
		const parts = [
			`gen ${TypeTorch.generation}`,
			`${TypeTorch.branch} (${TypeTorch.channel})`,
			artifact.seq !== undefined ? `#${artifact.seq} ${artifact.id}` : artifact.id,
			start.kind === "swap" ? `${start.reason}${start.previous ? ` from ${start.previous.artifact.id}` : ""}` : start.kind,
		];
		if (TypeTorch.isPinned()) parts.push("pinned");

		const chip = panel(this.ui.overlay, "DevOverlay", PALETTE.ink, {
			AnchorPoint: new Vector2(0, 1),
			Position: new UDim2(0, 4, 1, -4),
			Size: UDim2.fromOffset(0, 18),
			AutomaticSize: Enum.AutomaticSize.X,
			BackgroundTransparency: 0.35,
			Visible: false,
		});
		corner(chip, new UDim(0, 6));
		pad(chip, 8, 0);
		make("TextLabel", chip, {
			BackgroundTransparency: 1,
			Size: UDim2.fromOffset(0, 18),
			AutomaticSize: Enum.AutomaticSize.X,
			Font: FONT_MONO,
			TextSize: 12,
			TextColor3: PALETTE.silver,
			Text: parts.join("  |  "),
		});

		const player = Players.LocalPlayer;
		const refresh = () => (chip.Visible = TypeTorch.isDev(player));
		refresh();
		this.trove.add(TypeTorch.onPlayerDevChanged(() => refresh()));
	}
}
