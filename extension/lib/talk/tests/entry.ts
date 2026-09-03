/**
 * /talk regression tests (entry). Bundled by run-tests.mjs with esbuild and
 * executed on plain node. Keep tests framework-free (simple assert helpers).
 */
import { startTalkServer, injectBridge, getBridgeVersion, applyPatchToHtml, compileCompoundSelector, BRIDGE_SOURCE } from "../server";
import { loadStyleRegistry, parseManifest, validateManifest, getStyleById } from "../registry";
import { auditReportContent } from "../report-audit";
import { parseExplanationPlan, validateExplanationPlan } from "../explain/validate";
import { compileExplanation, plainText, renderMarkdownLite, thesisOf } from "../explain/render";
import { lintHtmlFragment } from "../lint";
import { htmlToMarkdown, exportSurface } from "../export";
import { resolveChrome, chromeCapture } from "../verify";
import {
	getRuntime,
	renderTalk,
	startSession,
	stopSession,
	listSessions,
	resumeSession,
	pollEvents,
	appendChatEntry,
	cleanTalkHome,
	deleteSession,
	escapeJsonScriptPayload,
} from "../session";
import { existsSync, readFileSync, mkdtempSync, mkdirSync, writeFileSync, readdirSync, utimesSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { request as httpRequest } from "node:http";
import { join } from "node:path";

const results: Array<{ name: string; ok: boolean; error?: string }> = [];
const suite: Array<{ name: string; fn: () => void | Promise<void> }> = [];
function test(name: string, fn: () => void | Promise<void>): void {
	suite.push({ name, fn });
}
function ok(cond: unknown, msg?: string): void {
	if (!cond) throw new Error(msg || "assertion failed");
}
function eq<T>(a: T, b: T, msg?: string): void {
	if (a !== b) throw new Error(`${msg || "eq"}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
}

// ---------- 1. registry ----------
test("registry: styles discovered, report default", () => {
	const styles = loadStyleRegistry();
	ok(styles.length >= 8, "style count >= 8 (packs evolve)");
	const visible = styles.filter((s) => !s.hidden).map((s) => s.id);
	for (const id of ["report", "arch", "draw", "chat", "canvas", "showcase"]) {
		ok(visible.includes(id), `visible style missing: ${id}`);
	}
});
test("registry: manifest validation", () => {
	const good = parseManifest(
		{ id: "a", name: "A", kind: "html-js", entry: "index.html", version: 2, dependencies: ["components"] },
		"a",
	);
	ok(good && good.dependencies?.[0] === "components", "dependencies parsed");
	eq(validateManifest(good).length, 0, "no issues");
	const badEntry = parseManifest({ id: "b", kind: "html-js", entry: "../evil.html" }, "b");
	ok(badEntry && validateManifest(badEntry).some((i) => i.code === "bad-entry"), "bad entry flagged");
	eq(parseManifest({ id: "c", kind: "not-a-kind" }, "c"), null, "invalid kind rejected");
	eq(parseManifest({ id: "a b!", kind: "html" }, "x"), null, "invalid id rejected");
});
test("registry: report pack is default with entry", () => {
	const report = loadStyleRegistry().find((s) => s.id === "report");
	ok(report?.default === true, "report is default");
	ok(report?.entryPath && existsSync(report.entryPath), "report entry exists");
});

// ---------- 2. report audit ----------
test("audit: clean fragment passes", () => {
	const html =
		'<section id="hero" class="hero" data-nav-title="摘要"><h1>Hi</h1><p class="sub">ok</p></section><section id="e" class="sec-head" data-nav-title="E"><h2>E</h2></section><div class="verdict"><div class="lbl">V</div><h3>x</h3></div>';
	const a = auditReportContent(html);
	eq(a.errors.length, 0, "errors=" + a.errors.map((e) => e.code).join(","));
});
test("audit: onclick rejected", () => {
	const a = auditReportContent('<p onclick="x()">bad</p>');
	ok(a.errors.some((e) => e.code === "inline-handler"), "inline handler flagged");
});
test("audit: shell elements rejected", () => {
	const a = auditReportContent("<html><body><p>x</p></body></html>");
	ok(a.errors.some((e) => e.code === "shell-escape"), "shell flagged");
});

// ---------- 3. lint (light audit for non-report styles) ----------
test("lint: unbridged controls flagged", () => {
	const issues = lintHtmlFragment('<button>hi</button><form><input name="a"></form>');
	ok(issues.some((i) => i.code === "unbridged-control"), "button flagged");
	ok(issues.some((i) => i.code === "unbridged-form"), "form flagged");
});
test("lint: clean bridged content passes", () => {
	const issues = lintHtmlFragment(
		'<button data-talk-event="go" data-talk-value="1">hi</button><form data-talk-form="submit"><input name="a"></form>',
	);
	eq(issues.length, 0, "no issues: " + issues.map((i) => i.code).join(","));
});
test("lint: shell element in fragment flagged, allowed in fullDocument", () => {
	ok(lintHtmlFragment("<main><p>x</p></main>").some((i) => i.code === "shell-in-fragment"), "flagged as fragment");
	eq(lintHtmlFragment("<main><p>x</p></main>", { fullDocument: true }).length, 0, "ok as document");
});

// ---------- 4. server: surfaces, patches, events ----------
let srv: Awaited<ReturnType<typeof startTalkServer>> | undefined;
test("server: surfaces + patch + events", async () => {
	srv = await startTalkServer();
	srv.setDocument(
		{ title: "a", html: '<html><body><div id="x">1</div></body></html>', styleId: "html-interactive", kind: "html-js" },
		"main",
	);
	const b = srv.applyPatch({ selector: "#x", html: "<b>2</b>", method: "inner", surface: "main" });
	ok(b.ok && b.persisted === true, "patch applied + persisted server-side");
	ok(srv.getState("main")?.html.includes("<b>2</b>"), "stored document sees the patch");
	const bad = srv.applyPatch({ selector: "#x" });
	ok(!bad.ok, "patch without html rejected");
	const fancy = srv.applyPatch({ selector: "#x:first-child", html: "<i>3</i>", method: "inner", surface: "main" });
	ok(fancy.ok && fancy.persisted === false, "unsupported selector broadcast-only + flagged");
	ok(typeof fancy.warning === "string", "warning present for unpersisted patch");
	srv.setDocument(
		{ title: "b", html: "<html><body><p>s2</p></body></html>", styleId: "report", kind: "html-js", fragment: "<p>s2</p>" },
		"alt",
	);
	eq(srv.listSurfaces().length, 2, "two surfaces");
	eq(srv.getState("alt")?.fragment, "<p>s2</p>", "fragment stored");
	const fetchHtml = await (await fetch(srv.url + "s/alt")).text();
	ok(fetchHtml.includes('data-talk-surface="alt"'), "surface stamped on body");
	let persisted = 0;
	srv.onEvent = () => {
		persisted += 1;
	};
	const r = await fetch(srv.url + "api/event", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ type: "form", payload: { id: "f", values: { a: "1" } }, surface: "alt" }),
	});
	eq(r.status, 200, "event accepted");
	eq(persisted, 1, "onEvent hook fired");
	eq(srv.listEvents()[0]?.surface, "alt", "event surface recorded");
	const bad2 = await fetch(srv.url + "api/event", {
		method: "POST",
		headers: { "content-type": "application/json", origin: "http://evil.example" },
		body: "{}",
	});
	eq(bad2.status, 403, "cross-origin rejected");
	const injected = injectBridge("<html><body><p>x</p></body></html>", { interactive: true });
	eq(getBridgeVersion(injected), 2, "bridge v2 injected");
	ok(injected.includes("data-talk-form") && injected.includes('addEventListener("patch"'), "bridge has form+patch");
});
test("server: unknown surface 404 + surfaces api", async () => {
	eq((await fetch(srv!.url + "s/nope")).status, 404, "404");
	const list = await (await fetch(srv!.url + "api/surfaces")).json();
	eq(list.surfaces.length, 2, "surfaces api");
});
test("server: health", async () => {
	const h = await (await fetch(srv!.url + "health")).json();
	eq(h.ok, true, "health ok");
});

// ---------- 5. session: persistence, versions, resume ----------
const TALK_HOME = join(homedir(), ".pi", "agent", "talk", "sessions");
test("session: render persists version + meta", async () => {
	const rt = getRuntime();
	await stopSession(rt);
	await startSession("html-interactive", { title: "persist-test" }, rt);
	ok(rt.sessionId?.startsWith("s-"), "sessionId assigned");
	const res = await renderTalk(
		{ styleId: "html-interactive", title: "persist-test", content: "<p>v1</p>", meta: { surface: "alt" } },
		rt,
	);
	ok(res.ok, "render ok");
	eq(rt.versionCount, 1, "versionCount=1");
	const metaPath = join(TALK_HOME, rt.sessionId!, "meta.json");
	ok(existsSync(metaPath), "meta.json written");
	const versionFile = join(TALK_HOME, rt.sessionId!, "versions", "0001-alt.html");
	ok(existsSync(versionFile) && readFileSync(versionFile, "utf8").includes("v1"), "version file content");
	const pr = await renderTalk({ content: "", patch: { selector: "p", html: "<p>v2</p>" } }, rt);
	ok(pr.ok, "patch render ok");
	eq(rt.versionCount, 2, "persisted patch creates a version snapshot");
	ok(rt.server?.getState("alt")?.html.includes("v2"), "patched document served");
	const v2File = join(TALK_HOME, rt.sessionId!, "versions", "0002-alt.html");
	ok(existsSync(v2File) && readFileSync(v2File, "utf8").includes("v2"), "patch version file on disk");
	await stopSession(rt);
});
test("session: input.surface param targets named surface", async () => {
	const rt = getRuntime();
	await startSession("html-interactive", {}, rt);
	const res = await renderTalk({ styleId: "html-interactive", content: "<p>named</p>", surface: "named" }, rt);
	ok(res.ok, "render ok");
	eq(res.details?.surface, "named", "surface param used");
	eq(rt.activeSurface, "named", "activeSurface switched");
	ok(rt.server?.getState("named") !== undefined, "named surface stored");
	await stopSession(rt);
});
test("session: listSessions + resume restores document", async () => {
	const rt = getRuntime();
	await startSession("html-interactive", { title: "resume-test" }, rt);
	const first = rt.sessionId;
	await renderTalk({ styleId: "html-interactive", content: "<p>resume-me</p>" }, rt);
	await stopSession(rt);
	const sessions = listSessions(rt);
	ok(sessions.some((s) => s.id === first), "session listed");
	const state = await resumeSession(first!, {}, rt);
	eq(state.sessionId, first, "resumed id");
	const html = await (await fetch(rt.server!.url)).text();
	ok(html.includes("resume-me"), "document restored");
	await stopSession(rt);
});
test("session: chat persists chat.md", async () => {
	const rt = getRuntime();
	await startSession("chat", { title: "chat-test" }, rt);
	const res = await renderTalk({ styleId: "chat", content: "hello persisted chat" }, rt);
	ok(res.ok, "chat render ok");
	const f = join(TALK_HOME, rt.sessionId!, "chat.md");
	ok(existsSync(f) && readFileSync(f, "utf8").includes("hello persisted chat"), "chat.md written");
	await stopSession(rt);
});

// ---------- 6. export: html + md ----------
test("export: html snapshot", async () => {
	const rt = getRuntime();
	await startSession("html-interactive", {}, rt);
	await renderTalk({ styleId: "html-interactive", content: "<p>export-me</p>" }, rt);
	const out = join(tmpdir(), `talk-export-${process.pid}.html`);
	const res = await exportSurface(rt, { format: "html", out });
	ok(res.ok && existsSync(out), "html exported");
	await stopSession(rt);
});
test("export: markdown conversion", () => {
	const md = htmlToMarkdown(
		'<h1>T</h1><p>Hello <strong>bold</strong> and <a href="https://x">link</a>.</p><ul><li>a</li><li>b</li></ul><table><caption>Cap</caption><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table><pre>code()</pre>',
	);
	ok(md.startsWith("# T"), "h1");
	ok(md.includes("**bold**") && md.includes("[link](https://x)"), "inline");
	ok(md.includes("- a") && md.includes("- b"), "list");
	ok(md.includes("| 1 | 2 |"), "table row");
	ok(md.includes("**Cap**"), "caption");
	ok(md.includes("```") && md.includes("code()"), "code fence");
});
test("export: report fragment to markdown", () => {
	const md = htmlToMarkdown(
		'<section class="hero"><h1>报告</h1><p class="sub">副标题</p></section><section class="sec-head"><div class="tag">01 · A</div><h2>章节</h2></section><div class="verdict"><div class="lbl">VERDICT</div><h3>结论</h3><p>通过</p></div>',
	);
	ok(md.includes("# 报告"), "hero h1");
	ok(md.includes("## 章节"), "section h2");
	ok(md.includes("VERDICT") && md.includes("结论"), "verdict");
});

// ---------- 7. verify (chrome required) ----------
test("verify: chrome resolution", () => {
	const chrome = resolveChrome();
	if (!chrome) throw new Error("no chrome found (set CHROME_PATH)");
	ok(existsSync(chrome), "chrome path exists");
});

// ---------- 8. server hardening: loopback host header ----------
function fetchStatus(url: string, headers: Record<string, string>): Promise<number> {
	return new Promise((resolve, reject) => {
		const req = httpRequest(url, { headers }, (res) => {
			res.resume();
			resolve(res.statusCode ?? 0);
		});
		req.on("error", reject);
		req.end();
	});
}
test("server: non-loopback Host header rejected (DNS-rebinding guard)", async () => {
	srv = srv ?? (await startTalkServer());
	srv.setDocument(
		{ title: "h", html: "<html><body><p>host</p></body></html>", styleId: "html-interactive", kind: "html-js" },
		"main",
	);
	eq(await fetchStatus(srv.url, { host: "evil.example:1" }), 403, "rebinding host rejected");
	eq(await fetchStatus(srv.url, { host: `localhost:${srv.port}` }), 200, "localhost accepted");
	eq(await fetchStatus(srv.url, {}), 200, "default host accepted");
	await srv.close();
	srv = undefined;
});

// ---------- 9. server-side patch application (applyPatchToHtml) ----------
test("patchToHtml: selector compile + inner/append/remove/outer", () => {
	eq(compileCompoundSelector("#x")?.id, "x", "#x compiled");
	eq(compileCompoundSelector("p.kpi.big")?.classes.join(","), "kpi,big", "classes compiled");
	eq(compileCompoundSelector("#x:first-child"), undefined, "pseudo rejected");
	eq(compileCompoundSelector("div > p"), undefined, "combinator rejected");
	const doc = `<!doctype html><html><body><div id="a"><p>1</p></div><p class="kpi">2</p><script>if (a && b) s("</b>");</script></body></html>`;
	const inner = applyPatchToHtml(doc, { selector: "#a", html: "<b>x</b>", method: "inner" });
	ok(inner?.includes("<b>x</b>") && !inner.includes("<p>1</p>"), "inner replaces children");
	const appended = applyPatchToHtml(doc, { selector: ".kpi", html: "<i>+</i>", method: "append" });
	ok(appended?.includes('<p class="kpi">2<i>+</i></p>'), "append keeps children");
	const removed = applyPatchToHtml(doc, { selector: ".kpi", method: "remove" });
	ok(removed && !removed.includes("kpi"), "remove drops element");
	const outer = applyPatchToHtml(doc, { selector: "p", html: "<span>o</span>", method: "outer" });
	ok(outer?.includes('<div id="a"><span>o</span></div>'), "outer replaces first match only");
	eq(applyPatchToHtml(doc, { selector: "#missing", html: "x" }), undefined, "no match → undefined");
	// scripts survive the round-trip byte-identical (CSP hashes stay valid)
	ok(outer?.includes(`s("</b>")`), "script content untouched");
});

// ---------- 10. session: resume idempotency + event cursor ----------
test("session: resume does not duplicate the event journal", async () => {
	const rt = getRuntime();
	await startSession("html-interactive", { title: "resume-events" }, rt);
	const id = rt.sessionId!;
	rt.server!.pushEvent({ type: "click", payload: { a: 1 }, source: "test" });
	rt.server!.pushEvent({ type: "click", payload: { a: 2 }, source: "test" });
	const journal = join(TALK_HOME, id, "events.jsonl");
	const linesBefore = readFileSync(journal, "utf8").split("\n").filter(Boolean).length;
	eq(linesBefore, 2, "two events journaled");
	await stopSession(rt);
	await resumeSession(id, {}, rt);
	await stopSession(rt);
	await resumeSession(id, {}, rt);
	const linesAfter = readFileSync(journal, "utf8").split("\n").filter(Boolean).length;
	eq(linesAfter, 2, "resume never re-appends journal lines");
});

test("session: resume sets the event cursor (no replay to the agent)", async () => {
	const rt = getRuntime();
	await startSession("html-interactive", { title: "cursor" }, rt);
	const id = rt.sessionId!;
	rt.server!.pushEvent({ type: "form", payload: { v: 1 }, source: "test" });
	await stopSession(rt);
	await resumeSession(id, {}, rt);
	eq(pollEvents(undefined, rt).length, 0, "restored events not re-delivered");
	rt.server!.pushEvent({ type: "click", payload: { n: 1 }, source: "test" });
	const fresh = pollEvents(undefined, rt);
	eq(fresh.length, 1, "only new events delivered");
	await stopSession(rt);
});

// ---------- 11. json-driven packs: </script> escaping ----------
test("session: JSON payload with </script> is escaped inside json script blocks", async () => {
	const rt = getRuntime();
	await startSession("compare", { title: "json-escape" }, rt);
	const payload = {
		title: "escape-test",
		versions: [
			{ name: "a", text: "look at </script><b>evil</b>" },
			{ name: "b", text: "plain" },
		],
	};
	const res = await renderTalk({ styleId: "compare", content: JSON.stringify(payload) }, rt);
	ok(res.ok, "render ok");
	const html = rt.server!.getState()?.html ?? "";
	const block = /<script id="cp-data"[^>]*>([\s\S]*?)<\/script>/.exec(html);
	ok(block, "json block found");
	const parsed = JSON.parse(block![1]!);
	eq(parsed.versions[0].text, "look at </script><b>evil</b>", "payload round-trips through JSON.parse");
	ok(!block![1]!.includes("</script"), "no raw </script> inside the json block");
	await stopSession(rt);
});

test("helpers: escapeJsonScriptPayload", () => {
	eq(escapeJsonScriptPayload('a</script>b</p>c'), "a<\\/script>b<\\/p>c", "</ escaped as <\\/");
	eq(JSON.parse(`"${escapeJsonScriptPayload("</script>")}"`), "</script>", "JSON.parse restores text");
});

// ---------- 12. chat transcript: user turns + timestamps ----------
test("session: chat transcript keeps user + assistant turns with ts", async () => {
	const rt = getRuntime();
	await startSession("chat", { title: "chat-both" }, rt);
	appendChatEntry(rt, "user", "please summarize");
	await renderTalk({ styleId: "chat", content: "here is the summary" }, rt);
	const f = join(TALK_HOME, rt.sessionId!, "chat.md");
	const text = readFileSync(f, "utf8");
	ok(text.includes("### user @ ") && text.includes("please summarize"), "user turn with timestamp");
	ok(text.includes("### assistant @ ") && text.includes("here is the summary"), "assistant turn with timestamp");
	await stopSession(rt);
	const state2 = await resumeSession(rt.sessionId!, {}, rt);
	ok(state2.active, "chat session resumed");
	const roles = rt.chatLog.map((e) => e.role).join(",");
	eq(roles, "user,assistant", "both roles restored");
	ok(rt.chatLog.every((e) => e.ts > 0), "timestamps restored");
	await stopSession(rt);
});

// ---------- 13. clean + delete (tmpdir sandbox) ----------
test("clean/delete: GC old sessions and stray files", () => {
	const dir = mkdtempSync(join(tmpdir(), "talk-clean-"));
	const old = Date.now() - 40 * 86_400_000;
	const age = (p: string) => utimesSync(p, old / 1000, old / 1000);
	const mkSession = (id: string, startedAt: number) => {
		mkdirSync(join(dir, id), { recursive: true });
		writeFileSync(join(dir, id, "meta.json"), JSON.stringify({ id, startedAt, renderCount: 0, versionCount: 0, eventCount: 0, surfaces: [] }));
	};
	mkSession("s-20200101-000000-old", old);
	mkSession("s-20990101-000000-new", Date.now());
	const litter = join(dir, "cmd-arch-1785579506371.json");
	writeFileSync(litter, "{}");
	age(litter);
	mkdirSync(join(dir, "_probe_"), { recursive: true });
	writeFileSync(join(dir, "_probe_", "probe.py"), "x");
	age(join(dir, "_probe_"));
	writeFileSync(join(dir, "chat-latest.md"), "# keep");
	const result = cleanTalkHome({ days: 30, sessionsDir: dir });
	eq(result.removedSessions, 1, "old session removed");
	eq(result.removedFiles, 1, "cmd litter removed");
	eq(result.removedDirs, 1, "_probe_ removed");
	const left = readdirSync(dir).sort();
	eq(left.join(","), "chat-latest.md,s-20990101-000000-new", "fresh session + chat-latest kept");
	ok(deleteSession("s-20990101-000000-new", dir), "delete removes a session");
	ok(!readdirSync(dir).includes("s-20990101-000000-new"), "session dir gone");
	ok(!deleteSession("../evil", dir), "path traversal id rejected");
});

// ---------- 14. governance is manifest-declared ----------
test("registry: governance + useWhen parsed from manifests", () => {
	const styles = loadStyleRegistry();
	const report = getStyleById(styles, "report");
	eq(report?.governance, "report", "report declares governance");
	const arch = getStyleById(styles, "arch");
	ok(arch?.useWhen && arch.useWhen.length > 0, "useWhen present");
	ok(arch?.command?.includes("{{extDir}}") && !arch.command.includes("/Users/"), "command uses {{extDir}}, no absolute path");
	const m = parseManifest({ id: "g", kind: "html-js", entry: "index.html", governance: "report", useWhen: "x" }, "g");
	eq(m?.governance, "report", "manifest governance parsed");
	eq(m?.useWhen, "x", "manifest useWhen parsed");
});

// ---------- 13. Explanation Layer: explain.ir/v1 ----------
function explainPlan(overrides: Record<string, unknown> = {}): unknown {
	return {
		schema: "explain.ir/v1",
		topic: "为什么网关偶发 502",
		audience: "beginner",
		layers: [
			{ id: "core", kind: "core", title: "一句话", content: "上游服务在 3 秒内没回话，网关就替它回了 502。" },
			{
				id: "mechanism",
				kind: "mechanism",
				title: "超时链条",
				content: "- 网关只等 3 秒\n- 上游 P99 是 4.1 秒\n- 慢请求于是变成 502",
			},
			{
				id: "analogy",
				kind: "analogy",
				title: "像餐厅",
				content: "服务员等厨房 3 分钟，超时就直接告诉客人「没做」。",
				analogyBreakage: "厨房超时后会继续做菜，网关之后的上游请求也还在跑，可能已经写库了。",
			},
			{ id: "code", kind: "code", title: "看这一行", content: "`proxy_read_timeout 3s;` 就是那 3 分钟。" },
		],
		limitations: ["只解释 502，不覆盖 504", "假设上游没有主动返回错误"],
		checks: [
			{
				id: "who-answers",
				afterLayerId: "mechanism",
				question: "这个 502 是谁生成的？",
				choices: [
					{ id: "upstream", label: "上游服务" },
					{ id: "gateway", label: "网关" },
					{ id: "client", label: "客户端" },
				],
				answerId: "gateway",
			},
		],
		...overrides,
	};
}
function codesOf(issues: Array<{ code: string }>): string[] {
	return issues.map((issue) => issue.code);
}

test("explain: valid plan validates and normalizes", () => {
	const v = validateExplanationPlan(explainPlan());
	ok(v.valid, `expected valid, got ${JSON.stringify(v.errors)}`);
	eq(v.plan?.layers.length, 4, "4 layers");
	eq(v.plan?.checks?.[0].choices.length, 3, "3 choices");
	eq(v.stats.contentChars > 0, true, "stats counted");
});
test("explain: fail-closed on the accuracy gates", () => {
	const cases: Array<[string, unknown, string]> = [
		["no limitations", explainPlan({ limitations: [] }), "limitations-count"],
		["four limitations truncated", explainPlan({ limitations: ["一", "二", "三", "四"] }), "limitations-count"],
		["missing limitations", { ...(explainPlan() as object), limitations: undefined }, "limitations-required"],
		["analogy without breakage", explainPlan({
			layers: (explainPlan() as { layers: Array<Record<string, unknown>> }).layers.slice(0, 3).map((l) => ({ ...l, analogyBreakage: undefined })),
		}), "analogy-breakage-required"],
		["duplicate layer id", explainPlan({
			layers: [
				{ id: "core", kind: "core", title: "a", content: "x" },
				{ id: "core", kind: "mechanism", title: "b", content: "y" },
			],
		}), "duplicate-layer-id"],
		["check targets unknown layer", explainPlan({
			checks: [{ id: "c", afterLayerId: "nope", question: "q", choices: [{ id: "a", label: "A" }, { id: "b", label: "B" }], answerId: "a" }],
		}), "check-target-unknown"],
		["answer not among choices", explainPlan({
			checks: [{ id: "c", afterLayerId: "core", question: "q", choices: [{ id: "a", label: "A" }, { id: "b", label: "B" }], answerId: "zzz" }],
		}), "check-answer-unknown"],
		["too many layers", explainPlan({ layers: Array.from({ length: 7 }, (_, i) => ({ id: `l${i}`, kind: "core", title: `t${i}`, content: "x" })) }), "layers-count"],
		["layer too long", explainPlan({ layers: [{ id: "core", kind: "core", title: "t", content: "y".repeat(1201) }] }), "layer-content"],
		["wrong schema", explainPlan({ schema: "explain.ir/v0" }), "bad-schema"],
		["bad audience", explainPlan({ audience: "child" }), "audience-enum"],
		// v1 (Sol review): identity is exact — no repair, no case-fold, no colon.
		["repaired id rejected", explainPlan({
			layers: [{ id: "Core Layer", kind: "core", title: "t", content: "x" }],
		}), "layer-id"],
		["colon id rejected", explainPlan({
			layers: [{ id: "layer:1", kind: "core", title: "t", content: "x" }],
		}), "layer-id"],
		["oversize id rejected", explainPlan({
			layers: [{ id: "x".repeat(65), kind: "core", title: "t", content: "x" }],
		}), "layer-id"],
		["exact reference required", explainPlan({
			layers: [{ id: "Core", kind: "core", title: "t", content: "x" }],
			checks: [{ id: "c1", afterLayerId: "core", question: "q", choices: [{ id: "a", label: "A" }, { id: "b", label: "B" }], answerId: "a" }],
		}), "check-target-unknown"],
		["check id with colon rejected", explainPlan({
			checks: [{ id: "q::1", afterLayerId: "core", question: "q", choices: [{ id: "a", label: "A" }, { id: "b", label: "B" }], answerId: "a" }],
		}), "check-id"],
		// v1 (Sol review): closed schema — cut fields stay cut, loudly.
		["unknown top-level field", explainPlan({ strategy: "socratic" }), "unknown-field"],
		["unknown layer field", explainPlan({
			layers: [{ id: "core", kind: "core", title: "t", content: "x", depth: 3 }],
		}), "unknown-field"],
		// v1 (Sol review): the one-sentence core is structural semantics.
		["no core", explainPlan({
			layers: [
				{ id: "a", kind: "mechanism", title: "a", content: "x" },
				{ id: "b", kind: "mechanism", title: "b", content: "y" },
			],
		}), "core-missing"],
		["two cores", explainPlan({
			layers: [
				{ id: "a", kind: "core", title: "a", content: "x" },
				{ id: "b", kind: "core", title: "b", content: "y" },
			],
		}), "core-count"],
		["core not first", explainPlan({
			layers: [
				{ id: "a", kind: "mechanism", title: "a", content: "x" },
				{ id: "b", kind: "core", title: "b", content: "y" },
			],
		}), "core-first"],
	];
	for (const [label, input, code] of cases) {
		const v = validateExplanationPlan(input);
		ok(!v.valid, `${label} must be rejected`);
		ok(codesOf(v.errors).includes(code), `${label} → ${code}, got ${codesOf(v.errors).join(",")}`);
		ok(v.plan === null, `${label} yields no plan`);
	}
});
test("explain: JSON parse failure is an issue, not a throw", () => {
	const v = parseExplanationPlan("{not json");
	ok(!v.valid, "invalid json rejected");
	eq(v.errors[0]?.code, "bad-json", "bad-json code");
});
test("explain: hollow analogy breakage and dense content warn only", () => {
	const layers = (explainPlan() as { layers: Array<Record<string, unknown>> }).layers.map((l) =>
		l.kind === "analogy" ? { ...l, analogyBreakage: "不完全准确" } : l,
	);
	const v = validateExplanationPlan(explainPlan({ layers }));
	ok(v.valid, "still valid");
	ok(codesOf(v.warnings).includes("analogy-breakage-vague"), "vague breakage flagged");
});
test("explain: plainText keeps technical characters (Sol probes)", () => {
	eq(plainText("C# 比 C++ 更安全。后者更慢。"), "C# 比 C++ 更安全。后者更慢。", "C#/C++ survive");
	eq(plainText("条件是 x > y。否则回退。"), "条件是 x > y。否则回退。", "comparison survives");
	eq(plainText("用 snake_case 命名。"), "用 snake_case 命名。", "underscores survive");
	eq(plainText("`foo_bar` 是变量。下一段。"), "foo_bar 是变量。下一段。", "code delimiters unwrap, content survives");
	eq(plainText("**重点**在这里。其次。"), "重点在这里。其次。", "bold unwraps");
	eq(plainText("## 标题\n第一句。第二句。"), "第一句。第二句。", "heading lines skipped");
	eq(plainText("- 网关只等 3 秒\n- 上游 P99 是 4.1 秒"), "网关只等 3 秒 上游 P99 是 4.1 秒", "list markers strip, 4.1 intact");
});
test("explain: thesisOf extracts the first sentence without corrupting it (Sol P1-5)", () => {
	eq(thesisOf("C# 比 C++ 更安全。后者更慢。"), "C# 比 C++ 更安全。", "CJK sentence split, C# intact");
	eq(thesisOf("条件是 x > y。否则回退。"), "条件是 x > y。", "comparison intact");
	eq(thesisOf("用 snake_case 命名。不要用驼峰。"), "用 snake_case 命名。", "underscores intact");
	eq(thesisOf("版本是 3.4。注意回退。"), "版本是 3.4。", "decimal point is not a sentence break");
	eq(thesisOf("What is 502? It is a gateway error."), "What is 502?", "latin sentence split");
	// Sol round-3 probes: ASCII !/? must NOT split without whitespace.
	eq(thesisOf("URL 是 https://api.test/search?q=x。然后回退。"), "URL 是 https://api.test/search?q=x。", "URL with query survives");
	eq(thesisOf("表达式 ready?next:value 很常见。其次。"), "表达式 ready?next:value 很常见。", "ternary survives");
	eq(thesisOf("断言 x!.y 是 TS 语法。其次。"), "断言 x!.y 是 TS 语法。", "non-split !. survives");
	// Sol round-4 probe: Markdown links [text](url) unwrap to display text, avoiding severed [ brackets on 。
	eq(thesisOf("[https://api.test/search?q=x。](https://api.test/search?q=x。) 然后。"), "https://api.test/search?q=x。", "Markdown link URL survives without severed brackets");
	eq(thesisOf("[搜索接口](https://api.test/search?q=x) 很稳定。其次。"), "搜索接口 很稳定。", "Markdown link text extracted cleanly");
});
test("explain: markdown-lite blocks", () => {
	const html = renderMarkdownLite("段落一\n\n- 甲\n- 乙\n\n1. 第一\n2. 第二\n\n```\nlet a = 1;\n```");
	ok(html.includes("<p>段落一</p>"), "paragraph");
	ok(html.includes("<ul><li>甲</li><li>乙</li></ul>"), "bullet list");
	ok(html.includes("<ol><li>第一</li><li>第二</li></ol>"), "numbered list");
	ok(html.includes('<pre class="code-block"><code>let a = 1;</code></pre>'), "fenced code");
	ok(renderMarkdownLite("用 `x` 和 **粗**").includes("<code>x</code>"), "inline code");
	ok(renderMarkdownLite("用 `x` 和 **粗**").includes("<strong>粗</strong>"), "inline bold");
	const opaque = renderMarkdownLite("代码里的 `**x**` 与 **粗**");
	ok(opaque.includes("<code>**x**</code>"), "markdown inside code span stays literal");
	ok(!/<code><strong>/.test(opaque), "code span is opaque to bold");
});
test("explain: compiled fragment passes the governed report audit", () => {
	const plan = validateExplanationPlan(explainPlan()).plan!;
	const compiled = compileExplanation(plan);
	const audit = auditReportContent(compiled.html);
	eq(audit.errors.length, 0, `audit errors: ${JSON.stringify(audit.errors)}`);
	eq(audit.warnings.length, 0, `audit warnings: ${JSON.stringify(audit.warnings)}`);
	ok(compiled.html.includes('id="hero"'), "hero present");
	ok(compiled.html.includes('id="layer-analogy"'), "stable layer anchor");
	ok(compiled.html.includes('data-talk-event="explain-check"'), "quiz uses the existing bridge");
	ok(!/answerId|data-correct/i.test(compiled.html), "the page never reveals the answer");
	ok(compiled.html.trimEnd().endsWith("</div>"), "verdict is last");
});
test("explain: checks render positionally after their layer (Sol P1-4)", () => {
	const plan = validateExplanationPlan(explainPlan()).plan!;
	const compiled = compileExplanation(plan);
	const html = compiled.html;
	const mechanism = html.indexOf('id="layer-mechanism"');
	const analogy = html.indexOf('id="layer-analogy"');
	const firstQuizButton = html.indexOf('data-talk-event="explain-check"');
	ok(mechanism !== -1 && analogy !== -1 && firstQuizButton !== -1, "anchors exist");
	ok(firstQuizButton > mechanism && firstQuizButton < analogy, `check sits after its layer (${mechanism} < ${firstQuizButton} < ${analogy})`);
	ok(!html.includes('id="checks"'), "no detached #checks section");
	// Wire format is unambiguous: ids may not contain ":", so split("::") is exact.
	for (const pair of [...html.matchAll(/data-talk-value="([^"]+)"/g)].map((m) => m[1]!)) {
		eq(pair.split("::").length, 2, `wire pair parses exactly once: ${pair}`);
	}
});
test("explain: hostile layer text is escaped, not rejected", () => {
	const plan = validateExplanationPlan(
		explainPlan({
			checks: undefined,
			layers: [
				{
					id: "core",
					kind: "core",
					title: "讲 <script>alert(1)</script> 与 onclick=",
					content: '危险写法是 <script>alert(1)</script>，以及 <img src=x onerror="pwn()">，javascript:alert(1)。',
				},
			],
		}),
	).plan!;;
	const compiled = compileExplanation(plan);
	ok(compiled.html.includes("&lt;script&gt;"), "script text is escaped");
	ok(!compiled.html.includes("<script"), "no script element produced");
	const audit = auditReportContent(compiled.html);
	eq(audit.errors.length, 0, `escaped text still audits clean: ${JSON.stringify(audit.errors)}`);
});
test("explain: renders through the report pipeline end to end", async () => {
	const rt = getRuntime();
	await startSession("report", { title: "explain-e2e" }, rt);
	const plan = validateExplanationPlan(explainPlan()).plan!;
	const compiled = compileExplanation(plan);
	const res = await renderTalk(
		{ styleId: "report", content: compiled.html, meta: compiled.meta, title: plan.topic },
		rt,
	);
	ok(res.ok, `render ok: ${res.message}`);
	const audit = (res.details as { audit?: { errors: unknown[]; warnings: unknown[] } })?.audit;
	eq(audit?.errors.length ?? -1, 0, "fragment + assembled report audit has zero errors");
	await stopSession(rt);
});

test("explain: quiz answers ride the existing event bridge", async () => {
	const rt = getRuntime();
	await startSession("report", { title: "explain-quiz" }, rt);
	const plan = validateExplanationPlan(explainPlan()).plan!;
	const compiled = compileExplanation(plan);
	const res = await renderTalk(
		{ styleId: "report", content: compiled.html, meta: compiled.meta, title: plan.topic },
		rt,
	);
	ok(res.ok, `render ok: ${res.message}`);
	// Every choice button must carry a parsable checkId::choiceId that exists in the IR.
	const pairs = [...compiled.html.matchAll(/data-talk-value="([^"]+)"/g)].map((m) => m[1]!);
	eq(pairs.length, 3, "one value per declared choice");
	for (const pair of pairs) {
		const [checkId, choiceId] = pair.split("::");
		const check = plan.checks?.find((c) => c.id === checkId);
		ok(check, `check ${checkId} exists in the IR`);
		ok(check!.choices.some((choice) => choice.id === choiceId), `choice ${pair} is declared`);
	}
	// Round-trip (Sol round-3): the JSON body is now DERIVED from the compiled
	// page, not hand-written — pick the first [data-talk-event="explain-check"]
	// button out of the rendered HTML and send what the bridge's click
	// delegation would send, with the bridge's real source tag
	// (server.ts talkSend uses source:"talk-bridge"). This covers the
	// /api/event endpoint, persistence and agent-side judgement; the browser
	// click-delegation step itself remains browser-QA territory (chromeCapture
	// cannot click) and is asserted separately below by anatomy.
	const buttonPattern =
		/<button[^>]*data-talk-event="explain-check"[^>]*data-talk-value="([^"]+)"[^>]*>([\s\S]*?)<\/button>/g;
	const buttons = [...compiled.html.matchAll(buttonPattern)].map((m) => ({
		value: m[1]!,
		label: m[2]!.replace(/<[^>]+>/g, "").trim(),
	}));
	ok(buttons.length >= 3, "choice buttons found in the compiled page");
	// Deliberately click the correct choice (agent knows the IR; a real learner
	// could click any). Payload stays derived from the rendered DOM.
	const correct = buttons.find((b) => {
		const [checkId, choiceId] = b.value.split("::");
		const check = plan.checks!.find((c) => c.id === checkId)!;
		return check.answerId === choiceId;
	});
	ok(correct, "the correct choice exists as a rendered button");
	const clicked = correct!.value;
	const clickedLabel = correct!.label;
	// Production bridge round-trip (Sol round-4): evaluate the actual BRIDGE_SOURCE
	// code from server.ts in a mock DOM sandbox, fire the production click listener
	// on the rendered button, and let production talkSend dispatch the real fetch to /api/event.
	const listeners: Record<string, (ev: any) => void> = {};
	const mockDoc = {
		body: { getAttribute: (attr: string) => (attr === "data-talk-surface" ? "main" : null) },
		addEventListener: (type: string, fn: any) => { listeners[type] = fn; },
		querySelector: () => null,
	};
	const port = rt.server!.port;
	const customFetch = (url: string, init: any) => {
		const fullUrl = url.startsWith("/") ? `http://127.0.0.1:${port}${url}` : url;
		return fetch(fullUrl, init);
	};
	new Function("document", "window", "fetch", "location", "EventSource", BRIDGE_SOURCE)(
		mockDoc,
		{},
		customFetch,
		{ reload: () => {} },
		class { addEventListener() {} },
	);
	ok(typeof listeners["click"] === "function", "production BRIDGE_SOURCE registered click listener");

	const mockButton = {
		id: "",
		innerText: clickedLabel,
		getAttribute: (attr: string) => {
			if (attr === "data-talk-event") return "explain-check";
			if (attr === "data-talk-value") return clicked;
			return null;
		},
	};
	const clickEv = {
		target: {
			closest: (sel: string) => (sel === "[data-talk-event]" ? mockButton : null),
		},
	};
	// Fire production click delegation!
	listeners["click"](clickEv);
	await new Promise((r) => setTimeout(r, 100));

	const events = pollEvents(undefined, rt);
	const answer = events.find((event) => event.type === "explain-check");
	ok(answer, "explain-check delivered to the agent");
	eq(answer!.source, "talk-bridge", "event carries the real bridge source tag");
	eq(String((answer!.payload as { value: string }).value), clicked, "value round-trips verbatim from the rendered button");
	eq(String((answer!.payload as { text: string }).text), clickedLabel.slice(0, 200), "text round-trips via bridge click delegation");
	const [checkId, choiceId] = String((answer!.payload as { value: string }).value).split("::");
	const check = plan.checks!.find((c) => c.id === checkId)!;
	eq(choiceId === check.answerId, true, "agent-side judgement resolves the answer");
	await stopSession(rt);
});

async function main(): Promise<void> {
	for (const t of suite) {
		try {
			await t.fn();
			results.push({ name: t.name, ok: true });
		} catch (error) {
			results.push({ name: t.name, ok: false, error: error instanceof Error ? error.message : String(error) });
		}
	}
	await srv?.close();

	const failed = results.filter((r) => !r.ok);
	console.log(`# /talk tests: ${results.length - failed.length}/${results.length} passed`);
	for (const r of failed) console.log(`# FAIL ${r.name} — ${r.error}`);
	process.exit(failed.length ? 1 : 0);
}

void main();
