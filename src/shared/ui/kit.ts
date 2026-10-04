import { PALETTE } from "../rush/palette";

/**
 * A tiny instance kit for code-built UI (the HUD on the client, the world board on the server). Only plain
 * instances: no images, no emojis. Pops use UIScale (framework popIn/popOut/bump), never Size tweens.
 */

export const FONT_TITLE = Enum.Font.FredokaOne;
export const FONT_BOLD = Enum.Font.BuilderSansBold;
export const FONT_BODY = Enum.Font.BuilderSansMedium;
export const FONT_MONO = Enum.Font.Code;

type Props<T extends keyof CreatableInstances> = Partial<WritableInstanceProperties<CreatableInstances[T]>>;

export function make<T extends keyof CreatableInstances>(className: T, parent: Instance | undefined, props: Props<T> = {}) {
	const instance = new Instance(className);
	for (const [key, value] of pairs(props as object)) {
		(instance as unknown as Record<string, unknown>)[key as string] = value;
	}
	if (parent) instance.Parent = parent;
	return instance;
}

/** A transparent frame (layout container). */
export function box(parent: Instance, name: string, props: Props<"Frame"> = {}) {
	return make("Frame", parent, { Name: name, BackgroundTransparency: 1, BorderSizePixel: 0, ...props });
}

/** A filled frame. */
export function panel(parent: Instance, name: string, color: Color3, props: Props<"Frame"> = {}) {
	return make("Frame", parent, { Name: name, BackgroundColor3: color, BorderSizePixel: 0, ...props });
}

export function corner(parent: Instance, radius: UDim = new UDim(1, 0)) {
	return make("UICorner", parent, { CornerRadius: radius });
}

export function stroke(parent: Instance, color: Color3, thickness: number, transparency = 0) {
	return make("UIStroke", parent, {
		Color: color,
		Thickness: thickness,
		Transparency: transparency,
		ApplyStrokeMode: Enum.ApplyStrokeMode.Border,
	});
}

/** A text outline (UIStroke in Contextual mode on a text object). */
export function textStroke(parent: Instance, color: Color3 = PALETTE.ink, thickness = 2) {
	return make("UIStroke", parent, { Color: color, Thickness: thickness, ApplyStrokeMode: Enum.ApplyStrokeMode.Contextual });
}

export function pad(parent: Instance, x: number, y = x) {
	return make("UIPadding", parent, {
		PaddingLeft: new UDim(0, x),
		PaddingRight: new UDim(0, x),
		PaddingTop: new UDim(0, y),
		PaddingBottom: new UDim(0, y),
	});
}

export function row(parent: Instance, gap: number, align: Enum.HorizontalAlignment = Enum.HorizontalAlignment.Left) {
	return make("UIListLayout", parent, {
		FillDirection: Enum.FillDirection.Horizontal,
		VerticalAlignment: Enum.VerticalAlignment.Center,
		HorizontalAlignment: align,
		SortOrder: Enum.SortOrder.LayoutOrder,
		Padding: new UDim(0, gap),
	});
}

export function column(parent: Instance, gap: number, align: Enum.HorizontalAlignment = Enum.HorizontalAlignment.Center) {
	return make("UIListLayout", parent, {
		FillDirection: Enum.FillDirection.Vertical,
		HorizontalAlignment: align,
		SortOrder: Enum.SortOrder.LayoutOrder,
		Padding: new UDim(0, gap),
	});
}

export function aspect(parent: Instance, ratio: number) {
	return make("UIAspectRatioConstraint", parent, { AspectRatio: ratio });
}

/** A text label that sizes itself along X (fixed height). */
export function text(
	parent: Instance,
	name: string,
	value: string,
	size: number,
	font: Enum.Font = FONT_BOLD,
	color: Color3 = PALETTE.white,
	props: Props<"TextLabel"> = {},
) {
	return make("TextLabel", parent, {
		Name: name,
		BackgroundTransparency: 1,
		Text: value,
		TextSize: size,
		Font: font,
		TextColor3: color,
		Size: UDim2.fromOffset(0, math.ceil(size * 1.15)),
		AutomaticSize: Enum.AutomaticSize.X,
		...props,
	});
}
