# TypeTorch starter game

The starter game for a new TypeTorch project: **Target Rush**, a round-based minigame that hot-swaps on live servers
mid-round, plus the original lobby coins. It shows every framework feature: services and controllers with constructor injection,
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
studio.project.json                        Studio testing: the kernel + this payload as ServerStorage.TypeTorchDev.Payload
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
| `DevOverlayController` | `isDev` + `onPlayerDevChanged`: `gen | branch (channel) | artifact | how it started` in the bottom-left corner, devs only |

**Live demo.** Start a round, then change a knob in `src/shared/rush/config.ts`, deploy to dev and keep playing:
- `TARGET_SIZE = 9` (or `2.5`): every target changes size the moment the new server generation runs;
- `SPAWN_EVERY_START` / `SPAWN_EVERY_END`: the spawn rate changes mid-round;
- `ROUND_SECONDS = 90`: the running round's timer bar jumps (durations are read from the knobs, not stored);
- `GOLDEN_CHANCE = 0.5`: golden rain.

Players see "Updating ~Ns", then "Updated <id>"; nobody is kicked or reset, the score, combo, timer and targets carry
on, and the board counts "Updated live xN". Arena knobs (`ARENA_RADIUS`, `PAD_*`) rebuild the arena instead.

## Build
```sh
bun install               # @typetorch/* from npm (framework, kernel, transformer, cli, dev-server)
bun run build             # writes src/shared/build.ts, then rbxtsc
bun run payload           # build + rojo build -> build/payload.rbxm
bun run typetorch build   # the CLI (@typetorch/cli): the payload exactly as a deploy uploads it
```
- `bun scripts/build-info.ts --channel prod --dirty` writes `src/shared/build.ts` by hand (the CLI writes the same
  file). With `TYPETORCH_SKIP_BUILD_INFO=1`, `bun run build` keeps a `build.ts` the CLI already wrote.
- Use `$print` / `$warn` / `$assert` from `rbxts-transform-debug`, never `print` / `warn` / `assert`.
- `tsconfig.json` runs two compiler plugins, in this order: `rbxts-transform-debug` (the `$print` macros), then
  `@typetorch/transformer` (the type guards `createNetwork` checks every message with, the constructor dependency ids
  of `@Service` / `@Controller`, and your own `Modding` macros). No Flamework: `Modding`, `Reflect` and `t` come from
  `@typetorch/framework`, and only that package is mapped into the payload.
- With a framework checkout next to the game, `bun run payload` then
  `lune run ../framework/scripts/test-generations.luau build/payload.rbxm` boots two
  generations of the payload under Lune and checks that each gets a fresh registry, that every service and controller
  registers and resolves its dependencies, and that the network guards work.

## Testing in Studio
Run your local code in Studio with the real kernel, the dev menu and DataStores, without uploading anything.
```sh
bun run watch             # build info, then rbxtsc -w (recompiles out/ on every save)
bun run studio            # in a second terminal: rojo serve studio.project.json
```
Open a place of this experience in Studio (DataStores need "Enable Studio Access to API Services"), connect the Rojo
plugin, then press Play.
- `studio.project.json` syncs the kernel from `node_modules/@typetorch/kernel` (the same tree as the kernel's place)
  and the compiled payload (`out/`, `include/` and the packages, the same tree as `default.project.json`) into
  `ServerStorage.TypeTorchDev.Payload`, plus the kernel place's baseplate and spawn.
- In Studio, kernel 0.3.1+ mounts a clone of that Model instead of an uploaded artifact: id `local-<HHMMSS UTC>`,
  branch `dev` (or the `Branch` attribute of `ServerStorage.TypeTorchDev`), dev channel. Server > Status shows
  "Studio: local payload".
- The payload holds only ModuleScripts, so nothing in it runs by itself: only the kernel's clone runs, once.
- **Code changes need Stop + Play.** Rojo doesn't sync into a running play session. The dev menu's Reload remounts a
  fresh clone of the same code: use it to test swaps (`persist`, `onSwapOut`, update toasts), not new code.
- Deploys and the 60 s poll don't move a local session. A pin or branch switch in the dev menu still loads an uploaded
  artifact, and Reload goes back to the local copy. To boot the branch head again, delete
  `ServerStorage.TypeTorchDev.Payload` (with Rojo disconnected).
- Don't save or publish the place from that session: live servers ignore the folder, but it bloats the place
  (`typetorch doctor` warns). `typetorch kernel deploy` publishes the place.
- Kernel 0.3.0 ignores the folder and boots the branch head: it needs `@typetorch/kernel` 0.3.1 or newer.

## Unreleased framework or kernel changes
The game takes `@typetorch/*` from npm. To build and deploy changes to the framework, kernel or transformer that
aren't released yet, clone those repos next to the game (`../framework`, `../kernel`, `../transformer`) and run:
```sh
bun run packages          # builds ../framework and ../transformer, packs all three into .typetorch/packages/,
                          #   extracts them over node_modules/@typetorch (a local override)
bun run build
```
- The override stays on across `bun install` (postinstall re-extracts the tarballs) until
  `bun run packages --off`, which deletes them and reinstalls the npm versions.
- `typetorch build` stamps the checkouts' commits as the payload's sources (from `.typetorch/packages/manifest.json`);
  without the override it stamps the npm versions.
- Why tarballs: a plain `file:../framework` dependency does not work with Bun on Windows (Bun copies the whole folder,
  `.git` and `node_modules` too, and fails with EPERM), and Bun caches tarballs, so the script extracts them itself.
- The payload maps only `node_modules/@typetorch/framework` (its `out/`), never the kernel or the transformer.

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
`bun run typetorch remote-claude --users <ids>` (the CLI runs `@typetorch/dev-server`) runs there. Paste the code it prints into the
Claude tab once per session (no Roblox secret needed), and turn on HTTP requests for the experience.
