# TypeTorch starter game

What `typetorch init` scaffolds: **Target Rush**, a round-based minigame that hot-swaps on live servers mid-round, plus
the original lobby coins. It shows every framework feature: services and controllers with constructor injection,
lifecycle hooks, troves everywhere, `observePlayers`, nested guarded networking with rate limits, state that survives
swaps (`persist`), the `TypeTorch` runtime API (update toasts, swap-out saves, branch changes, dev overlay), tagged
elements with per-element troves, charm atoms for UI state, a code-built HUD and world, and the dev menu.

## Layout
One folder per feature on each side; the boot files require every ModuleScript under `services/` / `controllers/`.
```
src/server/boot.ts                         boot(kernel) -> startServer(...)   (called by the kernel's Entry script)
src/server/services/coins/                 WalletService (coins, persist), CoinService (lobby coin ring)
src/server/services/rush/                  Target Rush: Arena, Round, Target, Board, Best services
                                           + arena-builder.ts, handoff.ts, characters.ts (plain helpers)
src/client/boot.ts                         boot(kernel) -> startClient(...)
src/client/controllers/ui/                 UiController: ScreenGui, responsive scale, PopupQueue, toasts, sounds
src/client/controllers/coins/              CoinController (coin prompts), WalletHudController (coin counter)
src/client/controllers/rush/               RushState (charm atoms), Target, RushHud, BoardHud, Results, Pad
src/client/controllers/system/             UpdateToastController, DevOverlayController
src/client/ui/fx.ts                        particle bursts and floating text
src/shared/net.ts                          createNetwork<ClientToServer, ServerToClient>()
src/shared/rush/config.ts                  Target Rush balance knobs (the live-demo file)
src/shared/rush/{types,rules,palette}.ts   shared shapes, pure rules, colors
src/shared/ui/{kit,icons}.ts               code-built UI kit; icons drawn from Frames (no images, no emojis)
src/shared/build.ts                        GENERATED before every compile (git identity), gitignored
default.project.json                       the payload: a Rojo Model with Server/, Shared/, Client/, include/
typetorch.json                             project, place, branches, channels, members (read by the CLI)
```

## Minigame: Target Rush
**How to play.** Step on the pink start pad (or wait for the lobby timer), count down 3-2-1, then pop as many targets
as you can in 60 seconds. Click or tap a target, pull the right trigger on a gamepad (screen center), or run into the
low ones. Each target has an approach ring that closes on it: pop it as the ring turns yellow for PERFECT (30), close
to it for GREAT (20), otherwise GOOD (10). Hits within 3 s of each other build a combo (x2 at 5, x3 at 12, x4 at 25);
clicking empty air ends it. Targets shrink and spawn faster as the round goes on; rare golden targets are worth 5x
and pay coins on the spot. Results show your rank, score, best combo, perfects, hits and coins; scores go on the
session board in the world and in the HUD. Solo works; friends share the targets (first hit wins).

**What each part shows.**
| Part | TypeTorch feature |
|---|---|
| `RoundService` | Server-authoritative round in `persist("rush.round.v1")` (phase, start time, scores, combos): a deploy mid-round carries on with the same round. `onSwapOut` counts the swaps the round survived; `onBranchChanged` resets to the lobby; `observePlayers` for joins; `startInfo` logs "round N carries on" |
| `TargetService` | Hit validation: target exists, timing with capped lag compensation, distance (click range / touching distance), per-player cooldown; `setNetworkLimits` rate/shape limits plus the generated type guards on `rush.hit` / `rush.whiff`. Target parts live in the trove; `onSwapOut` saves them as plain data and the next generation restores them with the same ids and timers |
| `ArenaService` + `handoff.ts` | All world content is code. The static arena is handed over between same-branch generations (adopted by layout key), so the floor never blinks out mid-swap; changing an arena knob rebuilds it |
| `BoardService` | SurfaceGui session board (live round + session bests, `persist`), "Updating..." on `onUpdatePending` (server side), "Updated live xN" and the running `gen | artifact` |
| `BestService` | Personal bests in a DataStore split by channel, one key per player, read once per join, written only on a new best (UpdateAsync max, budget-checked, pcall). Unfinished writes are retried by the next generation from `persist`. Falls back to in-session only when the DataStore is unavailable (Studio without API access), or set `SAVE_PERSONAL_BEST = false` |
| `RushStateController` | Client state as charm atoms per generation, filled by events and a snapshot after join or the client's own swap |
| `TargetController`, `PadController` | `observeElement` (tag + `isRealFrame` + per-element trove) on server parts; local visuals, predicted hits confirmed by `invoke`, edge arrows to off-screen targets |
| `ResultsController` | The single `PopupQueue`; client `persist` remembers which results were closed, so a client swap mid-card shows it again only if it wasn't closed |
| `UpdateToastController` | `onUpdatePending`: "Updating ~3s" toast; after the swap `startInfo` (kind, reason) gives "Updated #seq <id> 1.8s" |
| `DevOverlayController` | `isDev` + `onPlayerDevChanged`: `gen | branch (channel) | artifact | how it started` at the bottom, devs only |

