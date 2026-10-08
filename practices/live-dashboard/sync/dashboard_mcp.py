#!/usr/bin/env python3
"""Local MCP server for the Dashboard artifact (stdio, standard library only).

Tool: release_status - runs your release check (release_state.py, same folder; see README) and
returns only what the Dashboard needs: the release branch, the drifted repositories with their
reasons, and how many are synced. Read-only: it only calls `gh api` GET endpoints.

Register in Claude desktop (Settings > Developer > Edit Config) under "mcpServers" as "dashboard".
"""
from __future__ import annotations

import json
import os
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

sys.dont_write_bytecode = True  # keep the vault free of __pycache__ folders
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
# Claude desktop starts servers with a short PATH; gh usually lives in Homebrew.
os.environ["PATH"] = os.pathsep.join(["/opt/homebrew/bin", "/usr/local/bin", os.environ.get("PATH", "/usr/bin:/bin")])

CACHE_SECONDS = 90
_lock = threading.Lock()
_cache: dict = {"at": 0.0, "value": None}


def log(*a):
    print("[dashboard-mcp]", *a, file=sys.stderr, flush=True)


def release_report() -> dict:
    import release_state as rs  # imported lazily so a broken script never stops the server

    branch = rs.release_branch()
    entries = rs.matrix()

    def read(e):
        try:
            return rs.read_repo(e, branch, False)
        except Exception as ex:  # one unreadable repository should not hide the others
            return {"repo": e.get("repo", "?"), "error": str(ex)[:200], "envs": {"staging": None}}

    with ThreadPoolExecutor(max_workers=8) as pool:
        rows = list(pool.map(read, entries))
    judged = [r for r in rows if "staging" in r["envs"] or "production" in r["envs"]]
    drifted, synced = [], 0
    for r in judged:
        reasons = [f"could not read: {r['error']}"] if "error" in r else rs.drift(r)
        if reasons:
            drifted.append({"repo": r["repo"], "reasons": reasons})
        else:
            synced += 1
    return {
        "branch": branch,
        "checkedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "total": len(judged),
        "synced": synced,
        "drifted": sorted(drifted, key=lambda d: d["repo"]),
    }


def cached_report() -> dict:
    with _lock:  # concurrent calls share one run
        if _cache["value"] and time.time() - _cache["at"] < CACHE_SECONDS:
            return _cache["value"]
        value = release_report()
        _cache.update(at=time.time(), value=value)
        return value


TOOLS = [{
    "name": "release_status",
    "title": "Release status",
    "description": "Which release-matrix repositories have drifted from the release branch "
                   "(main ahead, deploy pending or failed, staging/production not on the release head), "
                   "with reasons, plus the count of synced repositories. Read-only.",
    "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
    "annotations": {"readOnlyHint": True, "openWorldHint": True},
}]


def handle(msg: dict):
    method, mid = msg.get("method"), msg.get("id")
    if method == "initialize":
        ver = (msg.get("params") or {}).get("protocolVersion") or "2025-06-18"
        return {"protocolVersion": ver, "capabilities": {"tools": {}},
                "serverInfo": {"name": "dashboard", "version": "1.0.0"}}
    if method == "ping":
        return {}
    if method == "tools/list":
        return {"tools": TOOLS}
    if method == "tools/call":
        name = (msg.get("params") or {}).get("name")
        if name != "release_status":
            raise LookupError(f"unknown tool {name}")
        try:
            report = cached_report()
            return {"content": [{"type": "text", "text": json.dumps(report)}], "structuredContent": report, "isError": False}
        except Exception as ex:
            log("release_status failed:", ex)
            return {"content": [{"type": "text", "text": f"Release check failed: {str(ex)[:300]}"}], "isError": True}
    if mid is None:
        return None  # notification
    raise LookupError(f"method not found: {method}")


def send(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def serve():
    out_lock = threading.Lock()

    def work(msg):
        mid = msg.get("id")
        try:
            result = handle(msg)
            if mid is not None:
                with out_lock:
                    send({"jsonrpc": "2.0", "id": mid, "result": result})
        except LookupError as ex:
            if mid is not None:
                with out_lock:
                    send({"jsonrpc": "2.0", "id": mid, "error": {"code": -32601, "message": str(ex)}})
        except Exception as ex:
            if mid is not None:
                with out_lock:
                    send({"jsonrpc": "2.0", "id": mid, "error": {"code": -32603, "message": str(ex)[:300]}})

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except ValueError:
            continue
        # tool calls can take a while; answer them on a thread so pings still get through
        if msg.get("method") == "tools/call":
            threading.Thread(target=work, args=(msg,), daemon=True).start()
        else:
            work(msg)


if __name__ == "__main__":
    serve()
