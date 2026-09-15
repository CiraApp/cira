import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ciraHome } from "../config.js";

/**
 * The little Cira remembers between runs about updates.
 *
 * Two small files rather than one, because they answer different questions and
 * are written at different moments: what the registry last said, and which
 * coding agents the developer agreed to keep in sync. Neither is worth a
 * schema, and a file that fails to parse is treated as absent - a corrupted
 * note about updates must never be the reason a deploy will not run.
 */

export interface UpdateState {
  /** ISO timestamp of the last registry check, successful or not. */
  lastCheckedAt?: string;
  latestVersion?: string;
  /** So the same release is not announced on every command. */
  lastNotifiedVersion?: string;
}

export interface SkillTargetState {
  installed: boolean;
  /** False when the developer wants the skill left where it is. */
  autoUpdate: boolean;
}

export interface SkillState {
  /** The release whose skill is currently on disk. */
  skillVersion?: string;
  targets: Record<string, SkillTargetState>;
}

export function readUpdateState(): UpdateState {
  return read<UpdateState>("update-state.json", {});
}

export function writeUpdateState(state: UpdateState): void {
  write("update-state.json", state);
}

export function readSkillState(): SkillState {
  const state = read<SkillState>("skill-state.json", { targets: {} });
  return { ...state, targets: state.targets ?? {} };
}

export function writeSkillState(state: SkillState): void {
  write("skill-state.json", state);
}

function read<T>(name: string, fallback: T): T {
  try {
    return {
      ...fallback,
      ...(JSON.parse(readFileSync(join(ciraHome(), name), "utf8")) as T),
    };
  } catch {
    return fallback;
  }
}

function write(name: string, value: unknown): void {
  try {
    mkdirSync(ciraHome(), { recursive: true, mode: 0o700 });
    writeFileSync(join(ciraHome(), name), `${JSON.stringify(value, null, 2)}\n`);
  } catch {
    // Failing to remember is not a reason to fail the command that was asked
    // for. The worst case is one redundant check or one repeated notice.
  }
}
