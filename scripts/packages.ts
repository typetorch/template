/**
 * Local @typetorch packages, until they are on npm: `bun scripts/packages.ts [--sync] [--no-build]`
 *
 * Why not `file:../framework`? Bun copies a `file:` directory dependency wholesale (.git, node_modules, src) and on
 * Windows that copy fails with EPERM. So the template depends on packed tarballs instead (exactly what npm would
 * ship, from each package's "files"):
 *
 *   .typetorch/packages/typetorch-framework.tgz   <- bun pm pack in ../framework (after `bun run build` there)
 *   .typetorch/packages/typetorch-kernel.tgz      <- bun pm pack in ../kernel
 *
 * Bun caches tarballs by path, so a re-packed tarball would not reach node_modules through `bun install`. This
 * script therefore also extracts each tarball straight into node_modules/@typetorch/<name> (the "sync" step).
 *
 *   bun scripts/packages.ts           build framework, pack both, sync into node_modules   (after changing framework)
 *   bun scripts/packages.ts --no-build   pack both and sync, without rebuilding framework
 *   bun scripts/packages.ts --sync    only extract the existing tarballs (runs as postinstall)
 *
 * Packing also records where each tarball came from in .typetorch/packages/manifest.json (the git HEAD and whether the
 * checkout had uncommitted changes). `typetorch build` stamps those commits into the payload ("sources") and lists
 * the commits since the previous deploy as the artifact's "what changed" lines:
 *   { "schema": 1, "packages": { "framework": { "version", "commit", "commitHash", "dirty", "path", "packedAt" }, ... } }
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";

const root = resolve(import.meta.dir, "..");
const packagesDir = join(root, ".typetorch", "packages");
const PACKAGES = [
	{ name: "framework", source: resolve(root, "../framework"), build: true },
	{ name: "kernel", source: resolve(root, "../kernel"), build: false },
];

const syncOnly = Bun.argv.includes("--sync");
const noBuild = Bun.argv.includes("--no-build");

const manifestPath = join(packagesDir, "manifest.json");

/** The checkout's git identity, or undefined outside a git repo. */
function gitSource(dir: string): { commit: string; commitHash: string; dirty: boolean } | undefined {
	const git = (...args: string[]) => {
		const result = Bun.spawnSync(["git", ...args], { cwd: dir, stdout: "pipe", stderr: "pipe" });
		return result.exitCode === 0 ? result.stdout.toString().trim() : undefined;
	};
	const commitHash = git("rev-parse", "HEAD");
	if (!commitHash) return undefined;
	return { commit: commitHash.slice(0, 7), commitHash, dirty: (git("status", "--porcelain") ?? "") !== "" };
}

function readManifest(): { schema: 1; packages: Record<string, unknown> } {
	try {
		const parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
		if (parsed && typeof parsed.packages === "object") return { schema: 1, packages: parsed.packages };
	} catch {}
	return { schema: 1, packages: {} };
}

function run(cmd: string[], cwd: string) {
	const result = Bun.spawnSync(cmd, { cwd, stdout: "inherit", stderr: "inherit" });
	if (result.exitCode !== 0) throw new Error(`${cmd.join(" ")} failed in ${cwd} (exit ${result.exitCode})`);
}

/** Minimal ustar/pax reader: enough for `bun pm pack` output. */
function extract(tarball: string, destination: string) {
	const data = gunzipSync(readFileSync(tarball));
	const text = (from: number, length: number) => {
		const slice = data.subarray(from, from + length);
		const end = slice.indexOf(0);
		return slice.subarray(0, end === -1 ? length : end).toString("utf8");
	};
	let offset = 0;
	let paxPath: string | undefined;
	while (offset + 512 <= data.length) {
		const name = text(offset, 100);
		if (name === "") break;
		const size = parseInt(text(offset + 124, 12).trim() || "0", 8);
		const type = text(offset + 156, 1) || "0";
		const prefix = text(offset + 345, 155);
		const body = data.subarray(offset + 512, offset + 512 + size);
		offset += 512 + Math.ceil(size / 512) * 512;
		if (type === "x") {
			const match = /\d+ path=([^\n]*)\n/.exec(body.toString("utf8"));
			paxPath = match?.[1];
			continue;
		}
		if (type === "g") continue;
		const fullName = paxPath ?? (prefix ? `${prefix}/${name}` : name);
		paxPath = undefined;
		const relative = fullName.replace(/^package\//, "");
		if (relative.includes("..")) throw new Error(`refusing path ${fullName}`);
		const target = join(destination, relative);
		if (type === "5") {
			mkdirSync(target, { recursive: true });
		} else if (type === "0" || type === "\0") {
			mkdirSync(dirname(target), { recursive: true });
			writeFileSync(target, body);
		}
	}
}

mkdirSync(packagesDir, { recursive: true });
const manifest = readManifest();
for (const pkg of PACKAGES) {
	const tarball = join(packagesDir, `typetorch-${pkg.name}.tgz`);
	if (!syncOnly) {
		if (!existsSync(pkg.source)) throw new Error(`${pkg.source} not found (clone it next to template/)`);
		if (pkg.build && !noBuild) run(["bun", "run", "build"], pkg.source);
		// Identity before packing (the framework build writes only ignored files, so it doesn't change "dirty").
		const source = gitSource(pkg.source);
		run(["bun", "pm", "pack", "--filename", tarball, "--ignore-scripts", "--quiet"], pkg.source);
		let version: string | undefined;
		try {
			version = JSON.parse(readFileSync(join(pkg.source, "package.json"), "utf8")).version;
		} catch {}
		manifest.packages[pkg.name] = { version, ...source, path: pkg.source, packedAt: new Date().toISOString() };
		writeFileSync(manifestPath, JSON.stringify(manifest, null, "\t") + "\n");
		console.log(`packages: @typetorch/${pkg.name} ${version ?? "?"} packed from ${source ? `${source.commit}${source.dirty ? " (dirty)" : ""}` : "a folder without git"}`);
	}
	if (!existsSync(tarball)) {
		console.warn(`packages: ${tarball} is missing; run \`bun scripts/packages.ts\` first`);
		continue;
	}
	const installed = join(root, "node_modules", "@typetorch", pkg.name);
	if (!existsSync(join(root, "node_modules"))) continue;
	rmSync(installed, { recursive: true, force: true });
	extract(tarball, installed);
	console.log(`packages: @typetorch/${pkg.name} -> node_modules`);
}
