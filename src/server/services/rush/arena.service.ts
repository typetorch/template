import { Module, Service, type OnInit } from "@typetorch/framework";
import { $print } from "rbxts-transform-debug";
import { PAD_RADIUS } from "../../../shared/rush/config";
import { buildArena, computeLayout, ensureZones, type ArenaLayout } from "./arena-builder";
import { handoffModel } from "./handoff";

/**
 * The Target Rush arena, built entirely from code around the place's SpawnLocation. The static geometry is handed over
 * between generations (see handoff.ts), so a mid-round deploy never pulls the floor from under anyone. It carries the
 * analytics zones too (TTZone parts, see ensureZones).
 */
@Service({ loadOrder: -10 })
export class ArenaService extends Module implements OnInit {
	layout!: ArenaLayout;
	pad!: BasePart;
	board!: BasePart;

	onInit() {
		this.layout = computeLayout();
		const { model, adopted } = handoffModel(this.trove, "TargetRushArena", this.layout.key, (built) =>
			buildArena(built, this.layout),
		);
		// Analytics zones (Lobby, StartPad, Arena, Board, Outskirts): part of the handed-over model, added if missing.
		ensureZones(model, this.layout);
		this.pad = model.FindFirstChild("Pad") as BasePart;
		this.board = model.FindFirstChild("Board") as BasePart;
		$print(adopted ? "arena handed over from the previous generation" : `arena built (${this.layout.key})`);
	}

	/** On the start pad (a character's root position). */
	onPad(position: Vector3): boolean {
		const offset = position.sub(this.layout.pad);
		const flat = new Vector3(offset.X, 0, offset.Z).Magnitude;
		return flat <= PAD_RADIUS + 0.5 && offset.Y >= -1 && offset.Y <= 7;
	}

	/** Inside the rim (a character's root position). */
	inside(position: Vector3): boolean {
		const offset = position.sub(this.layout.center);
		return new Vector3(offset.X, 0, offset.Z).Magnitude <= this.layout.radius - 1 && offset.Y > -4 && offset.Y < 30;
	}

	/** Where a returning player lands at the countdown: a ring around the center, facing the board. */
	spot(index: number, count: number): CFrame {
		const angle = (index / math.max(count, 1)) * math.pi * 2;
		const position = this.layout.center.add(new Vector3(math.cos(angle) * 8, 3.5, math.sin(angle) * 8 + 6));
		return CFrame.lookAt(position, position.add(new Vector3(0, 0, -1)));
	}

	/**
	 * A random target position: low ones (to run into) or high ones (to click), away from `avoid` (other targets) and
	 * low ones away from `players` too, so nobody gets a free hit by standing still.
	 */
	targetPosition(random: Random, low: boolean, avoid: Vector3[], players: Vector3[]): Vector3 | undefined {
		const { center, radius } = this.layout;
		for (let attempt = 0; attempt < 12; attempt++) {
			const angle = random.NextNumber(0, math.pi * 2);
			const distance = random.NextNumber(7, radius - 7);
			const height = low ? random.NextNumber(2.4, 3.4) : random.NextNumber(5.5, 13);
			const position = center.add(new Vector3(math.cos(angle) * distance, height, math.sin(angle) * distance));
			if (avoid.some((other) => other.sub(position).Magnitude < 7)) continue;
			if (low && players.some((other) => other.sub(position).Magnitude < 9)) continue;
			if (this.onPad(position)) continue;
			return position;
		}
		return undefined;
	}
}
