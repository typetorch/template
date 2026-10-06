import { CollectionService, Workspace } from "@rbxts/services";
import { ZONE_TAG, ZONE_VERSION, zoneBoxes } from "../../../shared/analytics/catalog";
import { ARENA_RADIUS, PAD_OFFSET, PAD_RADIUS } from "../../../shared/rush/config";
import { PALETTE } from "../../../shared/rush/palette";
import { PAD_TAG } from "../../../shared/rush/types";

/** Where the arena is. Derived from the place's SpawnLocation, so the template works in any place. */
export interface ArenaLayout {
	/** Floor top, at the arena center. */
	readonly center: Vector3;
	readonly radius: number;
	/** Top center of the start pad. */
	readonly pad: Vector3;
	/** Changes when anything that shapes the arena changes; the world handoff rebuilds on a new key. */
	readonly key: string;
}

const ARENA_VERSION = 1;
const UP = new Vector3(0, 1, 0);

export function computeLayout(): ArenaLayout {
	const spawn = Workspace.FindFirstChildWhichIsA("SpawnLocation", true);
	// The floor is a thin skin just above the ground the spawn stands on; the spawn pokes out in the middle.
	const ground = spawn ? spawn.Position.Y - spawn.Size.Y / 2 : 0;
	const center = new Vector3(spawn ? spawn.Position.X : 0, ground + 0.06, spawn ? spawn.Position.Z : 0);
	const pad = center.add(PAD_OFFSET).add(new Vector3(0, 0.4, 0));
	const round = (value: number) => math.round(value * 10) / 10;
	const key = `arena.v${ARENA_VERSION}|r${ARENA_RADIUS}|p${PAD_RADIUS}|${round(pad.X)},${round(pad.Z)}|${round(center.X)},${round(center.Y)},${round(center.Z)}`;
	return { center, radius: ARENA_RADIUS, pad, key };
}

function part(parent: Instance, name: string, setup: (part: Part) => void) {
	const instance = new Instance("Part");
	instance.Name = name;
	instance.Anchored = true;
	instance.TopSurface = Enum.SurfaceType.Smooth;
	instance.BottomSurface = Enum.SurfaceType.Smooth;
	instance.Material = Enum.Material.SmoothPlastic;
	setup(instance);
	instance.Parent = parent;
	return instance;
}

/** A flat cylinder whose top face is centered on `top`. */
function disc(parent: Instance, name: string, top: Vector3, radius: number, thickness: number, color: Color3) {
	return part(parent, name, (p) => {
		p.Shape = Enum.PartType.Cylinder;
		p.Size = new Vector3(thickness, radius * 2, radius * 2);
		p.CFrame = new CFrame(top.sub(UP.mul(thickness / 2))).mul(CFrame.Angles(0, 0, math.pi / 2));
		p.Color = color;
	});
}

function ball(parent: Instance, name: string, position: Vector3, size: number, color: Color3) {
	return part(parent, name, (p) => {
		p.Shape = Enum.PartType.Ball;
		p.Size = new Vector3(size, size, size);
		p.CFrame = new CFrame(position);
		p.Color = color;
	});
}

/** A vertical pole standing on `base`. */
function pole(parent: Instance, name: string, base: Vector3, height: number, width: number, color: Color3) {
	return part(parent, name, (p) => {
		p.Shape = Enum.PartType.Cylinder;
		p.Size = new Vector3(height, width, width);
		p.CFrame = new CFrame(base.add(UP.mul(height / 2))).mul(CFrame.Angles(0, 0, math.pi / 2));
		p.Color = color;
	});
}

