/**
 * What Cira's emails say.
 *
 * Plain values in, a subject and a plain-text and HTML body out, so every
 * word can be read and tested without sending anything. Written for the
 * person who manages an app, who may not be the person who wrote it: what
 * happened, what it means for the people using the app, and one link to
 * where it can be looked into.
 *
 * App, space and people's names are chosen by users, so every one is escaped
 * on its way into HTML. Nothing an app returned or logged is ever included.
 */

import { possessive } from "@cira/core";

export interface Message {
  subject: string;
  text: string;
  html: string;
}

interface Letter {
  subject: string;
  /** Short paragraphs, as plain text. */
  paragraphs: readonly string[];
  action: { label: string; href: string };
  /** Why this person got it. */
  because: string;
}

function letter({ subject, paragraphs, action, because }: Letter): Message {
  const text = [...paragraphs, `${action.label}: ${action.href}`, "", because].join(
    "\n\n",
  );

  const html = `<!doctype html>
<html><body style="margin:0;padding:32px 16px;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#111318">
<div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e3e5ea;border-radius:6px;padding:28px">
<p style="margin:0 0 18px;font-size:13px;font-weight:600;letter-spacing:-0.01em;color:#111318">Cira</p>
${paragraphs
  .map(
    (p) =>
      `<p style="margin:0 0 14px;font-size:14px;line-height:1.55;color:#2b2f38">${escape(p)}</p>`,
  )
  .join("\n")}
<p style="margin:22px 0 0"><a href="${escape(action.href)}" style="display:inline-block;background:#111318;color:#ffffff;text-decoration:none;font-size:13px;font-weight:500;padding:9px 14px;border-radius:4px">${escape(action.label)}</a></p>
</div>
<p style="max-width:520px;margin:14px auto 0;font-size:12px;line-height:1.5;color:#6b7080">${escape(because)}</p>
</body></html>`;

  return { subject, text, html };
}

function escape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** A time the way an email reader in any zone can place it. */
export function utc(at: Date): string {
  const day = at.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  const time = at.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
  return `${day}, ${time} UTC`;
}

