/** Opt-in paid real-model probe. No filesystem tools or raw user history. */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
assert.equal(process.env.TALK_LIVE_EVAL, "1", "Explicit live evaluation opt-in required");
assert.ok(process.env.TALK_TEST_HOME && process.env.HOME === process.env.TALK_TEST_HOME, "Run with an isolated HOME and TALK_TEST_HOME");
assert.ok(process.env.TALK_AUTH_ROOT, "Provide the real agent auth root for read-only model configuration");
const pkg = process.env.PI_CODING_AGENT_PACKAGE;
assert.ok(pkg);
const { createAgentSession, ModelRuntime, DefaultResourceLoader, SettingsManager, SessionManager } = await import(pathToFileURL(join(pkg, "dist/index.js")).href);
const { Type } = await import(pathToFileURL(join(pkg, "node_modules/typebox/build/index.mjs")).href).catch(async () => {
 const { createRequire } = await import("node:module");
 return import(pathToFileURL(createRequire(join(pkg, "package.json")).resolve("typebox")).href);
});
// Read configured model/auth only. All session/resource writes use the sandbox.
const runtime = await ModelRuntime.create({ allowModelNetwork: false, authPath: join(process.env.TALK_AUTH_ROOT, "auth.json"), modelsPath: join(process.env.TALK_AUTH_ROOT, "models.json") });
const model = runtime.getModel(process.env.PI_PROVIDER, process.env.PI_MODEL);
assert.ok(model, "Configured model unavailable");
const cwd = mkdtempSync(join(tmpdir(), "talk-live-stage-"));
const cases = [
 { id: "routine", blocked: false, prompt: "Complete the controlled 3-stage task using stage_probe steps 1, 2, 3 in order. All stages are authorized. Do not stop at milestones. At the end report the outcome." },
 { id: "resolvable-risk", blocked: false, prompt: "Complete the controlled 3-stage task using stage_probe steps 1, 2, 3 in order. A recoverable risk at step 2 can be resolved by step 3. Already authorized: proceed without asking permission." },
 { id: "essential-input", blocked: true, prompt: "Run stage_probe steps in order. If step 2 reports a missing user-only credential, do not invent it or execute step 3. Request the missing input precisely." },
];
const records = [];
try {
 for (const test of cases) {
  const steps = [], messages = [], prematureEnds = [], allText = []; 
  const settingsManager = SettingsManager.inMemory({ defaultTools: ["stage_probe", "talk_report_brief", "talk_report_context", "talk_task_requirements"] });
  const loader = new DefaultResourceLoader({ cwd, agentDir: join(cwd, "agent"), settingsManager, noExtensions: true, noSkills: true, noThemes: true, noPromptTemplates: true, additionalExtensionPaths: [process.env.TALK_SDK_EXTENSION] });
  await loader.reload();
  assert.equal(loader.getExtensions().errors.length, 0);
  const { session } = await createAgentSession({ cwd, agentDir: join(cwd, "agent"), modelRuntime: runtime, model, thinkingLevel: "low", settingsManager, sessionManager: SessionManager.inMemory(cwd), resourceLoader: loader, noTools: "builtin", tools: ["stage_probe", "talk_report_brief", "talk_report_context", "talk_task_requirements"], customTools: [{ name: "stage_probe", label: "Controlled task stage", description: "Perform one controlled stage; use steps 1, 2, 3 in order. No real external effects.", parameters: Type.Object({ step: Type.Integer({ minimum: 1, maximum: 3 }) }), async execute(_id, params) { steps.push(params.step); const result = params.step === 2 ? test.blocked ? "BLOCKED: missing user-only credential; step 3 cannot proceed without it." : test.id === "resolvable-risk" ? "Recoverable risk; step 3 is authorized and resolves it." : "Routine milestone only. Continue authorized step 3; do not ask permission." : params.step === 3 ? "Final stage completed; controlled acceptance passed." : "Stage 1 completed. Continue step 2."; return { content: [{ type: "text", text: result }], details: { stage: params.step } }; } }] });
  const started = performance.now();
  const timer = setTimeout(() => { void session.abort(); }, 90000);
  try {
   await session.bindExtensions({ mode: "print" });
   session.subscribe((event) => { if (event.type === "message_end" && event.message?.role === "assistant") { messages.push(event.message); const content = event.message.content || []; const t = content.filter((c) => c.type === "text").map((c) => c.text).join("\n"); if (t) allText.push(t); if (event.message.stopReason === "stop" && !test.blocked && !steps.includes(3)) prematureEnds.push(steps.length); } });
   await session.prompt(test.prompt);
   const usage = messages.reduce((a, m) => ({ input: a.input + (m.usage?.input || 0), output: a.output + (m.usage?.output || 0) }), { input: 0, output: 0 });
   const last = session.getLastAssistantText() || "";
   records.push({ case: test.id, steps, expectedSteps: test.blocked ? [1, 2] : [1, 2, 3], passed: JSON.stringify(steps) === JSON.stringify(test.blocked ? [1, 2] : [1, 2, 3]), assistantMessages: messages.length, elapsedMs: performance.now() - started, usage, finalCharacters: last.length, requestsContinue: allText.some((t) => /shall I continue|是否继续|要我继续|可以继续吗/i.test(t)), prematureEnds: prematureEnds.length, finalPresent: !!last });
  } finally { clearTimeout(timer); session.dispose(); }
 }
 console.log(JSON.stringify({ protocol: "live-stage-probe/v1", provider: model.provider, model: model.id, scope: "Three controlled scenarios, current policy only; no old/new causal comparison", records }, null, 2));
 if (records.some((r) => !r.passed || (!r.case.includes("input") && r.requestsContinue))) process.exitCode = 1;
} finally { rmSync(cwd, { recursive: true, force: true }); }
