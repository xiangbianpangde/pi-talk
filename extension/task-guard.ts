/** Execution protection independent of /talk and its reporting surfaces. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { createHash } from "node:crypto";

type Step = { id: string; goal: string; status: "pending" | "in_progress" | "completed" };
type Blocker = { kind: "missing_input" | "authorization" | "environment"; reason: string; nextAction: string };
const stepSchema = Type.Object({ id: Type.String({ minLength: 1 }), goal: Type.String({ minLength: 1 }), status: Type.Union([Type.Literal("pending"), Type.Literal("in_progress"), Type.Literal("completed")]) });

export default function taskGuard(pi: ExtensionAPI) {
	// The shared session bus coordinates separate extension APIs (and loader copies).
	const claim = { installed: false };
	pi.events.emit("pi-talk:task-guard-installed", claim);
	if (claim.installed) return;
	const release = pi.events.on("pi-talk:task-guard-installed", (value: unknown) => {
		(value as { installed: boolean }).installed = true;
	});
	pi.on("session_shutdown", release);
	let steps: Step[] = [];
	let blocker: Blocker | undefined;
	const executionSeen = new Set<string>();
	const evidenceSeen = new Set<string>();
	let newExecution = false;
	let newEvidence = false;
	let completedStep = false;
	let repeated = 0;
	let total = 0;
	let promptOpen = false;
	const reset = () => { steps = []; blocker = undefined; executionSeen.clear(); evidenceSeen.clear(); newExecution = false; newEvidence = false; completedStep = false; repeated = 0; total = 0; promptOpen = false; };
	const acceptPlan = (value: unknown, progress?: { verification?: string[] }) => {
		if (!Array.isArray(value) || value.length === 0 || value.some((s) => !s || typeof s.id !== "string" || !s.id.trim() || typeof s.goal !== "string" || !s.goal.trim() || !["pending", "in_progress", "completed"].includes(s.status)) || new Set(value.map((s) => s.id)).size !== value.length) return false;
		completedStep ||= value.some((s) => s.status === "completed" && steps.some((old) => old.id === s.id && old.status !== "completed"));
		steps = value.map(({ id, goal, status }) => ({ id, goal, status }));
		// Evidence is a claim, not proof: pair it with new successful execution at settlement.
		for (const item of progress?.verification ?? []) {
			if (typeof item !== "string" || !item.trim()) continue;
			const key = item.trim().replace(/\s+/g, " ");
			if (!evidenceSeen.has(key)) { evidenceSeen.add(key); newEvidence = true; }
		}
		blocker = undefined;
		return true;
	};
	// New input, replacement, and branch transitions must not inherit stale work.
	pi.on("input", () => { reset(); });
	for (const event of ["session_start", "session_switch", "session_fork", "session_tree"] as const) pi.on(event, () => { reset(); });
	pi.on("ui_prompt_start", () => { promptOpen = true; });
	pi.on("ui_prompt_end", () => { promptOpen = false; });
	pi.on("before_agent_start", (event) => ({ systemPrompt: event.systemPrompt + "\n\nTask execution boundary: for an authorized multi-step task, register and maintain its COMPLETE acceptance plan using update_plan, or task_guard_checkpoint if update_plan is unavailable. A stage report is not completion: keep executing authorized pending work. After meaningful execution, record concrete new verification evidence in progress.verification; unchanged step status alone does not mean no progress, but tool calls or rewritten claims alone do not establish progress. Mark steps completed only after their acceptance criteria are met; never mark them complete just to stop. Do not invent work for simple questions. If essential user input, new authorization, or an unrecoverable environment problem prevents all remaining authorized work, record a concrete blocker using task_guard_checkpoint (kind, reason, nextAction), then explain it to the user. Never use a blocker merely to request permission to continue already-authorized work. New input starts a new scope; re-register any still-relevant plan. Resumed or branched sessions must re-register their current plan." }));
	pi.on("tool_result", (event) => {
		if (event.isError) return;
		if (event.toolName === "update_plan") { acceptPlan(event.input.steps, event.input.progress); return; }
		// Control/reporting tools and empty results do not establish execution progress.
		if (!steps.length || /^(task_guard_checkpoint|talk_.*|.*plan.*|.*goal.*|.*checkpoint.*|.*question.*|.*intercom.*)$/.test(event.toolName)) return;
		if (!event.content.some((c) => c.type !== "text" || c.text.trim())) return;
		const key = createHash("sha256").update(JSON.stringify([event.toolName, event.content])).digest("hex");
		if (!executionSeen.has(key)) { executionSeen.add(key); newExecution = true; }
	});
	pi.registerTool({
		name: "task_guard_checkpoint", label: "Task execution checkpoint",
		description: "Register the full current multi-step acceptance plan if update_plan is unavailable, or record a genuine blocker preventing ALL remaining authorized work. Not a stage-report tool. Do not use to stop at a milestone or to re-request granted permission.",
		parameters: Type.Object({ steps: Type.Optional(Type.Array(stepSchema, { minItems: 1 })), progress: Type.Optional(Type.Object({ files_changed: Type.Optional(Type.Array(Type.String())), verification: Type.Optional(Type.Array(Type.String())), decisions: Type.Optional(Type.Array(Type.String())) })), blocker: Type.Optional(Type.Object({ kind: Type.Union([Type.Literal("missing_input"), Type.Literal("authorization"), Type.Literal("environment")]), reason: Type.String({ minLength: 1 }), nextAction: Type.String({ minLength: 1 }) })) }),
		async execute(_id, params) {
			if ((!params.steps && !params.blocker) || (params.steps && !acceptPlan(params.steps, params.progress)) || (params.blocker && (!params.blocker.reason.trim() || !params.blocker.nextAction.trim()))) return { content: [{ type: "text", text: "Invalid checkpoint: provide a valid full plan or a concrete blocker." }], isError: true };
			if (params.blocker) blocker = params.blocker;
			return { content: [{ type: "text", text: blocker ? `Execution paused: ${blocker.reason}. Required next action: ${blocker.nextAction}` : "Plan recorded. Continue authorized work until all criteria are met." }], details: { steps, blocker } };
		},
	});
	pi.on("agent_before_settle", (event) => {
		if (event.outcome !== "completed" || event.continue || promptOpen || blocker || !steps.some((s) => s.status !== "completed")) return;
		// Bounded protection, not an autonomous goal engine. Never mask an error or Escape.
		if (completedStep || (newExecution && newEvidence)) repeated = 0;
		newExecution = false; newEvidence = false; completedStep = false;
		const pending = steps.filter((s) => s.status !== "completed");
		if (total >= 8 || repeated >= 2) {
			const reason = total >= 8 ? "累计纠正达到 8 次" : "连续无进展达到上限（2 次纠正后仍无新增完成步骤或执行记录与验证证据配对）";
			return { entries: [{ type: "custom_message", customType: "task-guard-limit", display: true, content: `任务仍未完成，但自动继续保护已停止：${reason}。累计纠正：${total} 次。未将待办标为完成。未完成步骤：${JSON.stringify(pending)}。请检查真实阻塞和进展证据。` }] };
		}
		repeated++; total++;
		return { continue: true, entries: [{ type: "custom_message", customType: "task-guard-continue", display: false, content: `The authorized task is NOT complete. Your last reply was only a stage update. Continue now with the next authorized action, without asking permission again. Pending acceptance steps: ${JSON.stringify(steps.filter((s) => s.status !== "completed"))}. Update the plan after meaningful progress, including concrete new verification evidence in progress.verification paired with actual successful execution. Reworded plans, repeated results or tool calls alone are not progress. If genuinely blocked, record the concrete required input/authorization/environment action with task_guard_checkpoint and explain it. Do not clear or complete the plan just to end this run.` }] };
	});
}
