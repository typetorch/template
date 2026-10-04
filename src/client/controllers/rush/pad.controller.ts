import { listen } from "@rbxts/charm";
import { Workspace } from "@rbxts/services";
import { Trove } from "@rbxts/trove";
import { Controller, Module, observeElement, type OnRender, type OnStart } from "@typetorch/framework";
import { PAD_HOLD_SECONDS } from "../../../shared/rush/config";
import { PALETTE } from "../../../shared/rush/palette";
import { PAD_TAG } from "../../../shared/rush/types";
import { chevronIcon } from "../../../shared/ui/icons";
import { box, FONT_TITLE, make, text, textStroke } from "../../../shared/ui/kit";
import { RushStateController } from "./rush-state.controller";

interface PadVisual {
	readonly pad: BasePart;
	readonly sign: BillboardGui;
	readonly fill: Part;
	readonly radius: number;
}

/**
 * Lobby hints on the start pad, client-side only: a bobbing "START" sign with an arrow, and a fill that grows while
 * someone stands on it (the server sets the pad's HeldSince attribute; the countdown starts when it is full).
 */
@Controller()
export class PadController extends Module implements OnStart, OnRender {
	private readonly pads = new Set<PadVisual>();
	private lobby = true;

	constructor(private readonly state: RushStateController) {
		super();
	}

	onStart() {
		observeElement<BasePart>(this.trove, PAD_TAG, (pad, elementTrove) => this.track(pad, elementTrove));
		this.trove.add(
			listen(
				() => this.state.phase().phase,
				(phase) => {
					this.lobby = phase === "lobby";
					for (const visual of this.pads) visual.sign.Enabled = this.lobby;
				},
			),
		);
	}

	onRender() {
		const now = Workspace.GetServerTimeNow();
		for (const visual of this.pads) {
			visual.sign.StudsOffsetWorldSpace = new Vector3(0, 6.5 + math.sin(os.clock() * 3) * 0.5, 0);
			const since = visual.pad.GetAttribute("HeldSince");
			const progress = this.lobby && typeIs(since, "number") && since > 0 ? math.clamp((now - since) / PAD_HOLD_SECONDS, 0, 1) : 0;
			const diameter = math.max(visual.radius * 2 * progress, 0.01);
			visual.fill.Size = new Vector3(0.12, diameter, diameter);
			visual.fill.Transparency = progress > 0 ? 0.15 : 1;
		}
	}

	private track(pad: BasePart, elementTrove: Trove) {
		if (!pad.IsA("BasePart")) return;
		const radius = pad.GetAttribute("Radius");
		const sign = elementTrove.add(
			make("BillboardGui", pad, {
				Name: "StartSign",
				Adornee: pad,
				Size: UDim2.fromOffset(170, 130),
				StudsOffsetWorldSpace: new Vector3(0, 6.5, 0),
				LightInfluence: 0,
				MaxDistance: 220,
				Enabled: this.lobby,
			}),
		);
		const label = text(sign, "Text", "START", 40, FONT_TITLE, PALETTE.white, {
			AnchorPoint: new Vector2(0.5, 0),
			Position: UDim2.fromScale(0.5, 0),
		});
		textStroke(label, PALETTE.hotPink, 3);
		const arrow = box(sign, "Arrow", { AnchorPoint: new Vector2(0.5, 1), Position: UDim2.fromScale(0.5, 1), Size: UDim2.fromOffset(70, 70) });
		chevronIcon(arrow, UDim2.fromScale(1, 1), PALETTE.hotPink, 90);

		// The hold fill: a thin glowing disc on the pad (local only, the server never sees it).
		const top = pad.CFrame.mul(new CFrame(pad.Size.X / 2 + 0.07, 0, 0));
		const fill = elementTrove.add(
			make("Part", Workspace, {
				Name: "PadFill",
				Anchored: true,
				CanCollide: false,
				CanQuery: false,
				CanTouch: false,
				CastShadow: false,
				Shape: Enum.PartType.Cylinder,
				Material: Enum.Material.Neon,
				Color: PALETTE.lemon,
				Transparency: 1,
				Size: new Vector3(0.12, 0.01, 0.01),
				CFrame: top,
			}),
		);
		const visual: PadVisual = { pad, sign, fill, radius: typeIs(radius, "number") ? radius : 5 };
		this.pads.add(visual);
		elementTrove.add(() => this.pads.delete(visual));
	}
}