**Live demo.** Start a round, then change a knob in `src/shared/rush/config.ts`, deploy to dev and keep playing:
- `TARGET_SIZE = 9` (or `2.5`): every target changes size the moment the new server generation runs;
- `SPAWN_EVERY_START` / `SPAWN_EVERY_END`: the spawn rate changes mid-round;
- `ROUND_SECONDS = 90`: the running round's timer bar jumps (durations are read from the knobs, not stored);
- `GOLDEN_CHANCE = 0.5`: golden rain.

Players see "Updating ~Ns", then "Updated <id>"; nobody is kicked or reset, the score, combo, timer and targets carry
on, and the board counts "Updated live xN". Arena knobs (`ARENA_RADIUS`, `PAD_*`) rebuild the arena instead.

## Build
```sh
bun scripts/packages.ts   # first time only, until @typetorch/* is on npm (see below)
bun install
bun run build             # writes src/shared/build.ts, then rbxtsc
bun run payload           # build + rojo build -> build/payload.rbxm
```
- `bun scripts/build-info.ts --channel prod --dirty` writes `src/shared/build.ts` by hand (the CLI writes the same
  file). With `TYPETORCH_SKIP_BUILD_INFO=1`, `bun run build` keeps a `build.ts` the CLI already wrote.
- Use `$print` / `$warn` / `$assert` from `rbxts-transform-debug`, never `print` / `warn` / `assert`.

## Local @typetorch packages
Until the packages are published, `@typetorch/framework` and `@typetorch/kernel` come from the sibling repos
(`../framework`, `../kernel`) as packed tarballs in `.typetorch/packages/`. A plain `file:../framework` dependency
does not work with Bun on Windows: Bun copies the whole folder (`.git`, `node_modules`) and fails with EPERM. Bun also
caches tarballs, so a re-packed tarball never reaches `node_modules` through `bun install` alone.

After changing the framework, run:
```sh
bun run packages          # = bun scripts/packages.ts: builds ../framework, packs both, extracts into node_modules
bun run build
```
`bun install` re-extracts the tarballs afterwards (postinstall `--sync`), so it never brings back a stale copy.
The payload maps only `node_modules/@typetorch/framework` (its `out/`), never the kernel.

## Swap-safe rules
- Everything a module creates or connects goes in `this.trove` (Instances, connections, threads, disconnect functions).
- Never `Players.PlayerAdded.Connect`: implement `OnPlayerAdded` (it replays players already in the server).
- Plain data that must survive a swap goes in `this.ctx.persist(key, init)`.
- UI follows the user rules: no emojis, minimal text, UIScale pops (`popIn` / `popOut` / `bump`), script-free
  ScrollingFrames, one PopupQueue for modals.
- Static world geometry that players stand on can be handed over between generations (`handoff.ts`) instead of
  rebuilt; everything else a generation creates stays in its troves.

## Claude tab (remote-claude)
On a dev-channel private server, the dev menu's Claude tab sends prompts to Claude Code on a dev's machine while
`typetorch remote-claude --users <ids>` runs there. Paste the pairing code that typetorch-dev-server prints into the
Claude tab once per session (no Roblox secret needed), and turn on HTTP requests for the experience.
