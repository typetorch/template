/** The root part of a living character, or undefined. */
export function rootOf(player: Player): BasePart | undefined {
	const character = player.Character;
	if (!character) return undefined;
	const humanoid = character.FindFirstChildOfClass("Humanoid");
	if (!humanoid || humanoid.Health <= 0) return undefined;
	const root = character.FindFirstChild("HumanoidRootPart");
	return root && root.IsA("BasePart") ? root : undefined;
}
