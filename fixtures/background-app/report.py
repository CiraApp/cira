"""A scheduled run: does its work, says what it did, and exits. A non-zero
exit is a failed run, which is how Cira tells one from the other."""

import sys
from datetime import datetime, timezone


def main() -> int:
    now = datetime.now(timezone.utc)
    orders = [1250.00, 480.50, 99.99, 2310.00]
    print(f"weekly report at {now.isoformat()}", flush=True)
    print(f"{len(orders)} orders, {sum(orders):.2f} USD", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
