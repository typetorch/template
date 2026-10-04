import { Workspace } from "@rbxts/services";
import { Trove } from "@rbxts/trove";
import { TypeTorch } from "@typetorch/framework";

const LAYOUT_ATTRIBUTE = "TypeTorchLayout";

export interface Handoff {
	readonly model: Model;
	/** True when the model came from the previous generation instead of being built now. */
	readonly adopted: boolean;
}

/**
 * World handoff across hot-swaps. Between the old generation's stop and the new one's start there are a few frames
 * with no game code at all; a floor owned by a trove would vanish for those frames and players standing on it would
 * drop. So the model is handed over instead of rebuilt:
 *
 * - it is still owned by `trove`: cleaning the trove destroys it, unless this generation handed it over in
 *   `TypeTorch.onSwapOut` (only for a swap that stays on the same branch; a branch switch rebuilds the world);
 * - the next generation adopts it when its `layoutKey` matches, and rebuilds it otherwise (change an arena knob,
 *   deploy, and the arena is rebuilt in the same frame).
 *
 * Only for static world geometry. Anything a generation animates or owns per round (targets, GUIs) stays in a trove.
 */
export function handoffModel(trove: Trove, name: string, layoutKey: string, build: (model: Model) => void): Handoff {
	let model: Model | undefined;
	let adopted = false;
	const existing = Workspace.FindFirstChild(name);
	if (existing) {
		if (existing.IsA("Model") && existing.GetAttribute(LAYOUT_ATTRIBUTE) === layoutKey) {
			model = existing;
			adopted = true;
		} else {
			existing.Destroy();
		}
	}
	if (!model) {
		model = new Instance("Model");
		model.Name = name;
		build(model);
		model.SetAttribute(LAYOUT_ATTRIBUTE, layoutKey);
		model.Parent = Workspace;
	}

	const owned = model;
	let handOver = false;
	trove.add(
		TypeTorch.onSwapOut((info) => {
			handOver = info.branch === undefined || info.branch === TypeTorch.branch;
		}),
	);
	trove.add(() => {
		if (!handOver) owned.Destroy();
	});
	return { model: owned, adopted };
}
