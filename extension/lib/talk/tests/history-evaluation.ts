/** Read-only opt-in local history replay. Emits aggregates only, never source text/paths. */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { performance } from "node:perf_hooks";
import { createInformationEngine } from "../information";

const root = process.env.TALK_HISTORY_ROOT || join(homedir(), ".pi", "agent", "sessions");
const text = (content: any): string => typeof content === "string" ? content : Array.isArray(content) ? content.filter((c) => c.type === "text").map((c) => c.text || "").join("\n") : "";
const files = readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).flatMap((d) => {
	const dir = join(root, d.name);
	return readdirSync(dir).filter((f) => f.endsWith(".jsonl")).map((f) => join(dir, f));
}).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
const samples: any[] = [];
let sessions = 0;
for (const file of files) {
	if (samples.length >= 20) break;
	let entries: any[];
	try { entries = readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { continue; }
	// Reject branched/compacted records: chronological replay is not trusted active-branch reconstruction.
	if (entries.some((e) => ["compaction", "branch_summary"].includes(e.type))) continue;
	const children = new Map<string, number>();
	for (const e of entries) if (e.parentId) children.set(e.parentId, (children.get(e.parentId) || 0) + 1);
	if ([...children.values()].some((count) => count > 1)) continue;
	const messages = entries.filter((e) => e.type === "message").map((e) => e.message);
	let current: { goal: string; tools: any[]; final?: any; calls: Map<string, any> } | undefined;
	const tasks: typeof current[] = [];
	for (const m of messages) {
		if (m.role === "user") { if (current) tasks.push(current); current = { goal: text(m.content), tools: [], calls: new Map() }; }
		if (!current) continue;
		if (m.role === "assistant") {
			for (const c of m.content || []) if (c.type === "toolCall") current.calls.set(c.id, [c.name, c.arguments]);
			if (text(m.content).trim() && m.stopReason === "stop") current.final = m;
		}
		if (m.role === "toolResult") current.tools.push(m);
	}
	if (current) tasks.push(current);
	let used = 0;
	for (const task of tasks) {
		if (samples.length >= 20 || used >= 2) break;
		if (!task || !task.goal.trim() || !task.tools.length || !task.final || task.goal.length > 6000) continue;
		const engine = createInformationEngine(); engine.begin(task.goal);
		const start = performance.now();
		for (const t of task.tools) engine.collect(t.toolCallId, t.toolName, text(t.content), !!t.isError, JSON.stringify(task.calls.get(t.toolCallId) || [t.toolName, t.toolCallId]));
		const context = engine.context();
		const brief = engine.refine("completed", [], true);
		// No acceptance requirements were registered historically: completion MUST NOT be invented.
		const candidates = context.evidence.filter((e) => e.failed).map((e) => ({ text: `Tool failure: ${e.locator}`, kind: "risk" as const, status: "unverified" as const, evidenceIds: [e.id] }));
		const automatic = engine.refine("partial", candidates, false);
		const repeat = engine.refine("partial", candidates, false);
		const explicit = engine.refine("partial", candidates, true);
		samples.push({ case: `H${String(samples.length + 1).padStart(2, "0")}`, toolResults: task.tools.length, failures: task.tools.filter((t) => t.isError).length, retainedFailures: context.evidence.filter((e) => e.failed).length, droppedFailure: context.droppedFailure, truncatedRecords: context.evidence.filter((e) => e.truncated).length, contextIncomplete: context.incomplete, historicalReplyCharacters: text(task.final.content).length, evidenceContextCharacters: JSON.stringify(context).length, historicalFinalDurationMs: task.final.durationMs ?? null, historicalUsage: task.final.usage ? { input: task.final.usage.input, output: task.final.usage.output } : null, replayMs: performance.now() - start, fabricatedCompletionRejected: brief.state !== "completed", unchangedSuppressed: repeat.delivery === "suppress", explicitSent: explicit.delivery === "send", automaticRiskCount: automatic.claims.filter((c) => c.kind === "risk").length });
		used++;
	}
	if (used) sessions++;
}
const output = { protocol: "local-history-structural-replay/v1", taskCount: samples.length, sessionCount: sessions, additionalSemanticModelCalls: 0, scope: "Historical tool evidence replay and control invariants, NOT semantic quality A/B, independent acceptance or automatic publication verification", samples };
console.log(JSON.stringify(output, null, 2));
if (samples.length < 20 || samples.some((s) => !s.fabricatedCompletionRejected || !s.unchangedSuppressed || !s.explicitSent)) process.exitCode = 1;
