/** Compatibility-only trigger primitives. No information or presentation policy. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
export function parseTalkArgs(args: string): { sub?: string; rest: string } {
	const trimmed = args.trim();
	if (!trimmed) return { rest: "" };
	const sp = trimmed.indexOf(" ");
	if (sp < 0) return { sub: trimmed.toLowerCase(), rest: "" };
	return { sub: trimmed.slice(0, sp).toLowerCase(), rest: trimmed.slice(sp + 1).trim() };
}

/** Explicit style commands retain legacy picker fallback; ordinary /talk is routed by the command layer to the main transcript. */
export async function resolveTalkStart(args: string, mode: string, deps: {
	hasStyle(id: string): boolean;
	defaultStyle(): string | undefined;
	pickStyle(): Promise<string | undefined>;
}): Promise<{ styleId: string | undefined; message: string }> {
	const { sub, rest } = parseTalkArgs(args);
	let styleId: string | undefined;
	let message = "";
	if (sub && deps.hasStyle(sub)) {
		styleId = sub;
		message = rest;
	} else if (sub) message = args.trim();
	if (!styleId) {
		styleId = mode === "tui" && !message
			? (await deps.pickStyle()) || deps.defaultStyle()
			: deps.defaultStyle();
	}
	return { styleId, message };
}

export interface ReportOpportunity {
	id: string;
	taskId: string;
	branchId: string;
	cause: "explicit" | "settled" | "checkpoint";
	explicitFormat?: "text" | "image" | "html";
}

/** Idempotent opportunity normalization; settled is not a completion assertion. */
export function createOpportunityRouter() {
	const seen = new Set<string>();
	return {
		accept(event: ReportOpportunity) {
			const key = JSON.stringify([event.branchId, event.taskId, event.id]);
			if (seen.has(key)) return undefined;
			seen.add(key);
			// Bounded retry window, not durable exactly-once history.
			if (seen.size > 256) seen.delete(seen.values().next().value!);
			return { ...event };
		},
		reset() { seen.clear(); },
	};
}

/** Task-boundary state only. Evidence storage and prompt/presentation policy stay outside. */
export function createReportScope() {
	const router = createOpportunityRouter();
	let sequence = 0;
	let summarizePending = false;
	let opportunity: ReportOpportunity | undefined;
	return {
		requestSummary(pending = true) { summarizePending = pending; },
		start(branchId: string, hasGoal: boolean) {
			const preserveEvidence = Boolean(summarizePending && hasGoal && opportunity?.branchId === branchId);
			summarizePending = false;
			router.reset();
			opportunity = router.accept({ id: `prompt-${++sequence}`, taskId: `task-${sequence}`, branchId, cause: "explicit", explicitFormat: "text" });
			return { preserveEvidence, opportunity: opportunity ? { ...opportunity } : undefined };
		},
		settle(branchId: string, aborted: boolean, hasGoal: boolean) {
			if (!opportunity || opportunity.branchId !== branchId) return;
			if (aborted || !hasGoal) { opportunity = undefined; return; }
			const settled = router.accept({ id: `settled-${sequence}`, taskId: opportunity.taskId, branchId, cause: "settled" });
			if (settled) opportunity = settled;
		},
		current() { return opportunity ? { ...opportunity } : undefined; },
		reset() { summarizePending = false; opportunity = undefined; router.reset(); },
	};
}

export interface TalkTriggerDependencies {
	resetPermit(): void;
	stop(): Promise<void>;
	isActive(): boolean;
	appendix(): string;
}

export function registerTalkLifecycle(pi: Pick<ExtensionAPI, "on">, deps: TalkTriggerDependencies) {
	const handlers = createTalkTriggerHandlers(deps);
	const dispose = [pi.on("agent_start", () => { handlers.agentStart(); })];
	let registered = false;
	let disposed = false;
	return {
		registerSessionHooks() {
			if (registered || disposed) return;
			registered = true;
			dispose.push(pi.on("session_shutdown", () => handlers.sessionShutdown()));
			dispose.push(pi.on("before_agent_start", (event) => handlers.beforeAgentStart(event)));
		},
		dispose() {
			disposed = true;
			const callbacks = dispose.splice(0);
			let firstError: unknown;
			for (const off of callbacks) { try { off?.(); } catch (error) { firstError ??= error; } }
			if (firstError) throw firstError;
		},
	};
}

export function createTalkTriggerHandlers(deps: TalkTriggerDependencies) {
	return {
		agentStart() { deps.resetPermit(); },
		async sessionShutdown() {
			deps.resetPermit();
			await deps.stop();
		},
		async beforeAgentStart(event: { systemPrompt: string }) {
			if (!deps.isActive()) return;
			const appendix = deps.appendix();
			if (!appendix) return;
			return { systemPrompt: `${event.systemPrompt}\n\n${appendix}` };
		},
	};
}
