"""A worker with no web port: it runs until stopped, doing a little work on a
timer and saying so, which is what makes it visible in Cira's logs."""

import os
import time
from datetime import datetime, timezone

EVERY = int(os.environ.get("HEARTBEAT_SECONDS", "30"))


def main() -> None:
    print("worker started", flush=True)
    beat = 0
    while True:
        beat += 1
        print(f"heartbeat {beat} at {datetime.now(timezone.utc).isoformat()}", flush=True)
        time.sleep(EVERY)


if __name__ == "__main__":
    main()
