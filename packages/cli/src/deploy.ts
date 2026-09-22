import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { api, ApiError } from "./api.js";
import { readConfig } from "./config.js";
import { collectFiles } from "./files.js";
import { readEntries, uploadSource } from "./source.js";
import { collectEnv, isPublicName } from "./env.js";
import type { Framework } from "@cira/core";
import { detectFramework, readProjectLink, writeProjectLink } from "./project.js";
import { resolveMissing } from "./confirm.js";
import { discoverServices, type DiscoveredService, type Discovery } from "./services.js";
import { NGINX_CONF, NGINX_CONFIG, staticDockerfile, staticSite } from "./static-site.js";
import {
  readWorkspacePackage,
  workspaceBuildCommand,
  workspaceAround,
  workspaceDockerfile,
  type WorkspacePackage,
} from "./workspace.js";
import { discoverProcesses } from "./processes.js";
import { describeSchedule, parseSchedule } from "@cira/core/schedule";
import { DEFAULT_LIMITS, settleAppMemory } from "@cira/core/limits";
import { describeMemory, settleMemory } from "@cira/core/processes";
import {
  checkBundle,
  findEnvNeeds,
  tarGzip,
  type ArchiveEntry,
  isRootDockerfile,
  isSafeDockerfilePath,
  readDockerfile,
} from "@cira/deploy/packaging";
import { amber, bold, dim, fail, green, info, success, warn } from "./ui.js";

interface MeResponse {
  user: { name: string; email: string };
  spaces: Array<{ slug: string; name: string; role: string }>;
}

interface DeployResponse {
  appId: string;
  appSlug: string;
  spaceSlug: string;
  deploymentId: string;
}

interface StatusResponse {
  status: string;
  url: string | null;
  /** Why it failed, in the provider's words, when it said. */
  reason?: string | null;
  /** What went wrong without stopping it. */
  warning?: string | null;
  /** The release command is running, between the build and the rollout. */
  releasing?: boolean;
  /** Once live: who can open it besides its owner. */
  access?: "everyone" | "shared" | "private";
  /** Once live: how many of its workers and scheduled runs are switched off. */
  processesOff?: number;
}

interface CapabilitiesResponse {
  detected: Array<{ name: string; description: string; risk: string }>;
}

