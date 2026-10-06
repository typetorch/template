--!nocheck
-- Offline check of the game's analytics catalog (src/shared/analytics/catalog.ts), compiled, under Lune:
--   bun run build && lune run scripts/test-analytics.luau        (or: bun run test:analytics)
-- What it guards:
--   - stability: funnel step labels and indexes, experiment variants and controls, event names (renaming or
--     renumbering one splits the data: old rows keep the old name);
--   - shapes the engine accepts: names 1-64 characters, 1-16 distinct variants, distinct values;
--   - zones: the engine puts a player in the smallest TTZone box containing them, so the boxes must nest
--     (StartPad < Board < Lobby < Arena < Outskirts), the round zones must stay inside their circles and cover them,
--     and sample spots (spawn, pad, coin ring, board, rim, beyond) must land in the right zone.
local fs = require("@lune/fs")
local luau = require("@lune/luau")
local process = require("@lune/process")

local path = process.args[1] or "out/shared/analytics/catalog.luau"
local C = luau.load(fs.readFile(path), { debugName = path, environment = setmetatable({}, { __index = _G }) })()

local passed, failed = 0, 0
local function check(label, condition, detail)
	if condition then
		passed += 1
	else
		failed += 1
		print("FAIL " .. label .. (if detail ~= nil then ": " .. tostring(detail) else ""))
	end
end
local function same(a, b)
	if #a ~= #b then
		return false
	end
	for i = 1, #a do
		if a[i] ~= b[i] then
			return false
		end
	end
	return true
end
local function list(t)
	return table.concat(t, ",")
end
local function snake(name)
	return type(name) == "string" and #name >= 1 and #name <= 64 and string.match(name, "^[a-z][a-z0-9_]*$") ~= nil
end
local function pascal(name)
	return type(name) == "string" and #name >= 1 and #name <= 64 and string.match(name, "^[A-Z][A-Za-z]*$") ~= nil
end
local function distinct(values)
	local seen = {}
	for _, v in values do
		if seen[v] then
			return false, v
		end
		seen[v] = true
	end
	return true
end

