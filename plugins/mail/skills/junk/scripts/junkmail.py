#!/usr/bin/env python3
"""Junk-mail triage helper for Microsoft Graph. Stdlib-only, Python 3.8+.

Auth mirrors the freeagent plugin's outlook.py: device-code flow against a
public client, token cached on disk. Any Graph device-code cache holding
Mail.ReadWrite works.

  MSGRAPH_CLIENT_ID     app registration (default: Graph PowerShell public client)
  MSGRAPH_TENANT        default: organizations
  MSGRAPH_TOKEN_CACHE   explicit cache path; otherwise ~/.config/mail/, then
                        ~/.config/freeagent/ (shared mailbox grant)

Commands:
  login                     device-code flow, cache the tokens
  whoami                    signed-in user
  junk [--top N]            list Junk Email messages as JSON (read-only)
  rescue ID...              move messages to the Inbox
  delete ID...              mark read, then move to Deleted Items (recoverable)
  readsweep                 mark every unread message in Archive and
                            Deleted Items as read; prints counts
  unsub ID...               attempt unsubscribe from the List-Unsubscribe
                            header: RFC 8058 one-click POST preferred, plain
                            https GET as fallback, mailto reported only

This script does transport. Classification judgement, the personal rules
file, and the approval gate live in the skill.
"""

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

DEFAULT_CLIENT = "14d82eec-204b-4c2f-b7e8-296a70dab67e"
GRAPH = "https://graph.microsoft.com/v1.0"
SCOPE = "offline_access User.Read Mail.ReadWrite"
TOKEN_LEEWAY = 120


def client_id() -> str:
    return os.environ.get("MSGRAPH_CLIENT_ID", DEFAULT_CLIENT)


def login_base() -> str:
    tenant = os.environ.get("MSGRAPH_TENANT", "organizations")
    return f"https://login.microsoftonline.com/{tenant}/oauth2/v2.0"


def cache_path() -> Path:
    explicit = os.environ.get("MSGRAPH_TOKEN_CACHE")
    if explicit:
        return Path(explicit)
    own = Path.home() / ".config" / "mail" / "msgraph-token.json"
    if own.exists():
        return own
    shared = Path.home() / ".config" / "freeagent" / "msgraph-token.json"
    if shared.exists():
        return shared
    return own


def _post_form(url: str, fields: dict) -> dict:
    data = urllib.parse.urlencode(fields).encode()
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as err:
        try:
            return json.loads(err.read().decode())
        except json.JSONDecodeError:
            sys.exit(f"error: POST {url} -> {err.code} {err.reason}")


def _read_cache() -> dict:
    p = cache_path()
    if p.exists():
        try:
            return json.loads(p.read_text())
        except json.JSONDecodeError:
            return {}
    return {}


def _write_cache(body: dict) -> None:
    p = cache_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps({
        "access_token": body["access_token"],
        "refresh_token": body.get("refresh_token", _read_cache().get("refresh_token")),
        "expires_at": int(time.time()) + int(body.get("expires_in", 3600)),
    }))
    try:
        p.chmod(0o600)
    except OSError:
        pass


def access_token() -> str:
    cache = _read_cache()
    if cache.get("access_token") and cache.get("expires_at", 0) - TOKEN_LEEWAY > time.time():
        return cache["access_token"]
    refresh = cache.get("refresh_token")
    if not refresh:
        sys.exit("error: no cached token — run:  junkmail.py login")
    body = _post_form(login_base() + "/token", {
        "grant_type": "refresh_token",
        "client_id": client_id(),
        "refresh_token": refresh,
        "scope": SCOPE,
    })
    if "access_token" not in body:
        sys.exit(f"error: token refresh failed: {body.get('error_description', body)}")
    _write_cache(body)
    return body["access_token"]


def graph(method: str, path: str, payload: dict = None) -> dict:
    req = urllib.request.Request(GRAPH + path, method=method)
    req.add_header("Authorization", f"Bearer {access_token()}")
    data = None
    if payload is not None:
        data = json.dumps(payload).encode()
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, data=data, timeout=30) as resp:
            raw = resp.read().decode()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as err:
        sys.exit(f"error: {method} {path} -> {err.code} {err.read().decode()[:400]}")


def cmd_login(_args) -> None:
    body = _post_form(login_base() + "/devicecode",
                      {"client_id": client_id(), "scope": SCOPE})
    print(body["message"], flush=True)
    interval = int(body.get("interval", 5))
    while True:
        time.sleep(interval)
        token = _post_form(login_base() + "/token", {
            "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
            "client_id": client_id(),
            "device_code": body["device_code"],
        })
        if "access_token" in token:
            _write_cache(token)
            print("login complete; token cached at", cache_path())
            return
        if token.get("error") not in ("authorization_pending", "slow_down"):
            sys.exit(f"error: {token.get('error_description', token)}")


