import { Players, Workspace } from "@rbxts/services";
import { Controller, Module, observeElement, type OnRender, type OnStart } from "@typetorch/framework";
import { EVENTS } from "../../../shared/analytics/catalog";
import { PAD_RADIUS } from "../../../shared/rush/config";
import { PALETTE } from "../../../shared/rush/palette";
import { PAD_TAG } from "../../../shared/rush/types";
import { make } from "../../../shared/ui/kit";
import { AnalyticsController } from "../analytics/analytics.controller";
import { RushStateController } from "./rush-state.controller";

const CHEVRONS = 3;
const SPACING = 3.2;
/** The first chevron's distance ahead of the character. */
const LEAD = 2.6;
const ARM_LENGTH = 1.9;
const ARM_ANGLE = math.rad(38);

/**
 * Experiment onboarding_hint, variant "arrow": glowing chevrons on the floor march from the player toward the start
 * pad, in the lobby, until the player has stepped on the pad once this session (the server sets the FoundPad
 * attribute with the onboarding step reached_pad). Variant "none" (the control) keeps only the pad's START sign and
 * the HUD pill everyone has. Local parts only: the server and other players never see them.
 */
@Controller()
export class GuideController extends Module implements OnStart, OnRender {
	private arms = new Array<Part>();
	private pad?: BasePart;
	private arrow = false;
	private found = false;
	private shown = false;

	constructor(
		private readonly state: RushStateController,
		private readonly analytics: AnalyticsController,
	) {
		super();
	}

	onStart() {
		const folder = this.trove.add(make("Folder", Workspace, { Name: "TargetRushGuide" }));
		for (let index = 0; index < CHEVRONS * 2; index++) {
			this.arms.push(
				make("Part", folder, {
					Name: "Chevron",
					Anchored: true,
					CanCollide: false,
					CanQuery: false,
					CanTouch: false,
					CastShadow: false,
					Material: Enum.Material.Neon,
					Color: PALETTE.hotPink,
					Size: new Vector3(0.45, 0.12, ARM_LENGTH),
					Transparency: 1,
				}),
			);
		}
		observeElement<BasePart>(this.trove, PAD_TAG, (pad, elementTrove) => {
			if (!pad.IsA("BasePart")) return;
			this.pad = pad;
			elementTrove.add(() => {
				if (this.pad === pad) this.pad = undefined;
			});
		});
		this.analytics.observeVariant(this.trove, "onboarding_hint", (variant) => (this.arrow = variant === "arrow"));
		const player = Players.LocalPlayer;
		this.found = player.GetAttribute("FoundPad") === true;
		this.trove.connect(player.GetAttributeChangedSignal("FoundPad"), () => (this.found = player.GetAttribute("FoundPad") === true));
	}

	onRender() {
		const pad = this.pad;
		const root = Players.LocalPlayer.Character?.FindFirstChild("HumanoidRootPart") as BasePart | undefined;
		const lobby = this.state.ready() && this.state.phase().phase === "lobby";
		if (!this.arrow || this.found || !lobby || !pad || !root) return this.hide();

		// The pad is a cylinder lying on its side: its X axis points up, so its top is half its X size above the middle.
		const floorY = pad.Position.Y + pad.Size.X / 2 - 0.3;
		const offset = new Vector3(pad.Position.X - root.Position.X, 0, pad.Position.Z - root.Position.Z);
		const distance = offset.Magnitude;
		if (distance < PAD_RADIUS + 1) return this.hide();
		if (!this.shown) {
			this.shown = true;
			if (this.analytics.once(EVENTS.guideShown)) this.analytics.track(EVENTS.guideShown, { distance: math.floor(distance) });
		}
		const direction = offset.Unit;
		// The chevrons march toward the pad: the first fades in as it leaves the player, the last fades out.
		const step = ((os.clock() * 3) % SPACING) / SPACING;
		for (let index = 0; index < CHEVRONS; index++) {
			const along = LEAD + (index + step) * SPACING;
			let opacity = 0.85 * math.clamp((distance - PAD_RADIUS - along) / 3, 0, 1); // gone before the pad
			if (index === 0) opacity *= step;
			if (index === CHEVRONS - 1) opacity *= 1 - step;
			const tip = new Vector3(root.Position.X, floorY, root.Position.Z).add(direction.mul(along));
			const facing = CFrame.lookAt(tip, tip.add(direction));
			const transparency = 1 - opacity;
			for (const side of [-1, 1]) {
				const arm = this.arms[index * 2 + (side < 0 ? 0 : 1)];
				arm.CFrame = facing.mul(CFrame.Angles(0, side * ARM_ANGLE, 0)).mul(new CFrame(0, 0, ARM_LENGTH / 2));
				arm.Transparency = transparency;
			}
		}
	}

	private hide() {
		for (const arm of this.arms) if (arm.Transparency !== 1) arm.Transparency = 1;
	}
}
