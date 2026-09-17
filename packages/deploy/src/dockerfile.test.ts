import { describe, expect, it } from "vitest";
import { isRootDockerfile, readDockerfile } from "./dockerfile.js";

describe("readDockerfile", () => {
  /**
   * Wave's own, which is what this exists for. Its entrypoint hardcodes 8000,
   * so Cira has to name 8000 or nothing ever reaches it.
   */
  it("reads the port Wave's image says it listens on", () => {
    const spec = readDockerfile(`FROM python:3.12-slim
WORKDIR /app
COPY . .
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
`);
    expect(spec.port).toBe(8000);
  });

  it("copes with how EXPOSE is actually written", () => {
    expect(readDockerfile("EXPOSE 3000/tcp").port).toBe(3000);
    expect(readDockerfile("  expose   5000  ").port).toBe(5000);
    expect(readDockerfile("FROM x\n\nEXPOSE 9090\n").port).toBe(9090);
  });

  // Several ports is the image talking about more than the one thing Cloud Run
  // can route to. The first is the only defensible reading.
  it("takes the first of several", () => {
    expect(readDockerfile("EXPOSE 8000 9000").port).toBe(8000);
  });

  it("says nothing rather than guessing", () => {
    for (const text of [
      'FROM alpine\nCMD ["sh"]',
      "EXPOSE ${PORT}",
      "EXPOSE not-a-port",
      "EXPOSE 0",
      "EXPOSE 70000",
      "",
      "# EXPOSE 8000 is commented out",
    ]) {
      expect(readDockerfile(text).port, JSON.stringify(text)).toBeNull();
    }
  });

  it("is not fooled by the word appearing elsewhere", () => {
    expect(readDockerfile('RUN echo "EXPOSE 1234" > /tmp/x').port).toBeNull();
    expect(readDockerfile("LABEL exposes=8000").port).toBeNull();
  });
});

describe("isRootDockerfile", () => {
  // Only the one a build would use. A Dockerfile inside a subdirectory belongs
  // to something else, and building from it would be building the wrong thing.
  it("is only the one at the root", () => {
    expect(isRootDockerfile("Dockerfile")).toBe(true);
    expect(isRootDockerfile("apps/api/Dockerfile")).toBe(false);
    expect(isRootDockerfile("docker/Dockerfile")).toBe(false);
    expect(isRootDockerfile("Dockerfile.dev")).toBe(false);
    expect(isRootDockerfile("dockerfile")).toBe(false);
  });
});
