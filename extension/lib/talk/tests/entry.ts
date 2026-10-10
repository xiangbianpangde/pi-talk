/**
 * /talk regression tests (entry). Bundled by run-tests.mjs with esbuild and
 * executed on plain node. Keep tests framework-free (simple assert helpers).
 */
import { startTalkServer, injectBridge, getBridgeVersion, applyPatchToHtml, compileCompoundSelector, BRIDGE_SOURCE } from "../server";
import { loadStyleRegistry, parseManifest, validateManifest, getStyleById } from "../registry";
import { auditReportContent } from "../report-audit";
import { createReportGate, REPORT_CHOICES } from "../report-gate";
import { renderImageReportSvg } from "../report-image/render";
import { exportImageReport } from "../report-image/export";
import { getSessionDir } from "../paths";
import { randomUUID } from "node:crypto";
import registerTalk from "../../../talk";
import { createTalkTriggerHandlers, parseTalkArgs, resolveTalkStart, registerTalkLifecycle, createOpportunityRouter, createReportScope } from "../trigger";
import { createInformationEngine, briefText } from "../information";
import { createDeliveryQueue, deliverBrief } from "../delivery";
import { auditExplainContent } from "../explain-audit";
import { parseExplanationPlan, validateExplanationPlan } from "../explain/validate";
import { compileExplanation, plainText, renderMarkdownLite, thesisOf } from "../explain/render";
import { lintHtmlFragment } from "../lint";
import { htmlToMarkdown, exportSurface } from "../export";
import { resolveChrome, chromeCapture } from "../verify";
import {
	getRuntime,
	renderTalk,
	resolvePatchTarget,
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
import { existsSync, readFileSync, mkdtempSync, mkdirSync, writeFileSync, readdirSync, utimesSync, rmSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { request as httpRequest } from "node:http";
import { join } from "node:path";

class TestSkipped extends Error {}
const results: Array<{ name: string; ok: boolean; skipped?: boolean; error?: string }> = [];
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

test("isolation: session writes stay inside the disposable test home", () => {
	const expected = process.env.TALK_TEST_HOME;
	ok(expected, "tests must run through the isolated runner");
	eq(homedir(), expected!);
	ok(getSessionDir("isolation-probe").startsWith(join(expected!, ".pi", "agent", "talk", "sessions")));
});

test("trigger: report scope preserves only requested summary and resets branch boundaries", () => {
	const scope = createReportScope();
	scope.settle("a", false, true);
	eq(scope.current(), undefined, "settlement without a task cannot create task-0");
	eq(scope.start("a", false).preserveEvidence, false);
	scope.requestSummary();
	eq(scope.start("a", true).preserveEvidence, true);
	scope.settle("a", false, true);
	const settled = scope.current();
	eq(settled?.cause, "settled");
	scope.settle("a", false, true); eq(scope.current()?.id, settled?.id);
	scope.settle("a", true, true); eq(scope.current(), undefined, "abort clears opportunity");
	scope.requestSummary();
	const beforeSummary = scope.scopeVersion();
	eq(scope.start("a", true).preserveEvidence, true, "aborted task evidence can be summarized");
	ok(scope.scopeVersion() > beforeSummary, "summary invalidates pending report version even with retained evidence");
	eq(scope.start("a", true).preserveEvidence, false, "new task does not inherit previous summary request");
	const exposed = scope.current(); if (exposed) exposed.taskId = "tampered";
	ok(scope.current()?.taskId !== "tampered", "external copy cannot mutate internal task");
	scope.settle("other-branch", false, true); ok(scope.current()?.branchId !== "other-branch");
	const activeTask = scope.current()?.id;
	scope.settle("other-branch", true, false); eq(scope.current()?.id, activeTask, "stale branch abort cannot clear current scope");
	scope.requestSummary(); scope.requestSummary(false);
	eq(scope.start("a", true).preserveEvidence, false, "nonempty request clears unconsumed bare summary intent");
	scope.requestSummary(); scope.reset();
	eq(scope.current(), undefined);
	eq(scope.start("b", true).preserveEvidence, false);
	scope.requestSummary();
	eq(scope.start("c", true).preserveEvidence, false, "summary cannot preserve evidence across branches");
});

test("trigger: opportunity replay deduplicates retries without claiming completion", () => {
	const router = createOpportunityRouter();
	const event = { id: "run-1", taskId: "task", branchId: "a", cause: "settled" as const };
	ok(router.accept(event));
	eq(router.accept(event), undefined);
	ok(router.accept({ ...event, branchId: "b" }));
	router.reset();
	ok(router.accept(event));
});

test("trigger: argument parsing preserves legacy whitespace and case", () => {
	for (const [input, expected] of [
		["", { rest: "" }], ["  ", { rest: "" }],
		[" REPORT ", { sub: "report", rest: "" }],
		["HTML-STATIC  Explain This", { sub: "html-static", rest: "Explain This" }],
		["style\treport", { sub: "style\treport", rest: "" }],
	] as const) eq(JSON.stringify(parseTalkArgs(input)), JSON.stringify(expected));
});

test("trigger: start routing preserves explicit styles, non-TUI and cancelled picker fallback", async () => {
	for (const [args, mode, choice, expectedStyle, expectedMessage, picks] of [
		["", "tui", "chat", "chat", "", 1],
		["", "tui", undefined, "report", "", 1],
		["", "rpc", "chat", "report", "", 0],
		[" Explain This ", "tui", "chat", "report", "Explain This", 0],
		[" CHAT Hello World", "tui", "report", "chat", "Hello World", 0],
	] as const) {
		let pickCount = 0;
		const actual = await resolveTalkStart(args, mode, {
			hasStyle: (id) => id === "chat" || id === "report",
			defaultStyle: () => "report",
			pickStyle: async () => { pickCount++; return choice; },
		});
		eq(actual.styleId, expectedStyle);
		eq(actual.message, expectedMessage);
		eq(pickCount, picks);
	}
	const noStyle = await resolveTalkStart("", "tui", {
		hasStyle: () => false, defaultStyle: () => undefined, pickStyle: async () => undefined,
	});
	eq(noStyle.styleId, undefined);
});

test("trigger: lifecycle registration preserves event names and ordering", async () => {
	const hooks = new Map<string, (...args: any[]) => any>();
	const calls: string[] = [];
	const lifecycle = registerTalkLifecycle({ on: (event, handler) => { hooks.set(event, handler); return () => { hooks.delete(event); }; } }, {
		resetPermit: () => calls.push("reset"), stop: async () => { calls.push("stop"); },
		isActive: () => false, appendix: () => "",
	});
	lifecycle.registerSessionHooks();
	lifecycle.registerSessionHooks();
	eq([...hooks.keys()].join(","), "agent_start,session_shutdown,before_agent_start");
	await hooks.get("agent_start")!({});
	await hooks.get("session_shutdown")!({});
	eq(calls.join(","), "reset,reset,stop");
	lifecycle.dispose();
	eq(hooks.size, 0, "dispose removes all registered lifecycle handlers");
	lifecycle.registerSessionHooks(); eq(hooks.size, 0, "disposal is terminal");
});

test("trigger: disposal attempts every callback even if an unsubscribe fails", () => {
	let invoked = 0;
	const lifecycle = registerTalkLifecycle({ on: () => () => { invoked++; if (invoked === 1) throw new Error("unsubscribe failed"); } }, { resetPermit: () => {}, stop: async () => {}, isActive: () => false, appendix: () => "" });
	lifecycle.registerSessionHooks();
	let failed = false; try { lifecycle.dispose(); } catch { failed = true; }
	ok(failed); eq(invoked, 3);
	lifecycle.registerSessionHooks(); lifecycle.dispose(); eq(invoked, 3);
});

test("trigger: lifecycle resets permit, stops in order and only appends while active", async () => {
	const calls: string[] = [];
	let active = false;
	let appendix = "context";
	const handlers = createTalkTriggerHandlers({
		resetPermit: () => { calls.push("reset"); },
		stop: async () => { calls.push("stop"); },
		isActive: () => active,
		appendix: () => { calls.push("appendix"); return appendix; },
	});
	eq(await handlers.beforeAgentStart({ systemPrompt: "base" }), undefined);
	eq(calls.length, 0);
	active = true;
	eq((await handlers.beforeAgentStart({ systemPrompt: "base" }))?.systemPrompt, "base\n\ncontext");
	appendix = "";
	eq(await handlers.beforeAgentStart({ systemPrompt: "base" }), undefined);
	calls.length = 0;
	handlers.agentStart();
	await handlers.sessionShutdown();
	eq(calls.join(","), "reset,reset,stop");
});

test("delivery: concurrent operations serialize validation and survive failed sends", async () => {
	const queue = createDeliveryQueue();
	const engine = createInformationEngine(); engine.begin("goal");
	let sent = 0;
	const publish = () => queue(async () => {
		const brief = engine.refine("partial", [{ text: "new risk", kind: "risk", status: "inferred", evidenceIds: [] }], false, [], {}, "outcome");
		const result = await deliverBrief(brief, { publish: async () => { await Promise.resolve(); sent++; } });
		if (result.sent) engine.markDelivered(brief, engine.scopeVersion(), { sent: true });
	});
	await Promise.all([publish(), publish()]);
	eq(sent, 1, "concurrent identical stages publish once");
	try { await queue(async () => { throw new Error("failed"); }); } catch {}
	let recovered = false; await queue(async () => { recovered = true; });
	ok(recovered, "queue is not poisoned by failure");
});

test("delivery: failed publication and previews do not consume the delivery baseline", async () => {
	const engine = createInformationEngine(); engine.begin("goal");
	const claims = [{ text: "new risk", kind: "risk" as const, status: "inferred" as const, evidenceIds: [] }];
	const draft = () => engine.refine("partial", claims, false, [], {}, "outcome");
	let failed = false;
	try { await deliverBrief(draft(), { publish: () => { throw new Error("transport unavailable"); } }); } catch { failed = true; }
	ok(failed);
	eq(draft().delivery, "send", "failed transport remains retryable");
	const brief = draft();
	const result = await deliverBrief(brief, { publish: () => {} });
	if (result.sent) engine.markDelivered(brief, engine.scopeVersion(), { sent: true });
	eq(draft().delivery, "suppress", "only successfully published content becomes baseline");
});

test("delivery: routine suppression, material send and explicit override share one boundary", async () => {
	const sent: string[] = [];
	const target = { publish: async (content: string) => { sent.push(content); } };
	const engine = createInformationEngine(); engine.begin("goal");
	const routine = engine.refine("partial", [{ text: "commit recorded", kind: "result", status: "inferred", evidenceIds: [] }], false, [], {}, "routine");
	const suppressed = await deliverBrief(routine, target);
	eq(suppressed.sent, false); eq(suppressed.continuation, "continue"); eq(sent.length, 0);
	const outcome = engine.refine("partial", [{ text: "new risk found", kind: "risk", status: "inferred", evidenceIds: [] }], false);
	const delivered = await deliverBrief(outcome, target);
	eq(delivered.sent, true); eq(sent.length, 1);
	const explicit = await deliverBrief(routine, target, { explicit: true });
	eq(explicit.sent, true); eq(explicit.reason, "explicit"); eq(sent.length, 2);
});

test("information: operators, unrelated criteria, redaction and stale baseline fail closed", () => {
	const engine = createInformationEngine(); engine.begin("Implement encryption");
	engine.defineRequirements([{ id: "encrypt", userAnchor: "encryption", criterion: "encryption passed" }]);
	engine.collect("read", "read", "README opened", false);
	const unrelated = engine.refine("completed", [{ text: "README opened", kind: "result", status: "observed", evidenceIds: ["read"] }], false, ["read"], { checks: [{ requirementId: "encrypt", evidenceIds: ["read"] }] });
	eq(unrelated.state, "partial", "unrelated successful observation cannot satisfy criterion");
	engine.collect("latency", "test", "latency > 100", false);
	engine.collect("question", "test", "Tests passed?", false);
	for (const [text, id] of [["latency < 100", "latency"], ["Tests passed.", "question"]]) {
		eq(engine.refine("partial", [{ text, kind: "result", status: "observed", evidenceIds: [id] }]).claims[0].status, "unverified");
	}
	engine.collect("secret", "tool", 'Authorization: Bearer abc123\npassword="space secret"', false);
	const secret = engine.context().evidence.find((e) => e.id === "secret")!.text;
	ok(!secret.includes("abc123") && !secret.includes("space secret"));
	engine.collect("json", "Authorization: Bearer leaked", '{"password":"secret"}', false);
	const jsonSecret = engine.context().evidence.find((e) => e.id === "json")!;
	ok(!jsonSecret.text.includes("secret") && !jsonSecret.locator.includes("leaked"));
	const version = engine.scopeVersion();
	engine.begin("new task");
	eq(engine.markDelivered(unrelated, version, { sent: true }), false, "in-flight old delivery cannot pollute new baseline");
});

test("information: shadow scenarios preserve decisions, reject fabricated claims and reset scope", () => {
	const engine = createInformationEngine();
	engine.begin("verify output");
	engine.defineRequirements([{ id: "verify", userAnchor: "verify output", criterion: "all assertions passed" }]);
	engine.collect("check", "test run", "all assertions passed", false);
	const good = engine.refine("completed", [{ text: "all assertions passed", kind: "result", status: "observed", evidenceIds: ["check"] }], true, ["check"], { checks: [{ requirementId: "verify", evidenceIds: ["check"] }] });
	eq(good.state, "completed");
	const completionEngine = createInformationEngine();
	completionEngine.begin("verify output");
	completionEngine.defineRequirements([{ id: "verify", userAnchor: "verify output", criterion: "all assertions passed" }]);
	completionEngine.collect("check", "test", "all assertions passed", false);
	const completion = completionEngine.refine("completed", [{ text: "all assertions passed", kind: "result", status: "observed", evidenceIds: ["check"] }], false, ["check"], { checks: [{ requirementId: "verify", evidenceIds: ["check"] }] }, "routine");
	eq(completion.delivery, "send", "validated task completion overrides accidental routine label");
	eq(engine.refine("completed", [], true, ["check"]).state, "partial");
	const missingSource = engine.refine("partial", [{ text: "all assertions passed", kind: "result", status: "observed", evidenceIds: ["check", "missing"] }]);
	eq(missingSource.claims[0].status, "unverified", "dropping an unknown citation must not turn claim into observed");
	const paraphraseEngine = createInformationEngine();
	paraphraseEngine.begin("verify output");
	paraphraseEngine.collect("check", "test run", "46 tests passed", false);
	const paraphrase = paraphraseEngine.refine("partial", [{ text: "all 46 tests passed", kind: "result", status: "observed", evidenceIds: ["check"] }], true);
	eq(paraphrase.claims[0].status, "unverified", "a count does not establish an all qualifier");
	paraphraseEngine.collect("scope", "test", "tests passed", false);
	eq(paraphraseEngine.refine("partial", [{ text: "all tests passed", kind: "result", status: "observed", evidenceIds: ["scope"] }]).claims[0].status, "unverified");
	const negation = paraphraseEngine.refine("partial", [{ text: "46 tests failed", kind: "result", status: "observed", evidenceIds: ["check"] }], true);
	eq(negation.claims[0].status, "unverified");
	const wrongNumber = engine.refine("partial", [{ text: "all 47 tests passed", kind: "result", status: "observed", evidenceIds: ["check"] }], true);
	eq(wrongNumber.claims[0].status, "unverified");
	const reordered = paraphraseEngine.refine("partial", [{ text: "passed tests 46", kind: "result", status: "observed", evidenceIds: ["check"] }], true);
	eq(reordered.claims[0].status, "unverified");
	const fabricated = engine.refine("completed", [{ text: "all requirements met", kind: "result", status: "observed", evidenceIds: ["check"] }], true, ["check"]);
	eq(fabricated.state, "partial");
	eq(fabricated.claims[0].status, "unverified");
	const blocked = engine.refine("blocked", [
		{ text: "Choose deployment target", kind: "decision", status: "inferred", evidenceIds: [] },
		{ text: "Choose deployment target", kind: "decision", status: "inferred", evidenceIds: [] },
	]);
	eq(blocked.claims.length, 1);
	eq(blocked.state, "blocked");
	engine.collect("large", "read", "x".repeat(4000), false);
	ok(engine.context().incomplete);
	engine.begin("new goal");
	eq(engine.context().evidence.length, 0);
	engine.begin("");
	eq(engine.refine("completed", []).state, "unknown");
});

test("information: new evidence and risk identity cannot be deduplicated as unchanged", () => {
	const engine = createInformationEngine(); engine.begin("Check deployment");
	engine.collect("first", "check 1", "deployment pending", false);
	engine.collect("second", "check 2", "deployment pending", false);
	const result = { text: "deployment pending", kind: "result" as const, status: "observed" as const, evidenceIds: ["first"] };
	const sentBrief = engine.refine("partial", [result], false);
	eq(sentBrief.delivery, "send");
	engine.markDelivered(sentBrief, engine.scopeVersion(), { sent: true });
	eq(engine.refine("partial", [result], false).delivery, "suppress");
	eq(engine.refine("partial", [{ ...result, evidenceIds: ["second"] }], false).delivery, "send");
	const risk = { ...result, kind: "risk" as const, evidenceIds: ["second"] };
	const changed = engine.refine("partial", [{ ...result, evidenceIds: ["second"] }, risk], false);
	eq(changed.delivery, "send");
	eq(changed.claims.length, 2, "risk is not a duplicate of result text");
	eq(engine.refine("partial", changed.claims, true).delivery, "send", "explicit request is never silently suppressed");
	const untrusted = createInformationEngine(); untrusted.begin("Check deployment");
	untrusted.collect("log", "mixed log", "Deployment did not pass; earlier tests passed", false);
	const unsupported = untrusted.refine("partial", [{ text: "Deployment passed", kind: "result", status: "observed", evidenceIds: ["log"] }]);
	eq(unsupported.claims[0].status, "unverified", "keyword subsets cannot erase negation");
});

test("information: immutable requirements and critical versus incidental truncation", () => {
	const e = createInformationEngine(); e.begin("Implement A and B");
	const requirements = [{ id: "a", userAnchor: "A", criterion: "A passed" }, { id: "b", userAnchor: "B", criterion: "B passed" }];
	e.defineRequirements(requirements);
	let rejected = false;
	try { e.defineRequirements(requirements.slice(0, 1)); } catch { rejected = true; }
	ok(rejected, "cannot shrink requirements before evidence arrives");
	eq(e.context().requirements.length, 2);
	for (let i = 0; i < 25; i++) e.collect(`log-${i}`, "build log", "x".repeat(4000), false);
	e.collect("a", "test A", "A passed", false);
	e.collect("b", "test B", "B passed", false);
	const claims = [{ text: "A passed", kind: "result" as const, status: "observed" as const, evidenceIds: ["a"] }, { text: "B passed", kind: "result" as const, status: "observed" as const, evidenceIds: ["b"] }];
	const mapping = { checks: [{ requirementId: "a", evidenceIds: ["a"] }, { requirementId: "b", evidenceIds: ["b"] }] };
	ok(e.context().incomplete);
	eq(e.refine("completed", claims, true, ["a", "b"], mapping).state, "completed", "incidental truncated logs do not block intact acceptance");
	e.begin("Implement A"); e.defineRequirements(requirements.slice(0, 1));
	e.collect("a", "test A", "A passed" + "x".repeat(4000), false);
	eq(e.refine("completed", claims.slice(0, 1), true, ["a"], { checks: mapping.checks.slice(0, 1) }).state, "partial", "truncated acceptance blocks completion");
});

test("information: failure repair and full requirement coverage govern completion", () => {
	const e = createInformationEngine(); e.begin("Implement A and B");
	e.defineRequirements([{ id: "a", userAnchor: "A", criterion: "A passed" }, { id: "b", userAnchor: "B", criterion: "B passed" }]);
	e.collect("bad", "test A", "failed", true, "check-a");
	e.collect("pass-a", "test A", "A passed", false, "check-a");
	e.collect("pass-b", "test B", "B passed", false, "check-b");
	const claims = [{ text: "A passed", kind: "result" as const, status: "observed" as const, evidenceIds: ["pass-a"] }, { text: "B passed", kind: "result" as const, status: "observed" as const, evidenceIds: ["pass-b"] }];
	const checks = [{ requirementId: "a", evidenceIds: ["pass-a"] }, { requirementId: "b", evidenceIds: ["pass-b"] }];
	eq(e.refine("completed", claims, true, ["pass-a", "pass-b"], { checks }).state, "partial");
	const resolutions = [{ failureId: "bad", verificationId: "pass-a" }];
	const inferredB = [claims[0], { ...claims[1], status: "inferred" as const }];
	eq(e.refine("completed", inferredB, true, ["pass-a"], { checks, resolutions }).state, "partial", "observed A plus inferred B cannot satisfy all requirements");
	eq(e.refine("completed", claims, true, ["pass-a", "pass-b"], { checks, resolutions }).state, "completed");
	eq(e.refine("completed", claims, true, ["pass-a"], { checks: checks.slice(0, 1), resolutions }).state, "partial");
	eq(e.refine("completed", claims, true, ["pass-a", "pass-b"], { checks, resolutions: [{ failureId: "bad", verificationId: "pass-b" }] }).state, "partial");
});

test("information: shadow matrix covers completed, partial, failed, blocked, unchanged and decision cases", () => {
	const cases = [
		{ state: "completed" as const, claims: [{ text: "build passed", kind: "result" as const, status: "observed" as const, evidenceIds: ["ok"] }], expected: "completed" },
		{ state: "partial" as const, claims: [{ text: "one item remains", kind: "risk" as const, status: "inferred" as const, evidenceIds: ["todo"] }], expected: "partial" },
		{ state: "failed" as const, claims: [{ text: "test failed", kind: "risk" as const, status: "observed" as const, evidenceIds: ["bad"] }], expected: "failed" },
		{ state: "blocked" as const, claims: [{ text: "needs user choice", kind: "decision" as const, status: "inferred" as const, evidenceIds: [] }], expected: "blocked" },
	];
	for (const sample of cases) {
		const e = createInformationEngine(); e.begin("goal");
		e.defineRequirements([{ id: "goal", userAnchor: "goal", criterion: sample.claims[0].text }]);
		e.collect(sample.claims[0].evidenceIds[0] || "none", "fixture", sample.claims[0].text, sample.state === "failed");
		const brief = e.refine(sample.state, sample.claims, true, sample.state === "completed" ? ["ok"] : [], { checks: [{ requirementId: "goal", evidenceIds: ["ok"] }] });
		eq(brief.state, sample.expected);
	}
	const unchanged = createInformationEngine(); unchanged.begin("goal");
	unchanged.collect("ok", "fixture", "same", false);
	const candidate = [{ text: "same", kind: "result" as const, status: "observed" as const, evidenceIds: ["ok"] }];
	const initialBrief = unchanged.refine("partial", candidate, false);
	unchanged.markDelivered(initialBrief, unchanged.scopeVersion(), { sent: true });
	eq(unchanged.refine("partial", candidate, false).delivery, "suppress");
	ok((unchanged.refine("blocked", [{ text: "new blocker", kind: "blocker", status: "inferred", evidenceIds: [] }], false).claims[0].value ?? 0) > 0);
	const empty = unchanged.refine("unknown", [], false);
	eq(empty.delivery, "suppress", "empty automatic stage update is suppressed");
	eq(empty.reason, "insufficient-evidence");
	const stage = unchanged.refine("partial", [{ text: "已提交 commit，测试通过", kind: "result", status: "inferred", evidenceIds: [] }], false, [], {}, "routine");
	eq(stage.delivery, "suppress", "process-only stage report is suppressed");
	eq(stage.reason, "unchanged");
	const afterRoutine = unchanged.refine("partial", [{ text: "real new finding", kind: "result", status: "inferred", evidenceIds: [] }], false, [], {}, "outcome");
	eq(afterRoutine.delivery, "send", "routine suppression does not hide later outcomes");
	const blocker = unchanged.refine("blocked", [{ text: "需要用户提供生产凭据", kind: "blocker", status: "inferred", evidenceIds: [] }], false, [], {}, "routine");
	eq(blocker.delivery, "send", "real blocker is delivered");
	eq(blocker.continuation, "continue", "a blocker label alone does not prove user input is required");
	eq(stage.continuation, "continue");
	const decision = unchanged.refine("blocked", [{ text: "Choose target", kind: "decision", status: "inferred", evidenceIds: [] }], true);
	eq(decision.claims[0].kind, "decision");
});

test("information: evidence is bounded, redacted, traceable and completion is not self-asserting", () => {
	const engine = createInformationEngine();
	engine.begin("ship feature");
	engine.collect("t1", "bash", "password=secret result ready", false);
	engine.collect("t2", "test", "failed assertion", true);
	const context = engine.context();
	eq(context.evidence[0].text.includes("secret"), false);
	const brief = engine.refine("completed", [{ text: "result ready", kind: "result", status: "observed", evidenceIds: ["t1"] }], true, ["missing"]);
	eq(brief.state, "partial");
	ok(brief.claims.some((c) => c.kind === "risk"));
	ok(briefText(brief).includes("partial"));
	engine.markDelivered(brief, engine.scopeVersion(), { sent: true });
	const same = engine.refine("partial", brief.claims, false);
	eq(same.delivery, "suppress");
});

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

test("report gate: concurrent renders cannot reserve one permit twice", async () => {
	const gate = createReportGate();
	const prepared = await gate.prepare({ summary: "done", checks: ["passed"], remainingWork: [] }, async () => REPORT_CHOICES[0]);
	ok(prepared.ok);
	if (!prepared.ok) return;
	const first = gate.reserve(prepared.id, "html");
	ok(first);
	eq(gate.reserve(prepared.id, "html"), undefined);
	eq(gate.consume(prepared.id, "html"), false);
	ok(first!.release());
	const retry = gate.reserve(prepared.id, "html");
	ok(retry);
	ok(retry!.commit());
	eq(gate.allowed(prepared.id), false);
	eq(retry!.release(), false);
	const next = await gate.prepare({ summary: "done", checks: ["passed"], remainingWork: [] }, async () => REPORT_CHOICES[0]);
	if (!next.ok) throw new Error("prepare failed");
	const stale = gate.reserve(next.id, "html")!;
	gate.reset();
	eq(stale.commit(), false, "reset invalidates outstanding reservation");
});

test("report gate: incomplete or unverified work never prompts", async () => {
	const gate = createReportGate();
	let prompts = 0;
	const select = async () => { prompts++; return REPORT_CHOICES[0]; };
	for (const completion of [
		{ summary: "partial", checks: ["a"], remainingWork: ["external pin"] },
		{ summary: "done", checks: [], remainingWork: [] },
		{ summary: " ", checks: ["a"], remainingWork: [] },
	]) eq((await gate.prepare(completion, select)).ok, false);
	eq(prompts, 0);
	ok(!gate.allowed(undefined));
});
test("report gate: user choice is one-shot, cancellation and new tasks reset", async () => {
	const gate = createReportGate();
	const done = { summary: "done", checks: ["acceptance passed"], remainingWork: [] };
	const cancelled = await gate.prepare(done, async () => "取消汇报");
	eq(cancelled.ok, false);
	ok(!gate.allowed(undefined));
	const prepared = await gate.prepare(done, async () => REPORT_CHOICES[2]);
	ok(prepared.ok);
	if (!prepared.ok) return;
	eq(prepared.choice, "技术验收");
	ok(gate.allowed(prepared.id));
	ok(!gate.allowed("incorrect"));
	ok(!gate.consume("incorrect"));
	ok(gate.consume(prepared.id));
	ok(!gate.consume(prepared.id));
	const next = await gate.prepare(done, async () => REPORT_CHOICES[0]);
	ok(next.ok);
	gate.reset();
	if (next.ok) ok(!gate.allowed(next.id));
});

test("image gate: asks 1–5 count and enforces mode, cancellation and exact permit", async () => {
	const gate = createReportGate();
	const done = { summary: "done", checks: ["passed"], remainingWork: [] };
	const prompts: string[] = [];
	const prepared = await gate.prepare(done, async (question) => {
		prompts.push(question);
		return prompts.length === 1 ? "一张图汇报" : "3 张";
	});
	ok(prepared.ok);
	if (!prepared.ok) return;
	eq(prompts.length, 2);
	eq(prepared.imageCount, 3);
	eq(gate.imageCount(prepared.id), 3);
	ok(!gate.allowed(prepared.id, "html"));
	ok(!gate.consume(prepared.id, "html"));
	ok(gate.consume(prepared.id, "image"));
	ok(!gate.allowed(prepared.id, "image"));
	const cancelled = await gate.prepare(done, async (question) => question.includes("几张") ? "取消汇报" : "一张图汇报");
	ok(!cancelled.ok);
	ok(!gate.allowed(prepared.id));
	for (let n = 1; n <= 5; n++) {
		const selected = await gate.prepare(done, async (question) => question.includes("几张") ? `${n} 张` : "一张图汇报");
		ok(selected.ok);
		if (selected.ok) eq(gate.imageCount(selected.id), n);
	}
	const invalid = await gate.prepare(done, async (question) => question.includes("几张") ? "6 张" : "一张图汇报");
	ok(!invalid.ok);
	ok(!gate.allowed(undefined));
	const html = await gate.prepare(done, async () => "简要汇报");
	ok(html.ok);
	if (html.ok) { ok(gate.allowed(html.id, "html")); ok(!gate.allowed(html.id, "image")); }
});

const imagePage = {
	kicker: "研发里程碑", title: "交付质量与关键证据", takeaway: "已通过核心验收；在限定环境下可投入使用。",
	metrics: [{ value: "37/37", label: "验收用例通过" }],
	insights: [{ title: "覆盖主流程", body: "全部关键路径完成自动化校验。" }, { title: "剩余风险", body: "跨平台字体需要人工复核。" }],
	evidence: ["tests/run-tests.mjs 通过", "本地真实 PNG 文件头已核验"],
	caveat: "仅在现有测试环境验证，未覆盖生产流量。", source: "本地自动化验收 / 2026-01",
};
test("image report: valid SVG is escaped, sized and traceable", () => {
	const svg = renderImageReportSvg({ ...imagePage, title: "<验收>&复盘" }, 1, 2);
	ok(svg.includes('width="1200" height="1600"'));
	ok(svg.includes("&lt;验收&gt;&amp;复盘"));
	ok(svg.includes("本地自动化验收"));
	ok(svg.includes("02") && svg.includes("01"));
	ok(!svg.includes("<验收>"));
	ok(renderImageReportSvg({ ...imagePage, insights: [] }).includes("1200"), "no invented insights required");
});
test("image report: missing provenance, overflow and arbitrary keys fail closed", () => {
	for (const bad of [
		{ ...imagePage, source: "" },
		{ ...imagePage, takeaway: "这是过长的结论".repeat(15) },
		{ ...imagePage, code: "<script/>" },
		{ ...imagePage, title: "坏字符\uD800" },
		{ ...imagePage, source: "path\u202Egnp" },
		{ ...imagePage, insights: Array(5).fill(imagePage.insights[0]) },
	]) {
		let failed = false;
		try { renderImageReportSvg(bad); } catch { failed = true; }
		ok(failed);
	}
	let overflow = false;
	try { renderImageReportSvg({ ...imagePage, metrics: Array.from({ length: 3 }, () => ({ value: "很长的指标数值文本编号", label: "验证结果" })) }); } catch { overflow = true; }
	ok(overflow, "three-column metric must fit its column");
});
test("image export: count validation and failed conversion roll back whole batch", async () => {
	const id = randomUUID();
	const root = getSessionDir(id);
	const prior = process.env.CHROME_PATH;
	try {
		for (const pages of [[], Array(6).fill(imagePage)]) {
			let failed = false;
			try { await exportImageReport(pages, id); } catch { failed = true; }
			ok(failed);
		}
		process.env.CHROME_PATH = "/usr/bin/false";
		let failed = false;
		try { await exportImageReport([imagePage, imagePage], id); } catch { failed = true; }
		ok(failed);
		ok(!existsSync(join(root, "exports")) || readdirSync(join(root, "exports")).length === 0, "failed batch left artifacts");
	} finally {
		if (prior === undefined) delete process.env.CHROME_PATH; else process.env.CHROME_PATH = prior;
		rmSync(root, { recursive: true, force: true });
	}
});
test("image export: real PNG is 1200×1600 and retains SVG", async () => {
	if (!resolveChrome()) {
		if (process.env.TALK_REQUIRE_CHROME === "1") throw new Error("Release verification requires Chromium");
		throw new TestSkipped("Chromium unavailable; real PNG export was not executed");
	}
	const id = randomUUID();
	try {
		const artifacts = await exportImageReport([imagePage], id);
		eq(artifacts.length, 1);
		const a = artifacts[0];
		ok(existsSync(a.svg) && existsSync(a.png));
		const png = readFileSync(a.png);
		eq(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
		eq(png.readUInt32BE(16), 1200);
		eq(png.readUInt32BE(20), 1600);
	} finally { rmSync(getSessionDir(id), { recursive: true, force: true }); }
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
test("extension: bare summary retains evidence but message starts new scope", async () => {
	const hooks = new Map<string, any[]>(), tools = new Map<string, any>();
	let command: any;
	registerTalk({ on: (name: string, fn: any) => { hooks.set(name, [...(hooks.get(name) || []), fn]); }, registerTool: (tool: any) => tools.set(tool.name, tool), registerCommand: (_name: string, cmd: any) => { command = cmd; }, sendUserMessage: async () => {} } as any);
	const before = async (prompt: string) => { for (const fn of hooks.get("before_agent_start")!) await fn({ prompt, systemPrompt: "base" }); };
	await before("Fix A");
	await hooks.get("tool_result")![0]({ toolName: "bash", toolCallId: "a", input: {}, content: [{ type: "text", text: "A passed" }], isError: false });
	await command.handler("", { mode: "tui" }); await before("summarize");
	eq((await tools.get("talk_report_context").execute()).details.goal, "Fix A");
	await command.handler("Analyze B", { mode: "tui" }); await before("Analyze B");
	const context = (await tools.get("talk_report_context").execute()).details;
	eq(context.goal, "Analyze B"); eq(context.evidence.length, 0);
});

test("extension: actual tool registration enforces target permit and rejects cross-style patches", async () => {
	const tools = new Map<string, any>();
	const hooks = new Map<string, any>();
	const hookLists = new Map<string, any[]>();
	const commands = new Map<string, any>();
	registerTalk({ on: (name: string, fn: unknown) => { hooks.set(name, fn); hookLists.set(name, [...(hookLists.get(name) || []), fn]); }, registerTool: (tool: any) => tools.set(tool.name, tool), registerCommand: (name: string, cmd: unknown) => commands.set(name, cmd) } as any);
	ok(commands.has("talk"));
	const rtBefore = getRuntime();
	await stopSession(rtBefore);
	const sent: string[] = [];
	// Replace only delivery; command routing and session implementation are real.
	const fakePi = { on: () => {}, registerTool: () => {}, registerCommand: (name: string, cmd: any) => commands.set(name, cmd), sendUserMessage: async (text: string) => { sent.push(text); } };
	registerTalk(fakePi as any);
	const textCtx = { mode: "tui", ui: { select: () => { throw new Error("Unexpected picker"); }, notify: () => {} } };
	await commands.get("talk").handler("", textCtx);
	await commands.get("talk").handler("summarize results", textCtx);
	await commands.get("talk").handler("summarize results", { ...textCtx, mode: "rpc" });
	eq(sent.length, 3);
	eq(rtBefore.active, false, "ordinary reports do not start side sessions");
	ok(!rtBefore.server, "ordinary reports do not start a server");
	eq([...hooks.keys()].join(","), "agent_start,session_shutdown,before_agent_start,tool_result,agent_settled,session_before_switch,session_before_fork,session_tree");
	for (const name of ["talk_render", "talk_prepare_report", "talk_report_images", "talk_set_style", "talk_status"]) ok(tools.has(name));
	for (const fn of hookLists.get("before_agent_start")!) await fn({ prompt: "verify feature", systemPrompt: "base" }, { sessionManager: { getSessionId: () => "session" } });
	await hooks.get("tool_result")({ toolName: "bash", toolCallId: "observed", content: [{ type: "text", text: "passed" }], isError: false });
	const context = await tools.get("talk_report_context").execute();
	eq(context.details.goal, "verify feature");
	eq(context.details.opportunity.cause, "explicit");
	eq(context.details.opportunity.explicitFormat, "text");
	eq(context.details.evidence.length, 1);
	const settledCtx = { sessionManager: { getLeafId: () => "branch", getSessionId: () => "session" } };
	await hooks.get("agent_settled")({ aborted: false }, settledCtx);
	const settledContext = (await tools.get("talk_report_context").execute()).details;
	eq(settledContext.opportunity.cause, "settled");
	await hooks.get("agent_settled")({ aborted: false }, settledCtx);
	eq((await tools.get("talk_report_context").execute()).details.opportunity.id, settledContext.opportunity.id);
	await hooks.get("agent_settled")({ aborted: true }, settledCtx);
	eq((await tools.get("talk_report_context").execute()).details.opportunity, undefined);
	await hooks.get("session_before_fork")();
	eq((await tools.get("talk_report_context").execute()).details.evidence.length, 0);
	const rt = getRuntime();
	await stopSession(rt);
	await startSession("html-interactive", {}, rt);
	try {
		await renderTalk({ content: "<p>original</p>", surface: "main" }, rt);
		rt.surfaces.get("main")!.styleId = "report";
		const render = tools.get("talk_render");
		const invoke = (params: unknown) => render.execute("test", params, undefined, undefined, { hasUI: false });
		const cross = await invoke({ content: "", styleId: "html-interactive", patch: { selector: "p", surface: "main", html: "changed" } });
		eq(cross.details.reason, "invalid-patch-target");
		const implicit = await invoke({ content: "", metaJson: JSON.stringify({ patch: { selector: "p", surface: "main", html: "changed" } }) });
		eq(implicit.details.reason, "report-permit-required");
		const prepare = tools.get("talk_prepare_report");
		eq((await prepare.execute("test", { summary: "done", checks: ["passed"], remainingWork: [] }, undefined, undefined, { hasUI: false })).details.ok, false);
	} finally { await hooks.get("session_shutdown")(); }
});

test("patch: target style is authoritative and cross-style requests cannot mutate snapshots", async () => {
	const rt = getRuntime();
	await stopSession(rt);
	await startSession("html-interactive", {}, rt);
	try {
		await renderTalk({ content: "<p>original</p>", surface: "main" }, rt);
		const surface = rt.surfaces.get("main")!;
		// Isolate the trust boundary without constructing a formal report fixture.
		surface.styleId = "report";
		const before = rt.server!.getState("main")!.html;
		const versions = rt.versionCount;
		const attack = { content: "", styleId: "html-interactive", patch: { surface: "main", selector: "p", html: "<script>alert(1)</script>" } };
		ok(resolvePatchTarget(attack, rt)?.error, "cross-style target rejected");
		const rejected = await renderTalk(attack, rt);
		eq(rejected.ok, false);
		eq(rt.server!.getState("main")!.html, before);
		eq(rt.versionCount, versions);
		const inherited = resolvePatchTarget({ content: "", meta: { patch: attack.patch } }, rt);
		eq(inherited?.style?.id, "report", "meta patch also inherits target governance");
		const unsafe = await renderTalk({ content: "", patch: attack.patch }, rt);
		eq(unsafe.ok, false, "target report audit rejects script without explicit style");
		eq(rt.server!.getState("main")!.html, before);
		eq(rt.versionCount, versions);
		ok(resolvePatchTarget({ content: "", patch: { selector: "p", surface: "missing" } }, rt)?.error);
	} finally { await stopSession(rt); }
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
test("session: mixed surface styles retain target governance across resume", async () => {
	const rt = getRuntime();
	await startSession("html-interactive", {}, rt);
	const id = rt.sessionId!;
	await renderTalk({ content: "<p>report identity</p>", surface: "main" }, rt);
	rt.surfaces.get("main")!.styleId = "report";
	await stopSession(rt);
	await resumeSession(id, {}, rt);
	eq(rt.surfaces.get("main")!.styleId, "report");
	eq(resolvePatchTarget({ content: "", patch: { selector: "p" } }, rt)?.style?.id, "report");
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
	if (!chrome) {
		if (process.env.TALK_REQUIRE_CHROME === "1") throw new Error("Release verification requires Chromium (set CHROME_PATH)");
		throw new TestSkipped("Chromium unavailable; browser resolution was not verified");
	}
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
test("explain: compiled fragment passes the explain audit", () => {
	const plan = validateExplanationPlan(explainPlan()).plan!;
	const compiled = compileExplanation(plan);
	const audit = auditExplainContent(compiled.html);
	eq(audit.errors.length, 0, `audit errors: ${JSON.stringify(audit.errors)}`);
	eq(audit.warnings.length, 0, `audit warnings: ${JSON.stringify(audit.warnings)}`);
	ok(compiled.html.includes('id="hero"'), "hero present");
	ok(compiled.html.includes('id="layer-analogy"'), "stable layer anchor");
	ok(compiled.html.includes('data-talk-event="explain-check"'), "quiz uses the existing bridge");
	ok(!/answerId|data-correct/i.test(compiled.html), "the page never reveals the answer");
	ok(compiled.html.includes("takeaway-block"), "takeaway block is present");
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
	).plan!;
	const compiled = compileExplanation(plan);
	ok(compiled.html.includes("&lt;script&gt;"), "script text is escaped");
	ok(!compiled.html.includes("<script"), "no script element produced");
	const audit = auditExplainContent(compiled.html);
	eq(audit.errors.length, 0, `escaped text still audits clean: ${JSON.stringify(audit.errors)}`);
});
test("explain: renders through the explain pipeline end to end", async () => {
	const rt = getRuntime();
	await startSession("explain", { title: "explain-e2e" }, rt);
	const plan = validateExplanationPlan(explainPlan()).plan!;
	const compiled = compileExplanation(plan);
	const res = await renderTalk(
		{ styleId: "explain", content: compiled.html, meta: compiled.meta, title: plan.topic },
		rt,
	);
	ok(res.ok, `render ok: ${res.message}`);
	const audit = (res.details as { audit?: { errors: unknown[]; warnings: unknown[] } })?.audit;
	eq(audit?.errors.length ?? -1, 0, "fragment explain audit has zero errors");
	const serverHtml = rt.server?.getState("main")?.html ?? "";
	ok(serverHtml.includes("Content-Security-Policy"), "explain document must include Content-Security-Policy meta");
	ok(/script-src\s+(&#39;|\x27)sha256-/.test(serverHtml), "explain document CSP must include script hashes");
	ok(serverHtml.includes('id="explain-runtime"'), "explain document must include explain-runtime");
	await stopSession(rt);
});

test("explain: quiz answers ride the existing event bridge", async () => {
	const rt = getRuntime();
	await startSession("explain", { title: "explain-quiz" }, rt);
	const plan = validateExplanationPlan(explainPlan()).plan!;
	const compiled = compileExplanation(plan);
	const res = await renderTalk(
		{ styleId: "explain", content: compiled.html, meta: compiled.meta, title: plan.topic },
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
			results.push({ name: t.name, ok: error instanceof TestSkipped, skipped: error instanceof TestSkipped, error: error instanceof Error ? error.message : String(error) });
		}
	}
	await srv?.close();

	const failed = results.filter((r) => !r.ok);
	const skipped = results.filter((r) => r.skipped);
	console.log(`# /talk tests: ${results.length - failed.length - skipped.length}/${results.length} passed; ${skipped.length} skipped`);
	for (const r of skipped) console.log(`# SKIP ${r.name} — ${r.error}`);
	for (const r of failed) console.log(`# FAIL ${r.name} — ${r.error}`);
	process.exit(failed.length ? 1 : 0);
}

void main();
