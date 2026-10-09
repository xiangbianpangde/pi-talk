import { createHash } from "node:crypto";

export type TaskState = "completed" | "partial" | "failed" | "blocked" | "unknown";
export interface Evidence { id: string; locator: string; text: string; failed: boolean; observedAt: number }
export interface Claim { text: string; kind: "result" | "risk" | "blocker" | "decision"; status: "observed" | "inferred" | "unverified"; evidenceIds: string[] }
export interface Brief { state: TaskState; claims: Claim[]; delivery: "send" | "suppress"; warnings: string[] }
const fingerprint = (value: string) => createHash("sha256").update(value).digest("hex");

/** Ephemeral evidence scope: reset on each user goal and branch transition. No raw persistence. */
export function createInformationEngine() {
	let goal = "";
	let evidence: Evidence[] = [];
	let previous = "";
	let incomplete = false;
	return {
		begin(prompt: string) { goal = prompt.slice(0, 6000); evidence = []; incomplete = prompt.length > 6000; previous = ""; },
		collect(id: string, locator: string, text: string, failed: boolean) {
			if (!goal || evidence.some((e) => e.id === id)) return;
			// Bound context and redact common credentials before exposing it to the producer.
			const safe = text.replace(/(api[_-]?key|password|token|authorization)\s*[:=]\s*\S+/gi, "$1=[redacted]");
			if (safe.length > 3000) incomplete = true;
			evidence.push({ id, locator, text: safe.slice(0, 3000), failed, observedAt: Date.now() });
			if (evidence.length > 24) {
				const index = evidence.findIndex((e) => !e.failed);
				evidence.splice(index < 0 ? 0 : index, 1); incomplete = true;
			}
		},
		context() { return { goal, evidence: evidence.map((e) => ({ ...e })), incomplete }; },
		refine(state: TaskState, candidates: Claim[], explicit = true, acceptanceEvidenceIds: string[] = []): Brief {
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
				return { ...c, evidenceIds: sources, status: c.status === "observed" && !observed ? "unverified" : c.status };
			});
			for (const e of evidence.filter((e) => e.failed)) {
				if (!claims.some((c) => c.evidenceIds.includes(e.id) && (c.kind === "risk" || c.kind === "blocker"))) {
					claims.push({ text: `Tool failure: ${e.locator}`, kind: "risk", status: "unverified", evidenceIds: [e.id] });
				}
			}
			const acceptance = acceptanceEvidenceIds.length > 0 && acceptanceEvidenceIds.every((id) =>
				known.has(id) && !known.get(id)!.failed && claims.some((c) =>
					c.kind === "result" && c.status === "observed" && c.evidenceIds.includes(id)));
			if (state === "completed" && !claims.length) warnings.push("An empty brief cannot establish completion.");
			// Even a supported claim is not a complete acceptance protocol. The producer
			// must associate the supplied checks with the user's actual requirements.
			if (state === "completed" && (!acceptance || !claims.length || incomplete || claims.some((c) => c.kind === "blocker" || c.status === "unverified") || evidence.some((e) => e.failed))) {
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
