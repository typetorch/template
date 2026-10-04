/** Soft, bright colors shared by the arena, the targets and the HUD. */
export const PALETTE = {
	pink: Color3.fromRGB(255, 128, 178),
	hotPink: Color3.fromRGB(255, 96, 156),
	sky: Color3.fromRGB(104, 186, 255),
	mint: Color3.fromRGB(92, 222, 170),
	lemon: Color3.fromRGB(255, 214, 92),
	lavender: Color3.fromRGB(176, 148, 255),
	peach: Color3.fromRGB(255, 166, 112),
	gold: Color3.fromRGB(255, 200, 40),
	goldDark: Color3.fromRGB(196, 132, 20),
	silver: Color3.fromRGB(205, 214, 230),
	bronze: Color3.fromRGB(222, 150, 96),
	white: Color3.fromRGB(255, 255, 255),
	cream: Color3.fromRGB(255, 244, 222),
	navy: Color3.fromRGB(34, 36, 62),
	ink: Color3.fromRGB(22, 22, 38),
	grey: Color3.fromRGB(150, 154, 176),
	red: Color3.fromRGB(255, 94, 104),
};

/** Target colors (index stored on the target as an attribute). */
export const TARGET_COLORS = [PALETTE.pink, PALETTE.sky, PALETTE.mint, PALETTE.lavender, PALETTE.peach];

/** Grade colors for the pop text. */
export const GRADE_COLORS = {
	perfect: PALETTE.lemon,
	great: PALETTE.mint,
	good: PALETTE.sky,
};

export const GRADE_WORDS = {
	perfect: "PERFECT",
	great: "GREAT",
	good: "GOOD",
};

export function rankColor(rank: number): Color3 {
	if (rank === 1) return PALETTE.gold;
	if (rank === 2) return PALETTE.silver;
	if (rank === 3) return PALETTE.bronze;
	return PALETTE.lavender;
}
