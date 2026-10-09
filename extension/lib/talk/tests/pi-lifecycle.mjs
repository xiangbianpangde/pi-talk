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
 await runner.emit({ type: "agent_settled", aborted: false });
 const settled = await evidenceTool.execute("probe", {}, undefined, undefined, ctx);
 assert.equal(settled.details.opportunity.cause, "settled");
 await runner.emit({ type: "agent_settled", aborted: false });
 await runner.emit({ type: "agent_settled", aborted: true });
 await runner.emit({ type: "session_before_fork", entryId: "test" });
 const reset = await evidenceTool.execute("probe", {}, undefined, undefined, ctx);
 assert.equal(reset.details.evidence.length, 0);
 assert.equal(reset.details.goal, "");
 await runner.emit({ type: "session_shutdown" });
 assert.equal(errors.length, 0, errors.join("\n"));
 assert.ok(ctx.sessionManager.getSessionId());
 console.log("# Real Pi SDK lifecycle runner: passed (offline event replay; no provider call)");
} finally { session.dispose(); }
