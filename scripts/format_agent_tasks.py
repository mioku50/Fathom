#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description="Format agent_tasks.json deterministically.")
    parser.add_argument("path", nargs="?", default="agent_tasks.json")
    parser.add_argument("--check", action="store_true", help="Fail if formatting would change.")
    args = parser.parse_args()

    path = Path(args.path)
    original = path.read_text(encoding="utf-8")
    parsed = json.loads(original)
    formatted = json.dumps(parsed, ensure_ascii=False, indent=2) + "\n"

    if args.check:
        if original != formatted:
            print(f"{path} is not formatted. Run: python scripts/format_agent_tasks.py {path}")
            return 1
        print(f"{path} formatting is OK")
        return 0

    if original != formatted:
        path.write_text(formatted, encoding="utf-8")
        print(f"{path} formatted")
    else:
        print(f"{path} already formatted")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
