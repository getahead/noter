#!/usr/bin/env python3
"""Live transcription lag of one captured call (`cpt-noter-dod-core-engine-capture-latency`, Q4).

Reads the engine's event lines (JSON Lines on stdout, as `noter-engine` writes them) and prints,
per segment state (hypothesis, confirmed) and per language, how long after the words were said
each segment line arrived: lag = line `at` - (`session_started` `at` + segment `t1_ms`).

    python3 engine/scripts/latency.py call.jsonl

Pass (Q4): p95 hypothesis <= 2000 ms and p95 confirmed <= 4000 ms. Exit code 0 when both hold.
"""

import json
import sys
from collections import defaultdict

BUDGET_MS = {"hypothesis": 2000, "confirmed": 4000}


def percentile(values, p):
    """Nearest-rank percentile.

    >>> percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)
    10
    >>> percentile([4, 1, 3], 50)
    3
    """
    ordered = sorted(values)
    return ordered[max(0, -(-len(ordered) * p // 100) - 1)]


def lags(lines):
    """(state, lang, lag ms) per segment line, timed from the session start."""
    start = None
    for line in lines:
        try:
            record = json.loads(line)
        except ValueError:
            continue
        event = record.get("event", {})
        if event.get("type") == "session_started":
            start = record["at"]
        elif event.get("type") == "segment" and start is not None:
            s = event["segment"]
            yield s["state"], s["lang"], record["at"] - (start + s["t1_ms"])


def main(path):
    with open(path, encoding="utf-8") as f:
        found = list(lags(f))
    if not found:
        print("no segment lines after session_started")
        return 1
    ok = True
    for state, budget in BUDGET_MS.items():
        by_lang = defaultdict(list)
        for s, lang, lag in found:
            if s == state:
                by_lang[lang].append(lag)
                by_lang["all"].append(lag)
        for lang, values in sorted(by_lang.items()):
            p95 = percentile(values, 95)
            print(f"{state:10} {lang:4} n={len(values):5} p50={percentile(values, 50):6} ms  p95={p95:6} ms")
        held = bool(by_lang["all"]) and percentile(by_lang["all"], 95) <= budget
        print(f"{state:10} p95 budget {budget} ms: {'PASS' if held else 'FAIL'}")
        ok &= held
    return 0 if ok else 1


if __name__ == "__main__":
    if sys.argv[1:] == ["--check"]:
        import doctest

        sys.exit(doctest.testmod().failed)
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(2)
    sys.exit(main(sys.argv[1]))
