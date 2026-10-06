import { Debris, Players, SoundService } from "@rbxts/services";
import { Controller, Module, popIn, popOut, PopupQueue, type OnInit } from "@typetorch/framework";
import { PALETTE } from "../../../shared/rush/palette";
import { box, column, corner, FONT_BOLD, FONT_BODY, make, pad, panel, row, stroke, text } from "../../../shared/ui/kit";
import { tagScreen } from "../../ui/screens";

/** Sounds that ship with every Roblox client (rbxasset://), so the game uploads nothing. */
const SOUNDS = {
	tick: "rbxasset://sounds/volume_slider.ogg",
	whoosh: "rbxasset://sounds/action_jump.mp3",
	thud: "rbxasset://sounds/action_jump_land.mp3",
	splash: "rbxasset://sounds/impact_water.mp3",
};
export type SoundName = keyof typeof SOUNDS;

export interface ToastOptions {
	/** Draws the icon into the given box. */
	icon?: (parent: Instance) => GuiObject;
	text: string;
	detail?: string;
	color?: Color3;
	/** Auto-close after this long; omit to keep it until `close()`. */
	seconds?: number;
}

export interface Toast {
	readonly frame: Frame;
	readonly setDetail: (detail: string) => void;
	readonly close: () => void;
}

/** Reference screen for the responsive scale: a phone in landscape ends up near 0.7, a desktop at the 1.3 cap. */
const REFERENCE = new Vector2(900, 500);

/**
 * The client's UI root: one ScreenGui per generation (in this module's trove, so a hot-swap replaces it), a responsive
 * scale, layers (hud < toasts < modal), the single PopupQueue every modal goes through, a toast stack where toasts never
 * overlap, and local sounds. Other controllers get it injected.
 */
@Controller({ loadOrder: -10 })
export class UiController extends Module implements OnInit {
	gui!: ScreenGui;
	/** Scaled to the screen: lay out HUD widgets in here. */
	hud!: Frame;
	/** Unscaled, screen-space (for things placed at input or projected positions). */
	overlay!: Frame;
	modal!: Frame;
	/** The one modal queue (user rule: popups never overlap). */
	readonly popups = new PopupQueue();
	scale = 1;
	private toasts!: Frame;
	private toastOrder = 0;
	private readonly sounds = new Map<SoundName, Sound>();
	private soundFolder!: Folder;

	onInit() {
		const gui = this.trove.add(
			make("ScreenGui", undefined, {
				Name: "TargetRush",
				ResetOnSpawn: false,
				IgnoreGuiInset: false,
				ZIndexBehavior: Enum.ZIndexBehavior.Sibling,
				DisplayOrder: 5,
			}),
		);
		this.gui = gui;
		this.overlay = box(gui, "Overlay", { Size: UDim2.fromScale(1, 1), ZIndex: 2 });
		const root = box(gui, "Root", { Size: UDim2.fromScale(1, 1), ZIndex: 1 });
		const rootScale = make("UIScale", root);
		this.hud = box(root, "Hud", { Size: UDim2.fromScale(1, 1), ZIndex: 1 });
		this.toasts = box(root, "Toasts", {
			AnchorPoint: new Vector2(0.5, 0),
			Position: new UDim2(0.5, 0, 0, 64),
			Size: new UDim2(0.9, 0, 0, 0),
			AutomaticSize: Enum.AutomaticSize.Y,
			ZIndex: 5,
		});
		column(this.toasts, 6);
		this.modal = box(root, "Modal", { Size: UDim2.fromScale(1, 1), ZIndex: 10 });

		// The root is sized 1/scale and scaled by the UIScale, so it always covers the screen exactly.
		const resize = () => {
			const size = gui.AbsoluteSize;
			if (size.X <= 0 || size.Y <= 0) return;
			const scale = math.clamp(math.min(size.X / REFERENCE.X, size.Y / REFERENCE.Y), 0.62, 1.3);
			this.scale = scale;
			rootScale.Scale = scale;
			root.Size = UDim2.fromScale(1 / scale, 1 / scale);
		};
		this.trove.connect(gui.GetPropertyChangedSignal("AbsoluteSize"), resize);
		gui.Parent = Players.LocalPlayer.WaitForChild("PlayerGui");
		resize();

		// Sound clones live in one folder in the trove: a swap stops and removes them all.
		this.soundFolder = this.trove.add(make("Folder", SoundService, { Name: "TargetRushSounds" }));
		for (const [name, id] of pairs(SOUNDS)) {
			this.sounds.set(name, make("Sound", this.soundFolder, { Name: name, SoundId: id, Volume: 0.5 }));
		}
	}

	/**
	 * An invisible marker for an analytics screen that has no frame of its own (a HUD state): it is the screen `name`
	 * while Visible (see client/ui/screens.ts). Lives in this controller's ScreenGui, so a swap removes it.
	 */
	screenMarker(name: string): Frame {
		const marker = box(this.hud, `Screen_${name}`, { Size: UDim2.fromScale(0, 0), Visible: false });
		tagScreen(marker, name);
		return marker;
	}

	/** Plays a local sound (overlapping plays allowed). */
	sound(name: SoundName, speed = 1, volume = 0.5) {
		const template = this.sounds.get(name);
		if (!template) return;
		const sound = template.Clone();
		sound.PlaybackSpeed = speed;
		sound.Volume = volume;
		sound.Parent = this.soundFolder;
		sound.Play();
		Debris.AddItem(sound, 4);
	}

	/** A small pill under the timer. Toasts stack (never overlap) and pop through UIScale. */
	toast(options: ToastOptions): Toast {
		const color = options.color ?? PALETTE.white;
		this.toastOrder += 1;
		const frame = panel(this.toasts, "Toast", PALETTE.ink, {
			Size: UDim2.fromOffset(0, 40),
			AutomaticSize: Enum.AutomaticSize.X,
			BackgroundTransparency: 0.12,
			LayoutOrder: this.toastOrder,
			Visible: false,
		});
		corner(frame);
		stroke(frame, color, 2, 0.35);
		pad(frame, 14, 0);
		row(frame, 8);
		if (options.icon) {
			const holder = box(frame, "Icon", { Size: UDim2.fromOffset(26, 26), LayoutOrder: 1 });
			options.icon(holder);
		}
		text(frame, "Text", options.text, 20, FONT_BOLD, color, { LayoutOrder: 2 });
		const detail = text(frame, "Detail", options.detail ?? "", 18, FONT_BODY, PALETTE.silver, {
			LayoutOrder: 3,
			Visible: options.detail !== undefined,
		});
		popIn(frame);

		let closed = false;
		const close = () => {
			if (closed) return;
			closed = true;
			popOut(frame, () => frame.Destroy());
		};
		if (options.seconds !== undefined) this.trove.add(task.delay(options.seconds, close));
		return {
			frame,
			setDetail: (value: string) => {
				detail.Text = value;
				detail.Visible = value !== "";
			},
			close,
		};
	}
}
