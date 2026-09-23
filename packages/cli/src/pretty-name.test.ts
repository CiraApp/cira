import { describe, expect, it } from "vitest";
import { prettyName } from "./deploy.js";

describe("prettyName", () => {
  it("keeps the acronyms internal tools are named with", () => {
    expect(prettyName("dispatch-api")).toBe("Dispatch API");
    expect(prettyName("hr_crm-ui")).toBe("HR CRM UI");
  });

  it("capitalises everything else as words, and never leaves a name empty", () => {
    expect(prettyName("fleet-board")).toBe("Fleet Board");
    expect(prettyName("idle-report")).toBe("Idle Report");
    expect(prettyName("--")).toBe("App");
  });
});
