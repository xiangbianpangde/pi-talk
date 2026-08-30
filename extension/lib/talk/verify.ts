/**
 * Visual self-check for /talk surfaces.
 *
 * Closes the "blind render" gap: after rendering, take a real headless
 * screenshot of the surface and report console errors + DOM stats so the
 * agent can look at what it actually produced (and fix it).
 *
 * Strategy: python playwright (if importable) gives screenshot + console +
 * page errors in one probe; otherwise fall back to a Chrome/Chromium
 * headless CLI screenshot only.
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getSessionDir } from "./paths";

export interface VerifyTarget {
	sessionId?: string;
	server?: {
		url: string;
		getState(surfaceId?: string): { html: string; title: string } | undefined;
	};
}

export interface VerifyOptions {
	screenshot?: boolean;
	console?: boolean;
	pdf?: boolean;
	surface?: string;
	width?: number;
	height?: number;
}

export interface VerifyResult {
	ok: boolean;
	url?: string;
	screenshot?: string;
	pdf?: string;
	consoleErrors: Array<{ type: string; text: string }>;
	pageErrors: string[];
	failedRequests: Array<{ url: string; err: string | null }>;
	dom?: { title: string; h1s: number; textLen: number };
	error?: string;
}

function runCommand(cmd: string, args: string[], timeoutMs: number): Promise<{ code: number; stdout: string; stderr: string }> {
	return new Promise((resolve) => {
		const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
		child.stdout.on("data", (d) => (stdout += String(d)));
		child.stderr.on("data", (d) => (stderr += String(d)));
		child.on("close", (code) => {
			clearTimeout(timer);
			resolve({ code: code ?? 1, stdout, stderr });
		});
		child.on("error", (err) => {
			clearTimeout(timer);
			resolve({ code: 1, stdout, stderr: err.message });
		});
	});
}

function isPng(file: string): boolean {
	try {
		const head = readFileSync(file).subarray(0, 8);
		return head.length === 8 && head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
	} catch {
		return false;
	}
}

function isPdf(file: string): boolean {
	try {
		const head = readFileSync(file).subarray(0, 5).toString("latin1");
		return head === "%PDF-";
	} catch {
		return false;
	}
}

export function resolveChrome(): string | undefined {
	const env = process.env.CHROME_PATH;
	if (env && existsSync(env)) return env;
	const candidates: string[] = [];
	if (process.platform === "darwin") {
		candidates.push(
			"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
			"/Applications/Chromium.app/Contents/MacOS/Chromium",
			"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
			join(process.env.HOME ?? "", "Library", "Caches", "ms-playwright"),
		);
	} else {
		candidates.push(join(process.env.HOME ?? "", ".cache", "ms-playwright"));
	}
	const cacheBase = candidates.pop()!;
	if (existsSync(cacheBase)) {
		try {
			const dirs = readdirSync(cacheBase);
			// Newest chromium_headless_shell / chromium first
			dirs.sort().reverse();
			for (const dir of dirs) {
				if (dir.startsWith("chromium_headless_shell-")) {
					const p = process.platform === "darwin"
						? join(cacheBase, dir, "chrome-headless-shell-mac-arm64", "chrome-headless-shell")
						: join(cacheBase, dir, "chrome-linux", "headless_shell");
					if (existsSync(p)) return p;
				}
				if (dir.startsWith("chromium-")) {
					const p = process.platform === "darwin"
						? join(cacheBase, dir, "Chromium.app", "Contents", "MacOS", "Chromium")
						: join(cacheBase, dir, "chrome-linux", "chrome");
					if (existsSync(p)) return p;
				}
			}
		} catch {
			/* fallthrough */
		}
	}
	for (const c of candidates) {
		if (existsSync(c)) return c;
	}
	return undefined;
}

/** Headless Chrome CLI screenshot/PDF (no python needed). */
export async function chromeCapture(
	url: string,
	out: string,
	opts?: { pdf?: boolean; width?: number; height?: number },
): Promise<{ ok: boolean; error?: string; stderr?: string }> {
	const chrome = resolveChrome();
	if (!chrome) return { ok: false, error: "no chrome/chromium found (set CHROME_PATH)" };
	const args = [
		"--headless=new",
		"--disable-gpu",
		"--hide-scrollbars",
		"--no-first-run",
		"--disable-extensions",
		"--disable-background-networking",
		`--window-size=${opts?.width ?? 1440},${opts?.height ?? 2400}`,
	];
	if (opts?.pdf) {
		// --virtual-time-budget crashes headless-shell on heavy pages; PDF doesn't need it
		args.push(`--print-to-pdf=${out}`, "--no-pdf-header-footer", "--print-to-pdf-no-header");
	} else {
		// Same crash applies to --screenshot: VTB + report runtime (mermaid/animations)
		// makes headless-shell exit 1. Run compositor stages instead; the page load
		// event gates the capture, fonts/animations settle shortly after.
		args.push("--run-all-compositor-stages-before-draw", `--screenshot=${out}`);
	}
	args.push(url);
	const result = await runCommand(chrome, args, 60_000);
	const valid = opts?.pdf ? isPdf(out) : isPng(out);
	return {
		ok: result.code === 0 && existsSync(out) && valid,
		error: !valid ? `capture produced no valid ${opts?.pdf ? "pdf" : "png"} (exit ${result.code})` : undefined,
		stderr: result.stderr.slice(0, 2000),
	};
}

