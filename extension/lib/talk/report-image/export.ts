import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { getSessionDir } from "../paths";
import { chromeCapture } from "../verify";
import { IMAGE_REPORT_SIZE, renderImageReportSvg, type ImageReportPage } from "./render";

export interface ImageReportArtifact { svg: string; png: string; width: number; height: number }

/** Generates a complete batch or removes it; never consumes the report permit on a partial failure. */
export async function exportImageReport(pages: ImageReportPage[], sessionId?: string): Promise<ImageReportArtifact[]> {
	if (!Array.isArray(pages) || pages.length < 1 || pages.length > 5) throw new Error("Image reports require 1–5 pages");
	// Validate the entire batch before writing any artifact.
	const svgs = pages.map((page, i) => renderImageReportSvg(page, i + 1, pages.length));
	const root = join(getSessionDir(sessionId ?? "_"), "exports");
	mkdirSync(root, { recursive: true });
	const dir = mkdtempSync(join(root, "image-report-"));
	try {
		const artifacts: ImageReportArtifact[] = [];
		for (let i = 0; i < svgs.length; i++) {
			const name = String(i + 1).padStart(2, "0");
			const svg = join(dir, `${name}.svg`);
			const png = join(dir, `${name}.png`);
			writeFileSync(svg, svgs[i], "utf8");
			const result = await chromeCapture(pathToFileURL(svg).href, png, { width: IMAGE_REPORT_SIZE.width, height: IMAGE_REPORT_SIZE.height });
			if (!result.ok) throw new Error(`PNG conversion failed on image ${i + 1}: ${result.error ?? result.stderr ?? "unknown error"}`);
			const header = readFileSync(png).subarray(0, 24);
			const width = header.readUInt32BE(16);
			const height = header.readUInt32BE(20);
			if (width !== IMAGE_REPORT_SIZE.width || height !== IMAGE_REPORT_SIZE.height) throw new Error(`PNG dimensions are ${width}×${height}, expected 1200×1600`);
			artifacts.push({ svg, png, width, height });
		}
		return artifacts;
	} catch (error) {
		rmSync(dir, { recursive: true, force: true });
		throw error;
	}
}
