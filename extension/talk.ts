/**
 * /talk — multimodal interactive conversation with evolutionary styles.
 *
 * Styles live under ~/.pi/agent/talk/styles/ and can grow over time
 * (static HTML → interactive HTML+JS → custom packs) without rewriting core.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
	formatStyleList,
	getDefaultStyleId,
	getStyleById,
	parseStylePickerChoice,
	stylePickerOptions,
} from "./lib/talk/registry";
import {
	appendChatEntry,
	buildTalkSystemAppendix,
	cleanTalkHome,
	deleteSession,
	getRuntime,
	getSessionState,
	listSessions,
	openUrl,
	pollEvents,
	reloadStyles,
	renderTalk,
	resumeSession,
	recoverOrphanRuntimeFile,
	runCommand,
	setStyle,
	startSession,
	stopSession,
} from "./lib/talk/session";
import { verifySurface } from "./lib/talk/verify";
import { exportSurface } from "./lib/talk/export";
import { existsSync } from "node:fs";
import { join } from "node:path";

function updateWidget(ctx: { ui: { setWidget: Function; setStatus: Function } }, runtime = getRuntime()): void {
	if (!runtime.active) {
		ctx.ui.setWidget("talk", undefined);
		ctx.ui.setStatus("talk", undefined);
		return;
	}
	const style = getStyleById(runtime.styles, runtime.styleId);
	const lines = [
		`/talk active · style=${runtime.styleId} (${style?.kind ?? "?"}) · renders=${runtime.renderCount}`,
		runtime.url ? `surface: ${runtime.url}` : "surface: (tui/draw)",
		"cmds: /talk styles | /talk style <id> | /talk open | /talk stop",
	];
	if (style?.kind === "chat" && runtime.chatLog.length) {
		const last = runtime.chatLog[runtime.chatLog.length - 1]!;
		const preview = last.text.replace(/\s+/g, " ").slice(0, 120);
		lines.push(`last: ${preview}${last.text.length > 120 ? "…" : ""}`);
	}
	ctx.ui.setWidget("talk", lines);
	ctx.ui.setStatus("talk", `talk:${runtime.styleId}`);
}

function parseArgs(args: string): { sub?: string; rest: string } {
	const trimmed = args.trim();
	if (!trimmed) return { rest: "" };
	const sp = trimmed.indexOf(" ");
	if (sp < 0) return { sub: trimmed.toLowerCase(), rest: "" };
	return { sub: trimmed.slice(0, sp).toLowerCase(), rest: trimmed.slice(sp + 1).trim() };
}

async function pickStyle(ctx: { ui: { select: Function } }, runtime = getRuntime()): Promise<string | undefined> {
	const options = stylePickerOptions(runtime.styles);
	if (options.length === 0) return undefined;
	const choice = await ctx.ui.select("/talk — choose interaction style", options);
	return parseStylePickerChoice(choice);
}

export default function (pi: ExtensionAPI) {
	const runtime = getRuntime();
	// Fresh style scan on load/reload
	reloadStyles(runtime);
	// Crash recovery: reconcile a stale runtime.json left by a dead process
	// (stamps the orphan session with endedAt, deactivates the file).
	void recoverOrphanRuntimeFile();

	pi.on("session_shutdown", async () => {
		await stopSession(getRuntime());
	});

	pi.on("before_agent_start", async (event) => {
		const rt = getRuntime();
		if (!rt.active) return;
		const appendix = buildTalkSystemAppendix(rt);
		if (!appendix) return;
		return {
			systemPrompt: `${event.systemPrompt}\n\n${appendix}`,
		};
	});

	pi.registerCommand("talk", {
		description:
			"Multimodal talk mode — formal reports use the reference-derived report design system by default; arch/draw and explicit prototype HTML remain available.",
		handler: async (args, ctx) => {
			const rt = getRuntime();
			const { sub, rest } = parseArgs(args);

			// Subcommands that work without an active session
			if (sub === "styles" || sub === "list") {
				reloadStyles(rt);
				ctx.ui.notify(formatStyleList(rt.styles, { includeHidden: true }), "info");
				return;
			}
			if (sub === "reload-styles" || sub === "reload") {
				const styles = reloadStyles(rt);
				ctx.ui.notify(`Reloaded ${styles.length} talk styles`, "info");
				updateWidget(ctx, rt);
				return;
			}
			if (sub === "status") {
				const st = getSessionState(rt);
				ctx.ui.notify(JSON.stringify(st, null, 2), "info");
				return;
			}
			if (sub === "stop" || sub === "end" || sub === "close") {
				await stopSession(rt);
				updateWidget(ctx, rt);
				ctx.ui.notify("/talk stopped", "info");
				return;
			}
			if (sub === "open") {
				if (!rt.active) {
					ctx.ui.notify("No active /talk session", "warning");
					return;
				}
				const surface = rest.trim() || rt.activeSurface;
				if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(surface)) {
					ctx.ui.notify(`Invalid surface id: ${surface}`, "warning");
					return;
				}
				const url = rt.server?.url
					? surface === "main"
						? rt.server.url
						: `${rt.server.url}s/${surface}`
					: rt.url;
				if (url) {
					openUrl(url);
					ctx.ui.notify(`Opened ${url}`, "info");
				} else {
					ctx.ui.notify("Current style has no browser URL (chat/draw)", "warning");
				}
				return;
			}
			if (sub === "surfaces") {
				if (!rt.active || !rt.server) {
					ctx.ui.notify("No active /talk session", "warning");
					return;
				}
				const list = rt.server
					.listSurfaces()
					.map((s) => `${s.id === rt.activeSurface ? "*" : " "} ${s.id} — ${s.title} (${s.styleId})`)
					.join("\n");
				ctx.ui.notify(`Surfaces (active *):\n${list}\n\n/talk open <id> to open one`, "info");
				return;
			}
			if (sub === "history" || sub === "sessions") {
				const sessions = listSessions(rt);
				if (sessions.length === 0) {
					ctx.ui.notify("No persisted sessions yet.", "info");
					return;
				}
				const lines = sessions
					.slice(0, 20)
					.map(
						(s) =>
							`${s.id}  ${s.styleId}  v${s.versionCount}  evt${s.eventCount}  ${new Date(s.startedAt).toISOString().slice(0, 19).replace("T", " ")}  ${s.title ?? ""}`,
					);
				ctx.ui.notify(`Sessions:\n${lines.join("\n")}\n\n/talk resume <id>`,"info");
				return;
			}
			if (sub === "delete" || sub === "rm") {
				const id = rest.trim();
				if (!id) {
					ctx.ui.notify("Usage: /talk delete <session-id> (see /talk history)", "warning");
					return;
				}
				if (rt.active && rt.sessionId === id) {
					ctx.ui.notify("Stop the session first (/talk stop) before deleting it.", "warning");
					return;
				}
				ctx.ui.notify(deleteSession(id) ? `Deleted session ${id}` : `Session not found: ${id}`, "info");
				return;
			}
			if (sub === "clean" || sub === "gc") {
				const days = Number.parseInt(rest.trim(), 10);
				const result = cleanTalkHome({ days: Number.isFinite(days) && days > 0 ? days : 30 });
				ctx.ui.notify(
					`/talk clean (30d default): removed ${result.removedSessions} sessions, ${result.removedFiles} stray files, ${result.removedDirs} stray dirs`,
					"info",
				);
				return;
			}
			if (sub === "resume") {
				let id = rest.trim();
				if (!id) {
					const sessions = listSessions(rt);
					id = sessions[0]?.id ?? "";
				}
				if (!id) {
					ctx.ui.notify("No persisted sessions to resume.", "warning");
					return;
				}
				try {
					const state = await resumeSession(id, { open: true }, rt);
					updateWidget(ctx, rt);
					ctx.ui.notify(
						`Resumed ${id} (${state.styleId}) · renders ${state.renderCount} · versions ${state.versionCount}`,
						"info",
					);
				} catch (error) {
					ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
				}
				return;
			}
			if (sub === "export") {
				if (!rt.active || !rt.server) {
					ctx.ui.notify("No active /talk session to export", "warning");
					return;
				}
				const [format, ...outParts] = rest.trim().split(/\s+/);
				if (!["html", "md", "png", "pdf"].includes(format || "")) {
					ctx.ui.notify("Usage: /talk export <html|md|png|pdf> [out-path]", "warning");
					return;
				}
				const result = await exportSurface(rt, {
					format: format as "html" | "md" | "png" | "pdf",
					out: outParts.join(" ") || undefined,
				});
				ctx.ui.notify(result.message, result.ok ? "info" : "error");
				return;
			}
			if (sub === "test" || sub === "tests") {
				const extDir = new URL(".", import.meta.url).pathname;
				const testFile = join(extDir, "lib", "talk", "tests", "run-tests.mjs");
				if (!existsSync(testFile)) {
					ctx.ui.notify("Test runner not found: lib/talk/tests/run-tests.mjs", "error");
					return;
				}
				const result = await runCommand("node", [testFile], 120_000);
				const summary = result.stdout.split(/\r?\n/).filter((l) => l.startsWith("# ")).join("\n");
				ctx.ui.notify(
					`/talk test:\n${summary || "(no summary)"}\n${result.stderr.slice(0, 500)}`,
					result.code === 0 ? "info" : "error",
				);
				return;
			}
			if (sub === "style" || sub === "use") {
				const id = rest || (await pickStyle(ctx, rt));
				if (!id) {
					ctx.ui.notify("Style id required", "warning");
					return;
				}
				try {
					if (!rt.active) await startSession(id, undefined, rt);
					else setStyle(id, rt);
					// If switching to html*, ensure server placeholder
					const style = getStyleById(rt.styles, rt.styleId);
					if (style && (style.kind === "html" || style.kind === "html-js")) {
						const switchContent = style.id === "report"
							? `<section id="report-welcome" class="hero" data-nav-title="就绪"><h1>正式汇报模式已就绪</h1><p class="sub">后续汇报将使用统一的期刊式设计系统。</p></section><section id="report-next" class="sec-head" data-nav-title="下一步"><h2>等待汇报内容</h2><p>提交目标、证据与结论后生成正式报告。</p></section><div class="verdict"><div class="lbl">状态</div><h3>REPORT READY</h3><p>已启用内容治理、响应式、打印与可访问性契约。</p></div>`
							: `<p>Switched to <strong>${style.name}</strong>.</p>`;
						await renderTalk(
							{
								styleId: style.id,
								title: rt.title,
								content: switchContent,
								open: true,
							},
							rt,
						);
					}
					updateWidget(ctx, rt);
					ctx.ui.notify(`Talk style → ${rt.styleId}`, "info");
				} catch (error) {
					ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
				}
				return;
			}
			if (sub === "help" || sub === "?") {
				ctx.ui.notify(
					[
						"/talk [style] [message]  — start multimodal talk",
						"/talk styles            — list styles (builtin + packs)",
						"/talk style <id>        — switch style",
						"/talk open [surface]    — reopen browser surface (optionally a named one)",
						"/talk surfaces          — list surfaces",
						"/talk history           — list persisted sessions",
						"/talk resume [id]       — resume a session (default: latest)",
						"/talk delete <id>       — delete one persisted session",
						"/talk clean [days]      — GC old sessions + stray files (default 30 days)",
						"/talk export <fmt> [out]— export current surface (html|md|png|pdf)",
						"/talk test              — run the talk regression suite",
						"/talk reload-styles     — rescan ~/.pi/agent/talk/styles",
						"/talk status | stop",
						"",
						"Evolve: add ~/.pi/agent/talk/styles/<id>/manifest.json (+ index.html)",
					].join("\n"),
					"info",
				);
				return;
			}

			// Start / continue
			// Forms:
			//   /talk
			//   /talk html-interactive
			//   /talk html-interactive explain this
			//   /talk explain this architecture   (message only → picker)
			let styleId: string | undefined;
			let message = "";

			if (sub && getStyleById(rt.styles, sub)) {
				styleId = sub;
				message = rest;
			} else if (sub) {
				// treat entire args as message
				message = args.trim();
			}

			if (!styleId) {
				// Base style = the reference-derived report design system. Picker only for bare /talk in TUI.
				if (ctx.mode === "tui" && !message) {
					styleId = (await pickStyle(ctx, rt)) || getDefaultStyleId(rt.styles);
				} else {
					styleId = getDefaultStyleId(rt.styles);
				}
			}
			if (!styleId) {
				ctx.ui.notify("Cancelled", "info");
				return;
			}

			try {
				await startSession(styleId, { title: message ? message.slice(0, 60) : undefined }, rt);
				const style = getStyleById(rt.styles, rt.styleId)!;
				if (style.kind === "html" || style.kind === "html-js") {
					// open browser with placeholder
					openUrl(rt.url!);
				}
				updateWidget(ctx, rt);

				const kickoff =
					message ||
					`Start /talk in style "${style.id}" (${style.kind}). Formal reporting is unified on the reference-derived report design system (paper palette, sidebar, serif hierarchy, KPI/evidence/verdict). Greet briefly; use report components unless the task explicitly needs arch/draw/prototype interaction.`;

				if (ctx.mode !== "tui" && !message) {
					ctx.ui.notify(`/talk started (${style.id}). Pass a message in non-TUI mode to kick the agent.`, "info");
					return;
				}

				// chat 样式把用户这一轮也记入 transcript(agent 回复走 talk_render)
				if (style.kind === "chat" && message) appendChatEntry(rt, "user", message);

				await pi.sendUserMessage(
					[
						`[/talk style=${style.id} kind=${style.kind}]`,
						style.kind === "html" || style.kind === "html-js"
							? `Browser surface: ${rt.url}`
							: style.kind === "draw"
								? "Use draw ops via talk_render (ensure/rect/text/arrow/snapshot)."
								: "Use talk_render for structured chat replies when helpful.",
						"",
						kickoff,
					].join("\n"),
				);
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
		},
	});

	pi.registerTool({
		name: "talk_list_styles",
		label: "Talk styles",
		description: "List available /talk interaction styles (builtin + evolutionary packs under ~/.pi/agent/talk/styles).",
		parameters: Type.Object({
			reload: Type.Optional(Type.Boolean({ description: "Rescan style packs first" })),
		}),
		async execute(_id, params) {
			const rt = getRuntime();
			if (params.reload) reloadStyles(rt);
			return {
				content: [{ type: "text", text: formatStyleList(rt.styles, { includeHidden: true }) }],
				details: { count: rt.styles.length, styles: rt.styles },
			};
		},
	});

	pi.registerTool({
		name: "talk_set_style",
		label: "Talk set style",
		description: "Switch the active /talk style. Default/base is report; also arch, draw, html-interactive, chat.",
		parameters: Type.Object({
			styleId: Type.String({ description: "Style id from talk_list_styles" }),
		}),
		async execute(_id, params) {
			const rt = getRuntime();
			if (!rt.active) await startSession(params.styleId, undefined, rt);
			else setStyle(params.styleId, rt);
			const style = getStyleById(rt.styles, rt.styleId);
			return {
				content: [
					{
						type: "text",
						text: `Talk style set to ${rt.styleId} (${style?.kind}). ${style?.description ?? ""}`,
					},
				],
				details: getSessionState(rt),
			};
		},
	});

	pi.registerTool({
		name: "talk_render",
		label: "Talk render",
		description:
			"Render into the active /talk surface. Formal reports use styleId=report and the governed .hero/.sec-head/.kpi/.card/.tbl-wrap/.verdict design system; result details include a report audit. arch=JSON IR; draw=draw.sh lines; chat=text.",
		promptSnippet: "Render formal reports, reviews, milestones, weekly updates, and acceptance summaries in the /talk report design system",
		promptGuidelines: [
			"Use talk_render with styleId report for 汇报、结项、周报、阶段说明、验收、评审、审计和方案总结; do not build those pages in raw html-static or html-interactive.",
			"When using talk_render styleId report, author a body fragment with .hero, section[id].sec-head, semantic KPI/card/table/note components, and a final .verdict; avoid one-off inline style layouts.",
			"After talk_render returns a report audit, fix every error and warning (delivery target: 0/0) before presenting the report; use arbitrary JavaScript only in explicit html-interactive prototype tasks.",
		],
		parameters: Type.Object({
			content: Type.String({
				description:
					"Payload for the style. HTML fragment/document for html*; draw.sh lines for draw; markdown/text for chat. Empty when patching.",
			}),
			styleId: Type.Optional(Type.String({ description: "Override style for this render" })),
			title: Type.Optional(Type.String({ description: "Surface title" })),
			open: Type.Optional(Type.Boolean({ description: "Open/focus browser surface after render" })),
			metaJson: Type.Optional(
				Type.String({ description: "Optional JSON object string for style-specific extras" }),
			),
			surface: Type.Optional(
				Type.String({ description: "Surface id (multi-surface workbench; default: active surface)" }),
			),
			patch: Type.Optional(
				Type.Object({
					selector: Type.String({ description: "CSS selector of the element to update" }),
					html: Type.Optional(Type.String({ description: "HTML to apply (omit for method=remove)" })),
					method: Type.Optional(
						Type.String({ description: "inner (default) | outer | append | prepend | remove" }),
					),
					surface: Type.Optional(Type.String({ description: "Target surface (default: active)" })),
				}),
				{ description: "Incremental DOM patch instead of a full render (no reload, keeps scroll/focus)" },
			),
			verify: Type.Optional(
				Type.Boolean({ description: "After render run the visual self-check (headless screenshot + console errors)" }),
			),
		}),
		async execute(_id, params) {
			const rt = getRuntime();
			let meta: Record<string, unknown> | undefined;
			if (params.metaJson) {
				try {
					meta = JSON.parse(params.metaJson);
				} catch {
					return {
						content: [{ type: "text", text: "metaJson is not valid JSON" }],
						details: { ok: false },
					};
				}
			}
			const result = await renderTalk(
				{
					content: params.content,
					styleId: params.styleId,
					title: params.title,
					open: params.open,
					meta,
					surface: params.surface,
					patch: params.patch,
					verify: params.verify,
				},
				rt,
			);
			return {
				content: [
					{
						type: "text",
						text: [
							result.ok ? "OK" : "ERROR",
							result.message,
							result.url ? `url: ${result.url}` : "",
							result.file ? `file: ${result.file}` : "",
						]
							.filter(Boolean)
							.join("\n"),
					},
				],
				details: result,
			};
		},
	});

	pi.registerTool({
		name: "talk_poll_events",
		label: "Talk poll events",
		description:
			"Poll user interaction events from interactive HTML (button clicks, talkSend). Use after rendering html-interactive UIs.",
		parameters: Type.Object({
			afterId: Type.Optional(Type.String({ description: "Only events after this id" })),
			mark: Type.Optional(Type.Boolean({ description: "Advance cursor (default true)" })),
		}),
		async execute(_id, params) {
			const events = pollEvents({ afterId: params.afterId, mark: params.mark });
			return {
				content: [
					{
						type: "text",
						text: events.length
							? events.map((e) => `- ${e.id} ${e.type} ${JSON.stringify(e.payload ?? null)}`).join("\n")
							: "(no new events)",
					},
				],
				details: { events, count: events.length },
			};
		},
	});

	pi.registerTool({
		name: "talk_status",
		label: "Talk status",
		description: "Get /talk session status (active style, url, sessionId, surfaces, versions, pending events).",
		parameters: Type.Object({}),
		async execute() {
			const rt = getRuntime();
			const state = getSessionState(rt);
			const pending = pollEvents({ mark: false });
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify({ ...state, pendingEvents: pending.length }, null, 2),
					},
				],
				details: { state, pending },
			};
		},
	});

	pi.registerTool({
		name: "talk_verify",
		label: "Talk verify",
		description:
			"Visual self-check of the current surface: headless screenshot + console errors + DOM stats. Use after talk_render to see what the page actually looks like (close the blind-render gap); then describe the screenshot to inspect appearance.",
		promptGuidelines: [
			"After rendering a talk surface, call talk_verify to screenshot it headlessly and check console errors before presenting to the user.",
			"Use describe_image on the returned screenshot path to inspect the real rendered appearance.",
		],
		parameters: Type.Object({
			screenshot: Type.Optional(Type.Boolean({ description: "Take a screenshot (default true)" })),
			console: Type.Optional(Type.Boolean({ description: "Capture console/page errors via playwright probe (default true)" })),
			pdf: Type.Optional(Type.Boolean({ description: "Also capture a PDF (default false)" })),
			surface: Type.Optional(Type.String({ description: "Surface id (default: active surface)" })),
		}),
		async execute(_id, params) {
			const rt = getRuntime();
			if (!rt.active || !rt.server) {
				return { content: [{ type: "text", text: "No active /talk session." }], details: { ok: false } };
			}
			const result = await verifySurface(rt, {
				screenshot: params.screenshot ?? true,
				console: params.console ?? true,
				pdf: params.pdf ?? false,
				surface: params.surface,
			});
			const lines = [
				result.ok ? "OK" : "FAILED",
				result.url ? `url: ${result.url}` : "",
				result.screenshot ? `screenshot: ${result.screenshot}` : "",
				result.pdf ? `pdf: ${result.pdf}` : "",
				result.error ? `error: ${result.error}` : "",
				`consoleErrors: ${result.consoleErrors.length}`, 
				`pageErrors: ${result.pageErrors.length}`,
				`failedRequests: ${result.failedRequests.length}`,
				result.dom ? `dom: title=${result.dom.title.slice(0, 60)} h1=${result.dom.h1s} textChars=${result.dom.textLen}` : "",
			];
			if (result.consoleErrors.length) {
				lines.push("console sample:", ...result.consoleErrors.slice(0, 5).map((e) => `- [${e.type}] ${e.text.slice(0, 200)}`));
			}
			if (result.pageErrors.length) {
				lines.push("page errors:", ...result.pageErrors.slice(0, 5).map((e) => `- ${e.slice(0, 300)}`));
			}
			return {
				content: [{ type: "text", text: lines.filter(Boolean).join("\n") }],
				details: result,
			};
		},
	});

	pi.registerTool({
		name: "talk_export",
		label: "Talk export",
		description:
			"Export the current /talk surface as html (full document), md (GFM markdown), png (full-page screenshot) or pdf (print layout). Default output goes to the session exports/ dir; pass out for a custom path.",
		promptGuidelines: [
			"After a report is accepted, export it (pdf or md) and offer the path so the user can persist it into the knowledge base.",
		],
		parameters: Type.Object({
			format: Type.Union([
				Type.Literal("html"),
				Type.Literal("md"),
				Type.Literal("png"),
				Type.Literal("pdf"),
			], { description: "Export format" }),
			out: Type.Optional(Type.String({ description: "Output path (default: session exports dir, auto-named)" })),
			surface: Type.Optional(Type.String({ description: "Surface id (default: active surface)" })),
		}),
		async execute(_id, params) {
			const rt = getRuntime();
			if (!rt.active || !rt.server) {
				return { content: [{ type: "text", text: "No active /talk session to export." }], details: { ok: false } };
			}
			const result = await exportSurface(rt, {
				format: params.format,
				out: params.out,
				surface: params.surface,
			});
			return {
				content: [{ type: "text", text: `${result.ok ? "OK" : "ERROR"}\n${result.message}${result.file ? `\nfile: ${result.file}` : ""}` }],
				details: result,
			};
		},
	});
}
