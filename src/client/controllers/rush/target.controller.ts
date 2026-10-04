import { Debris, Players, UserInputService, Workspace } from "@rbxts/services";
import { Trove } from "@rbxts/trove";
import { Controller, Module, observeElement, type OnRender, type OnStart } from "@typetorch/framework";
import { network } from "../../../shared/net";
import { MIN_REACTION, PERFECT_WINDOW } from "../../../shared/rush/config";
import { GRADE_COLORS, GRADE_WORDS, PALETTE } from "../../../shared/rush/palette";
import { lerp, perfectAt, scaleAt } from "../../../shared/rush/rules";
import { TARGET_TAG, type HitVia } from "../../../shared/rush/types";
import { chevronIcon, crossIcon } from "../../../shared/ui/icons";
import { box, corner, make, stroke } from "../../../shared/ui/kit";
import { burst, floatText } from "../../ui/fx";
import { UiController } from "../ui/ui.controller";
import { RushStateController } from "./rush-state.controller";

/** The approach ring starts this many times the target's size and closes on it at the PERFECT moment. */
const APPROACH_SCALE = 2.8;
const POP_IN = 0.18;
/** Running into a target: reach beyond its radius (half a character). */
const TOUCH_REACH = 2;
/** Tap tolerance around a target on screen, in pixels. */
const SLACK_MOUSE = 16;
const SLACK_TOUCH = 34;
const SLACK_GAMEPAD = 60;
const MAX_ARROWS = 10;

interface LocalTarget {
	readonly id: number;
	readonly part: BasePart;
	readonly base: CFrame;
	readonly size: number;
	readonly spawnedAt: number;
	readonly lifetime: number;
	readonly golden: boolean;
	readonly color: Color3;
	readonly ring: BillboardGui;
	readonly ringStroke: UIStroke;
	readonly wobble: number;
	pending: boolean;
	retryAt: number;
	popped: boolean;
}

function easeOutBack(alpha: number) {
	const c1 = 1.70158;
	const c3 = c1 + 1;
	return 1 + c3 * math.pow(alpha - 1, 3) + c1 * math.pow(alpha - 1, 2);
}

/**
 * Targets on the client: the server's tagged parts get a local look (pop-in, shrink, bob, an approach ring, sparkles
 * for golden ones) and input: click or tap on them, a gamepad trigger at the screen center, or run into the low ones.
 * Hits are predicted (instant pop) and confirmed by the server, which decides the grade and the points. Off-screen
 * targets get arrows at the screen edge. Every target's visuals live in its own element trove.
 */
@Controller()
export class TargetController extends Module implements OnStart, OnRender {
	private readonly targets = new Map<number, LocalTarget>();
	private readonly arrows = new Array<Frame>();
	private fx!: Folder;
	private lastHitClock = 0;

	constructor(
		private readonly ui: UiController,
		private readonly state: RushStateController,
	) {
		super();
	}

	onStart() {
		this.fx = this.trove.add(make("Folder", Workspace, { Name: "TargetRushFx" }));
		for (let index = 0; index < MAX_ARROWS; index++) this.arrows.push(this.makeArrow());

		observeElement<BasePart>(this.trove, TARGET_TAG, (part, elementTrove) => this.track(part, elementTrove));

		this.trove.connect(UserInputService.InputBegan, (input, processed) => {
			if (processed) return;
			if (input.UserInputType === Enum.UserInputType.MouseButton1) {
				this.aim(new Vector2(input.Position.X, input.Position.Y), SLACK_MOUSE);
			} else if (input.KeyCode === Enum.KeyCode.ButtonR2) {
				this.aim(this.ui.overlay.AbsoluteSize.div(2), SLACK_GAMEPAD);
			}
		});
		this.trove.connect(UserInputService.TouchTapInWorld, (position, processedByUI) => {
			if (!processedByUI) this.aim(position, SLACK_TOUCH);
		});

		// Someone else's pop: the same burst, smaller text.
		this.trove.add(
			network.client.rush.popped.on((event) => {
				const position = new Vector3(event.x, event.y, event.z);
				burst(this.fx, position, GRADE_COLORS[event.grade], 10, event.golden ? "confetti" : "pop");
				floatText(this.fx, position, "", `+${event.points}`, PALETTE.white);
			}),
		);
	}

