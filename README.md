# TypeTorch starter game

What `typetorch init` scaffolds: a small coin game that hot-swaps on live servers and shows every framework feature
(services with constructor injection, controllers, nested guarded networking, state that survives swaps, tagged
elements with per-element troves, a code-built HUD, the dev menu).

## Layout
```
src/server/boot.ts                    boot(kernel) -> startServer(...)   (called by the kernel's Entry script)
src/server/services/*.service.ts      @Service classes (ScoreService, CoinService <- ScoreService injected)
src/client/boot.ts                    boot(kernel) -> startClient(...)
src/client/controllers/*.controller.ts  @Controller classes (CoinController, HudController)
src/shared/net.ts                     createNetwork<ClientToServer, ServerToClient>()
src/shared/build.ts                   GENERATED before every compile (git identity), gitignored
default.project.json                  the payload: a Rojo Model with Server/, Shared/, Client/, include/
typetorch.json                        project, place, branches, channels, members (read by the CLI)
```

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
  ScrollingFrames.

## Claude tab (remote-claude)
On a dev-channel private server, the dev menu's Claude tab sends prompts to Claude Code on a dev's machine while
`typetorch remote-claude --users <ids>` runs there. One-time setup: add the experience secret
`typetorch_remote_claude` (Creator Hub, Secrets, domain `*.trycloudflare.com`; for Studio, a local secret) with the same
value as `TYPETORCH_REMOTE_CLAUDE_SECRET` on that machine, and turn on HTTP requests for the experience.
