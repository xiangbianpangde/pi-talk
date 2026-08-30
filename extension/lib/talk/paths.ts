import { homedir } from "node:os";
import { join } from "node:path";

export function getTalkHome(home = homedir()): string {
	return join(home, ".pi", "agent", "talk");
}

export function getTalkStylesDir(home = homedir()): string {
	return join(getTalkHome(home), "styles");
}

export function getTalkSessionsDir(home = homedir()): string {
	return join(getTalkHome(home), "sessions");
}

export function getSessionDir(sessionId: string, home = homedir()): string {
	return join(getTalkSessionsDir(home), sessionId);
}

export function getTalkRuntimeFile(home = homedir()): string {
	return join(getTalkHome(home), "runtime.json");
}

export function getDrawScript(home = homedir()): string {
	return join(home, ".pi", "agent", "skills", "draw", "draw.sh");
}
