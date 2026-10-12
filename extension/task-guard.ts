/** Execution protection independent of /talk and its reporting surfaces. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

type Step = { id: string; goal: string; status: "pending" | "in_progress" | "completed" };
type Blocker = { kind: "missing_input" | "authorization" | "environment"; reason: string; nextAction: string };
const stepSchema = Type.Object({ id: Type.String({ minLength: 1 }), goal: Type.String({ minLength: 1 }), status: Type.Union([Type.Literal("pending"), Type.Literal("in_progress"), Type.Literal("completed")]) });

export default function taskGuard(pi: ExtensionAPI) {
	let steps: Step[] = [];
	let blocker: Blocker | undefined;
	let fingerprint = "";
	let repeated = 0;
	let total = 0;
	let promptOpen = false;
	const reset = () => { steps = []; blocker = undefined; fingerprint = ""; repeated = 0; total = 0; promptOpen = false; };
	const acceptPlan = (value: unknown) => {
		if (!Array.isArray(value) || value.length === 0 || value.some((s) => !s || typeof s.id !== "string" || !s.id.trim() || typeof s.goal !== "string" || !s.goal.trim() || !["pending", "in_progress", "completed"].includes(s.status)) || new Set(value.map((s) => s.id)).size !== value.length) return false;
		steps = value.map(({ id, goal, status }) => ({ id, goal, status }));
		const next = JSON.stringify(steps);
		if (next !== fingerprint) repeated = 0;
		fingerprint = next;
		blocker = undefined;
		return true;
	};
	// New input, replacement, and branch transitions must not inherit stale work.
	pi.on("input", () => { reset(); });
	for (const event of ["session_start", "session_switch", "session_fork", "session_tree"] as const) pi.on(event, () => { reset(); });
	pi.on("ui_prompt_start", () => { promptOpen = true; });
	pi.on("ui_prompt_end", () => { promptOpen = false; });
	pi.on("before_agent_start", (event) => ({ systemPrompt: event.systemPrompt + "\n\nTask execution boundary: for an authorized multi-step task, register and maintain its COMPLETE acceptance plan using update_plan, or task_guard_checkpoint if update_plan is unavailable. A stage report is not completion: keep executing authorized pending work. Mark steps completed only after their acceptance criteria are met; never mark them complete just to stop. Do not invent work for simple questions. If essential user input, new authorization, or an unrecoverable environment problem prevents all remaining authorized work, record a concrete blocker using task_guard_checkpoint (kind, reason, nextAction), then explain it to the user. Never use a blocker merely to request permission to continue already-authorized work. New input starts a new scope; re-register any still-relevant plan. Resumed or branched sessions must re-register their current plan." }));
	pi.on("tool_result", (event) => {
		if (!event.isError && event.toolName === "update_plan") acceptPlan(event.input.steps);
	});
	pi.registerTool({
		name: "task_guard_checkpoint", label: "Task execution checkpoint",
		description: "Register the full current multi-step acceptance plan if update_plan is unavailable, or record a genuine blocker preventing ALL remaining authorized work. Not a stage-report tool. Do not use to stop at a milestone or to re-request granted permission.",
		parameters: Type.Object({ steps: Type.Optional(Type.Array(stepSchema, { minItems: 1 })), blocker: Type.Optional(Type.Object({ kind: Type.Union([Type.Literal("missing_input"), Type.Literal("authorization"), Type.Literal("environment")]), reason: Type.String({ minLength: 1 }), nextAction: Type.String({ minLength: 1 }) })) }),
		async execute(_id, params) {
			if ((!params.steps && !params.blocker) || (params.steps && !acceptPlan(params.steps)) || (params.blocker && (!params.blocker.reason.trim() || !params.blocker.nextAction.trim()))) return { content: [{ type: "text", text: "Invalid checkpoint: provide a valid full plan or a concrete blocker." }], isError: true };
			if (params.blocker) blocker = params.blocker;
			return { content: [{ type: "text", text: blocker ? `Execution paused: ${blocker.reason}. Required next action: ${blocker.nextAction}` : "Plan recorded. Continue authorized work until all criteria are met." }], details: { steps, blocker } };
		},
	});
	pi.on("agent_before_settle", (event) => {
		if (event.outcome !== "completed" || event.continue || promptOpen || blocker || !steps.some((s) => s.status !== "completed")) return;
		// Bounded protection, not an autonomous goal engine. Never mask an error or Escape.
		if (repeated >= 2 || total >= 8) return { entries: [{ type: "custom_message", customType: "task-guard-limit", display: true, content: "任务仍未完成，但自动继续保护已达到上限（计划连续未变化或本任务已纠正 8 次停止）。未将待办标为完成；请检查当前阻塞和计划。" }] };
		repeated++; total++;
		return { continue: true, entries: [{ type: "custom_message", customType: "task-guard-continue", display: false, content: `The authorized task is NOT complete. Your last reply was only a stage update. Continue now with the next authorized action, without asking permission again. Pending acceptance steps: ${JSON.stringify(steps.filter((s) => s.status !== "completed"))}. Update the plan after meaningful progress. If genuinely blocked, record the concrete required input/authorization/environment action with task_guard_checkpoint and explain it. Do not clear or complete the plan just to end this run.` }] };
	});
}
