/** Deterministic, data-only editorial infographic. No arbitrary SVG/HTML is accepted. */
export interface ImageReportPage {
	kicker: string;
	title: string;
	takeaway: string;
	metrics?: Array<{ value: string; label: string }>;
	insights: Array<{ title: string; body: string }>;
	evidence: string[];
	caveat: string;
	source: string;
}

export const IMAGE_REPORT_SIZE = { width: 1200, height: 1600 } as const;

const ink = "#25312f";
const muted = "#586862";
const paper = "#f7f3e9";
const red = "#a83832";
const green = "#214d42";
const esc = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

function textField(value: unknown, name: string, max: number): string {
	if (typeof value !== "string" || !value.trim() || value !== value.trim() || /[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069\uFFFE\uFFFF]/.test(value) || [...value].some((c) => { const cp = c.codePointAt(0)!; return cp >= 0xd800 && cp <= 0xdfff; }) || [...value].length > max) {
		throw new Error(`${name} must be nonempty, trimmed, XML-safe single-line text of at most ${max} characters`);
	}
	return value;
}
function entries(value: unknown, name: string, min: number, max: number): unknown[] {
	if (!Array.isArray(value) || value.length < min || value.length > max) throw new Error(`${name} must contain ${min}–${max} items`);
	return value;
}
function object(value: unknown, name: string, keys: string[]): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((k) => !keys.includes(k))) {
		throw new Error(`${name} must be an object with only: ${keys.join(", ")}`);
	}
	return value as Record<string, unknown>;
}

/** Fail closed: reject overflow rather than truncate meaning or silently drop evidence. */
export function validateImageReportPage(input: unknown): ImageReportPage {
	const p = object(input, "page", ["kicker", "title", "takeaway", "metrics", "insights", "evidence", "caveat", "source"]);
	return {
		kicker: textField(p.kicker, "kicker", 32),
		title: textField(p.title, "title", 34),
		takeaway: textField(p.takeaway, "takeaway", 95),
		metrics: entries(p.metrics ?? [], "metrics", 0, 3).map((v, i) => {
			const m = object(v, `metrics[${i}]`, ["value", "label"]);
			return { value: textField(m.value, `metrics[${i}].value`, 15), label: textField(m.label, `metrics[${i}].label`, 22) };
		}),
		insights: entries(p.insights, "insights", 2, 4).map((v, i) => {
			const c = object(v, `insights[${i}]`, ["title", "body"]);
			return { title: textField(c.title, `insights[${i}].title`, 24), body: textField(c.body, `insights[${i}].body`, 80) };
		}),
		evidence: entries(p.evidence, "evidence", 1, 3).map((v, i) => textField(v, `evidence[${i}]`, 52)),
		caveat: textField(p.caveat, "caveat", 72),
		source: textField(p.source, "source", 75),
	};
}

