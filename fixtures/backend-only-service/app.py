"""An orders service with no web page: the fixture for API-only apps in Cira.

Deliberately ordinary, and deliberately written with nothing but the standard
library. There is no framework here for the capability analyzer to recognise -
no decorators, no router objects - only a table of routes near the bottom of
this file, which is the least convenient shape a real service could take and
so the most honest test of the claim that Cira reads any language.

Every route exists to put Cira into a particular state:

- the root answers JSON, so Cira decides there is no web page to open;
- unknown paths answer 404, so verification's control request can tell a real
  route from an invented one;
- four reads that verification will actually call, so they are safe to call;
- two writes that verification only asks about with OPTIONS;
- one read that always answers 401, so a capability lands in `refused`;
- /health and /__reset, which are not business operations and should not
  become capabilities.

State lives in memory and resets when the process restarts, or on
POST /__reset. Nothing here talks to a database or to anything outside itself.
"""

from __future__ import annotations

import copy
import json
import os
from datetime import date
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

# The orders the service starts with. Ids are real ones an example input can
# use: verification calls every read with its example, and /orders/lookup
# answers 404 for an id it does not know.
SEED_ORDERS = [
    {"order_id": "ord_1001", "customer": "Acme Freight", "total": 1250.00, "status": "paid", "placed": "2026-08-03"},
    {"order_id": "ord_1002", "customer": "Northwind Health", "total": 480.50, "status": "paid", "placed": "2026-08-11"},
    {"order_id": "ord_1003", "customer": "Acme Freight", "total": 99.99, "status": "pending", "placed": "2026-08-19"},
    {"order_id": "ord_1004", "customer": "Orbital Foods", "total": 2310.00, "status": "paid", "placed": "2026-08-27"},
    {"order_id": "ord_1005", "customer": "Kestrel Air", "total": 64.00, "status": "refunded", "placed": "2026-09-02"},
    {"order_id": "ord_1006", "customer": "Northwind Health", "total": 715.25, "status": "paid", "placed": "2026-09-09"},
]

ORDER_STATUSES = ("paid", "pending", "refunded")
REPORTS = ("daily-sales", "refunds", "top-customers")

state: dict = {}


def reset() -> None:
    state["orders"] = copy.deepcopy(SEED_ORDERS)
    state["refunds"] = []
    state["reports"] = {name: 1 for name in REPORTS}


reset()


class Problem(Exception):
    """A request the service understood and will not do, and why."""

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def one(query: dict, name: str) -> str | None:
    values = query.get(name)
    return values[0].strip() if values else None


def whole_number(raw: str | None, name: str, default: int, most: int) -> int:
    if raw is None or raw == "":
        return default
    try:
        value = int(raw)
    except ValueError:
        raise Problem(400, f"{name} must be a whole number") from None
    if value < 1 or value > most:
        raise Problem(400, f"{name} must be between 1 and {most}")
    return value


def iso_date(raw: str | None, name: str) -> date:
    if raw is None or raw == "":
        raise Problem(400, f"{name} is required, as YYYY-MM-DD")
    try:
        return date.fromisoformat(raw)
    except ValueError:
        raise Problem(400, f"{name} must be a date as YYYY-MM-DD") from None


def find(order_id: str | None) -> dict:
    if order_id is None or order_id == "":
        raise Problem(400, "order_id is required")
    for order in state["orders"]:
        if order["order_id"] == order_id:
            return order
    raise Problem(404, f"No order {order_id}")


# ---- reads -------------------------------------------------------------------


def describe(_query: dict, _body: dict) -> tuple[int, dict]:
    """What this is. JSON on purpose: there is no web page here to open."""
    return 200, {
        "service": "orders",
        "description": "Orders, refunds and revenue for the sales team.",
        "web_interface": False,
    }


def health(_query: dict, _body: dict) -> tuple[int, dict]:
    return 200, {"ok": True}


def list_orders(query: dict, _body: dict) -> tuple[int, dict]:
    """Orders, newest first. Optional `status` and `limit`."""
    status = one(query, "status")
    if status not in (None, "") and status not in ORDER_STATUSES:
        raise Problem(400, f"status must be one of {', '.join(ORDER_STATUSES)}")
    limit = whole_number(one(query, "limit"), "limit", default=20, most=100)

    orders = [o for o in state["orders"] if not status or o["status"] == status]
    orders.sort(key=lambda o: o["placed"], reverse=True)
    return 200, {"orders": orders[:limit], "total": len(orders)}


def lookup_order(query: dict, _body: dict) -> tuple[int, dict]:
    """One order by `order_id`. 404 when there is no such order."""
    return 200, {"order": find(one(query, "order_id"))}


def revenue(query: dict, _body: dict) -> tuple[int, dict]:
    """Revenue from orders placed between `start` and `end`, inclusive."""
    start = iso_date(one(query, "start"), "start")
    end = iso_date(one(query, "end"), "end")
    if end < start:
        raise Problem(400, "end must not be before start")

    counted = [
        o
        for o in state["orders"]
        if o["status"] != "refunded" and start <= date.fromisoformat(o["placed"]) <= end
    ]
    return 200, {
        "start": start.isoformat(),
        "end": end.isoformat(),
        "currency": "USD",
        "orders": len(counted),
        "revenue": round(sum(o["total"] for o in counted), 2),
    }


