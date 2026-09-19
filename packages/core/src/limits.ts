/**
 * How much of Cira one company, one person and one app may use.
 *
 * Every app runs in one shared Google project and on one bill, so without
 * these a single runaway deploy loop or a script hammering an app through
 * MCP is everybody's problem. They live here, in one record, because the
 * same numbers are enforced by the server, applied to Cloud Run by the
 * provider, and shown on the pages they affect - and three copies of a
 * number is how a page comes to promise a limit the server does not keep.
 *
 * One set for everyone for now. Plans will choose between sets (roadmap
 * 2.1), which is why the checks take the limits as an argument rather than
 * reading this constant themselves.
 */
export interface Limits {
  /** Apps one space may hold. */
  appsPerSpace: number;
  /** Deploys one space may start in any sixty minutes. Each is a paid build. */
  deploysPerSpacePerHour: number;
  /**
   * Capability runs one person may start in any sixty seconds, from MCP, Ask
   * Cira and the console together. Each is a request to somebody's app.
   */
  invocationsPerPersonPerMinute: number;
  /** What a space may run besides answering requests (see processes.ts). */
  processes: {
    /** Scheduled runs switched on at once, across the space. */
    scheduledPerSpace: number;
    /** Workers switched on at once, across the space. They cost money idle. */
    workersPerSpace: number;
    /** The shortest time a timetable may leave between runs. */
    minIntervalMinutes: number;
    /** How long a scheduled run may take unless someone says otherwise. */
    defaultTimeoutMinutes: number;
    /** The longest anyone may let one run. */
    maxTimeoutMinutes: number;
    /**
     * The memory a worker or scheduled run may be given, smallest first. What
     * a repository asks for is rounded up to one of these; the last is the
     * most anyone gets. All of them fit one CPU on Cloud Run.
     */
    memoryChoicesMiB: readonly number[];
    /**
     * What one is given when its repository does not say. More than a web
     * instance: a worker is where the heavy work goes, running out of memory
     * is how it most often fails, and memory is the cheap part of the bill.
     */
    defaultMemoryMiB: number;
  };
  /** What each app's service is given on Cloud Run. */
  app: {
    maxInstances: number;
    cpu: number;
    /** For an app that is one process. */
    memoryMiB: number;
    /** For an app with sidecars, whose limits are the sum of its containers'. */
    memoryMiBWithSidecars: number;
    /** How long one request may run before Cloud Run ends it. */
    requestTimeoutSeconds: number;
  };
}

export const DEFAULT_LIMITS: Limits = {
  appsPerSpace: 25,
  deploysPerSpacePerHour: 30,
  invocationsPerPersonPerMinute: 60,
  processes: {
    scheduledPerSpace: 10,
    workersPerSpace: 2,
    minIntervalMinutes: 5,
    defaultTimeoutMinutes: 10,
    maxTimeoutMinutes: 60,
    memoryChoicesMiB: [512, 1024, 2048, 4096],
    defaultMemoryMiB: 1024,
  },
  app: {
    maxInstances: 10,
    cpu: 1,
    memoryMiB: 512,
    memoryMiBWithSidecars: 1024,
    requestTimeoutSeconds: 300,
  },
};

export type LimitVerdict = { ok: true } | { ok: false; message: string };

/**
 * Whether a space may take one more app. Redeploying an app it already has is
 * never counted: a limit that stopped a fix from shipping would be worse than
 * no limit.
 */
export function checkNewApp(appCount: number, limits: Limits): LimitVerdict {
  if (appCount < limits.appsPerSpace) return { ok: true };
  return {
    ok: false,
    message:
      `This space already has ${limits.appsPerSpace} apps, which is as many as a space can hold. ` +
      "Remove one it no longer needs, or redeploy an existing app instead.",
  };
}

/**
 * Whether a space may start another deploy, given when its recent ones
 * started. Says how long until the oldest in the window leaves it, so the
 * answer is a time to try again rather than just "no".
 */
export function checkDeployRate(
  recent: readonly Date[],
  now: Date,
  limits: Limits,
): LimitVerdict {
  const hourAgo = now.getTime() - 3_600_000;
  const inWindow = recent.filter((at) => at.getTime() > hourAgo);
  if (inWindow.length < limits.deploysPerSpacePerHour) return { ok: true };

  const oldest = Math.min(...inWindow.map((at) => at.getTime()));
  const minutes = Math.max(1, Math.ceil((oldest + 3_600_000 - now.getTime()) / 60_000));
  return {
    ok: false,
    message:
      `This space has started ${limits.deploysPerSpacePerHour} deploys in the last hour, which is the limit. ` +
      `Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
  };
}

/** Whether a person may run another capability, given how many they just ran. */
export function checkInvocationRate(recentCount: number, limits: Limits): LimitVerdict {
  if (recentCount < limits.invocationsPerPersonPerMinute) return { ok: true };
  return {
    ok: false,
    message:
      `You have run ${limits.invocationsPerPersonPerMinute} capabilities in the last minute, which is the limit. ` +
      "Wait a moment and try again.",
  };
}

/** An app's allowance in words, for the page that shows it. */
export function describeAppAllowance(limits: Limits, withSidecars: boolean): string {
  const memory = withSidecars ? limits.app.memoryMiBWithSidecars : limits.app.memoryMiB;
  const size = memory >= 1024 ? `${memory / 1024} GB` : `${memory} MB`;
  return `Up to ${limits.app.maxInstances} instances, each ${limits.app.cpu} CPU and ${size}`;
}

/**
 * Whether a space may switch on one more process of this kind, given how many
 * of that kind it already has on.
 */
export function checkProcessOn(
  kind: "worker" | "scheduled",
  onAlready: number,
  limits: Limits,
): LimitVerdict {
  const most =
    kind === "worker"
      ? limits.processes.workersPerSpace
      : limits.processes.scheduledPerSpace;
  if (onAlready < most) return { ok: true };
  return {
    ok: false,
    message:
      kind === "worker"
        ? `This space already has ${most} workers on, which is the limit. Workers run all the time, so turn one off first.`
        : `This space already has ${most} scheduled runs on, which is the limit. Turn one off first.`,
  };
}
