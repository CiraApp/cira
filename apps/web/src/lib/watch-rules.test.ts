import { describe, expect, it } from "vitest";
import { nextWatch } from "./watch-rules";

/** A blip is quiet, an outage is told once when it starts and once when it ends. */
describe("nextWatch", () => {
  const at = (minute: number) => new Date(Date.UTC(2026, 8, 19, 12, minute));

  it("lets one missed answer pass, and calls the second an outage from the first", () => {
    const first = nextWatch(null, false, at(0), 2);
    expect(first.event).toBeNull();
    const second = nextWatch(first.watched, false, at(5), 2);
    expect(second.event).toEqual({ kind: "down", since: at(0) });
    const third = nextWatch(second.watched, false, at(10), 2);
    expect(third.event).toBeNull();
    expect(third.watched).toEqual({ failures: 3, downSince: at(0) });
  });

  it("says it is back only after an outage, not after a blip", () => {
    const blip = nextWatch({ failures: 1, downSince: at(0) }, true, at(5), 2);
    expect(blip).toEqual({ watched: { failures: 0, downSince: null }, event: null });
    const back = nextWatch({ failures: 4, downSince: at(0) }, true, at(20), 2);
    expect(back.event).toEqual({ kind: "back", since: at(0) });
  });

  it("counts a worker's first failure, since each is already definite", () => {
    expect(nextWatch(null, false, at(0), 1).event).toEqual({
      kind: "down",
      since: at(0),
    });
    expect(nextWatch(null, true, at(0), 1).event).toBeNull();
  });
});
