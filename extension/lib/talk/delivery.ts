import type { Brief } from "./information";

export interface DeliveryTarget {
	publish(content: string): Promise<unknown> | unknown;
}

export interface DeliveryResult {
	sent: boolean;
	reason: "sent" | "suppressed" | "explicit";
	continuation: "continue";
}

/** Single main-transcript delivery boundary. Rendering and authorization never belong here. */
export async function deliverBrief(
	brief: Brief,
	target: DeliveryTarget,
	options: { explicit?: boolean } = {},
): Promise<DeliveryResult> {
	const explicit = options.explicit === true;
	if (!explicit && brief.delivery === "suppress") {
		return { sent: false, reason: "suppressed", continuation: "continue" };
	}
	const text = briefTextForDelivery(brief, explicit);
	if (!text) return { sent: false, reason: "suppressed", continuation: "continue" };
	await target.publish(text);
	return { sent: true, reason: explicit ? "explicit" : "sent", continuation: "continue" };
}

export function briefTextForDelivery(brief: Brief, explicit = false): string {
	if (brief.delivery === "suppress" && !explicit) return "";
	return [
		`Status: ${brief.state}`,
		...brief.claims.map((claim) => `${claim.text} [${claim.status}${claim.evidenceIds.length ? `; ${claim.evidenceIds.join(", ")}` : ""}]`),
		...brief.warnings,
	].join("\n").trim();
}