	onRender() {
		const now = Workspace.GetServerTimeNow();
		const playing = this.state.phase().phase === "round";
		const root = Players.LocalPlayer.Character?.FindFirstChild("HumanoidRootPart") as BasePart | undefined;
		const clock = os.clock();
		for (const [, target] of this.targets) {
			if (target.pending) continue;
			const age = now - target.spawnedAt;
			const pop = age < POP_IN ? easeOutBack(math.clamp(age / POP_IN, 0, 1)) : 1;
			const diameter = math.max(target.size * scaleAt(age, target.lifetime) * pop, 0.05);
			target.part.Size = new Vector3(diameter, diameter, diameter);
			target.part.CFrame = target.base.add(new Vector3(0, math.sin(now * 2.4 + target.wobble) * 0.25, 0));

			// The approach ring closes on the target at the PERFECT moment, then hugs it.
			const closesAt = perfectAt(target.lifetime);
			const approach = age < closesAt ? lerp(APPROACH_SCALE, 1, math.max(age, 0) / closesAt) : 1;
			const ringSize = diameter * approach + 0.3;
			target.ring.Size = UDim2.fromScale(ringSize, ringSize);
			const off = math.abs(age - closesAt);
			target.ringStroke.Color = off <= PERFECT_WINDOW ? PALETTE.lemon : age > closesAt ? PALETTE.pink : PALETTE.white;
			target.ringStroke.Thickness = off <= PERFECT_WINDOW ? 6 : 4;
			target.ringStroke.Transparency = age < POP_IN ? 1 - math.max(age, 0) / POP_IN : 0;
			const life = age / target.lifetime;
			target.part.LocalTransparencyModifier = life > 0.85 ? math.min((life - 0.85) / 0.15, 1) * 0.6 : 0;

			// Run into it (low targets): the server checks the same distance with some slack.
			if (playing && root && clock >= target.retryAt && age >= MIN_REACTION + 0.05) {
				if (root.Position.sub(target.part.Position).Magnitude <= diameter / 2 + TOUCH_REACH) this.tryHit(target, "touch");
			}
		}
		this.drawArrows(playing);
	}

	private track(part: BasePart, elementTrove: Trove) {
		if (!part.IsA("BasePart")) return;
		const id = part.GetAttribute("TargetId");
		const spawnedAt = part.GetAttribute("SpawnedAt");
		const lifetime = part.GetAttribute("Lifetime");
		const size = part.GetAttribute("Size");
		const golden = part.GetAttribute("Golden") === true;
		if (!typeIs(id, "number") || !typeIs(spawnedAt, "number") || !typeIs(lifetime, "number") || !typeIs(size, "number")) return;

		const ring = elementTrove.add(
			make("BillboardGui", part, {
				Name: "Ring",
				Adornee: part,
				AlwaysOnTop: true,
				LightInfluence: 0,
				MaxDistance: 400,
				Size: UDim2.fromScale(size * APPROACH_SCALE, size * APPROACH_SCALE),
			}),
		);
		const circle = box(ring, "Circle", { Size: UDim2.fromScale(1, 1) });
		corner(circle);
		const ringStroke = stroke(circle, PALETTE.white, 4, 1);
		if (golden) {
			make("ParticleEmitter", part, {
				Texture: "rbxasset://textures/particles/sparkles_main.dds",
				Color: new ColorSequence(PALETTE.lemon),
				Size: new NumberSequence([new NumberSequenceKeypoint(0, 0.8), new NumberSequenceKeypoint(1, 0)]),
				Rate: 14,
				Lifetime: new NumberRange(0.4, 0.8),
				Speed: new NumberRange(2, 4),
				SpreadAngle: new Vector2(180, 180),
				LightEmission: 0.6,
			});
			make("PointLight", part, { Color: PALETTE.lemon, Range: 12, Brightness: 2 });
		}

		const target: LocalTarget = {
			id,
			part,
			base: part.CFrame,
			size,
			spawnedAt,
			lifetime,
			golden,
			color: part.Color,
			ring,
			ringStroke,
			wobble: math.random() * math.pi * 2,
			pending: false,
			retryAt: 0,
			popped: false,
		};
		this.targets.set(id, target);
		elementTrove.add(() => {
			if (this.targets.get(id) === target) this.targets.delete(id);
			// Ran out of time (not hit, not taken over by a new generation's copy): a small grey puff.
			const age = Workspace.GetServerTimeNow() - spawnedAt;
			if (!target.popped && !target.pending && age >= lifetime - 0.15) {
				burst(this.fx, target.base.Position, PALETTE.grey, 6);
			}
		});
	}

	/** A click/tap at a screen point: the nearest target under it (with some slack), or a whiff. */
	private aim(point: Vector2, slack: number) {
		if (this.state.phase().phase !== "round") return;
		const camera = Workspace.CurrentCamera;
		if (!camera) return;
		let best: LocalTarget | undefined;
		let bestScore = math.huge;
		for (const [, target] of this.targets) {
			if (target.pending) continue;
			const [screen, onScreen] = camera.WorldToScreenPoint(target.part.Position);
			if (!onScreen) continue;
			const [edge] = camera.WorldToScreenPoint(
				target.part.Position.add(camera.CFrame.RightVector.mul(target.part.Size.X / 2)),
			);
			const radius = new Vector2(edge.X - screen.X, edge.Y - screen.Y).Magnitude;
			const distance = new Vector2(screen.X, screen.Y).sub(point).Magnitude;
			if (distance > radius + slack) continue;
			const score = distance / math.max(radius, 1);
			if (score < bestScore) {
				bestScore = score;
				best = target;
			}
		}
		if (best) this.tryHit(best, "click");
		else this.whiff(point);
	}