interface VerifyResponse {
  callable: number;
  refused: number;
  absent: number;
  inconclusive: boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** What to call each of these out loud. */
const FRAMEWORK_NAMES: Record<Framework, string> = {
  nextjs: "Next.js app",
  node: "Node.js app",
  python: "Python app",
  go: "Go app",
  ruby: "Ruby app",
  java: "Java app",
  php: "PHP app",
  dotnet: ".NET app",
  unknown: "Application",
};

export async function deploy(argv: string[] = []): Promise<number> {
  const requestedSpace = readFlag(argv, "--space");
  const config = readConfig();
  if (config.token === undefined) {
    fail("Not signed in. Run: cira login");
    return 1;
  }

  // Inside a package of a JavaScript workspace, the workspace is what gets
  // uploaded, because the package cannot be built without its lockfile and
  // its sibling packages, and the package is what gets deployed. Everywhere
  // else the folder the developer is standing in is both.
  const here = process.cwd();
  const workspace = workspaceAround(here);
  const root = workspace?.root ?? here;
  const focus = workspace === null ? null : readWorkspacePackage(workspace, here);

  info("");
  info(`${dim("Detecting application...")}`);
  // Never a reason to stop. The build works out what this is from the source
  // itself; this only decides what the app's page will call it.
  const framework = detectFramework(here);
  success(FRAMEWORK_NAMES[framework]);

  const link = readProjectLink(here);

  let me: MeResponse;
  try {
    me = await api<MeResponse>("/api/cli/me");
  } catch (error) {
    fail(error instanceof ApiError ? error.message : "Could not reach Cira.");
    return 1;
  }

  if (me.spaces.length === 0) {
    fail("You are not in a space yet. Open Cira and join or create one first.");
    return 1;
  }

  if (requestedSpace !== null && !me.spaces.some((s) => s.slug === requestedSpace)) {
    fail(`You are not in a space called "${requestedSpace}".`);
    info(dim(`  You are in: ${me.spaces.map((s) => s.slug).join(", ")}`));
    return 1;
  }

  // An explicit choice wins, then the folder's existing link, and only then a
  // single obvious space. Guessing which company to publish someone's work
  // into is not a guess worth making.
  const spaceSlug =
    requestedSpace ??
    link?.spaceSlug ??
    (me.spaces.length === 1 ? me.spaces[0]?.slug : undefined);

  if (spaceSlug === undefined) {
    fail("You are in more than one space, so tell Cira which one to deploy to.");
    info("");
    for (const s of me.spaces) {
      info(`  cira deploy --space ${s.slug}${dim(`   (${s.name})`)}`);
    }
    info("");
    return 1;
  }

  // Whether this repository is one thing or two. Nobody writes this down: each
  // half already carries whatever its own toolchain needs, which is the same
  // evidence a person would use. Read before the files, because a Dockerfile
  // anywhere changes which files a build expects to be sent.
  const found =
    workspace === null || focus === null ? discoverServices(root) : focusOn(focus, here);
  // A site with no server of its own - a Vite or Create React App build, a
  // folder of HTML - is built and served as files. Only when nothing else
  // says how it runs: a Dockerfile, or a start script, always wins.
  const site =
    focus !== null
      ? found.services[0]?.dockerfile === GENERATED && !focus.hasStart
        ? staticSite(here, root)
        : null
      : found.services.length <= 1 &&
          found.services[0]?.dockerfile === null &&
          readFlag(argv, "--dockerfile") === null
        ? staticSite(root)
        : null;
  if (
    focus !== null &&
    found.services[0]?.dockerfile === GENERATED &&
    !focus.hasStart &&
    site === null
  ) {
    fail(
      `${focus.path} has no start script, so there is nothing to run it with. Add one to its package.json.`,
    );
    return 1;
  }
  const dockerfileNamed = readFlag(argv, "--dockerfile");
  const style =
    site !== null ||
    dockerfileNamed !== null ||
    existsSync(join(root, "Dockerfile")) ||
    found.services.some((part) => part.dockerfile !== null)
      ? "dockerfile"
      : "buildpacks";

  const walked = collectFiles(root, style);
  // The workspace's other apps are not part of this one: not needed to build
  // it, and read as its own code they would lend it their capabilities.
  const siblings =
    focus === null
      ? []
      : discoverServices(root)
          .services.map((part) => part.sourcePath)
          .filter(
            (path) =>
              path !== "" && path !== focus.path && !focus.path.startsWith(`${path}/`),
          );
  const files = walked.files.filter(
    (file) => !siblings.some((path) => file.path.startsWith(`${path}/`)),
  );
  if (files.length === 0) {
    fail("There is nothing to deploy in this folder.");
    return 1;
  }

  // Said out loud, because a file quietly left out is a build that fails for
  // a reason nobody can see - and a file quietly sent is worse.
  if (walked.withheld.length > 0) {
    warn(
      `Not uploading ${walked.withheld.length === 1 ? "a file that looks" : `${walked.withheld.length} files that look`} like ${walked.withheld.length === 1 ? "a credential" : "credentials"}:`,
    );
    for (const path of walked.withheld) info(`    ${path}`);
    info(
      dim(
        "  Put what they hold in .env, which travels as variables. To ship one anyway, add it to .ciraignore as !path.",
      ),
    );
  }

  // Checked here rather than only on the server, because the server never sees
  // the files: it authorises an upload by size and Google enforces that size.
  // A 40 MB asset someone forgot to ignore is worth naming before the upload,
  // not after it.
  const bundle = checkBundle(files);
  if (!bundle.ok) {
    fail(bundle.reason);
    return 1;
  }

  // A Dockerfile is the project saying how it wants to be built and run, and
  // it is read here because the walk already has the file list. Without it the
  // build has to work the language out and then guess at an entrypoint, which
  // is where a great deal of real software stops.
  let container;
  try {
    container = readContainer(root, files, dockerfileNamed);
  } catch (error) {
    fail(error instanceof Error ? error.message : "Could not read that Dockerfile.");
    return 1;
  }

  if (site !== null) {
    info(
      dim(
        site.build === null
          ? "A static site: its files are served as they are"
          : `A static site: built, then its ${site.output} folder is served`,
      ),
    );
    if (focus === null) container = { dockerfile: STATIC_DOCKERFILE, port: 8080 };
  } else if (container !== null) {
    const where =
      container.dockerfile === "Dockerfile" ? "" : ` (${container.dockerfile})`;
    success(
      container.port === null
        ? `Dockerfile${where}`
        : `Dockerfile${where}, listening on ${container.port}`,
    );
  }

  let services = null;

  // What else the app runs, from the files that already say so. A repository
  // whose files name no web process is not a website, and nothing takes the
  // port: deploying it must not fail for want of a server it never had.
  const declared = discoverProcesses(root, found.services);
  const servesWeb = declared.web !== false;

  if (found.services.length > 1 || focus !== null) {
    if (servesWeb && found.ingress === null) {
      const apps = found.services.map((part) => part.sourcePath).filter((p) => p !== "");
      fail(
        `This repository has more than one thing to deploy, and ${found.ambiguity}. ` +
          "Deploy each from its own folder:",
      );
      info("");
      for (const path of apps) info(`  cd ${path} && cira deploy`);
      info("");
      return 1;
    }

    services = found.services.map((part) => ({
      ...part,
      ingress: servesWeb && part.slug === found.ingress?.slug,
    }));

    if (focus !== null && workspace !== null) {
      const how =
        services[0]?.dockerfile === GENERATED
          ? `built from the ${workspace.manager} workspace${workspace.turbo ? " with turbo" : ""}`
          : services[0]?.dockerfile !== null
            ? "its own Dockerfile, from the workspace"
            : "from the workspace";
      info(dim(`Deploying ${focus.path}, ${how}`));
    } else info(`${dim(`Found ${services.length} services`)}`);
    for (const part of focus === null ? services : []) {
      const how = part.dockerfile === null ? part.framework : "Dockerfile";
      const role = part.ingress
        ? "front door"
        : `internal${part.port === null ? "" : `, port ${part.port}`}`;
      success(`  ${part.slug}  ${dim(part.sourcePath)}  ${dim(`${how}, ${role}`)}`);
    }
  }

  if (declared.release !== null) {
    info(dim(`Before going live it runs: ${declared.release}`));
  }

  if (servesWeb && declared.webMemoryMiB !== null) {
    const memory = settleAppMemory(declared.webMemoryMiB);
    info(
      dim(`Web process: ${describeMemory(memory.memoryMiB!)}, as the repository asks`),
    );
    if (memory.capped) {
      warn(
        `The web process asks for ${describeMemory(declared.webMemoryMiB)}; Cira gives it ${describeMemory(memory.memoryMiB!)}, the most it offers.`,
      );
    }
  }

  if (declared.processes.length > 0) {
    info(`${dim(servesWeb ? "Also runs" : "Runs, with no web process")}`);
    for (const process of declared.processes) {
      const when =
        process.kind === "worker"
          ? "worker, runs all the time"
          : process.schedule === null
            ? "scheduled, no timetable yet"
            : `scheduled, ${describeTimetable(process.schedule)}`;
      const memory = settleMemory(process.memoryMiB, DEFAULT_LIMITS);
      success(
        `  ${process.name}  ${dim(process.command)}  ${dim(`${when}, ${describeMemory(memory.memoryMiB)}, from ${process.source}`)}`,
      );
      if (memory.capped) {
        warn(
          `${process.name} asks for ${describeMemory(process.memoryMiB!)}; Cira gives it ${describeMemory(memory.memoryMiB)}, the most it offers.`,
        );
      }
    }
  }

  const bytes = files.reduce((n, f) => n + f.size, 0);
  const honoured =
    walked.ignoreFiles.length === 0 ? "" : `, honouring ${walked.ignoreFiles.join(", ")}`;
  info(`${dim(`Packaging ${files.length} files (${formatBytes(bytes)}${honoured})...`)}`);

  const entries = readEntries(root, files);

  // Names are printed, values never are - not here, not on failure, not
  // anywhere. See docs/secrets.md.
  let collected;
  try {
    // The package's own .env first, where a workspace app keeps it, then the
    // root's.
    collected = collectEnv(here, argv);
    if (collected.source === null && here !== root) collected = collectEnv(root, argv);
  } catch (error) {
    fail(error instanceof Error ? error.message : "Could not read the env file.");
    return 1;
  }

  // One list rather than two. Cira used to print what it thought was missing
  // and, separately, what it had been given, which left the reader to hold
  // both in their head and work out the overlap. The interesting question is
  // per-variable - do we have this one? - so it is answered per variable.
  //
  // Names only, here and everywhere. See docs/secrets.md.
  const needed = findEnvNeeds(entries);
  const supplied = new Set(Object.keys(collected.env));
  // What production already has counts. A deploy changes only what it sends,
  // so a clone with no `.env` is not missing anything production is set with.
  const inProduction = new Set(
    link === null ? [] : await productionNames(link.appId, collected.unset),
  );
  const missing = needed.filter(
    (need) => !supplied.has(need.name) && !inProduction.has(need.name),
  );

  const checklist = [
    ...needed.map((need) => ({
      name: need.name,
      have: supplied.has(need.name) || inProduction.has(need.name),
      note: supplied.has(need.name)
        ? ""
        : inProduction.has(need.name)
          ? "already set in production"
          : `${need.reason}, in ${need.file.replace(/^\.\//, "")}`,
    })),
    // Set, and not something the scan asked for. Still going to the app, so
    // still worth seeing - a typo in a name shows up here as a variable
    // nobody asked for sitting next to the one still missing.
    ...[...supplied]
      .filter((name) => !needed.some((need) => need.name === name))
      .map((name) => ({ name, have: true, note: "" })),
  ].sort((a, b) => a.name.localeCompare(b.name));

  if (checklist.length > 0) {
    info("");
    info(
      dim(`Environment${collected.source === null ? "" : ` (from ${collected.source})`}`),
    );

    const column = Math.max(...checklist.map((row) => row.name.length));
    for (const row of checklist) {
      const mark = row.have ? green("✓") : amber("✗");
      // Padded only when something follows it, so a line with nothing to say
      // ends at its own name rather than trailing whitespace across the column.
      const note = row.note === "" ? "" : `  ${dim(row.note)}`;
      const name = note === "" ? row.name : row.name.padEnd(column);
      info(`  ${mark} ${name}${note}`);
    }
    info("");
  }

  if (missing.length > 0) {
    warn(
      `${missing.length} missing. It will build, and the app may not work without ${missing.length === 1 ? "it" : "them"}.`,
    );
    info("");

    const resolved = await resolveMissing(
      here,
      missing.map((need) => ({
        name: need.name,
        note: `${need.reason}, in ${need.file.replace(/^\.\//, "")}`,
      })),
      argv,
      collected.file,
    );

    // Whatever was typed goes to this deploy, the same as anything from a file.
    Object.assign(collected.env, resolved.added);

    if (!resolved.proceed) {
      fail("Nothing was deployed.");
      return 1;
    }
  }

  if (collected.unset.length > 0) {
    info(`  ${bold("Taking away:")} ${collected.unset.join(", ")}`);
    info("");
  }

  // Worth interrupting for: the build inlines these into the JavaScript the
  // browser downloads, so a secret here is published the moment it ships and
  // rotating is the only fix.
  if (collected.publicNames.length > 0) {
    info("");
    info(`  ${bold("Public to anyone who opens the app:")}`);
    for (const name of collected.publicNames) info(`    ${name}`);
    info(`  ${dim("These are compiled into the JavaScript the browser downloads.")}`);
    info("");
  }

  // The Dockerfile Cira writes for a workspace package, now that every name a
  // browser will be given is known: what this deploy sends, and what
  // production already has. Each needs its own ARG line to reach the build.
  const extra: ArchiveEntry[] = [];
  const publicNames = [
    ...new Set([...Object.keys(collected.env), ...inProduction].filter(isPublicName)),
  ].sort();
  const written = (path: string, text: string) =>
    extra.push({ path, mode: 0o644, body: Buffer.from(text) });
  if (site !== null) {
    written(NGINX_CONF, NGINX_CONFIG);
    const buildCommand =
      workspace !== null && focus !== null
        ? workspaceBuildCommand(workspace, focus)
        : null;
    written(
      focus === null ? STATIC_DOCKERFILE : GENERATED,
      staticDockerfile({
        site,
        path: focus?.path ?? "",
        publicNames,
        ...(buildCommand === null ? {} : { buildCommand }),
      }),
    );
  } else if (
    workspace !== null &&
    focus !== null &&
    found.services[0]?.dockerfile === GENERATED
  ) {
    written(GENERATED, workspaceDockerfile({ workspace, pkg: focus, publicNames }));
  }
  const archive = tarGzip([...entries, ...extra]);

  // One archive, sent straight to storage. It does not pass through Cira,
  // which is what lets a project larger than a few megabytes deploy at all.
  let sourceId: string;
  try {
    sourceId = await uploadSource(archive);
  } catch (error) {
    fail(error instanceof ApiError ? error.message : "Could not upload this project.");
    return 1;
  }
  success("Uploaded");

  info(`${dim(`Deploying to ${spaceSlug}...`)}`);

  let started: DeployResponse;
  try {
    started = await api<DeployResponse>("/api/cli/deploy", {
      method: "POST",
      body: {
        spaceSlug,
        // Named after the folder being deployed: in a workspace that is the
        // package, not the repository holding it.
        appName: link === null ? prettyName(basename(here)) : basename(here),
        appId: link?.appId ?? null,
        sourceId,
        framework,
        container,
        ...(services === null ? {} : { services }),
        web: servesWeb,
        webMemoryMiB: servesWeb ? declared.webMemoryMiB : null,
        release: declared.release,
        processes: declared.processes,
        env: collected.env,
        unset: collected.unset,
      },
    });
  } catch (error) {
    fail(error instanceof ApiError ? error.message : "The deploy could not be started.");
    return 1;
  }

  writeProjectLink(
    {
      appId: started.appId,
      spaceId: "",
      spaceSlug: started.spaceSlug,
      appSlug: started.appSlug,
    },
    here,
  );

  // Cira reads the source itself, out of the archive just uploaded, so there
  // is nothing to send but its name. Started while the build is going out: by
  // the time the app is live the answer is usually already back, and finding
  // out what an app can do costs no extra waiting.
  info(`${dim("Analyzing capabilities...")}`);
  const analysis = api<CapabilitiesResponse>("/api/cli/capabilities", {
    method: "POST",
    body: { appId: started.appId, sourceId },
  }).catch((error: unknown) => (error instanceof Error ? error : new Error("failed")));

  // As long as Cira itself waits before calling a deploy abandoned: a build
  // may take twenty minutes, and a CLI that gave up at ten failed CI jobs
  // whose deploys went on to succeed.
  // A release command - a migration - gets the same patience again after
  // the build, as Cira gives it.
  const deadline = Date.now() + 70 * 60 * 1000;
  let last = "";

  while (Date.now() < deadline) {
    await sleep(3000);

    let status: StatusResponse;
    try {
      status = await api<StatusResponse>(
        `/api/cli/deploy/status?id=${encodeURIComponent(started.deploymentId)}`,
      );
    } catch (error) {
      // A network blip is worth waiting through. Being signed out, or the app
      // being removed while it deployed, is not going to change by waiting.
      if (error instanceof ApiError && (error.status === 401 || error.status === 404)) {
        info("");
        fail(
          error.status === 401
            ? "Cira stopped accepting this login while the deploy ran. Run cira login, then check the app in Cira."
            : "This app was removed while it was deploying.",
        );
        return 1;
      }
      continue;
    }

    const phase =
      status.releasing === true ? "running the release command" : status.status;
    if (phase !== last) {
      info(dim(`  ${phase}...`));
      last = phase;
    }

    if (status.status === "live") {
      info("");
      success("Deployed");
      info("");
      info(`  ${bold(`${config.apiUrl}/${started.spaceSlug}/${started.appSlug}`)}`);
      info("");
      info(
        dim(
          status.access === "everyone"
            ? "  Everyone in the space can open it."
            : status.access === "shared"
              ? "  The people given access on that page can open it."
              : "  Only you can see it. Give people access from that page.",
        ),
      );
      if (typeof status.warning === "string" && status.warning !== "") {
        info("");
        warn(status.warning);
      }
      // Older Cira did not say, and every process a first deploy finds is off.
      const off = status.processesOff ?? declared.processes.length;
      if (off > 0) {
        info(
          dim(
            off === declared.processes.length
              ? "  Its workers and scheduled runs are off until someone who manages it turns them on there."
              : `  ${off} of its workers and scheduled runs ${off === 1 ? "is" : "are"} off until someone who manages it turns ${off === 1 ? "it" : "them"} on there.`,
          ),
        );
      }

      // Nothing is published until the app itself confirms it serves the
      // route. That can only be asked now, which is why it is not part of the
      // analysis that ran while the build was going out.
      const found = await analysis;
      const confirmed = await confirmCapabilities(started.appId);
      reportCapabilities(found, confirmed);
      return 0;
    }

    if (status.status === "superseded") {
      info("");
      fail(
        "A newer deploy of this app started, so this one stopped. That one is the one going out.",
      );
      return 1;
    }

    if (status.status === "failed" || status.status === "removed") {
      // The end of the build's own output, where the error is, rather than
      // only a link to a page that shows it.
      const tail =
        status.status === "failed"
          ? await api<{ step?: "build" | "release"; lines: string[] }>(
              `/api/cli/deploy/logs?id=${encodeURIComponent(started.deploymentId)}`,
            ).catch(() => ({ step: "build" as const, lines: [] as string[] }))
          : { step: "build" as const, lines: [] as string[] };
      const shown = tail.lines.length > 0;
      // The reason is written for the page and the email, which point at the
      // logs; here they are printed right below it.
      const reason =
        status.reason === undefined || status.reason === null
          ? null
          : shown
            ? status.reason.replace(/ Its logs, on the app's page, say where\.$/, "")
            : status.reason;
      info("");
      fail(
        reason === null
          ? "The deploy did not finish. Open the app in Cira to see why."
          : `The deploy did not finish: ${reason}`,
      );
      if (shown) {
        info("");
        info(
          dim(
            tail.step === "release"
              ? "  What the release command printed:"
              : "  The end of the build log:",
          ),
        );
        for (const line of tail.lines) info(dim(`    ${line}`));
      }
      info("");
      info(dim(`  ${config.apiUrl}/${started.spaceSlug}/${started.appSlug}`));
      return 1;
    }
  }

  fail(
    "Still not finished after 70 minutes, so Cira will treat it as stopped. Open the app in Cira to see its build.",
  );
  return 1;
}

/**
 * The names an app is already set with in production, minus any this deploy
 * takes away. Empty when Cira cannot say - an older Cira, or an app this
 * person may not manage, which the deploy itself will refuse with a reason.
 */
async function productionNames(
  appId: string,
  unset: readonly string[],
): Promise<string[]> {
  try {
    const { names } = await api<{ names: string[] }>(
      `/api/cli/env?appId=${encodeURIComponent(appId)}`,
    );
    return names.filter((name) => !unset.includes(name));
  } catch {
    return [];
  }
}

/** A timetable in words, or as written when it cannot be read. */
function describeTimetable(expression: string): string {
  const parsed = parseSchedule(expression);
  return parsed.ok ? describeSchedule(parsed.schedule) : expression;
}

function prettyName(folder: string): string {
  const cleaned = folder.replace(/[-_]+/g, " ").trim();
  return cleaned === "" ? "App" : cleaned.replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * What this project's Dockerfile says, or null when there is none.
 *
 * `--dockerfile` names one somewhere other than the root, which a monorepo
 * needs: the file sits with the service and the build context is the
 * workspace. Named explicitly rather than searched for, because a repository
 * with several is not one where guessing is safe.
 */
function readContainer(
  root: string,
  files: readonly { path: string }[],
  named: string | null,
): { dockerfile: string; port: number | null } | null {
  const path =
    named ?? (files.some((f) => isRootDockerfile(f.path)) ? "Dockerfile" : null);
  if (path === null) return null;

  if (!isSafeDockerfilePath(path)) {
    throw new Error(`${path} is not a usable Dockerfile path.`);
  }

  // Asked for by name and not there is a mistake worth stopping for. Found by
  // looking and unreadable is not: the build can still work the project out.
  if (!files.some((f) => f.path === path)) {
    if (named === null) return null;
    throw new Error(`There is no ${path} in this folder.`);
  }

  try {
    return {
      dockerfile: path,
      port: readDockerfile(readFileSync(join(root, path), "utf8")).port,
    };
  } catch {
    if (named !== null) throw new Error(`Could not read ${path}.`);
    return null;
  }
}

/** Where the Dockerfile Cira writes for a workspace package sits in the upload. */
const GENERATED = ".cira/workspace.Dockerfile";
/** And the one for a site it serves as files. */
const STATIC_DOCKERFILE = ".cira/static.Dockerfile";

/**
 * One package of a workspace, as the only part of the app: its own Dockerfile
 * when it has one, the one Cira writes when it is a JavaScript package, and
 * otherwise buildpacks pointed at its folder, which is all a Python or Go
 * service in a monorepo needs.
 */
function focusOn(pkg: WorkspacePackage, here: string): Discovery {
  const own = join(here, "Dockerfile");
  let dockerfile: string | null = null;
  let port: number | null = null;
  if (existsSync(own)) {
    dockerfile = `${pkg.path}/Dockerfile`;
    try {
      port = readDockerfile(readFileSync(own, "utf8")).port;
    } catch {
      // Unreadable is still a Dockerfile; the build will say what is wrong.
    }
  } else if (existsSync(join(here, "package.json"))) {
    dockerfile = GENERATED;
  }
  const part: DiscoveredService = {
    slug: "app",
    sourcePath: pkg.path,
    framework: detectFramework(here),
    dockerfile,
    port,
  };
  return { services: [part], ingress: part, ambiguity: null };
}

/** Read `--flag value` or `--flag=value` from the arguments. */
function readFlag(argv: string[], flag: string): string | null {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === flag) return argv[i + 1] ?? null;
    if (arg !== undefined && arg.startsWith(`${flag}=`)) {
      return arg.slice(flag.length + 1);
    }
  }
  return null;
}

/**
 * What Cira found the app can do.
 *
 * Reported after the deploy rather than instead of it: capability analysis is
 * a normal part of shipping, and a deploy that worked is not made a failure by
 * analysis that did not.
 */
/**
 * Ask Cira to check the capabilities against the app that is now running.
 *
 * Quiet on failure. A deploy that worked is not made a failure by a check that
 * did not, and the app's page says plainly which capabilities have been
 * confirmed.
 */
async function confirmCapabilities(appId: string): Promise<VerifyResponse | null> {
  try {
    return await api<VerifyResponse>("/api/cli/capabilities/verify", {
      method: "POST",
      body: { appId },
    });
  } catch {
    // The app's page says which have been confirmed; a deploy that worked is
    // not a failure because the check afterwards did not.
    return null;
  }
}

function reportCapabilities(
  result: CapabilitiesResponse | Error,
  confirmed: VerifyResponse | null,
): void {
  if (result instanceof Error) {
    info("");
    info(dim(`  Capabilities were not analyzed: ${result.message}`));
    return;
  }

  if (result.detected.length === 0) {
    info("");
    info(dim("  No capabilities detected in this app."));
    return;
  }

  info("");
  info(`${bold("Capabilities")}`);
  info("");
  for (const capability of result.detected) {
    const mark = capability.risk === "read" ? " " : "!";
    info(`  ${mark} ${bold(capability.name)}`);
    info(`    ${dim(capability.description)}`);
  }

  info("");

  // What was found and what the app confirmed are different numbers, and
  // saying only the first would claim more than is true. Reading the code can
  // be wrong; the app is asked, and anything it will not answer for is dropped.
  if (confirmed === null) {
    info(dim("  Not confirmed yet. Open the app in Cira to see which are live."));
    info("");
    return;
  }

  if (confirmed.inconclusive) {
    info(dim("  This app answers every address, so none could be confirmed."));
    info("");
    return;
  }

  const reads = result.detected.filter((c) => c.risk === "read").length;
  const parts = [`${confirmed.callable} confirmed by the app`];
  if (confirmed.absent > 0) parts.push(`${confirmed.absent} it does not serve`);
  if (confirmed.refused > 0)
    parts.push(`${confirmed.refused} it would not let Cira call`);
  info(`  ${parts.join(", ")}`);

  // Worth its own line, because it is the one outcome a developer can do
  // something about and the one that used to be invisible. These routes are
  // real and the description of them is right; the app just asks whoever calls
  // it to sign in, and Cira is not one of its users. Said here rather than
  // only on the app's page because this is the moment the person who could
  // change it is looking at the terminal.
  if (confirmed.refused > 0) {
    info(
      dim(
        confirmed.refused === 1
          ? "  That one is a real route behind your app's own sign-in."
          : `  Those ${confirmed.refused} are real routes behind your app's own sign-in.`,
      ),
    );
    info(
      dim(
        "  To let agents in, turn on \u201cTell this app who is calling\u201d in its settings,",
      ),
    );
    info(dim("  and have the app accept Cira's signed statement of who it is."));
  }

  if (confirmed.callable > reads) {
    info(dim("  Anything that writes stays off until someone turns it on."));
  }
  info("");
}
