/**
 * /talk regression suite runner — `node lib/talk/tests/run-tests.mjs`
 * (wired to `/talk test`). Bundles tests/entry.ts with esbuild, then runs it
 * on plain node. Exit code 0 = all green; summary lines start with "# ".
 */
import { execFileSync } from "node:child_process";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXT_DIR = join(__dirname, "..", "..", "..");
const ESBUILD = join(process.env.HOME ?? "", ".pi", "agent", "npm", "node_modules", "esbuild", "lib", "main.js");
const OUT = join(tmpdir(), `talk-tests-${process.pid}.mjs`);
const entryFile = join(__dirname, "entry.ts");

if (!existsSync(ESBUILD)) {
	console.error("esbuild not found at " + ESBUILD);
	process.exit(2);
}

const { build } = await import("file://" + ESBUILD);
await build({
	entryPoints: [entryFile],
	bundle: true,
	platform: "node",
	format: "esm",
	outfile: OUT,
	absWorkingDir: EXT_DIR,
	logLevel: "silent",
});

try {
	execFileSync("node", [OUT], { stdio: "inherit" });
} catch (error) {
	const status = typeof error === "object" && error !== null && "status" in error ? error.status : undefined;
	process.exit(typeof status === "number" ? status : 1);
} finally {
	try {
		rmSync(OUT, { force: true });
	} catch {
		/* keep for debug */
	}
}

// Also run each pack's own design-system suite (node:test) under ~/.pi/agent/talk/styles/*/tests
import { readdirSync } from "node:fs";
const stylesDir = join(process.env.HOME ?? "", ".pi", "agent", "talk", "styles");
if (existsSync(stylesDir)) {
	for (const pack of readdirSync(stylesDir, { withFileTypes: true }).filter((d) => d.isDirectory())) {
		const packTests = join(stylesDir, pack.name, "tests");
		if (!existsSync(packTests)) continue;
		// Expand manually: `node --test "tests/*.mjs"` needs glob support (Node 21+)
		const testFiles = readdirSync(packTests)
			.filter((f) => f.endsWith(".mjs"))
			.map((f) => join(packTests, f));
		if (testFiles.length === 0) continue;
		try {
			execFileSync("node", ["--test", ...testFiles], { cwd: join(stylesDir, pack.name), stdio: "inherit" });
		} catch (error) {
			const status = typeof error === "object" && error !== null && "status" in error ? error.status : undefined;
			process.exit(typeof status === "number" ? status : 1);
		}
	}
}
