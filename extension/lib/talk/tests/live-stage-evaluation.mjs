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
const cases = process.env.TALK_COMPLETION_EVAL === "1" ? [
 { id: "completion", blocked: false, prompt: "Complete the controlled task with stage_probe steps 1,2,3 in order. Required acceptance criterion: Final stage completed; controlled acceptance passed. Before stage tools, register exactly one requirement id=acceptance anchored to 'controlled acceptance passed' with criterion exactly 'Final stage completed; controlled acceptance passed.'. After step 3 get talk_report_context, use the exact full text of step 3 as an observed result claim, its evidence id in acceptanceEvidenceIds and checks for acceptance. Call talk_report_brief with state=completed, publish=true, explicit=false, updatePurpose=routine to verify an accidental routine label cannot hide validated completion. Then finish with a short acknowledgment without repeating the published report." },
] : process.env.TALK_DELIVERY_EVAL === "1" ? [
 { id: "delivery", blocked: false, prompt: "Complete stage_probe steps 1,2,3. After step 1 call talk_report_brief with publish=true, explicit=false, updatePurpose=routine, state=partial and one inferred result 'Routine checkpoint'. This must not publish. After step 2 publish an inferred risk claim with exact text 'Controlled risk notice' and empty evidenceIds, explicit=false, updatePurpose=outcome. Repeat the identical brief once to test suppression, then call it once with explicit=true to test requested repetition. Continue step 3 without asking permission. Do not repeat 'Controlled risk notice' in your final answer; summarize stage 3 only. This is an authorized controlled delivery test." },
] : [
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
   const stageEntries = session.extensionRunner.createContext().sessionManager.getEntries().filter((e) => e.type === "custom_message" && e.customType === "talk-stage-update");
   const deliveryCalls = messages.flatMap((m) => m.content || []).filter((c) => c.type === "toolCall" && c.name === "talk_report_brief");
   const completionCall = deliveryCalls.find((c) => c.arguments?.state === "completed" && c.arguments?.publish === true && c.arguments?.explicit === false && c.arguments?.updatePurpose === "routine");
   const requirementCalls = messages.flatMap((m) => m.content || []).filter((c) => c.type === "toolCall" && c.name === "talk_task_requirements");
   const completionPassed = test.id !== "completion" || (stageEntries.length === 1 && stageEntries[0].details?.state === "completed" && String(stageEntries[0].content).includes("controlled acceptance passed") && !!completionCall && requirementCalls.length === 1 && completionCall.arguments.claims.some((c) => c.status === "observed" && c.kind === "result") && completionCall.arguments.acceptanceEvidenceIds?.length > 0 && completionCall.arguments.checks?.some((c) => c.requirementId === "acceptance" && c.evidenceIds.length > 0));
   const deliveryPassed = test.id !== "delivery" || (stageEntries.length === 2 && stageEntries.every((e) => String(e.content).includes("Controlled risk notice")) && !last.includes("Controlled risk notice") && deliveryCalls.length >= 4);
   records.push({ case: test.id, steps, expectedSteps: test.blocked ? [1, 2] : [1, 2, 3], passed: JSON.stringify(steps) === JSON.stringify(test.blocked ? [1, 2] : [1, 2, 3]), assistantMessages: messages.length, elapsedMs: performance.now() - started, usage, finalCharacters: last.length, stageEntries: stageEntries.length, deliveryPassed, completionPassed, requestsContinue: allText.some((t) => /shall I continue|是否继续|要我继续|可以继续吗/i.test(t)), prematureEnds: prematureEnds.length, finalPresent: !!last.trim(), requiredInputRequested: !test.blocked || (/(credential|凭据)/i.test(last) && /(provide|need|supply|missing|请提供|需要|缺少)/i.test(last)), falseCompletion: test.blocked && /(?:all stages completed|task (?:is )?complete|全部完成|任务已完成)/i.test(last) });
  } finally { clearTimeout(timer); session.dispose(); }
 }
 console.log(JSON.stringify({ protocol: "live-stage-probe/v1", provider: model.provider, model: model.id, scope: "Controlled current-policy scenarios selected by evaluation mode; no old/new causal comparison", records }, null, 2));
 if (records.some((r) => !r.passed || !r.completionPassed || !r.deliveryPassed || !r.finalPresent || r.prematureEnds > 0 || !r.requiredInputRequested || r.falseCompletion || (!r.case.includes("input") && r.requestsContinue))) process.exitCode = 1;
} finally { rmSync(cwd, { recursive: true, force: true }); }