def cmd_whoami(_args) -> None:
    me = graph("GET", "/me?$select=displayName,mail,userPrincipalName")
    print(me.get("displayName"), "<%s>" % (me.get("mail") or me.get("userPrincipalName")))


def cmd_junk(args) -> None:
    fields = "id,receivedDateTime,isRead,subject,bodyPreview,from"
    data = graph("GET",
                 f"/me/mailFolders/junkemail/messages?$top={args.top}"
                 f"&$select={fields}&$orderby=receivedDateTime%20desc")
    out = []
    for m in data.get("value", []):
        sender = (m.get("from") or {}).get("emailAddress", {})
        out.append({
            "id": m["id"],
            "received": m.get("receivedDateTime"),
            "read": m.get("isRead"),
            "from": sender.get("address"),
            "fromName": sender.get("name"),
            "subject": m.get("subject"),
            "preview": (m.get("bodyPreview") or "")[:200],
        })
    print(json.dumps(out, indent=2))


def cmd_rescue(args) -> None:
    for mid in args.ids:
        graph("POST", f"/me/messages/{mid}/move", {"destinationId": "inbox"})
    print(f"rescued {len(args.ids)} to Inbox")


def cmd_delete(args) -> None:
    # Read first, then move: a message deleted unread leaves an unread badge
    # on Deleted Items, which is the noise this flow exists to remove.
    for mid in args.ids:
        graph("PATCH", f"/me/messages/{mid}", {"isRead": True})
        graph("POST", f"/me/messages/{mid}/move", {"destinationId": "deleteditems"})
    print(f"deleted {len(args.ids)} (marked read, moved to Deleted Items — recoverable)")


def _external(url: str, method: str, data: bytes = None, headers: dict = None) -> int:
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("User-Agent", "Mozilla/5.0 (junk-triage unsubscribe)")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return resp.status
    except urllib.error.HTTPError as err:
        return err.code
    except (urllib.error.URLError, TimeoutError):
        return -1


def cmd_unsub(args) -> None:
    for mid in args.ids:
        msg = graph("GET", f"/me/messages/{mid}?$select=subject,internetMessageHeaders")
        headers = {h["name"].lower(): h["value"]
                   for h in msg.get("internetMessageHeaders", [])}
        subject = (msg.get("subject") or "")[:50]
        raw = headers.get("list-unsubscribe")
        if not raw:
            print(f"none\t{subject}\tno List-Unsubscribe header")
            continue
        targets = [t.strip().strip("<>") for t in raw.split(",")]
        https = next((t for t in targets if t.startswith("https://")), None)
        one_click = "one-click" in headers.get("list-unsubscribe-post", "").lower()
        if https and one_click:
            code = _external(https, "POST", b"List-Unsubscribe=One-Click",
                             {"Content-Type": "application/x-www-form-urlencoded"})
            print(f"post {code}\t{subject}\t{https[:80]}")
        elif https:
            code = _external(https, "GET")
            print(f"get {code}\t{subject}\t{https[:80]}")
        else:
            print(f"mailto\t{subject}\t{targets[0][:80]} (not sent)")


def cmd_readsweep(_args) -> None:
    for folder in ("archive", "deleteditems"):
        total = 0
        while True:
            data = graph("GET",
                         f"/me/mailFolders/{folder}/messages"
                         f"?$filter=isRead%20eq%20false&$top=50&$select=id")
            batch = data.get("value", [])
            if not batch:
                break
            for m in batch:
                graph("PATCH", f"/me/messages/{m['id']}", {"isRead": True})
            total += len(batch)
        print(f"{folder}: {total} marked read")


def main() -> None:
    parser = argparse.ArgumentParser(prog="junkmail.py")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("login").set_defaults(func=cmd_login)
    sub.add_parser("whoami").set_defaults(func=cmd_whoami)
    p = sub.add_parser("junk")
    p.add_argument("--top", type=int, default=50)
    p.set_defaults(func=cmd_junk)
    p = sub.add_parser("rescue")
    p.add_argument("ids", nargs="+")
    p.set_defaults(func=cmd_rescue)
    p = sub.add_parser("delete")
    p.add_argument("ids", nargs="+")
    p.set_defaults(func=cmd_delete)
    p = sub.add_parser("unsub")
    p.add_argument("ids", nargs="+")
    p.set_defaults(func=cmd_unsub)
    sub.add_parser("readsweep").set_defaults(func=cmd_readsweep)
    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
