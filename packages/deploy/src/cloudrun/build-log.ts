/**
 * A Cloud Build log, as a person reads it.
 *
 * The stored log is Docker's progress output wrapped in Cloud Build's: every
 * line prefixed "Step #0: ", every Docker line prefixed with its step number
 * and a timer, and most of it layer hashes being downloaded and unpacked. The
 * forty lines a failed deploy printed in the terminal were thirty of that and
 * the pip error somewhere in the middle. What is left is what a developer
 * would have seen building it on their own machine: each Dockerfile step, and
 * whatever the step printed.
 */

/** Cloud Build's wrapper around each step's output. */
const STEP_PREFIX = /^Step #\d+(?: - "[^"]*")?: ?/;

/** BuildKit's "#8 " and "#8 2.040 " before a line of a step's output. */
const BUILDKIT_PREFIX = /^#\d+ (?:\d+\.\d+ )?/;

/** Progress that says nothing about the app: fetching, hashing, timing. */
const NOISE = [
  /^(?:Starting|Finished) Step #\d+/,
  /^(?:FETCHSOURCE|BUILD|PUSH|DONE|ERROR)$/,
  /^starting build "/,
  /^Fetching storage object: /,
  /^Copying gs:\/\//,
  /^Operation completed over /,
  /^Already have image/,
  /^-+$/,
  /\[notice\]/,
];

/** Once the BuildKit prefix is gone. */
const STEP_NOISE = [
  /^(?:extracting )?sha256:[0-9a-f]{64}/,
  /^resolve [^ ]+ /,
  /^DONE \d+(?:\.\d+)?s$/,
  /^CACHED$/,
  /^transferring (?:dockerfile|context|\.dockerignore)?:? /,
  /^\[internal\] /,
  /^building with "/,
  /^writing image sha256:/,
  /^naming to /,
  /^exporting (?:to image|layers)/,
  /^ > \[/,
];

/** A step failing, as Cloud Build words it: said better by the line above it. */
const BUILD_STEP_FAILED =
  /^ERROR: build step \d+ "[^"]+" failed: step exited with non-zero status: \d+$/;

export function readableBuildLog(lines: readonly string[]): string[] {
  const kept: string[] = [];
  for (const raw of lines) {
    if (NOISE.some((pattern) => pattern.test(raw))) continue;
    if (BUILD_STEP_FAILED.test(raw)) continue;
    const inStep = raw.replace(STEP_PREFIX, "");
    if (NOISE.some((pattern) => pattern.test(inStep))) continue;
    const line = inStep.replace(BUILDKIT_PREFIX, "").trimEnd();
    if (STEP_NOISE.some((pattern) => pattern.test(line))) continue;
    // Docker repeats the failing command's error as a recap at the end.
    if (line.startsWith("executor failed running ") && kept.includes(`ERROR: ${line}`)) {
      continue;
    }
    if (line === "" && (kept.length === 0 || kept.at(-1) === "")) continue;
    kept.push(line);
  }
  while (kept.at(-1) === "") kept.pop();
  return kept;
}