function minutesBetween(from: Date, to: Date): string {
  const minutes = Math.max(1, Math.round((to.getTime() - from.getTime()) / 60_000));
  if (minutes < 90) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(minutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

/** Where an app lives in Cira, and who is being written to about it. */
export interface AppRef {
  name: string;
  spaceName: string;
  /** The app's page in Cira, absolute. */
  page: string;
}

const manager = (app: AppRef) =>
  `You get this because you manage ${app.name} in ${app.spaceName} on Cira.`;

export function inviteMessage(args: {
  inviter: string;
  spaceName: string;
  role: "member" | "admin";
  email: string;
  url: string;
  expiresAt: Date;
  /** The teams they are put on the moment they accept, if any. */
  teams?: readonly string[];
}): Message {
  // Said in the invitation because it is the useful half of it: what someone
  // will be able to open the minute they are in.
  const teams = args.teams ?? [];
  const onTeams =
    teams.length === 0
      ? ""
      : `, on ${teams.length === 1 ? teams[0] : `${teams.slice(0, -1).join(", ")} and ${teams.at(-1)}`}`;

  return letter({
    subject: `${args.inviter} invited you to ${args.spaceName} on Cira`,
    paragraphs: [
      `${args.inviter} invited you to join ${args.spaceName} on Cira, where ${possessive(args.spaceName)} internal software lives${args.role === "admin" ? ", as an admin" : ""}${onTeams}.`,
      `The invitation is for ${args.email} and works once, until ${utc(args.expiresAt)}. Sign in with that address to accept it.`,
    ],
    action: { label: "Accept the invitation", href: args.url },
    because: `You get this because ${args.inviter} invited ${args.email}. If you were not expecting it, you can ignore it.`,
  });
}

export function deployFailedMessage(args: {
  app: AppRef;
  startedAt: Date;
  /** Whether an earlier deploy is still serving, so the app is still up. */
  stillRunningEarlier: boolean;
  /** Why, in plain words, when that is known. */
  reason?: string | null;
}): Message {
  const { app } = args;
  return letter({
    subject: `${app.name}: a deploy failed`,
    paragraphs: [
      `The deploy of ${app.name} started ${utc(args.startedAt)} did not finish.`,
      ...(args.reason === undefined || args.reason === null ? [] : [args.reason]),
      args.stillRunningEarlier
        ? "The version that was running before is still running, so nothing changed for the people using it."
        : `${app.name} has never been deployed successfully, so it is not running yet.`,
      "Its page in Cira has the build's logs and the app's own, which say more.",
    ],
    action: { label: `Open ${app.name}`, href: app.page },
    because: manager(app),
  });
}

/**
 * A worker as a sentence names it. Most Procfiles call theirs "worker", and
 * "the worker worker keeps stopping" reads as a typo; that one is just "its
 * worker", and any other is "the worker “name”".
 */
export function workerCalled(name: string): string {
  return name === "worker" ? "its worker" : `the worker “${name}”`;
}

function capitalised(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function notAnsweringMessage(args: {
  app: AppRef;
  /** Null for the app's web address, or the worker's name. */
  worker: string | null;
  since: Date;
  /** In the reader's terms: "it ran out of memory", "it failed to start". */
  why: string | null;
  logs: string;
}): Message {
  const { app } = args;
  const what = args.worker === null ? app.name : capitalised(workerCalled(args.worker));
  return letter({
    subject:
      args.worker === null
        ? `${app.name} is not answering`
        : `${app.name}: ${workerCalled(args.worker)} keeps stopping`,
    paragraphs: [
      args.worker === null
        ? `${app.name} has not answered Cira's checks since ${utc(args.since)}. People opening it are likely to see an error.`
        : `${what} of ${app.name} has not been running properly since ${utc(args.since)}${args.why === null ? "" : `: ${args.why}`}.`,
      "Its logs are the place to start. Cira will write again when it is back.",
    ],
    action: { label: "Open its logs", href: args.logs },
    because: manager(app),
  });
}

export function answeringAgainMessage(args: {
  app: AppRef;
  worker: string | null;
  since: Date;
  now: Date;
}): Message {
  const { app } = args;
  return letter({
    subject:
      args.worker === null
        ? `${app.name} is answering again`
        : `${app.name}: ${workerCalled(args.worker)} is running again`,
    paragraphs: [
      `${args.worker === null ? app.name : capitalised(workerCalled(args.worker))} is back, after ${minutesBetween(args.since, args.now)} (since ${utc(args.since)}).`,
    ],
    action: { label: `Open ${app.name}`, href: app.page },
    because: manager(app),
  });
}

export function runFailedMessage(args: {
  app: AppRef;
  run: string;
  startedAt: Date;
  outOfMemory: boolean;
  nextRunAt: Date | null;
  logs: string;
}): Message {
  const { app } = args;
  return letter({
    // Quoted, since a run's name is often an ordinary word - "The scheduled
    // run nightly of" read as a slip.
    subject: `${app.name}: \u201c${args.run}\u201d failed`,
    paragraphs: [
      `The scheduled run \u201c${args.run}\u201d of ${app.name}, started ${utc(args.startedAt)}, failed${args.outOfMemory ? " because it ran out of memory" : ""}.`,
      args.outOfMemory
        ? "Giving it more memory on the app's page is the usual fix."
        : "Its logs from that run say what went wrong.",
      args.nextRunAt === null
        ? "It is not due to run again until it is given a timetable."
        : `It runs next ${utc(args.nextRunAt)}.`,
    ],
    action: {
      label: args.outOfMemory ? `Open ${app.name}` : "Open that run's logs",
      href: args.outOfMemory ? app.page : args.logs,
    },
    because: manager(app),
  });
}

export function refusedMessage(args: {
  app: AppRef;
  operation: string;
  /** Whether Cira already tells the app who is behind each call. */
  told: boolean;
}): Message {
  const { app } = args;
  return letter({
    subject: `${app.name}: ${args.operation} stopped letting Cira in`,
    paragraphs: [
      `${app.name} turned Cira away when ${args.operation} was run through it: the app now asks everyone to sign in, and Cira cannot sign in with anyone's password.`,
      args.told
        ? "Cira already tells the app who is behind each call, so the app's own code is not accepting that statement. Until it does, people and agents asking for this are told it is unavailable."
        : "If the app signs its own users in, turn on \u201cTell this app who is calling\u201d in its settings and have its code accept Cira's signed statement of who the person is. Until then, people and agents asking for this are told it is unavailable.",
    ],
    action: {
      label: args.told ? `Open ${app.name}` : `Open ${possessive(app.name)} settings`,
      href: args.told ? app.page : `${app.page}#settings`,
    },
    because: manager(app),
  });
}

/** A space, and where its billing is, for the notices about the space itself. */
export interface SpaceRef {
  name: string;
  /** The space's billing page, absolute. */
  billing: string;
}

const admin = (space: SpaceRef) =>
  `You get this because you are an admin of ${space.name} on Cira.`;

/** A day the way a reader anywhere can place it: "Friday, Oct 3". */
function day(at: Date): string {
  return at.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function trialEndingMessage(args: { space: SpaceRef; endsAt: Date }): Message {
  const { space } = args;
  return letter({
    subject: `${possessive(space.name)} Cira trial ends ${day(args.endsAt)}`,
    paragraphs: [
      `The free trial of Cira for ${space.name} ends on ${day(args.endsAt)}.`,
      "After that, everything already deployed keeps opening and nothing is deleted. New deploys stop, and workers and scheduled runs are switched off, until someone subscribes.",
      "Subscribing takes a minute and a card, at Stripe. Cira never sees the card.",
    ],
    action: { label: "Subscribe", href: space.billing },
    because: admin(space),
  });
}

export function trialEndedMessage(args: { space: SpaceRef }): Message {
  const { space } = args;
  return letter({
    subject: `${possessive(space.name)} Cira trial has ended`,
    paragraphs: [
      `The free trial of Cira for ${space.name} has ended.`,
      "Everything already deployed still opens, and nothing has been deleted. Deploying is paused, and workers and scheduled runs are off, until someone subscribes - then switch them back on from each app's page.",
    ],
    action: { label: "Subscribe", href: space.billing },
    because: admin(space),
  });
}

export function planEnforcedMessage(args: {
  space: SpaceRef;
  switchedOff: readonly string[];
  cooled: readonly string[];
}): Message {
  const { space } = args;
  const items = [
    ...args.switchedOff,
    ...args.cooled.map((name) => `${name}, which was being kept warm`),
  ];
  return letter({
    subject: `${space.name}: Cira switched ${items.length === 1 ? "something" : `${items.length} things`} off`,
    paragraphs: [
      `${possessive(space.name)} plan no longer covers everything it was running, so Cira switched off what costs money by the hour:`,
      items.join("; ") + ".",
      "Nothing was deleted. Each can be switched back on from its app's page once the plan allows it.",
    ],
    action: { label: "See the plan", href: space.billing },
    because: admin(space),
  });
}

export function paymentFailedMessage(args: { space: SpaceRef }): Message {
  const { space } = args;
  return letter({
    subject: `${space.name}: a payment for Cira did not go through`,
    paragraphs: [
      `The latest payment for ${space.name}'s Cira subscription did not go through.`,
      "Everything keeps running for now. Updating the card from Billing keeps it that way; Stripe will try the payment again.",
    ],
    action: { label: "Update the card", href: space.billing },
    because: admin(space),
  });
}

export function subscriptionEndedMessage(args: { space: SpaceRef }): Message {
  const { space } = args;
  return letter({
    subject: `${possessive(space.name)} Cira subscription has ended`,
    paragraphs: [
      `${possessive(space.name)} Cira subscription has ended.`,
      "Everything already deployed still opens, and nothing has been deleted. Deploying is paused, and workers, scheduled runs and warm apps are off, until someone subscribes again.",
    ],
    action: { label: "Subscribe again", href: space.billing },
    because: admin(space),
  });
}
