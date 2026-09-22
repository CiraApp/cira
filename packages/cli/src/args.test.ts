import { describe, expect, it } from "vitest";
import { unknownArgument } from "./args.js";

/**
 * A command that changes something runs only with arguments it understands.
 * `cira deploy --help` used to deploy, and a typo in `--space` would have
 * published into whichever space came first.
 */
describe("unknownArgument", () => {
  it("lets through every flag deploy documents, both ways of giving a value", () => {
    expect(
      unknownArgument("deploy", [
        "--space",
        "acme",
        "--env=API=1",
        "--env",
        "B=2",
        "--unset",
        "OLD",
        "--no-env",
        "--yes",
        "--dockerfile=apps/api/Dockerfile",
      ]),
    ).toBeNull();
  });

  it("stops at a typo, a stray word, or a flag another command takes", () => {
    expect(unknownArgument("deploy", ["--spcae", "acme"])).toBe("--spcae");
    expect(unknownArgument("deploy", ["apps/web"])).toBe("apps/web");
    expect(unknownArgument("deploy", ["--app", "x"])).toBe("--app");
    expect(unknownArgument("remove", ["--app", "x", "--confirm", "X"])).toBeNull();
  });

  it("leaves commands with their own arguments alone", () => {
    expect(unknownArgument("skill", ["install"])).toBeNull();
  });
});
