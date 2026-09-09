"""Demo authentication: HMAC-signed tokens, stdlib only.

This is exercise-grade auth for the MVP — it proves the token plumbing
(frontend attaches Bearer tokens, backend verifies and audits) without a user
database. Replace issue/verify with a real identity provider in Phase 2.
Set DOIP_SECRET in the environment for anything beyond localhost.
"""

import base64
import hashlib
import hmac
import json
import os
import time

SECRET = os.environ.get("DOIP_SECRET", "doip-demo-secret-change-me").encode()
ROLES = {"admin", "planner", "operator", "viewer"}


def issue(role: str, user_name: str) -> str:
    payload = json.dumps({"role": role, "name": user_name, "iat": int(time.time())}).encode()
    body = base64.urlsafe_b64encode(payload).rstrip(b"=")
    sig = base64.urlsafe_b64encode(hmac.new(SECRET, body, hashlib.sha256).digest()).rstrip(b"=")
    return (body + b"." + sig).decode()


def verify(token: str) -> dict | None:
    try:
        body, sig = token.encode().split(b".")
        expect = base64.urlsafe_b64encode(hmac.new(SECRET, body, hashlib.sha256).digest()).rstrip(b"=")
        if not hmac.compare_digest(sig, expect):
            return None
        return json.loads(base64.urlsafe_b64decode(body + b"=="))
    except Exception:
        return None