/** Builds the whole arena into `model`: soft floor rings, bumper rim, start pad, candy lamps, clouds, the board. */
export function buildArena(model: Model, layout: ArenaLayout) {
	const { center, radius } = layout;

	// Floor: concentric pastel rings, each a hair higher than the last (no z-fighting).
	const rings = [PALETTE.lavender.Lerp(PALETTE.white, 0.45), PALETTE.cream, PALETTE.pink.Lerp(PALETTE.white, 0.55), PALETTE.mint.Lerp(PALETTE.white, 0.55)];
	disc(model, "Floor", center, radius, 1, rings[0]);
	for (let index = 1; index < rings.size(); index++) {
		disc(model, `Ring${index}`, center.add(UP.mul(0.02 * index)), radius * (1 - index * 0.24), 0.2, rings[index]);
	}

	// Rim: soft bumper balls, half sunk into the floor.
	const bumperColors = [PALETTE.pink, PALETTE.sky, PALETTE.lemon, PALETTE.mint, PALETTE.lavender];
	const rimRadius = radius + 1.5;
	const bumpers = math.floor((math.pi * 2 * rimRadius) / 5.2);
	const rim = new Instance("Folder");
	rim.Name = "Rim";
	rim.Parent = model;
	for (let index = 0; index < bumpers; index++) {
		const angle = (index / bumpers) * math.pi * 2;
		const position = center.add(new Vector3(math.cos(angle) * rimRadius, 1, math.sin(angle) * rimRadius));
		ball(rim, `Bumper${index + 1}`, position, 4.6, bumperColors[index % bumperColors.size()]);
	}

	// Start pad: a raised pink button with a glowing edge. Tagged so clients add their own hints to it.
	const padTop = layout.pad;
	const padRim = disc(model, "PadRim", padTop.sub(UP.mul(0.15)), PAD_RADIUS + 0.7, 0.5, PALETTE.pink);
	padRim.Material = Enum.Material.Neon;
	const pad = disc(model, "Pad", padTop, PAD_RADIUS, 0.6, PALETTE.hotPink);
	disc(model, "PadDot", padTop.add(UP.mul(0.02)), PAD_RADIUS * 0.42, 0.1, PALETTE.white).CanCollide = false;
	pad.SetAttribute("Radius", PAD_RADIUS);
	pad.SetAttribute("HeldSince", 0);
	CollectionService.AddTag(pad, PAD_TAG);

	// Candy lamps around the rim.
	const lamps = new Instance("Folder");
	lamps.Name = "Lamps";
	lamps.Parent = model;
	const lampColors = [PALETTE.lemon, PALETTE.pink, PALETTE.sky, PALETTE.mint];
	for (let index = 0; index < 8; index++) {
		const angle = ((index + 0.5) / 8) * math.pi * 2;
		const base = center.add(new Vector3(math.cos(angle) * (radius + 5), 0, math.sin(angle) * (radius + 5)));
		const color = lampColors[index % lampColors.size()];
		pole(lamps, `Pole${index + 1}`, base, 10, 0.8, PALETTE.white).CastShadow = false;
		for (const height of [3, 6]) {
			const band = pole(lamps, `Band${index + 1}`, base.add(UP.mul(height)), 0.6, 0.95, color);
			band.CastShadow = false;
		}
		const bulb = ball(lamps, `Bulb${index + 1}`, base.add(UP.mul(11)), 2.6, color);
		bulb.Material = Enum.Material.Neon;
		bulb.CastShadow = false;
		const light = new Instance("PointLight");
		light.Color = color;
		light.Range = 20;
		light.Brightness = 1.2;
		light.Parent = bulb;
	}

	// A few puffy clouds overhead.
	const clouds = new Instance("Folder");
	clouds.Name = "Clouds";
	clouds.Parent = model;
	const random = new Random(7);
	for (let index = 0; index < 5; index++) {
		const angle = (index / 5) * math.pi * 2 + random.NextNumber(0, 0.6);
		const distance = random.NextNumber(25, 55);
		const middle = center.add(new Vector3(math.cos(angle) * distance, random.NextNumber(45, 60), math.sin(angle) * distance));
		for (let puff = 0; puff < 4; puff++) {
			const offset = new Vector3(random.NextNumber(-7, 7), random.NextNumber(-1.5, 1.5), random.NextNumber(-4, 4));
			const cloud = ball(clouds, `Cloud${index + 1}`, middle.add(offset), random.NextNumber(8, 14), PALETTE.white);
			cloud.CanCollide = false;
			cloud.CanQuery = false;
			cloud.CastShadow = false;
			cloud.Transparency = 0.08;
		}
	}

	// The leaderboard board at the far edge, facing the center (BoardService puts its SurfaceGui on it).
	const boardBase = center.add(new Vector3(0, 0, -(radius - 4)));
	const boardCenter = boardBase.add(UP.mul(11.4));
	const facing = CFrame.lookAt(boardCenter, new Vector3(center.X, boardCenter.Y, center.Z));
	part(model, "BoardTrim", (p) => {
		p.Size = new Vector3(27.2, 15.6, 0.5);
		p.CFrame = facing.mul(new CFrame(0, 0, 0.35));
		p.Color = PALETTE.lavender;
	});
	const board = part(model, "Board", (p) => {
		p.Size = new Vector3(26, 14.4, 0.6);
		p.CFrame = facing;
		p.Color = PALETTE.navy;
	});
	for (const side of [-1, 1]) {
		const leg = pole(model, "BoardLeg", facing.mul(new CFrame(side * 10, -7.2, 0.4)).Position.sub(UP.mul(4.2)), 4.4, 1.2, PALETTE.lavender);
		leg.CastShadow = false;
	}
	CollectionService.AddTag(board, "TargetRush:Board");
}

/**
 * Analytics zones (framework: parts tagged `TTZone`, named by a `Name` attribute; a player is in the smallest one that
 * contains them): invisible boxes from shared/analytics/catalog.ts, in a `Zones` folder inside the arena model.
 *
 * They travel with the model, so the world handoff keeps them (and their tags) across hot-swaps. They are versioned on
 * their own: an adopted arena whose zones are missing or older gets new ones without rebuilding the floor.
 */
export function ensureZones(model: Model, layout: ArenaLayout) {
	const key = `zones.v${ZONE_VERSION}|${layout.key}`;
	const existing = model.FindFirstChild("Zones");
	if (existing && existing.GetAttribute("ZoneKey") === key) return;
	existing?.Destroy();

	const folder = new Instance("Folder");
	folder.Name = "Zones";
	const offset = layout.pad.sub(layout.center);
	const boxes = zoneBoxes({ arenaRadius: layout.radius, padX: offset.X, padZ: offset.Z, padRadius: PAD_RADIUS });
	boxes.forEach((box, index) => {
		const zone = new Instance("Part");
		zone.Name = `${box.name}${index + 1}`;
		zone.Anchored = true;
		zone.CanCollide = false;
		zone.CanQuery = false;
		zone.CanTouch = false;
		zone.CastShadow = false;
		zone.AudioCanCollide = false;
		zone.Transparency = 1;
		zone.Size = new Vector3(box.sx, box.sy, box.sz);
		zone.CFrame = new CFrame(layout.center.add(new Vector3(box.x, box.y, box.z)));
		zone.SetAttribute("Name", box.name);
		zone.Parent = folder;
	});
	folder.SetAttribute("ZoneKey", key);
	folder.Parent = model;
	// Tagged once the parts are in the world (the engine's zone list follows the tag).
	for (const zone of folder.GetChildren()) CollectionService.AddTag(zone, ZONE_TAG);
}
