import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_API_URL, readConfig } from "./config.js";

let home: string;

function storeConfig(config: Record<string, unknown>): void {
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, "config.json"), JSON.stringify(config));
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "cira-config-"));
  process.env["CIRA_HOME"] = home;
  delete process.env["CIRA_API_URL"];
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  delete process.env["CIRA_HOME"];
  delete process.env["CIRA_API_URL"];
});

describe("readConfig", () => {
  it("defaults to Cira's own domain", () => {
    expect(readConfig().apiUrl).toBe("https://cira.dev");
    expect(DEFAULT_API_URL).toBe("https://cira.dev");
  });

  // Nobody should have to run anything to stop talking to a hostname that
  // reads like a scratch project. The token travels unchanged - it is the same
  // deployment behind both names.
  it("moves a config off the old hostname, keeping the token", () => {
    storeConfig({
      apiUrl: "https://cira-aumitshiv.vercel.app",
      token: "cli_abc",
      email: "someone@example.com",
    });

    const config = readConfig();
    expect(config.apiUrl).toBe("https://cira.dev");
    expect(config.token).toBe("cli_abc");
    expect(config.email).toBe("someone@example.com");
  });

  // Somebody pointing at a preview build or a local instance meant it.
  it("leaves a URL someone chose on purpose alone", () => {
    storeConfig({ apiUrl: "http://localhost:3000", token: "cli_abc" });
    expect(readConfig().apiUrl).toBe("http://localhost:3000");
  });

  it("lets the environment override anything stored", () => {
    storeConfig({ apiUrl: "https://cira-aumitshiv.vercel.app" });
    process.env["CIRA_API_URL"] = "https://preview.example";
    expect(readConfig().apiUrl).toBe("https://preview.example");
  });
});