const PROBE_SCRIPT = `
import json, sys
from playwright.sync_api import sync_playwright
url, out = sys.argv[1], sys.argv[2]
console, errors, failed = [], [], []
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1440, "height": 900})
    pg.on("console", lambda m: console.append({"type": m.type, "text": m.text[:500]}))
    pg.on("pageerror", lambda e: errors.append(str(e)[:500]))
    pg.on("requestfailed", lambda r: failed.append({"url": r.url[:200], "err": r.failure}))
    pg.goto(url, wait_until="load", timeout=15000)
    pg.wait_for_timeout(800)
    title = pg.title()
    h1s = pg.locator("h1").count()
    text = pg.inner_text("body")[:2000]
    pg.screenshot(path=out, full_page=True)
    b.close()
print(json.dumps({"title": title, "h1s": h1s, "textLen": len(text), "console": console, "errors": errors, "failed": failed}))
`;

let cachedPython: string | undefined | null;

function resolvePython(): string | undefined {
	if (cachedPython !== undefined) return cachedPython ?? undefined;
	const candidates = [process.env.TALK_PYTHON, "python3", "python"].filter(
		(c): c is string => typeof c === "string" && c.length > 0,
	);
	for (const c of candidates) {
		try {
			const found = spawnSync(c, ["-c", "import playwright"], { timeout: 5000 });
			if (found.status === 0) {
				cachedPython = c;
				return c;
			}
		} catch {
			/* try next */
		}
	}
	cachedPython = null;
	return undefined;
}

/** Probe with python playwright: screenshot + console + page errors in one pass. */
export async function probeWithPlaywright(
	url: string,
	screenshotOut: string,
): Promise<{ ok: boolean; data?: VerifyResult; error?: string }> {
	const python = resolvePython();
	if (!python) return { ok: false, error: "python playwright not available" };
	// Probe script lives in the system tmp dir, not the talk sessions home
	const probeFile = join(tmpdir(), `talk-probe-${process.pid}.py`);
	try {
		writeFileSync(probeFile, PROBE_SCRIPT);
	} catch {
		return { ok: false, error: "cannot write probe script" };
	}
	try {
		const result = await runCommand(python, [probeFile, url, screenshotOut], 60_000);
		const lastLine = result.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1) ?? "";
		let data: any = null;
		try {
			data = JSON.parse(lastLine);
		} catch {
			return {
				ok: false,
				error: `probe failed (exit ${result.code}): ${(result.stderr || result.stdout).slice(0, 500)}`,
			};
		}
		return {
			ok: data && existsSync(screenshotOut) && isPng(screenshotOut),
			data: {
				ok: true,
				consoleErrors: data.console ?? [],
				pageErrors: data.errors ?? [],
				failedRequests: data.failed ?? [],
				dom: {
					title: data.title ?? "",
					h1s: data.h1s ?? 0,
					textLen: data.textLen ?? 0,
				},
			},
		};
	} finally {
		try {
			rmSync(probeFile, { force: true });
		} catch {
			/* ignore */
		}
	}
}

export async function verifySurface(
	target: VerifyTarget,
	opts?: VerifyOptions,
): Promise<VerifyResult> {
	const surface = opts?.surface && /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(opts.surface) ? opts.surface : "main";
	if (!target.server) return { ok: false, error: "no active talk session" };
	const base = target.server.url;
	const url = surface === "main" ? base : `${base}s/${surface}`;

	const shotsDir = target.sessionId
		? join(getSessionDir(target.sessionId), "shots")
		: join(getSessionDir("_"), "shots");
	try {
		mkdirSync(shotsDir, { recursive: true });
	} catch {
		return { ok: false, error: "cannot create shots dir" };
	}
	const stamp = Date.now();
	const shotFile = join(shotsDir, `${stamp}-${surface}.png`);
	const pdfFile = opts?.pdf ? join(shotsDir, `${stamp}-${surface}.pdf`) : undefined;

	const result: VerifyResult = { ok: false, consoleErrors: [], pageErrors: [], failedRequests: [] };
	result.url = url;

	if (opts?.console !== false) {
		const probe = await probeWithPlaywright(url, shotFile);
		if (probe.ok && probe.data) {
			result.consoleErrors = probe.data.consoleErrors;
			result.pageErrors = probe.data.pageErrors;
			result.failedRequests = probe.data.failedRequests;
			result.dom = probe.data.dom;
			result.screenshot = shotFile;
			result.ok = true;
		} else if (opts?.screenshot !== false) {
			// Fallback: CLI screenshot, no console capture
			const shot = await chromeCapture(url, shotFile, { width: opts?.width, height: opts?.height });
			if (shot.ok) {
				result.screenshot = shotFile;
				result.ok = true;
			} else {
				result.error = shot.error || shot.stderr || "screenshot failed";
				return result;
			}
		} else {
			result.error = probe.error ?? "probe failed";
			return result;
		}
	} else if (opts?.screenshot !== false) {
		const shot = await chromeCapture(url, shotFile, { width: opts?.width, height: opts?.height });
		if (!shot.ok) {
			result.error = shot.error || shot.stderr || "screenshot failed";
			return result;
		}
		result.screenshot = shotFile;
		result.ok = true;
	} else {
		result.ok = true;
	}

	if (pdfFile) {
		const pdf = await chromeCapture(url, pdfFile, { pdf: true, width: opts?.width, height: opts?.height });
		if (pdf.ok) result.pdf = pdfFile;
		else result.error = result.error || pdf.error || "pdf capture failed";
	}
	return result;
}
