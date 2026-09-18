import type Anthropic from "@anthropic-ai/sdk";

/**
 * What passes between the Ask Cira panel and `/api/ask`.
 *
 * Imported by both sides, so it holds types and plain values only - nothing
 * here may reach for a database, a secret or a server-only module.
 *
 * The conversation itself travels in the model's own message format and is
 * kept by the browser, not the server. Answers are built out of the company's
 * data, and Cira has only ever stored metadata about the software it runs;
 * holding the conversation in the tab that is showing it is what keeps that
 * true. Nothing is lost by it: every tool call is checked against the asking
 * person's permissions at the moment it runs, so an edited conversation can
 * only steer a model that acts as the person who edited it.
 */
export type AskMessage = Anthropic.MessageParam;

/** An app, as much as the panel needs to draw its tile and name it. */
export interface AskApp {
  id: string;
  name: string;
}

/**
 * Where one step has got to.
 *
 * `refused` is kept apart from `failed` because the two ask different things
 * of the person reading: a failure might be worth trying again, and a refusal
 * - an app that signs its own users in - never is.
 */
export type StepState = "running" | "done" | "failed" | "refused";

export type AskEvent =
  /** A piece of the answer, as it is written. */
  | { type: "text"; text: string }
  /**
   * A tool starting or finishing. Sent twice with the same id: once running,
   * once settled, so the panel can tick it off in place.
   */
  | {
      type: "step";
      id: string;
      state: StepState;
      /** Plain words, written by the server rather than the model. */
      label: string;
      /** A short aside beside the label: a count, a time. */
      detail?: string;
      app?: AskApp;
      /**
       * Exactly what the app returned, for "See the data". The model may have
       * been shown less than this; the person never is.
       */
      data?: string;
    }
  /** A write, stopped before it runs, waiting for a person. */
  | {
      type: "confirm";
      toolUseId: string;
      app: AskApp;
      /** "Create refund", from the capability's name. */
      action: string;
      description: string;
      input: Record<string, unknown>;
    }
  /** The whole conversation, for the browser to keep and send back next time. */
  | { type: "done"; messages: AskMessage[] }
  /** Something a person can act on. Never a stack trace. */
  | { type: "error"; message: string };

export type AskRequest =
  | { messages: AskMessage[]; question: string }
  | { messages: AskMessage[]; decision: { toolUseId: string; run: boolean } };

/** The longest question the box accepts. A paragraph, not a document. */
export const MAX_QUESTION_CHARS = 2000;