-- Funnels: the labels and their order are the data's step indexes. Add at the end; never change these. ------------
local GOLDEN_FUNNELS = {
	onboarding = { "spawned", "moved", "reached_pad", "round_joined", "first_hit", "round_finished", "second_round" },
	round = { "lobby", "countdown", "started", "first_hit", "finished" },
	shop = { "opened", "item_viewed", "bought", "equipped" },
}
for name, golden in GOLDEN_FUNNELS do
	local steps = C.FUNNELS[name]
	check(`funnel {name} exists`, steps ~= nil)
	if steps then
		local prefix = { table.unpack(steps, 1, #golden) }
		check(`funnel {name}: steps 1..{#golden} unchanged`, same(prefix, golden), list(steps))
		check(`funnel {name}: labels distinct`, (distinct(steps)))
		for index, label in steps do
			check(`funnel {name}: "{label}" is a valid name`, snake(label))
			check(`funnel {name}: stepIndex("{label}") = {index}`, C.stepIndex(name, label) == index, C.stepIndex(name, label))
		end
	end
end
for name in C.FUNNELS do
	check(`funnel name "{name}" is valid`, snake(name))
end

-- Experiments: the first variant is the control. ------------------------------------------------------------------
local GOLDEN_EXPERIMENTS = {
	onboarding_hint = { "none", "arrow" },
	round_length = { "normal", "short" },
	aim_assist = { "normal", "generous" },
}
local names = {}
for name in C.EXPERIMENTS do
	table.insert(names, name)
end
table.sort(names)
local declared = table.clone(C.EXPERIMENT_NAMES)
table.sort(declared)
check("EXPERIMENT_NAMES lists every experiment", same(names, declared), list(declared))
for name, golden in GOLDEN_EXPERIMENTS do
	local variants = C.EXPERIMENTS[name]
	check(`experiment {name} exists`, variants ~= nil)
	if variants then
		check(`experiment {name}: variants unchanged (control first)`, same({ table.unpack(variants, 1, #golden) }, golden), list(variants))
	end
end
for name, variants in C.EXPERIMENTS do
	check(`experiment "{name}" is a valid name`, snake(name))
	check(`experiment {name}: 1-16 variants`, #variants >= 1 and #variants <= 16, #variants)
	check(`experiment {name}: variants distinct`, (distinct(variants)))
	for _, variant in variants do
		check(`experiment {name}: variant "{variant}" is valid`, snake(variant))
	end
end
check("the variant attribute name", C.variantAttribute("aim_assist") == "Exp_aim_assist", C.variantAttribute("aim_assist"))

-- Activities, screens, events, coins. ----------------------------------------------------------------------------
check("activities", same(C.ACTIVITIES, { "lobby", "queued", "countdown", "round", "results", "waiting" }), list(C.ACTIVITIES))
local screens = {}
for _, phase in { "lobby", "countdown", "round", "results" } do
	check(`a HUD screen for the {phase} phase`, pascal(C.HUD_SCREENS[phase]), C.HUD_SCREENS[phase])
	table.insert(screens, C.HUD_SCREENS[phase])
end
for _, screen in C.SCREENS do
	check(`screen "{screen}" is valid`, pascal(screen))
	table.insert(screens, screen)
end
check("screen names distinct", (distinct(screens)))

local events = {}
for key, name in C.EVENTS do
	check(`event {key} = "{name}" is a valid name`, snake(name))
	table.insert(events, name)
end
local ok, dup = distinct(events)
check("event names distinct", ok, dup)
local GOLDEN_EVENTS = {
	targetHit = "target_hit",
	targetMissed = "target_missed",
	roundEnd = "round_end",
	personalBest = "personal_best",
	coinPickup = "coin_pickup",
	promptShown = "purchase_prompt_shown",
	promptCancelled = "purchase_prompt_cancelled",
	itemViewed = "item_viewed",
	shopOpened = "shop_opened",
}
for key, name in GOLDEN_EVENTS do
	check(`event {key} is still "{name}"`, C.EVENTS[key] == name, C.EVENTS[key])
end
check("currency is coins", C.CURRENCY == "coins")
local reasons = {}
for _, reason in C.COIN_REASONS do
	check(`coin reason "{reason}" is valid`, snake(reason))
	table.insert(reasons, reason)
end
check("coin reasons distinct", (distinct(reasons)))

-- Zones. -----------------------------------------------------------------------------------------------------------
check("zone tag", C.ZONE_TAG == "TTZone")
for _, zone in C.ZONES do
	check(`zone "{zone}" is valid`, pascal(zone))
end

-- The shipped arena (config.ts: ARENA_RADIUS 40, PAD_OFFSET (0, 0, -16), PAD_RADIUS 5).
local LAYOUT = { arenaRadius = 40, padX = 0, padZ = -16, padRadius = 5 }
local boxes = C.zoneBoxes(LAYOUT)
local function volumes(boxList, name)
	local least, most = math.huge, 0
	for _, box in boxList do
		if box.name == name then
			local volume = box.sx * box.sy * box.sz
			least = math.min(least, volume)
			most = math.max(most, volume)
		end
	end
	return least, most
end
local padLeast, padMost = volumes(boxes, "StartPad")
local boardLeast, boardMost = volumes(boxes, "Board")
local lobbyLeast, lobbyMost = volumes(boxes, "Lobby")
local arenaLeast, arenaMost = volumes(boxes, "Arena")
local outLeast = volumes(boxes, "Outskirts")
check("nesting: StartPad < Board", padMost < boardLeast, `{padMost} {boardLeast}`)
check("nesting: Board < every Lobby box", boardMost < lobbyLeast, `{boardMost} {lobbyLeast}`)
check("nesting: Lobby < every Arena box", lobbyMost < arenaLeast, `{lobbyMost} {arenaLeast}`)
check("nesting: Arena < Outskirts", arenaMost < outLeast, `{arenaMost} {outLeast}`)

-- Round zones: inscribed (no corner outside the circle) and covering at least 95% of the radius all around.
local function discCheck(name, radius)
	local disc = C.discBoxes(name, radius, 0, 10)
	local inside = true
	for _, box in disc do
		if (box.sx / 2) ^ 2 + (box.sz / 2) ^ 2 > radius * radius + 1e-6 then
			inside = false
		end
	end
	check(`{name} r{radius}: every box inside the circle`, inside)
	local uncovered = 0
	for degrees = 0, 359 do
		local a = math.rad(degrees)
		local x, z = math.cos(a) * radius * 0.95, math.sin(a) * radius * 0.95
		if C.zoneAt(disc, x, 5, z) ~= name then
			uncovered += 1
		end
	end
	check(`{name} r{radius}: covers 95% of the radius all around`, uncovered == 0, `{uncovered} of 360 directions`)
end
discCheck("Lobby", 26)
discCheck("Arena", 40)
discCheck("Arena", 60)

-- Where spots land (character root height: 3 studs above the floor).
local SPOTS = {
	{ "the spawn", 0, 3, 0, "Lobby" },
	{ "the start pad", 0, 3, -16, "StartPad" },
	{ "the pad's edge", 4.5, 3, -16, "StartPad" },
	{ "the lobby coin ring", 0, 3, 22, "Lobby" },
	{ "the coin ring, east", 22, 3, 0, "Lobby" },
	{ "the coin ring, diagonal", 15.6, 3, 15.6, "Lobby" },
	{ "in front of the board", 0, 3, -30, "Board" },
	{ "the floor, east", 33, 3, 0, "Arena" },
	{ "the floor near the rim, diagonal", 26.5, 3, 26.5, "Arena" },
	{ "the floor near the rim, south", 0, 3, 38, "Arena" },
	{ "a jump above the middle", 0, 10, 0, "Lobby" },
	{ "beyond the rim", 46, 3, 0, "Outskirts" },
	{ "fallen below", 0, -20, 0, "Outskirts" },
	{ "far away", 200, 3, 0, "" },
}
for _, spot in SPOTS do
	local label, x, y, z, want = spot[1], spot[2], spot[3], spot[4], spot[5]
	local got = C.zoneAt(boxes, x, y, z)
	check(`{label} is {if want == "" then "no zone" else want}`, got == want, got)
end

-- A bigger and a smaller arena keep the Lobby/Arena nesting (the arena boxes grow taller).
for _, radius in { 30, 60, 90 } do
	local other = C.zoneBoxes({ arenaRadius = radius, padX = 0, padZ = -16, padRadius = 5 })
	local _, otherLobbyMost = volumes(other, "Lobby")
	local otherArenaLeast = volumes(other, "Arena")
	check(`radius {radius}: Lobby < every Arena box`, otherLobbyMost < otherArenaLeast, `{otherLobbyMost} {otherArenaLeast}`)
	check(`radius {radius}: the middle is Lobby`, C.zoneAt(other, 0, 3, 0) == "Lobby")
	check(`radius {radius}: near the rim is Arena`, C.zoneAt(other, 0, 3, radius - 2) == "Arena", C.zoneAt(other, 0, 3, radius - 2))
end

print(`test-analytics: {if failed == 0 then `all {passed} checks passed` else `{failed} of {passed + failed} checks failed`}`)
if failed > 0 then
	process.exit(1)
end
