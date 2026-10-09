/** Real Pi SDK loader/runner replay, offline and isolated by run-tests.mjs. */
import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";
assert.equal(homedir(), process.env.TALK_TEST_HOME, "Use the isolated runner");
const pkg = process.env.PI_CODING_AGENT_PACKAGE;
assert.ok(pkg, "Set PI_CODING_AGENT_PACKAGE to the installed Pi package directory");
const { createAgentSession, DefaultResourceLoader, SettingsManager, SessionManager } = await import(pathToFileURL(join(pkg, "dist", "index.js")).href);
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
 await runner.emit({ type: "agent_start" });
 await runner.emitBeforeAgentStart("Verify A", undefined, { customPrompt: "test", cwd: process.cwd() });
 await runner.emitToolResult({ type: "tool_result", toolName: "bash", toolCallId: "real-runner", input: { command: "test" }, content: [{ type: "text", text: "passed" }], isError: false });
 const evidenceTool = runner.getToolDefinition("talk_report_context");
 assert.ok(evidenceTool);
 const before = await evidenceTool.execute("probe", {}, undefined, undefined, ctx);
 assert.equal(before.details.goal, "Verify A");
 assert.equal(before.details.evidence.length, 1);
 await runner.emit({ type: "agent_before_settle", entries: [], continue: false, context: {}, outcome: "success" });
 await runner.emit({ type: "agent_settled", aborted: false });
 const settled = await evidenceTool.execute("probe", {}, undefined, undefined, ctx);
 assert.equal(settled.details.opportunity.cause, "settled");
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
 assert.equal(errors.length, 0, errors.join("\n"));
 console.log("# Real Pi SDK lifecycle runner: passed (event replay + two actual AgentSession loops; deterministic provider fixture, no network)");
} finally { session.dispose(); }