	private tryHit(target: LocalTarget, via: HitVia) {
		target.pending = true;
		this.lastHitClock = os.clock();
		target.part.LocalTransparencyModifier = 1;
		target.ring.Enabled = false;
		const position = target.part.Position;
		// Predicted: the pop and its sound happen now; the grade and points arrive with the server's answer.
		burst(this.fx, position, target.color, 12);
		this.ui.sound("tick", 1 + math.min(this.state.me().combo, 24) * 0.035, 0.5);

		this.trove.addPromise(
			network.client.rush.hit
				.invoke(target.id, via)
				.then((reply) => {
					if (reply[0] === false) {
						this.refused(target);
						return;
					}
					const result = reply[0];
					target.popped = true;
					this.state.applyHit(result);
					const color = GRADE_COLORS[result.grade];
					floatText(this.fx, position, GRADE_WORDS[result.grade], `+${result.points}`, color, result.grade === "perfect");
					if (result.grade === "perfect") {
						burst(this.fx, position, PALETTE.lemon, 10, "sparkle");
						this.ui.sound("tick", 1.6, 0.4);
					}
					if (result.golden) {
						burst(this.fx, position, PALETTE.gold, 40, "confetti");
						this.ui.sound("splash", 1.3, 0.5);
					}
				})
				.catch(() => this.refused(target)),
		);
	}

	/** The server said no (taken, too late, a swap in progress): show the target again if it is still there. */
	private refused(target: LocalTarget) {
		target.pending = false;
		target.retryAt = os.clock() + 0.3;
		if (target.part.Parent === undefined) return;
		target.ring.Enabled = true;
		target.part.LocalTransparencyModifier = 0;
	}

	private whiff(point: Vector2) {
		if (os.clock() - this.lastHitClock < 0.25) return; // a double click on a target just popped
		const mark = box(this.ui.overlay, "Miss", {
			AnchorPoint: new Vector2(0.5, 0.5),
			Position: UDim2.fromOffset(point.X, point.Y),
			Size: UDim2.fromOffset(26, 26),
		});
		crossIcon(mark, UDim2.fromScale(1, 1), PALETTE.grey);
		Debris.AddItem(mark, 0.35);
		if (this.state.me().combo > 0) {
			this.state.breakCombo();
			network.client.rush.whiff.fire();
			this.ui.sound("thud", 1, 0.4);
		}
	}

	private makeArrow(): Frame {
		const arrow = box(this.ui.overlay, "TargetArrow", {
			AnchorPoint: new Vector2(0.5, 0.5),
			Size: UDim2.fromOffset(34, 34),
			Visible: false,
		});
		const bubble = make("Frame", arrow, {
			Name: "Bubble",
			BackgroundColor3: PALETTE.pink,
			Size: UDim2.fromScale(1, 1),
			BorderSizePixel: 0,
		});
		corner(bubble);
		stroke(bubble, PALETTE.white, 2);
		chevronIcon(bubble, UDim2.fromScale(0.62, 0.62), PALETTE.white).Position = UDim2.fromScale(0.22, 0.19);
		return arrow;
	}

	/** Arrows at the screen edge pointing at targets you can't see (golden ones bigger). */
	private drawArrows(playing: boolean) {
		const camera = Workspace.CurrentCamera;
		let used = 0;
		if (playing && camera) {
			const size = this.ui.overlay.AbsoluteSize;
			const center = size.div(2);
			const margin = 34;
			for (const [, target] of this.targets) {
				if (used >= MAX_ARROWS) break;
				if (target.pending) continue;
				const [screen, onScreen] = camera.WorldToScreenPoint(target.part.Position);
				if (onScreen) continue;
				let point = new Vector2(screen.X, screen.Y);
				if (screen.Z < 0) point = center.mul(2).sub(point); // behind the camera: mirror
				let direction = point.sub(center);
				if (direction.Magnitude < 1) direction = new Vector2(0, 1);
				direction = direction.Unit;
				const reach = math.min(
					(center.X - margin) / math.max(math.abs(direction.X), 1e-4),
					(center.Y - margin) / math.max(math.abs(direction.Y), 1e-4),
				);
				const at = center.add(direction.mul(reach));
				const arrow = this.arrows[used];
				used += 1;
				arrow.Visible = true;
				arrow.Position = UDim2.fromOffset(at.X, at.Y);
				arrow.Rotation = math.deg(math.atan2(direction.Y, direction.X));
				arrow.Size = target.golden ? UDim2.fromOffset(46, 46) : UDim2.fromOffset(34, 34);
				(arrow.FindFirstChild("Bubble") as Frame).BackgroundColor3 = target.color;
			}
		}
		for (let index = used; index < this.arrows.size(); index++) this.arrows[index].Visible = false;
	}
}
