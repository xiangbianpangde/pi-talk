/** Offline real SDK acceptance test. Uses only a disposable HOME and deterministic provider. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
if (!process.env.TASK_GUARD_TEST_HOME) {
 const root = mkdtempSync(join(tmpdir(), "task-guard-test-"));
 const home = join(root, "home"); mkdirSync(home);
 try {
 const entries = (process.env.TASK_GUARD_ENTRIES || "extension/task-guard.ts").split(",");
 const { build } = await import(pathToFileURL(join(process.env.HOME, ".pi/agent/npm/node_modules/esbuild/lib/main.js")));
 const bundled = [];
 for (const [i, entry] of entries.entries()) {
  const out = join(root, `extension-${i}.mjs`);
  await build({ entryPoints: [resolve(entry)], bundle: true, platform: "node", format: "esm", outfile: out, plugins: [{ name: "dependencies", setup(b) {
   b.onResolve({ filter: /^typebox$/ }, () => ({ path: createRequire(import.meta.url).resolve("typebox", { paths: [join(process.env.HOME, ".pi/agent/npm/node_modules/pi-subagents")] }) }));
   b.onResolve({ filter: /npm\/node_modules\/parse5\/dist\/index\.js$/ }, () => ({ path: join(process.env.HOME, ".pi/agent/npm/node_modules/parse5/dist/index.js") }));
  } }], logLevel: "silent" });
  bundled.push(out);
 }
 execFileSync(process.execPath, [process.argv[1]], { stdio: "inherit", env: { ...process.env, HOME: home, TASK_GUARD_TEST_HOME: home, TASK_GUARD_ENTRIES: bundled.join(",") } });
 }
 finally { rmSync(root, { recursive: true, force: true }); }
 process.exit(0);
}
const pkg = process.env.PI_CODING_AGENT_PACKAGE || "/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent";
const { createAgentSession, DefaultResourceLoader, SettingsManager, SessionManager } = await import(pathToFileURL(join(pkg, "dist/index.js")));
const { createAssistantMessageEventStream } = await import(pathToFileURL(join(pkg, "node_modules/@earendil-works/pi-ai/dist/utils/event-stream.js")));
const settingsManager = SettingsManager.inMemory({ defaultTools: [], compaction: { enabled: false }, retry: { enabled: false } });
const resourceLoader = new DefaultResourceLoader({ cwd: process.cwd(), agentDir: join(process.env.HOME, ".pi/agent"), settingsManager, noExtensions: true, noSkills: true, noThemes: true, noPromptTemplates: true, additionalExtensionPaths: (process.env.TASK_GUARD_ENTRIES || "extension/task-guard.ts").split(",").map((path) => resolve(path)) });
await resourceLoader.reload();
assert.deepEqual(resourceLoader.getExtensions().errors, []);
const loaded = resourceLoader.getExtensions().extensions;
assert.equal(loaded.filter((extension) => extension.tools.has("task_guard_checkpoint")).length, 1, "task guard registers once across entrypoints");
const { session } = await createAgentSession({ cwd: process.cwd(), agentDir: join(process.env.HOME, ".pi/agent"), settingsManager, resourceLoader, sessionManager: SessionManager.inMemory(), noTools: "builtin" });
const model = { id: "fixture", name: "Fixture", api: "openai-completions", provider: "openai", baseUrl: "http://127.0.0.1", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32768, maxTokens: 1024 };
const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const steps = [{ id: "build", goal: "Implement", status: "completed" }, { id: "verify", goal: "Verify and deliver", status: "pending" }];
try {
 await session.bindExtensions({});
 await session.modelRuntime.setRuntimeApiKey("openai", "fixture");
 session.agent.state.model = model; session.agent.getApiKey = () => "fixture";
 const runner = session.extensionRunner;
 const errors = []; runner.onError((e) => errors.push(e.message));
 let calls = 0;
 let sequence = [];
 session.agent.streamFunction = () => {
  calls++;
  const item = sequence.shift() || { text: "Stage done, next is verification." };
  const content = item.params ? [{ type: "toolCall", id: `checkpoint-${calls}`, name: "task_guard_checkpoint", arguments: item.params }] : [{ type: "text", text: item.text }];
  const reason = item.params ? "toolUse" : "stop";
  const message = { role: "assistant", content, api: model.api, provider: model.provider, model: model.id, stopReason: reason, timestamp: Date.now(), usage };
  const stream = createAssistantMessageEventStream();
  queueMicrotask(() => { stream.push({ type: "start", partial: message }); stream.push({ type: "done", reason, message }); });
  return stream;
 };
 const run = async (items, count) => { calls = 0; sequence = [...items]; await session.prompt("Execute this synthetic authorized task"); assert.equal(calls, count); };
 await run([{ params: { steps } }, { text: "Implementation done. I will verify next." }, { params: { steps: steps.map((s) => ({ ...s, status: "completed" })) } }, { text: "Verified; delivery complete." }], 4);
 assert.equal(session.getLastAssistantText(), "Verified; delivery complete.");
 assert.ok(session.messages.some((m) => m.customType === "task-guard-continue"));
 console.log("PASS: normal stage stop leads to a real next provider request and full delivery");
 await run([{ text: "Simple answer." }], 1);
 console.log("PASS: new input clears stale plans; simple questions do not continue");
 await run([{ params: { steps } }, { params: { blocker: { kind: "authorization", reason: "Production write is not authorized", nextAction: "User must authorize the named production target" } } }, { text: "Need production authorization." }], 3);
 console.log("PASS: explicit real authorization blocker pauses");
 await run([{ params: { steps } }, { text: "Milestone" }], 4);
 assert.ok(session.messages.some((m) => m.customType === "task-guard-limit"));
 console.log("PASS: unchanged plan stops after two corrections with visible unfinished warning");
 // Real runner dispatch for update_plan, errors, cancel, branch and missing runtime continuation.
 const checkpoint = runner.getToolDefinition("task_guard_checkpoint");
 const ctx = runner.createContext();
 const boundary = async (outcome = "completed", canContinue = true) => runner.emitBoundary({ type: "agent_before_settle", outcome }, () => ({ contextEntries: [], contextMessages: [], llmMessages: [], pendingMessages: [], canContinue }));
 await runner.emit({ type: "input", text: "new", source: "interactive" });
 await runner.emitToolResult({ type: "tool_result", toolName: "update_plan", toolCallId: "p", input: { steps }, content: [], isError: true });
 assert.equal((await boundary()).continue, false);
 await runner.emitToolResult({ type: "tool_result", toolName: "update_plan", toolCallId: "p", input: { steps }, content: [], isError: false });
 assert.equal((await boundary("aborted")).continue, false);
 assert.equal((await boundary("error")).continue, false);
 const corrected = await boundary("completed", false);
 assert.equal(corrected.continue, true, "a custom message makes an assistant-final context continuable");
 assert.ok(corrected.entries.some((e) => e.type === "custom_message"));
 await runner.emit({ type: "ui_prompt_start", reason: "ui_prompt", kind: "confirm" });
 assert.equal((await boundary()).continue, false);
 await runner.emit({ type: "ui_prompt_end", reason: "ui_prompt", kind: "confirm" });
 assert.equal((await boundary()).continue, true);
 await runner.emit({ type: "session_tree" });
 assert.equal((await boundary()).continue, false);
 const invalid = await checkpoint.execute("bad", { steps: [steps[0], steps[0]] }, undefined, undefined, ctx);
 assert.equal(invalid.isError, true);
 assert.deepEqual(errors, []);
 console.log("PASS: external plan, failed plan, Escape/error, UI wait, assistant-final context and branch reset");
 // Evidence must be paired with new successful execution, not just a changed plan or any tool call.
 const plan = async (progress) => runner.emitToolResult({ type: "tool_result", toolName: "update_plan", toolCallId: "p", input: { steps, progress }, content: [], isError: false });
 const work = async (text, isError = false) => runner.emitToolResult({ type: "tool_result", toolName: "bash", toolCallId: "w", input: { command: "verify" }, content: [{ type: "text", text }], isError });
 const fresh = async () => { await runner.emit({ type: "input", text: "new", source: "interactive" }); await plan(); };
 const evidence = (n) => ({ files_changed: [], verification: [`Check ${n} passed`], decisions: [] });
 await fresh();
 for (let n = 0; n < 4; n++) {
  await work(`Check ${n} passed`); await plan(evidence(n));
  assert.equal((await boundary()).continue, true, "same step status with paired new evidence must continue");
 }
 await checkpoint.execute("e", { steps, progress: evidence(4) }, undefined, undefined, ctx);
 await work("Check 4 passed");
 assert.equal((await boundary()).continue, true, "fallback checkpoint supports progress before execution results");
 for (const mode of ["tools-only", "evidence-only", "failed-work", "repeated-work", "cosmetic-plan", "empty-work", "report-only"]) {
  await fresh();
  for (let n = 0; n < 3; n++) {
   if (mode === "tools-only") await work(`output ${n}`);
   if (mode === "empty-work") { await work("   "); await plan(evidence(n)); }
   if (mode === "report-only") { await runner.emitToolResult({ type: "tool_result", toolName: "talk_report_brief", toolCallId: "r", input: {}, content: [{ type: "text", text: `report ${n}` }], isError: false }); await plan(evidence(n)); }
   if (mode === "evidence-only") await plan(evidence(n));
   if (mode === "failed-work") { await work(`failure ${n}`, true); await plan(evidence(n)); }
   if (mode === "repeated-work") { await work("same output"); await plan(evidence(n)); }
   if (mode === "cosmetic-plan") await runner.emitToolResult({ type: "tool_result", toolName: "update_plan", toolCallId: "p", input: { steps: steps.map(s => ({ ...s, goal: `${s.goal} ${n}` })) }, content: [], isError: false });
   const result = await boundary();
   if (n < 2) assert.equal(result.continue, true);
   else {
    assert.equal(result.continue, false, mode);
    assert.match(result.entries[0].content, /连续无进展/);
    assert.match(result.entries[0].content, /verify/);
   }
  }
 }
 await fresh();
 for (let n = 0; n < 9; n++) {
  await work(`unique ${n}`); await plan(evidence(n));
  const result = await boundary();
  if (n < 8) assert.equal(result.continue, true);
  else { assert.equal(result.continue, false); assert.match(result.entries[0].content, /累计纠正达到 8 次/); }
 }
 await runner.emit({ type: "input", text: "acceptance", source: "interactive" });
 const done = steps.map(s => ({ ...s, status: "completed" }));
 const checks = [{ id: "render", goal: "Render and inspect", required: true, status: "pending" }];
 await checkpoint.execute("a", { steps: done, acceptance: checks }, undefined, undefined, ctx);
 assert.equal((await boundary()).continue, true, "completed steps cannot bypass required acceptance");
 await checkpoint.execute("a", { acceptance: [] }, undefined, undefined, ctx);
 assert.equal((await boundary()).continue, true, "omitting acceptance cannot clear it");
 await checkpoint.execute("b", { acceptance: [{ ...checks[0], status: "blocked" }], blocker: { kind: "environment", reason: "Allowed export timed out; other browsers forbidden", nextAction: "Restore permitted renderer" } }, undefined, undefined, ctx);
 const partial = await boundary();
 assert.equal(partial.continue, false);
 assert.match(partial.entries[0].content, /受限交付/);
 assert.match(partial.entries[0].content, /render/);
 const badPass = await checkpoint.execute("c", { acceptance: [{ ...checks[0], status: "passed" }] }, undefined, undefined, ctx);
 assert.equal(badPass.isError, true, "passed acceptance needs evidence");
 await checkpoint.execute("d", { steps: done, acceptance: [{ ...checks[0], status: "passed", evidence: ["Actual render inspected"] }] }, undefined, undefined, ctx);
 assert.equal((await boundary()).continue, false);
 assert.deepEqual(errors, []);
 console.log("PASS: required acceptance continuation, retention, restricted delivery and evidence validation");
 console.log("PASS: paired evidence, checkpoint progress, repeated/failed/unpaired/cosmetic changes and total limit");
} finally { session.dispose(); }
