/** /talk regression suite. All runtime data lives in a disposable home. */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const extensionDir = join(here, "..", "..", "..");
const agentDir = join(homedir(), ".pi", "agent");
const esbuildPath = join(agentDir, "npm", "node_modules", "esbuild", "lib", "main.js");
const parse5Path = join(agentDir, "npm", "node_modules", "parse5", "dist", "index.js");
const require = createRequire(import.meta.url);
// Resolve the real schema library, never a registration-only mock.
const typeboxPath = require.resolve("typebox", { paths: [extensionDir, join(agentDir, "npm"), join(agentDir, "npm", "node_modules", "pi-subagents"), process.env.PI_PACKAGE_DIR || extensionDir] });
const checkoutStyles = join(extensionDir, "..", "styles");
const sourceStyles = existsSync(checkoutStyles) ? checkoutStyles : join(agentDir, "talk", "styles");

if (!existsSync(esbuildPath) || !existsSync(parse5Path)) {
	console.error("Missing test dependencies: esbuild and parse5 under " + join(agentDir, "npm"));
	process.exit(2);
}

const sandbox = mkdtempSync(join(tmpdir(), "talk-tests-"));
const home = join(sandbox, "home");
const isolatedAgent = join(home, ".pi", "agent");
const talkHome = join(isolatedAgent, "talk");
const out = join(sandbox, "entry.mjs");
let status = 0;
try {
	mkdirSync(talkHome, { recursive: true });
	mkdirSync(join(sandbox, "tmp"));
	// Dependencies are read by the suites, never installed or modified here.
	symlinkSync(join(agentDir, "npm"), join(isolatedAgent, "npm"), "dir");
	if (existsSync(sourceStyles)) cpSync(sourceStyles, join(talkHome, "styles"), { recursive: true });
	const checkoutComponents = join(extensionDir, "..", "components");
	const components = existsSync(checkoutComponents) ? checkoutComponents : join(agentDir, "talk", "components");
	if (existsSync(components)) cpSync(components, join(talkHome, "components"), { recursive: true });
	// Preserve render/open routing, but don't launch desktop applications in tests.
	const bin = join(sandbox, "bin");
	mkdirSync(bin);
	for (const command of ["open", "xdg-open"]) writeFileSync(join(bin, command), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
	const env = { ...process.env, HOME: home, USERPROFILE: home, TALK_TEST_HOME: home, TMPDIR: join(sandbox, "tmp"), TMP: join(sandbox, "tmp"), TEMP: join(sandbox, "tmp"), PATH: bin + ":" + process.env.PATH };
	const { build } = await import(pathToFileURL(esbuildPath).href);
	await build({
		entryPoints: [join(here, "entry.ts")], bundle: true, platform: "node", format: "esm", outfile: out,
		absWorkingDir: extensionDir,
		plugins: [{ name: "resolve-pi-parse5", setup(build) {
			build.onResolve({ filter: /\.\.\/\.\.\/\.\.\/npm\/node_modules\/parse5\/dist\/index\.js$/ }, () => ({ path: parse5Path }));
			build.onResolve({ filter: /^typebox$/ }, () => ({ path: typeboxPath }));
		} }], logLevel: "silent",
	});
	console.log("# Isolated talk test home: " + home);
	execFileSync(process.execPath, [out], { stdio: "inherit", env });
	if (process.env.PI_CODING_AGENT_PACKAGE) {
		const sdkExtension = join(sandbox, "talk.mjs");
		await build({ entryPoints: [join(extensionDir, "talk.ts")], bundle: true, platform: "node", format: "esm", outfile: sdkExtension,
			plugins: [{ name: "sdk-dependencies", setup(build) {
				build.onResolve({ filter: /\.\.\/\.\.\/\.\.\/npm\/node_modules\/parse5\/dist\/index\.js$/ }, () => ({ path: parse5Path }));
				build.onResolve({ filter: /^typebox$/ }, () => ({ path: typeboxPath }));
			} }], logLevel: "silent" });
		execFileSync(process.execPath, [join(here, "pi-lifecycle.mjs")], { stdio: "inherit", env: { ...env, TALK_SDK_EXTENSION: sdkExtension } });
	}
	// Run source suites so relative source imports still resolve to this checkout.
	if (existsSync(sourceStyles)) for (const pack of readdirSync(sourceStyles, { withFileTypes: true }).filter((d) => d.isDirectory())) {
		const tests = join(sourceStyles, pack.name, "tests");
		if (!existsSync(tests)) continue;
		const files = readdirSync(tests).filter((f) => f.endsWith(".mjs")).map((f) => join(tests, f));
		if (files.length) execFileSync(process.execPath, ["--test", ...files], { cwd: join(sourceStyles, pack.name), stdio: "inherit", env });
	}
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	status = typeof error?.status === "number" ? error.status : 1;
} finally {
	rmSync(sandbox, { recursive: true, force: true });
}
process.exitCode = status;