def top_customers(query: dict, _body: dict) -> tuple[int, dict]:
    """Customers by what they have spent, refunds excluded. Optional `limit`."""
    limit = whole_number(one(query, "limit"), "limit", default=5, most=50)
    spend: dict[str, float] = {}
    for order in state["orders"]:
        if order["status"] != "refunded":
            spend[order["customer"]] = spend.get(order["customer"], 0) + order["total"]
    ranked = sorted(spend.items(), key=lambda item: item[1], reverse=True)[:limit]
    return 200, {
        "customers": [{"customer": name, "spend": round(total, 2)} for name, total in ranked],
    }


def audit(_query: dict, _body: dict) -> tuple[int, dict]:
    """The admin audit log. Always refused: it needs a session Cira cannot have."""
    raise Problem(401, "The audit log needs an administrator to sign in.")


# ---- writes ------------------------------------------------------------------


def refund_order(_query: dict, body: dict) -> tuple[int, dict]:
    """Refund an order. Takes `order_id` and an optional `reason`."""
    order = find(body.get("order_id") if isinstance(body.get("order_id"), str) else None)
    if order["status"] == "refunded":
        raise Problem(409, f"{order['order_id']} has already been refunded")

    order["status"] = "refunded"
    refund = {
        "order_id": order["order_id"],
        "amount": order["total"],
        "reason": body.get("reason") if isinstance(body.get("reason"), str) else None,
    }
    state["refunds"].append(refund)
    return 200, {"refund": refund, "order": order}


def regenerate_report(_query: dict, body: dict) -> tuple[int, dict]:
    """Rebuild one of the named reports. Takes `report`, which must be known."""
    report = body.get("report")
    if report not in REPORTS:
        raise Problem(400, f"report must be one of {', '.join(REPORTS)}")
    state["reports"][report] += 1
    return 200, {"report": report, "version": state["reports"][report]}


def reset_state(_query: dict, _body: dict) -> tuple[int, dict]:
    """Put the seed data back. For tests; harmless if anything else calls it."""
    reset()
    return 200, {"reset": True}


# ---- routing -------------------------------------------------------------------

ROUTES = {
    "/": {"GET": describe},
    "/health": {"GET": health},
    "/orders": {"GET": list_orders},
    "/orders/lookup": {"GET": lookup_order},
    "/revenue": {"GET": revenue},
    "/customers/top": {"GET": top_customers},
    "/admin/audit": {"GET": audit},
    "/orders/refund": {"POST": refund_order},
    "/reports/regenerate": {"POST": regenerate_report},
    "/__reset": {"POST": reset_state},
}


class Handler(BaseHTTPRequestHandler):
    server_version = "orders/1"

    def do_GET(self) -> None:
        self.dispatch("GET")

    def do_POST(self) -> None:
        self.dispatch("POST")

    def do_PUT(self) -> None:
        self.dispatch("PUT")

    def do_DELETE(self) -> None:
        self.dispatch("DELETE")

    def do_OPTIONS(self) -> None:
        # Which methods a path serves, without doing anything: the answer Cira
        # uses to confirm a write exists without ever performing it.
        path = urlparse(self.path).path
        methods = ROUTES.get(path)
        if methods is None:
            self.reply(404, {"error": "Not found"})
            return
        self.reply(405, {"error": "Method not allowed"}, allow=", ".join(sorted(methods)))

    def dispatch(self, method: str) -> None:
        parsed = urlparse(self.path)
        methods = ROUTES.get(parsed.path)
        if methods is None:
            self.reply(404, {"error": "Not found"})
            return

        handler = methods.get(method)
        if handler is None:
            self.reply(405, {"error": "Method not allowed"}, allow=", ".join(sorted(methods)))
            return

        try:
            body = self.read_body() if method in ("POST", "PUT") else {}
            status, payload = handler(parse_qs(parsed.query), body)
        except Problem as problem:
            extra = {"www_authenticate": 'Bearer realm="orders"'} if problem.status == 401 else {}
            self.reply(problem.status, {"error": problem.message}, **extra)
            return
        self.reply(status, payload)

    def read_body(self) -> dict:
        length = int(self.headers.get("content-length") or 0)
        if length == 0:
            return {}
        try:
            parsed = json.loads(self.rfile.read(length))
        except json.JSONDecodeError:
            raise Problem(400, "The body must be JSON") from None
        if not isinstance(parsed, dict):
            raise Problem(400, "The body must be a JSON object")
        return parsed

    def reply(self, status: int, payload: dict, allow: str | None = None, www_authenticate: str | None = None) -> None:
        data = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        if allow is not None:
            self.send_header("allow", allow)
        if www_authenticate is not None:
            self.send_header("www-authenticate", www_authenticate)
        self.end_headers()
        self.wfile.write(data)


def main() -> None:
    port = int(os.environ.get("PORT", "8080"))
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"orders service on :{port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
