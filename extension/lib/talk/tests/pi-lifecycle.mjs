/** Real Pi SDK loader/runner replay, offline and isolated by run-tests.mjs. */
import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";
assert.equal(homedir(), process.env.TALK_TEST_HOME, "Use the isolated runner");
const pkg = process.env.PI_CODING_AGENT_PACKAGE;
assert.ok(pkg, "Set PI_CODING_AGENT_PACKAGE to the installed Pi package directory");
const { createAgentSession, DefaultResourceLoader, SettingsManager, SessionManager, createAgentSessionRuntime, createAgentSessionServices, createAgentSessionFromServices } = await import(pathToFileURL(join(pkg, "dist", "index.js")).href);
const settingsManager = SettingsManager.inMemory({ defaultTools: [] });
let registered = false;
const loader = new DefaultResourceLoader({ cwd: process.cwd(), agentDir: join(homedir(), ".pi", "agent"), settingsManager,
 noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true,
 additionalExtensionPaths: [process.env.TALK_SDK_EXTENSION || resolve("extension/talk.ts")], extensionFactories: [(pi) => { registered = true; }] });
await loader.reload();
const extensions = loader.getExtensions();
assert.equal(extensions.errors.length, 0, JSON.stringify(extensions.errors));
assert.ok(registered);
const { session } = await createAgentSession({ cwd: process.cwd(), agentDir: join(homedir(), ".pi", "agent"), settingsManager, resourceLoader: loader, sessionManager: SessionManager.inMemory(), noTools: "builtin" });
try {
 await session.bindExtensions({});
 const runner = session.extensionRunner;
 const errors = [];
 runner.onError((e) => errors.push(String(e.message || e)));
 const ctx = runner.createContext();
 const tools = runner.getAllRegisteredTools();
 assert.ok(tools.some((t) => t.definition.name === "talk_report_context"));
 assert.ok(tools.some((t) => t.definition.name === "talk_report_brief"));
 await runner.emit({ type: "agent_start" });
 const promptPolicy = await runner.emitBeforeAgentStart("Verify A", undefined, { customPrompt: "test", cwd: process.cwd() });
 assert.ok(JSON.stringify(promptPolicy).includes("Continue authorized execution after updates"));
 assert.ok(JSON.stringify(promptPolicy).includes("do not ask again for already granted permission"));
 await runner.emitToolResult({ type: "tool_result", toolName: "bash", toolCallId: "real-runner", input: { command: "test" }, content: [{ type: "text", text: "passed" }], isError: false });
 const evidenceTool = runner.getToolDefinition("talk_report_context");
 const briefTool = runner.getToolDefinition("talk_report_brief");
 assert.ok(briefTool);
 assert.ok(evidenceTool);
 const before = await evidenceTool.execute("probe", {}, undefined, undefined, ctx);
 assert.equal(before.details.goal, "Verify A");
 assert.equal(before.details.evidence.length, 1);
 await runner.emit({ type: "agent_before_settle", entries: [], continue: false, context: {}, outcome: "success" });
 await runner.emit({ type: "agent_settled", aborted: false });
 const settled = await evidenceTool.execute("probe", {}, undefined, undefined, ctx);
 assert.equal(settled.details.opportunity.cause, "settled");
 const params = { state: "partial", claims: [{ text: "passed", kind: "risk", status: "observed", evidenceIds: ["real-runner"] }], explicit: false, publish: true };
 const preview = await briefTool.execute("preview", { ...params, publish: false }, undefined, undefined, ctx);
 assert.equal(preview.details.delivery, undefined);
 const published = await briefTool.execute("publish", params, undefined, undefined, ctx);
 assert.equal(published.details.delivery.sent, true);
 const stageEntries = () => ctx.sessionManager.getEntries().filter((e) => e.type === "custom_message" && e.customType === "talk-stage-update");
 assert.equal(stageEntries().length, 1, "actual Pi transcript contains one stage entry");
 const repeated = await briefTool.execute("repeat", params, undefined, undefined, ctx);
 assert.equal(repeated.details.delivery.sent, false);
 assert.equal(stageEntries().length, 1);
 const requested = await briefTool.execute("explicit", { ...params, explicit: true }, undefined, undefined, ctx);
 assert.equal(requested.details.delivery.sent, true);
 assert.equal(stageEntries().length, 2);
 const routine = await briefTool.execute("routine", { state: "partial", claims: [{ text: "Plan next step", kind: "result", status: "inferred", evidenceIds: [] }], explicit: false, updatePurpose: "routine", publish: true }, undefined, undefined, ctx);
 assert.equal(routine.details.delivery.sent, false);
 assert.equal(routine.details.continuation, "continue");
 assert.equal(stageEntries().length, 2, "routine stage creates no actual transcript entry");
 await runner.emit({ type: "agent_settled", aborted: false });
 await runner.emit({ type: "agent_settled", aborted: true });
 await runner.emit({ type: "session_before_switch", sessionPath: "memory" });
 const switched = await evidenceTool.execute("probe", {}, undefined, undefined, ctx);
 assert.equal(switched.details.goal, "");
 await runner.emit({ type: "session_before_fork", entryId: "test" });
 const reset = await evidenceTool.execute("probe", {}, undefined, undefined, ctx);
 assert.equal(reset.details.evidence.length, 0);
 assert.equal(reset.details.goal, "");
 await runner.emit({ type: "session_shutdown" });
 assert.equal(errors.length, 0, errors.join("\n"));
 assert.ok(ctx.sessionManager.getSessionId());
 // Exercise the actual AgentSession loop with a deterministic provider fixture.
 // This verifies dispatch/settlement, not live-model behavior or report semantics.
 const { createAssistantMessageEventStream } = await import(pathToFileURL(join(pkg, "node_modules", "@earendil-works", "pi-ai", "dist", "utils", "event-stream.js")).href);
 const fixtureModel = { id: "offline-fixture", name: "Offline fixture", api: "openai-completions", provider: "openai", baseUrl: "http://127.0.0.1", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32768, maxTokens: 1024 };
 await session.modelRuntime.setRuntimeApiKey("openai", "offline-fixture-not-a-real-key");
 session.agent.state.model = fixtureModel;
 session.agent.getApiKey = () => "offline-fixture";
 let providerFixtureCalls = 0;
 session.agent.streamFunction = () => {
  providerFixtureCalls++;
  const stream = createAssistantMessageEventStream();
  const message = { role: "assistant", content: [{ type: "text", text: "Fixture reply; no completion claim." }], api: fixtureModel.api, provider: fixtureModel.provider, model: fixtureModel.id, stopReason: "stop", timestamp: Date.now(), usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
  queueMicrotask(() => { stream.push({ type: "start", partial: message }); stream.push({ type: "done", reason: "stop", message }); });
  return stream;
 };
 await session.prompt("Check task-loop dispatch");
 const loopContext = await evidenceTool.execute("probe", {}, undefined, undefined, runner.createContext());
 assert.equal(loopContext.details.goal, "Check task-loop dispatch");
 assert.equal(loopContext.details.opportunity.cause, "settled");
 assert.equal(session.getLastAssistantText(), "Fixture reply; no completion claim.");
 assert.equal(providerFixtureCalls, 1);
 await session.prompt("A second independent task");
 const second = await evidenceTool.execute("probe", {}, undefined, undefined, runner.createContext());
 assert.equal(second.details.goal, "A second independent task");
 assert.equal(second.details.evidence.length, 0);
 assert.equal(second.details.opportunity.cause, "settled");
 assert.equal(providerFixtureCalls, 2);
 // A queued continuation must finish without a permission dialog or milestone stop.
 let queueOnce = true;
 const unsubscribeQueue = session.subscribe((event) => {
  if (event.type === "message_end" && event.message?.role === "assistant" && queueOnce) {
   queueOnce = false;
   session.followUp("Continue the authorized task without asking for permission");
  }
 });
 await session.prompt("Run the authorized multi-stage task");
 await session.waitForIdle();
 unsubscribeQueue();
 assert.equal(queueOnce, false);
 assert.ok(providerFixtureCalls >= 4, "queued continuation reached the deterministic response stream");
 assert.equal(session.getLastAssistantText(), "Fixture reply; no completion claim.");
 // Abort an actual pending provider stream, then recover with another prompt.
 const normalStream = session.agent.streamFunction;
 let enteredStream;
 const entered = new Promise((resolve) => { enteredStream = resolve; });
 session.agent.streamFunction = (_model, _context, options) => {
  const stream = createAssistantMessageEventStream();
  const message = { role: "assistant", content: [], api: fixtureModel.api, provider: fixtureModel.provider, model: fixtureModel.id, stopReason: "aborted", timestamp: Date.now(), usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
  options.signal.addEventListener("abort", () => stream.push({ type: "error", reason: "aborted", error: message }), { once: true });
  enteredStream();
  return stream;
 };
 const pendingPrompt = session.prompt("Task to abort");
 await entered;
 await session.abort();
 await pendingPrompt;
 const abortedState = await evidenceTool.execute("abort-probe", {}, undefined, undefined, runner.createContext());
 assert.notEqual(abortedState.details.opportunity?.cause, "settled", "aborted task is not settled reporting opportunity");
 session.agent.streamFunction = normalStream;
 await session.prompt("Recovery after abort");
 const recovered = await evidenceTool.execute("recovery-probe", {}, undefined, undefined, runner.createContext());
 assert.equal(recovered.details.goal, "Recovery after abort");
 assert.equal(recovered.details.opportunity.cause, "settled");
 await session.reload();
 const reloadedRunner = session.extensionRunner;
 const reloadedContext = reloadedRunner.createContext();
 const reloadedEvidence = reloadedRunner.getToolDefinition("talk_report_context");
 const afterReload = await reloadedEvidence.execute("reload-probe", {}, undefined, undefined, reloadedContext);
 assert.equal(afterReload.details.goal, "");
 assert.equal(afterReload.details.evidence.length, 0, "reload invalidates ephemeral evidence rather than carrying stale scope");
 assert.equal(reloadedRunner.getAllRegisteredTools().filter((t) => t.definition.name === "talk_report_brief").length, 1);
 assert.equal(errors.length, 0, errors.join("\n"));
 console.log("# Real Pi SDK lifecycle runner: passed (event replay + consecutive AgentSession loops + queued continuation; deterministic provider fixture, no network)");
} finally { session.dispose(); }

// Actual replacement/resume uses file-backed synthetic history inside isolated HOME.
const sessionDir = join(homedir(), "runtime-sessions");
const initialManager = SessionManager.create(process.cwd(), sessionDir);
initialManager.appendMessage({ role: "user", content: [{ type: "text", text: "Synthetic persisted task" }], timestamp: Date.now() });
const originalPath = initialManager.getSessionFile();
const runtime = await createAgentSessionRuntime(async ({ cwd, agentDir, sessionManager, sessionStartEvent }) => {
 const services = await createAgentSessionServices({ cwd, agentDir, settingsManager: SettingsManager.inMemory({ defaultTools: [] }), resourceLoaderOptions: { noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, additionalExtensionPaths: [process.env.TALK_SDK_EXTENSION] } });
 assert.equal(services.resourceLoader.getExtensions().errors.length, 0);
 return { ...(await createAgentSessionFromServices({ services, sessionManager, sessionStartEvent, noTools: "builtin" })), services, diagnostics: services.diagnostics };
}, { cwd: process.cwd(), agentDir: join(homedir(), ".pi", "agent"), sessionManager: initialManager });
const readState = async () => {
 await runtime.session.bindExtensions({});
 const runner = runtime.session.extensionRunner;
 return runner.getToolDefinition("talk_report_context").execute("replacement-probe", {}, undefined, undefined, runner.createContext());
};
try {
 await readState();
 await runtime.session.extensionRunner.emitBeforeAgentStart("Old task", undefined, { customPrompt: "test", cwd: process.cwd() });
 const oldSession = runtime.session;
 const changed = await runtime.newSession();
 assert.equal(changed.cancelled, false);
 assert.notEqual(runtime.session, oldSession);
 assert.equal((await readState()).details.goal, "");
 assert.ok(originalPath);
 const resumed = await runtime.switchSession(originalPath);
 assert.equal(resumed.cancelled, false);
 assert.equal((await readState()).details.evidence.length, 0);
 assert.ok(runtime.session.messages.some((m) => m.role === "user"));
 const userEntry = runtime.session.extensionRunner.createContext().sessionManager.getEntries().find((e) => e.type === "message" && e.message.role === "user");
 assert.ok(userEntry);
 const forked = await runtime.fork(userEntry.id, { position: "at" });
 assert.equal(forked.cancelled, false);
 const forkState = await readState();
 assert.equal(forkState.details.goal, "");
 assert.equal(forkState.details.evidence.length, 0);
 console.log("# Real Pi runtime replacement/resume: passed (synthetic persisted history, no provider)");
} finally { await runtime.dispose(); }
