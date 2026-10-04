import { PALETTE, rankColor } from "../rush/palette";
import { aspect, box, corner, FONT_TITLE, make, panel, stroke, textStroke } from "./kit";

/**
 * Icons drawn from Frames (no images, no emojis): each is a square box (UIAspectRatioConstraint 1) whose parts are
 * sized in Scale, so an icon is as big as the box you give it. `size` is a UDim2 for the box.
 */

function iconBox(parent: Instance, name: string, size: UDim2) {
	const frame = box(parent, name, { Size: size });
	aspect(frame, 1);
	return frame;
}

/** A centered rounded bar from scale point to scale point (rotated to match). */
function bar(parent: Instance, from: Vector2, to: Vector2, thickness: number, color: Color3) {
	const delta = to.sub(from);
	const length = delta.Magnitude + thickness;
	const middle = from.add(to).div(2);
	const piece = panel(parent, "Bar", color, {
		AnchorPoint: new Vector2(0.5, 0.5),
		Position: UDim2.fromScale(middle.X, middle.Y),
		Size: UDim2.fromScale(length, thickness),
		Rotation: math.deg(math.atan2(delta.Y, delta.X)),
	});
	corner(piece);
	return piece;
}

function dot(parent: Instance, name: string, center: Vector2, diameter: number, color: Color3) {
	const circle = panel(parent, name, color, {
		AnchorPoint: new Vector2(0.5, 0.5),
		Position: UDim2.fromScale(center.X, center.Y),
		Size: UDim2.fromScale(diameter, diameter),
	});
	corner(circle);
	return circle;
}

export function coinIcon(parent: Instance, size: UDim2, strokePx = 3) {
	const icon = iconBox(parent, "CoinIcon", size);
	const face = dot(icon, "Face", new Vector2(0.5, 0.5), 0.9, PALETTE.gold);
	stroke(face, PALETTE.goldDark, strokePx);
	dot(icon, "Shine", new Vector2(0.5, 0.5), 0.46, PALETTE.lemon).BackgroundTransparency = 0.25;
	return icon;
}

export function targetIcon(parent: Instance, size: UDim2) {
	const icon = iconBox(parent, "TargetIcon", size);
	dot(icon, "Outer", new Vector2(0.5, 0.5), 1, PALETTE.hotPink);
	dot(icon, "Middle", new Vector2(0.5, 0.5), 0.64, PALETTE.white);
	dot(icon, "Inner", new Vector2(0.5, 0.5), 0.3, PALETTE.hotPink);
	return icon;
}

export function crownIcon(parent: Instance, size: UDim2, color: Color3 = PALETTE.gold) {
	const icon = iconBox(parent, "CrownIcon", size);
	for (const [x, y] of [
		[0.17, 0.4],
		[0.5, 0.3],
		[0.83, 0.4],
	]) {
		panel(icon, "Point", color, {
			AnchorPoint: new Vector2(0.5, 0.5),
			Position: UDim2.fromScale(x, y),
			Size: UDim2.fromScale(0.27, 0.27),
			Rotation: 45,
		});
	}
	const body = panel(icon, "Body", color, {
		AnchorPoint: new Vector2(0.5, 0.5),
		Position: UDim2.fromScale(0.5, 0.62),
		Size: UDim2.fromScale(0.8, 0.34),
	});
	corner(body, new UDim(0.2, 0));
	panel(icon, "Band", color.Lerp(PALETTE.ink, 0.25), {
		AnchorPoint: new Vector2(0.5, 0.5),
		Position: UDim2.fromScale(0.5, 0.74),
		Size: UDim2.fromScale(0.8, 0.1),
	});
	return icon;
}

export function clockIcon(parent: Instance, size: UDim2, color: Color3 = PALETTE.white, strokePx = 3) {
	const icon = iconBox(parent, "ClockIcon", size);
	const ring = box(icon, "Ring", {
		AnchorPoint: new Vector2(0.5, 0.5),
		Position: UDim2.fromScale(0.5, 0.5),
		Size: UDim2.fromScale(0.84, 0.84),
	});
	corner(ring);
	stroke(ring, color, strokePx);
	bar(icon, new Vector2(0.5, 0.5), new Vector2(0.5, 0.26), 0.1, color);
	bar(icon, new Vector2(0.5, 0.5), new Vector2(0.68, 0.5), 0.1, color);
	return icon;
}

export function checkIcon(parent: Instance, size: UDim2, color: Color3 = PALETTE.mint) {
	const icon = iconBox(parent, "CheckIcon", size);
	bar(icon, new Vector2(0.2, 0.52), new Vector2(0.42, 0.74), 0.17, color);
	bar(icon, new Vector2(0.42, 0.74), new Vector2(0.82, 0.28), 0.17, color);
	return icon;
}

export function crossIcon(parent: Instance, size: UDim2, color: Color3 = PALETTE.white) {
	const icon = iconBox(parent, "CrossIcon", size);
	bar(icon, new Vector2(0.24, 0.24), new Vector2(0.76, 0.76), 0.16, color);
	bar(icon, new Vector2(0.24, 0.76), new Vector2(0.76, 0.24), 0.16, color);
	return icon;
}

