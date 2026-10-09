import { createHash } from "node:crypto";

export type TaskState = "completed" | "partial" | "failed" | "blocked" | "unknown";
export interface Evidence { id: string; locator: string; text: string; failed: boolean; observedAt: number; checkKey?: string }
export interface Requirement { id: string; userAnchor: string; criterion: string }
export interface RequirementCheck { requirementId: string; evidenceIds: string[] }
export interface FailureResolution { failureId: string; verificationId: string }
export interface AcceptanceMap { checks?: RequirementCheck[]; resolutions?: FailureResolution[] }
export interface Claim { text: string; kind: "result" | "risk" | "blocker" | "decision"; status: "observed" | "inferred" | "unverified"; evidenceIds: string[]; value?: number }
export interface Brief { state: TaskState; claims: Claim[]; delivery: "send" | "suppress"; warnings: string[] }
const fingerprint = (value: string) => createHash("sha256").update(value).digest("hex");

/** Ephemeral evidence scope: reset on each user goal and branch transition. No raw persistence. */
export function createInformationEngine() {
	let goal = "";
	let evidence: Evidence[] = [];
	let previous = "";
	let incomplete = false;
	let requirements: Requirement[] = [];
	return {
		begin(prompt: string) { goal = prompt.slice(0, 6000); evidence = []; requirements = []; incomplete = prompt.length > 6000; previous = ""; },
		/** Producer-authored decomposition, anchored to literal user text, not independently verified coverage. */
		defineRequirements(items: Requirement[]) {
			if (!goal || evidence.length) throw new Error("Define requirements before executing tools in this task scope.");
			if (!items.length || items.some((r) => !r.id.trim() || !r.criterion.trim() || !r.userAnchor.trim() || !goal.includes(r.userAnchor)) || new Set(items.map((r) => r.id)).size !== items.length) {
				throw new Error("Requirements need unique ids, criteria and exact user-goal anchors.");
			}
			requirements = items.map((r) => ({ ...r }));
		},
		collect(id: string, locator: string, text: string, failed: boolean, checkKey?: string) {
			if (!goal || evidence.some((e) => e.id === id)) return;
			// Bound context and redact common credentials before exposing it to the producer.
			const safe = text.replace(/(api[_-]?key|password|token|authorization)\s*[:=]\s*\S+/gi, "$1=[redacted]");
			if (safe.length > 3000) incomplete = true;
			evidence.push({ id, locator, text: safe.slice(0, 3000), failed, observedAt: Date.now(), checkKey });
			if (evidence.length > 24) {
				const index = evidence.findIndex((e) => !e.failed);
				evidence.splice(index < 0 ? 0 : index, 1); incomplete = true;
			}
		},
		context() { return { goal, requirements: requirements.map((r) => ({ ...r })), evidence: evidence.map((e) => ({ ...e })), incomplete }; },
		refine(state: TaskState, candidates: Claim[], explicit = true, acceptanceEvidenceIds: string[] = [], mapping: AcceptanceMap = {}): Brief {
			const warnings: string[] = [];
			const known = new Map(evidence.map((e) => [e.id, e]));
			const seen = new Set<string>();
			const claims = candidates.filter((c) => {
				const key = c.text.trim().replace(/\s+/g, " ");
				if (!key || seen.has(key)) return false;
				seen.add(key); return true;
			}).map((c): Claim => {
				const sources = c.evidenceIds.filter((id) => known.has(id));
				const observed = c.status === "observed" && sources.length > 0 && sources.every((id) => known.get(id)!.text.includes(c.text));
				if (c.status === "observed" && !observed) warnings.push("Claim not directly supported; downgraded to unverified.");
				const status = c.status === "observed" && !observed ? "unverified" : c.status;
				const value = (c.kind === "blocker" ? 4 : c.kind === "risk" ? 3 : c.kind === "decision" ? 3 : 2) + (sources.length ? 1 : 0) + (status === "unverified" ? 1 : 0);
				return { ...c, evidenceIds: sources, status, value };
			});
			const resolved = new Set<string>();
			for (const link of mapping.resolutions || []) {
				const failure = known.get(link.failureId), verification = known.get(link.verificationId);
				// Same deterministic tool/input identity and later successful execution.
				if (failure?.failed && verification && !verification.failed && failure.checkKey && failure.checkKey === verification.checkKey && evidence.indexOf(verification) > evidence.indexOf(failure)) resolved.add(failure.id);
				else warnings.push(`Invalid failure resolution: ${link.failureId}`);
			}
			const unresolved = evidence.filter((e) => e.failed && !resolved.has(e.id));
			for (const e of unresolved) {
				if (!claims.some((c) => c.evidenceIds.includes(e.id) && (c.kind === "risk" || c.kind === "blocker"))) {
					claims.push({ text: `Tool failure: ${e.locator}`, kind: "risk", status: "unverified", evidenceIds: [e.id], value: 5 });
				}
			}
			claims.sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
			const acceptance = acceptanceEvidenceIds.length > 0 && acceptanceEvidenceIds.every((id) =>
				known.has(id) && !known.get(id)!.failed && claims.some((c) =>
					c.kind === "result" && c.status === "observed" && c.evidenceIds.includes(id)));
			const coverage = requirements.length > 0 && requirements.every((r) => (mapping.checks || []).some((check) =>
				check.requirementId === r.id && check.evidenceIds.length > 0 && check.evidenceIds.every((id) =>
					known.has(id) && !known.get(id)!.failed && claims.some((c) => c.kind === "result" && c.status !== "unverified" && c.evidenceIds.includes(id)))));
			if (!coverage) warnings.push("Required acceptance criteria are absent or not fully mapped to successful evidence.");
			if (state === "completed" && !claims.length) warnings.push("An empty brief cannot establish completion.");
			// Even a supported claim is not a complete acceptance protocol. The producer
			// must associate the supplied checks with the user's actual requirements.
			if (state === "completed" && (!acceptance || !coverage || !claims.length || incomplete || claims.some((c) => c.kind === "blocker" || c.status === "unverified") || unresolved.length > 0)) {
				state = "partial"; warnings.push("Completion not established by this evidence scope.");
			}
			if (!goal) { state = "unknown"; warnings.push("No anchored task goal."); }
			if (incomplete) warnings.push("Evidence context is incomplete.");
			const current = fingerprint(JSON.stringify({ state, claims }));
			const delivery = !explicit && current === previous ? "suppress" : "send";
			previous = current;
			return { state, claims, delivery, warnings };
		},
	};
}

/** Plain main-transcript draft, not a widget or HTML template. */
export function briefText(brief: Brief): string {
	if (brief.delivery === "suppress") return "No material change; suppress automatic update.";
	return [`Status: ${brief.state}`, ...brief.claims.map((c) => `${c.text} [${c.status}${c.evidenceIds.length ? `; ${c.evidenceIds.join(", ")}` : ""}]`), ...brief.warnings].join("\n");
}
