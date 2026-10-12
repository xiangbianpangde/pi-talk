/** Paid model acceptance probe: real auth is read-only; all writes are isolated. */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
assert.equal(process.env.TASK_GUARD_LIVE, "1", "Explicit opt-in required");
assert.ok(process.env.TALK_AUTH_ROOT, "Read-only auth/model root required");
if (!process.env.TASK_GUARD_TEST_HOME) {
 const root = mkdtempSync(join(tmpdir(), "task-guard-live-")), home = join(root, "home"); mkdirSync(home);
 try { execFileSync(process.execPath, [process.argv[1]], { stdio: "inherit", env: { ...process.env, HOME: home, TASK_GUARD_TEST_HOME: home } }); }
 finally { rmSync(root, { recursive: true, force: true }); }
 process.exit(0);
}
const pkg = process.env.PI_CODING_AGENT_PACKAGE || "/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent";
const { createAgentSession, ModelRuntime, DefaultResourceLoader, SettingsManager, SessionManager } = await import(pathToFileURL(join(pkg, "dist/index.js")));
const { Type } = await import(pathToFileURL(join(pkg, "node_modules/typebox/build/index.mjs")));
const runtime = await ModelRuntime.create({ allowModelNetwork: false, authPath: join(process.env.TALK_AUTH_ROOT, "auth.json"), modelsPath: join(process.env.TALK_AUTH_ROOT, "models.json") });
const model = runtime.getModel(process.env.PI_PROVIDER, process.env.PI_MODEL);
assert.ok(model, "Set PI_PROVIDER and PI_MODEL to an available model");
const records = [];
for (const blocked of [false, true]) {
 const settingsManager = SettingsManager.inMemory({ defaultTools: ["stage_probe", "task_guard_checkpoint"], compaction: { enabled: false }, retry: { enabled: false } });
 const cwd = process.env.HOME;
 const loader = new DefaultResourceLoader({ cwd, agentDir: join(cwd, "agent"), settingsManager, noExtensions: true, noSkills: true, noThemes: true, noPromptTemplates: true, additionalExtensionPaths: [resolve("extension/task-guard.ts")] });
 await loader.reload(); assert.deepEqual(loader.getExtensions().errors, []);
 const stages = [];
 const { session } = await createAgentSession({ cwd, agentDir: join(cwd, "agent"), modelRuntime: runtime, model, thinkingLevel: "low", settingsManager, sessionManager: SessionManager.inMemory(), resourceLoader: loader, noTools: "builtin", customTools: [{ name: "stage_probe", label: "Synthetic stage", description: "Run synthetic stage 1, 2 or 3. No external effects. Use stages in order.", parameters: Type.Object({ step: Type.Integer({ minimum: 1, maximum: 3 }) }), async execute(_id, { step }) { stages.push(step); return { content: [{ type: "text", text: step === 2 && blocked ? "BLOCKED: user-only credential missing; stage 3 is forbidden until user supplies it." : `Stage ${step} done.` }] }; } }] });
 const timer = setTimeout(() => { void session.abort(); }, 120000);
 try {
  await session.bindExtensions({ mode: "print" });
  await session.prompt(`This is a controlled execution-boundary test. Register a complete 3-stage plan using task_guard_checkpoint. All stages are authorized except when a tool reports missing user-only credentials. Run stage_probe 1 and 2. ${blocked ? "If step 2 blocks, record the precise blocker and request the credential; do NOT run step 3." : "To exercise the boundary deliberately, after stage 2 emit a final ordinary assistant reply saying only 'Stage 2 completed; verification remains.' WITHOUT a tool call in that reply. On the guard's next continuation, run stage_probe 3, mark the complete plan completed, and give final delivery."}`);
  const messages = session.messages;
  const last = session.getLastAssistantText() || "";
  const record = { case: blocked ? "missing-input" : "forced-stage-stop", stages, corrections: messages.filter((m) => m.customType === "task-guard-continue").length, blockerRecorded: messages.some((m) => m.role === "assistant" && m.content?.some((c) => c.type === "toolCall" && c.name === "task_guard_checkpoint" && c.arguments?.blocker)), finalPresent: !!last.trim(), passed: JSON.stringify(stages) === JSON.stringify(blocked ? [1, 2] : [1, 2, 3]) && (blocked ? /credential|凭据/i.test(last) : messages.some((m) => m.customType === "task-guard-continue")) };
  records.push(record); console.log(JSON.stringify(record));
 } finally { clearTimeout(timer); session.dispose(); }
}
const report = { protocol: "task-guard-live/v1", provider: model.provider, model: model.id, records };
if (process.env.TASK_GUARD_REPORT) writeFileSync(process.env.TASK_GUARD_REPORT, JSON.stringify(report, null, 2) + "\n");
assert.ok(records.every((r) => r.passed && r.finalPresent && (r.case !== "missing-input" || r.blockerRecorded)), JSON.stringify(report));
