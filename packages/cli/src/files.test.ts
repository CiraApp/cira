import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { collectFiles } from "./files";

/**
 * What a deploy sends, from a real folder on disk. The rule is that it is
 * what the build would be sent anyway - by git for a buildpacks build, by
 * `docker build` for a Dockerfile - minus anything that holds a credential.
 */

function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "cira-files-"));
  for (const [path, body] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body);
  }
  return root;
}

const sent = (root: string, style?: "dockerfile" | "buildpacks") =>
  collectFiles(root, style).files.map((f) => f.path);

describe("collectFiles", () => {
  it("honours .gitignore, including one in a subdirectory", () => {
    const root = project({
      ".gitignore": "data/\n*.csv\n",
      "app.py": "print(1)",
      "data/big.parquet": "x",
      "report.csv": "a,b",
      "api/.gitignore": "fixtures.json\n",
      "api/main.py": "x",
      "api/fixtures.json": "{}",
    });
    expect(sent(root)).toEqual([".gitignore", "api/.gitignore", "api/main.py", "app.py"]);
  });

  it("holds back files that hold credentials, and says which", () => {
    const root = project({
      "app.py": "x",
      ".streamlit/secrets.toml": 'API_KEY = "sk-live"',
      "config/master.key": "abc",
      "credentials.json": "{}",
      ".npmrc": "//registry/:_authToken=t",
      "deploy/key.pem":
        "-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----",
    });
    const walked = collectFiles(root);
    expect(walked.files.map((f) => f.path)).toEqual(["app.py"]);
    expect(walked.withheld).toEqual([
      ".npmrc",
      ".streamlit/secrets.toml",
      "config/master.key",
      "credentials.json",
      "deploy/key.pem",
    ]);
  });

  it("sends a certificate that holds no private key", () => {
    // A database's CA bundle is public, and the app cannot connect without it.
    const root = project({
      "app.py": "x",
      "certs/rds-ca.pem": "-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----",
    });
    expect(sent(root)).toEqual(["app.py", "certs/rds-ca.pem"]);
  });

  it("sends a withheld file when .ciraignore insists on it", () => {
    const root = project({
      ".ciraignore": "!config/master.key\nnotes/\n",
      "app.rb": "x",
      "config/master.key": "abc",
      "notes/todo.md": "x",
    });
    const walked = collectFiles(root);
    expect(walked.files.map((f) => f.path)).toEqual([
      ".ciraignore",
      "app.rb",
      "config/master.key",
    ]);
    expect(walked.withheld).toEqual([]);
  });

  it("sends build output a Dockerfile copies, and reads .dockerignore instead of .gitignore", () => {
    const root = project({
      Dockerfile: "FROM eclipse-temurin\nCOPY target/app.jar app.jar",
      ".gitignore": "target/\n",
      ".dockerignore": "docs/\n",
      "target/app.jar": "jar",
      "docs/readme.md": "x",
      "src/Main.java": "x",
    });
    expect(sent(root, "dockerfile")).toEqual([
      ".dockerignore",
      ".gitignore",
      "Dockerfile",
      "src/Main.java",
      "target/app.jar",
    ]);
  });

  it("leaves out build output for buildpacks, which make their own", () => {
    const root = project({ "pom.xml": "x", "target/app.jar": "jar", "src/A.java": "x" });
    expect(sent(root)).toEqual(["pom.xml", "src/A.java"]);
  });

  it("recognises a virtual environment by what Python puts in it, whatever it is called", () => {
    const root = project({
      "app.py": "x",
      "env/pyvenv.cfg": "home = /usr/bin",
      "env/lib/python3.12/site-packages/x.py": "x",
    });
    expect(sent(root)).toEqual(["app.py"]);
  });

  it("names the ignore files it honoured", () => {
    const root = project({ ".gitignore": "x", ".ciraignore": "y", "a.py": "" });
    expect(collectFiles(root).ignoreFiles.sort()).toEqual([".ciraignore", ".gitignore"]);
  });
});
