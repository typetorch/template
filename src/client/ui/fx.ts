import { Debris, TweenService } from "@rbxts/services";
import { PALETTE } from "../../shared/rush/palette";
import { FONT_TITLE, make, textStroke } from "../../shared/ui/kit";

/**
 * World effects built from plain instances and textures that ship with the client. Every effect is parented to a
 * folder the caller's trove owns (so a hot-swap removes them) and cleans itself up with Debris.
 */

const SPARKLE = "rbxasset://textures/particles/sparkles_main.dds";
const SQUARE = "rbxasset://textures/particles/SquareParticle.png";

function anchor(folder: Instance, position: Vector3, lifetime: number) {
	const part = make("Part", undefined, {
		Name: "Fx",
		Anchored: true,
		CanCollide: false,
		CanQuery: false,
		CanTouch: false,
		Transparency: 1,
		Size: new Vector3(0.2, 0.2, 0.2),
		CFrame: new CFrame(position),
	});
	part.Parent = folder;
	Debris.AddItem(part, lifetime);
	return part;
}

/** A burst of soft squares (confetti when `confetti`, sparkles when `sparkle`). */
export function burst(folder: Instance, position: Vector3, color: Color3, amount: number, kind: "pop" | "sparkle" | "confetti" = "pop") {
	const holder = anchor(folder, position, 1.6);
	const emitter = make("ParticleEmitter", holder, {
		Texture: kind === "sparkle" ? SPARKLE : SQUARE,
		Color:
			kind === "confetti"
				? new ColorSequence([
						new ColorSequenceKeypoint(0, PALETTE.pink),
						new ColorSequenceKeypoint(0.33, PALETTE.lemon),
						new ColorSequenceKeypoint(0.66, PALETTE.sky),
						new ColorSequenceKeypoint(1, PALETTE.mint),
					])
				: new ColorSequence(color, color.Lerp(PALETTE.white, 0.6)),
		Size: new NumberSequence([new NumberSequenceKeypoint(0, kind === "sparkle" ? 1.4 : 0.7), new NumberSequenceKeypoint(1, 0)]),
		Transparency: new NumberSequence([new NumberSequenceKeypoint(0, 0), new NumberSequenceKeypoint(0.7, 0.2), new NumberSequenceKeypoint(1, 1)]),
		Speed: new NumberRange(kind === "confetti" ? 14 : 9, kind === "confetti" ? 24 : 16),
		SpreadAngle: new Vector2(180, 180),
		Lifetime: new NumberRange(0.35, kind === "confetti" ? 1.1 : 0.6),
		Drag: 5,
		Acceleration: kind === "confetti" ? new Vector3(0, -18, 0) : new Vector3(0, 0, 0),
		Rotation: new NumberRange(0, 360),
		RotSpeed: new NumberRange(-200, 200),
		LightEmission: 0.35,
		Rate: 0,
	});
	emitter.Emit(amount);
}

/** A word that pops (UIScale), rises and fades: "PERFECT +90". */
export function floatText(folder: Instance, position: Vector3, word: string, sub: string, color: Color3, big = false) {
	const holder = anchor(folder, position, 1.3);
	const gui = make("BillboardGui", holder, {
		Size: UDim2.fromOffset(240, 90),
		StudsOffset: new Vector3(0, 1.5, 0),
		AlwaysOnTop: true,
		LightInfluence: 0,
		MaxDistance: 200,
	});
	// Pops through a UIScale on a centered frame (never a Size tween).
	const frame = make("Frame", gui, {
		BackgroundTransparency: 1,
		AnchorPoint: new Vector2(0.5, 0.5),
		Position: UDim2.fromScale(0.5, 0.5),
		Size: UDim2.fromScale(1, 1),
	});
	const scale = make("UIScale", frame, { Scale: 0.4 });
	const labels = new Array<TextLabel>();
	const strokes = new Array<UIStroke>();
	const wordLabel = make("TextLabel", frame, {
		BackgroundTransparency: 1,
		Size: UDim2.fromScale(1, 0.55),
		Text: word,
		Font: FONT_TITLE,
		TextScaled: true,
		TextColor3: color,
	});
	labels.push(wordLabel);
	strokes.push(textStroke(wordLabel, PALETTE.ink, big ? 3 : 2));
	if (sub !== "") {
		const subLabel = make("TextLabel", frame, {
			BackgroundTransparency: 1,
			Position: UDim2.fromScale(0, 0.55),
			Size: UDim2.fromScale(1, 0.42),
			Text: sub,
			Font: FONT_TITLE,
			TextScaled: true,
			TextColor3: PALETTE.white,
		});
		labels.push(subLabel);
		strokes.push(textStroke(subLabel, PALETTE.ink, 2));
	}
	const peak = big ? 1.25 : 1;
	TweenService.Create(scale, new TweenInfo(0.18, Enum.EasingStyle.Back, Enum.EasingDirection.Out), { Scale: peak }).Play();
	TweenService.Create(gui, new TweenInfo(1.1, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), {
		StudsOffset: new Vector3(0, 4, 0),
	}).Play();
	const fade = new TweenInfo(0.4, Enum.EasingStyle.Quad, Enum.EasingDirection.In, 0, false, 0.6);
	for (const label of labels) TweenService.Create(label, fade, { TextTransparency: 1 }).Play();
	for (const line of strokes) TweenService.Create(line, fade, { Transparency: 1 }).Play();
}
