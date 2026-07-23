#!/usr/bin/env python3
"""Cowork worker CLI for workout-feedback drafts.

Does ONLY the queue I/O over two HTTP endpoints — the model (Cowork, on the
subscription) does the generation in between. Writes go through /submit, which runs
the server-side fact-check; this script never touches the database directly.

Env (set once, see the skill's setup doc):
  FEEDBACK_WORKER_URL     base URL, e.g. https://your-app.vercel.app/api/feedback/worker
  FEEDBACK_WORKER_SECRET  the shared bearer secret (same value as in Vercel)

Usage:
  python feedback_worker.py claim  --limit 5
  python feedback_worker.py submit --job <jobId> --text-file draft.txt
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.request


def die(msg: str) -> None:
    print(f"ERROR: {msg}", file=sys.stderr)
    sys.exit(1)


def _config(key: str) -> str:
    """Read a setting from the environment, falling back to a `worker.env` file
    (KEY=VALUE lines) next to this script — so Igor only has to fill one file."""
    val = os.environ.get(key, "").strip()
    if val:
        return val
    env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "worker.env")
    try:
        with open(env_path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, _, v = line.partition("=")
                if k.strip() == key:
                    return v.strip().strip('"').strip("'")
    except FileNotFoundError:
        pass
    return ""


def _base_url() -> str:
    url = _config("FEEDBACK_WORKER_URL").rstrip("/")
    if not url:
        die("FEEDBACK_WORKER_URL is not set — fill it in worker.env (see references/setup.md)")
    return url


def _secret() -> str:
    s = _config("FEEDBACK_WORKER_SECRET")
    if not s:
        die("FEEDBACK_WORKER_SECRET is not set — fill it in worker.env (see references/setup.md)")
    return s


def _post(path: str, payload: dict) -> dict:
    req = urllib.request.Request(
        _base_url() + path,
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": "Bearer " + _secret(),
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        die(f"HTTP {e.code} from {path}: {body[:400]}")
    except urllib.error.URLError as e:
        die(f"cannot reach {path}: {e}")
    return {}  # unreachable (die exits)


def cmd_claim(args: argparse.Namespace) -> None:
    res = _post("/claim", {"limit": args.limit})
    jobs = res.get("jobs", [])
    print(f"# claimed {res.get('claimed', 0)} job(s), reclaimed {res.get('reclaimed', 0)} stale", file=sys.stderr)
    # stdout = the machine-readable batch the model reads and generates from
    print(json.dumps(res, ensure_ascii=False, indent=2))
    if not jobs:
        print("# queue is empty — nothing to generate", file=sys.stderr)


def cmd_submit(args: argparse.Namespace) -> None:
    with open(args.text_file, encoding="utf-8") as f:
        text = f.read().strip()
    if not text:
        die(f"draft file {args.text_file} is empty")
    res = _post("/submit", {"jobId": args.job, "draftText": text})
    status = res.get("status", "?")
    if status == "done":
        print(f"# {args.job}: DONE (fact-check passed)", file=sys.stderr)
    elif status == "failed":
        print(f"# {args.job}: FAILED fact-check — {res.get('reason', '')}", file=sys.stderr)
    print(json.dumps(res, ensure_ascii=False, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser(description="Cowork feedback-draft worker")
    sub = parser.add_subparsers(dest="command", required=True)

    p_claim = sub.add_parser("claim", help="claim a batch of pending jobs (returns prompts)")
    p_claim.add_argument("--limit", type=int, default=5, help="max jobs this pass (server caps at 10)")
    p_claim.set_defaults(func=cmd_claim)

    p_submit = sub.add_parser("submit", help="submit one generated draft (runs fact-check)")
    p_submit.add_argument("--job", required=True, help="jobId from claim")
    p_submit.add_argument("--text-file", required=True, help="file holding the generated draft text")
    p_submit.set_defaults(func=cmd_submit)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