export function starIcon(parent: Instance, size: UDim2, color: Color3 = PALETTE.lemon) {
	const icon = iconBox(parent, "StarIcon", size);
	for (const rotation of [0, 45]) {
		const square = panel(icon, "Point", color, {
			AnchorPoint: new Vector2(0.5, 0.5),
			Position: UDim2.fromScale(0.5, 0.5),
			Size: UDim2.fromScale(0.64, 0.64),
			Rotation: rotation,
		});
		corner(square, new UDim(0.12, 0));
	}
	dot(icon, "Shine", new Vector2(0.5, 0.5), 0.3, PALETTE.white).BackgroundTransparency = 0.35;
	return icon;
}

/** A chevron pointing right; rotate the box (or pass `rotation`) for other directions. */
export function chevronIcon(parent: Instance, size: UDim2, color: Color3 = PALETTE.white, rotation = 0) {
	const icon = iconBox(parent, "ChevronIcon", size);
	icon.Rotation = rotation;
	bar(icon, new Vector2(0.32, 0.14), new Vector2(0.7, 0.5), 0.18, color);
	bar(icon, new Vector2(0.32, 0.86), new Vector2(0.7, 0.5), 0.18, color);
	return icon;
}

/** Two stacked chevrons pointing up: a combo. */
export function comboIcon(parent: Instance, size: UDim2, color: Color3 = PALETTE.lemon) {
	const icon = iconBox(parent, "ComboIcon", size);
	for (const y of [0.12, 0.48]) {
		bar(icon, new Vector2(0.16, y + 0.32), new Vector2(0.5, y), 0.17, color);
		bar(icon, new Vector2(0.84, y + 0.32), new Vector2(0.5, y), 0.17, color);
	}
	return icon;
}

/** A ring with a fading tail; spin its `Ring` child (Rotation) for a loading spinner. */
export function spinnerIcon(parent: Instance, size: UDim2, color: Color3 = PALETTE.white, strokePx = 3) {
	const icon = iconBox(parent, "SpinnerIcon", size);
	const ring = box(icon, "Ring", {
		AnchorPoint: new Vector2(0.5, 0.5),
		Position: UDim2.fromScale(0.5, 0.5),
		Size: UDim2.fromScale(0.8, 0.8),
	});
	corner(ring);
	const line = stroke(ring, color, strokePx);
	make("UIGradient", line, {
		Transparency: new NumberSequence([new NumberSequenceKeypoint(0, 1), new NumberSequenceKeypoint(0.5, 0.6), new NumberSequenceKeypoint(1, 0)]),
	});
	return icon;
}

/** Circular arrows: "updated live". */
export function refreshIcon(parent: Instance, size: UDim2, color: Color3 = PALETTE.mint, strokePx = 3) {
	const icon = iconBox(parent, "RefreshIcon", size);
	const ring = box(icon, "Ring", {
		AnchorPoint: new Vector2(0.5, 0.5),
		Position: UDim2.fromScale(0.5, 0.5),
		Size: UDim2.fromScale(0.72, 0.72),
	});
	corner(ring);
	const line = stroke(ring, color, strokePx);
	make("UIGradient", line, {
		Transparency: new NumberSequence([
			new NumberSequenceKeypoint(0, 0),
			new NumberSequenceKeypoint(0.8, 0),
			new NumberSequenceKeypoint(0.801, 1),
			new NumberSequenceKeypoint(1, 1),
		]),
		Rotation: -60,
	});
	bar(icon, new Vector2(0.62, 0.08), new Vector2(0.84, 0.16), 0.13, color);
	bar(icon, new Vector2(0.84, 0.16), new Vector2(0.78, 0.4), 0.13, color);
	return icon;
}

export function personIcon(parent: Instance, size: UDim2, color: Color3 = PALETTE.white) {
	const icon = iconBox(parent, "PersonIcon", size);
	dot(icon, "Head", new Vector2(0.5, 0.3), 0.4, color);
	const body = panel(icon, "Body", color, {
		AnchorPoint: new Vector2(0.5, 0.5),
		Position: UDim2.fromScale(0.5, 0.8),
		Size: UDim2.fromScale(0.74, 0.4),
	});
	corner(body, new UDim(0.5, 0));
	return icon;
}

/** A medal-colored circle with the rank number. */
export function rankBadge(parent: Instance, size: UDim2, rank: number) {
	const icon = iconBox(parent, "RankBadge", size);
	const face = dot(icon, "Face", new Vector2(0.5, 0.5), 1, rankColor(rank));
	const label = make("TextLabel", face, {
		Name: "Rank",
		BackgroundTransparency: 1,
		Size: UDim2.fromScale(0.8, 0.8),
		AnchorPoint: new Vector2(0.5, 0.5),
		Position: UDim2.fromScale(0.5, 0.52),
		Text: tostring(rank),
		TextScaled: true,
		Font: FONT_TITLE,
		TextColor3: PALETTE.white,
	});
	textStroke(label, PALETTE.ink, 1.5);
	return icon;
}

/** Updates a rankBadge in place. */
export function setRank(badge: Frame, rank: number) {
	const face = badge.FindFirstChild("Face") as Frame | undefined;
	if (!face) return;
	face.BackgroundColor3 = rankColor(rank);
	const label = face.FindFirstChild("Rank") as TextLabel | undefined;
	if (label) label.Text = tostring(rank);
}
