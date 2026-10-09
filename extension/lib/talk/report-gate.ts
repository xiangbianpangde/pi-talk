import { randomUUID } from "node:crypto";

export const REPORT_CHOICES = ["简要汇报", "完整汇报", "技术验收", "一张图汇报", "取消汇报"] as const;
export const IMAGE_COUNTS = ["1 张", "2 张", "3 张", "4 张", "5 张", "取消汇报"] as const;
export type ReportChoice = (typeof REPORT_CHOICES)[number];

export interface ReportCompletion {
	summary: string;
	checks: string[];
	remainingWork: string[];
}

/** A one-shot, in-memory authorization. No authorization survives a new agent run. */
export function createReportGate() {
	let permit: { id: string; choice: ReportChoice; imageCount?: number; reserved?: boolean } | undefined;
	return {
		reset() { permit = undefined; },
		async prepare(completion: ReportCompletion, select: (question: string, options: string[]) => Promise<string | undefined>) {
			permit = undefined;
			if (!completion.summary.trim() || !completion.checks.length || completion.checks.some((s) => !s.trim()) || completion.remainingWork.length) {
				return { ok: false as const, message: "正式汇报须在任务全部完成且验收通过后生成。请先完成剩余工作，并提供完成摘要、实际通过的验收检查和空的 remainingWork；未完成时只在文字中说明进度。" };
			}
			const choice = await select("任务已全部完成并验收通过。请选择本次汇报类型：", [...REPORT_CHOICES]);
			if (!choice || choice === "取消汇报" || !REPORT_CHOICES.includes(choice as ReportChoice)) {
				return { ok: false as const, message: "用户取消或未选择汇报类型；没有生成 HTML 汇报。" };
			}
			let imageCount: number | undefined;
			if (choice === "一张图汇报") {
				const count = await select("需要几张汇报图？最多 5 张；建议 1 张。", [...IMAGE_COUNTS]);
				if (!count || count === "取消汇报" || !IMAGE_COUNTS.includes(count as typeof IMAGE_COUNTS[number])) {
					return { ok: false as const, message: "用户取消或未选择图像数量；没有生成图像汇报。" };
				}
				imageCount = Number(count[0]);
			}
			permit = { id: randomUUID(), choice: choice as ReportChoice, imageCount };
			return { ok: true as const, ...permit };
		},
		allowed(id: string | undefined, mode?: "html" | "image") {
			return Boolean(id && permit?.id === id && !permit.reserved && (mode === "html" ? permit.choice !== "一张图汇报" : mode === "image" ? permit.choice === "一张图汇报" : true));
		},
		/** Reserve synchronously before asynchronous rendering; release on failure. */
		reserve(id: string | undefined, mode: "html" | "image") {
			if (!this.allowed(id, mode) || !permit) return undefined;
			const current = permit;
			current.reserved = true;
			let finished = false;
			return {
				commit() {
					if (finished || permit !== current) return false;
					finished = true;
					permit = undefined;
					return true;
				},
				release() {
					if (finished || permit !== current) return false;
					finished = true;
					current.reserved = false;
					return true;
				},
			};
		},
		imageCount(id: string | undefined) { return this.allowed(id, "image") ? permit?.imageCount : undefined; },
		consume(id: string | undefined, mode?: "html" | "image") {
			if (!this.allowed(id, mode)) return false;
			permit = undefined;
			return true;
		},
	};
}