// Approximately preserve Latin and CJK glyph widths; limits below are width-based, not character-based.
function width(text: string): number {
	return [...text].reduce((n, c) => n + (/^[\x20-\x7e]$/.test(c) ? (/[MW@#%]/.test(c) ? 0.85 : 0.56) : 1), 0);
}
function lines(text: string, capacity: number, maxLines: number, name: string): string[] {
	const result: string[] = [];
	let line = "";
	for (const c of text) {
		if (width(line + c) > capacity && line) { result.push(line); line = ""; }
		line += c;
	}
	if (line) result.push(line);
	if (result.length > maxLines) throw new Error(`${name} exceeds ${maxLines} visual lines; shorten the text or use another image`);
	return result;
}
function label(text: string, x: number, y: number, size: number, color: string, weight = 400, extra = "") {
	return `<text x="${x}" y="${y}" fill="${color}" font-size="${size}" font-weight="${weight}" ${extra}>${esc(text)}</text>`;
}
function multi(text: string, x: number, y: number, size: number, capacity: number, maxLines: number, lineHeight: number, name: string, color = ink, weight = 400) {
	return lines(text, capacity, maxLines, name).map((line, i) => label(line, x, y + i * lineHeight, size, color, weight)).join("");
}

export function renderImageReportSvg(input: unknown, index = 1, total = 1): string {
	const page = validateImageReportPage(input);
	if (!Number.isInteger(index) || !Number.isInteger(total) || total < 1 || total > 5 || index < 1 || index > total) throw new Error("image index and total must be within 1–5");
	const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1600" viewBox="0 0 1200 1600" role="img" aria-label="${esc(page.title)}">`,
		`<rect width="1200" height="1600" fill="${paper}"/><rect width="1200" height="14" fill="${red}"/>`,
		`<g font-family="PingFang SC,Noto Sans CJK SC,Microsoft YaHei,Arial,sans-serif">`,
		label("FIELDNOTE  /  图解汇报", 72, 80, 19, red, 700, 'letter-spacing="2"'),
		label(`${String(index).padStart(2, "0")} / ${String(total).padStart(2, "0")}`, 1040, 80, 20, green, 700),
		`<line x1="72" y1="103" x2="1128" y2="103" stroke="#c8c7bc"/>`,
		label(page.kicker.toUpperCase(), 72, 151, 21, muted, 600, 'letter-spacing="1"'),
		multi(page.title, 72, 228, 65, 16, 2, 78, "title", ink, 700),
		`<rect x="72" y="325" width="1056" height="182" rx="4" fill="${green}"/>`,
		label("核心结论  /  THE TAKEAWAY", 100, 367, 20, "#c7dfd2", 700, 'letter-spacing="1"'),
		multi(page.takeaway, 100, 421, 34, 28, 2, 46, "takeaway", "#ffffff", 600),
		label(page.metrics?.length ? "关键指标  /  SIGNALS" : "内容脉络  /  AT A GLANCE", 72, 558, 20, red, 700, 'letter-spacing="1"')];
	if (page.metrics?.length) {
		const span = 1056 / page.metrics.length;
		page.metrics.forEach((m, i) => {
			const x = 72 + i * span;
			parts.push(`<rect x="${x}" y="577" width="${span - 10}" height="135" rx="3" fill="#fffdfa" stroke="#e5dfd1"/>`,
				multi(m.value, x + 20, 637, 38, (span - 45) / 38, 1, 42, "metric value", green, 700),
				multi(m.label, x + 20, 679, 19, (span - 45) / 19, 1, 24, "metric label", muted, 500));
		});
	} else {
		parts.push(`<rect x="72" y="577" width="1056" height="135" rx="3" fill="#fffdfa" stroke="#e5dfd1"/>`,
			label("01", 96, 645, 52, red, 700), label("结论 → 依据 → 边界", 190, 635, 30, green, 600),
			label("按阅读顺序压缩为一屏，未提供的数字不臆造。", 190, 679, 19, muted));
	}
	parts.push(label("分析要点  /  WHAT MATTERS", 72, 760, 20, red, 700, 'letter-spacing="1"'));
	page.insights.forEach((item, i) => {
		const x = 72 + (i % 2) * 536;
		const y = 782 + Math.floor(i / 2) * 208;
		parts.push(`<rect x="${x}" y="${y}" width="520" height="192" rx="3" fill="#fffdfa" stroke="#dfdbcd"/>`,
			`<rect x="${x}" y="${y}" width="6" height="192" fill="${i === 0 ? red : green}"/>`,
			label(String(i + 1).padStart(2, "0"), x + 24, y + 44, 22, red, 700),
			multi(item.title, x + 69, y + 44, 24, 18, 1, 28, `insight ${i + 1} title`, ink, 700),
			multi(item.body, x + 24, y + 90, 21, 22, 4, 27, `insight ${i + 1} body`, muted));
	});
	parts.push(label("证据链  /  TRACEABLE EVIDENCE", 72, 1238, 20, red, 700, 'letter-spacing="1"'));
	const span = 1056 / page.evidence.length;
	page.evidence.forEach((item, i) => {
		const x = 72 + i * span;
		parts.push(`<line x1="${x}" y1="1265" x2="${x + span - 18}" y2="1265" stroke="${green}" stroke-width="3"/>`,
			label(String(i + 1).padStart(2, "0"), x, 1303, 21, red, 700),
			multi(item, x, 1344, 19, (span - 25) / 19, 3, 25, `evidence ${i + 1}`, ink));
	});
	parts.push(`<line x1="72" y1="1440" x2="1128" y2="1440" stroke="#c8c7bc"/>`,
		label("边界", 72, 1478, 18, red, 700),
		multi(page.caveat, 144, 1478, 18, 54, 2, 25, "caveat", muted),
		label("来源", 72, 1554, 16, green, 700),
		multi(page.source, 144, 1554, 16, 58, 1, 20, "source", muted),
		`</g></svg>`);
	return parts.join("");
}
