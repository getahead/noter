#!/usr/bin/env python3
"""Live transcription lag of one captured call (`cpt-noter-dod-core-engine-capture-latency`, Q4).

Reads the engine's event lines (JSON Lines on stdout, as `noter-engine` writes them) and prints,
per segment state (hypothesis, confirmed) and per language, how long after the words were said
each segment line arrived: lag = line `at` - when call ms `t1_ms` was captured, which is the `at`
of the session's `levels` line for that 100 ms of call time (call time counts captured samples).
It also prints when the first audio came after `session_started` and how much audio the capture
lost (wall time minus call time at the end): neither is transcription lag, both are capture faults.

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


def read(lines):
    """The session's start, its levels stamps (one per 100 ms of call time) and its segments."""
    start, call, levels, segments = None, None, [], []
    for line in lines:
        try:
            record = json.loads(line)
        except ValueError:
            continue
        event = record.get("event", {})
        if event.get("type") == "session_started":
            start, call = record["at"], event.get("call_id")
        elif start is None:
            continue
        elif event.get("type") == "levels" and event.get("call_id") == call:
            levels.append(record["at"])
        elif event.get("type") == "segment":
            segments.append((record["at"], event["segment"]))
    return start, levels, segments


def lags(start, levels, segments):
    """(state, lang, lag ms) per segment line, timed from when its last word was captured.

    shortcut: one engine run from call ms 0 (after a restart `resume_from_ms` shifts the levels).

    >>> seg = lambda t1: {"state": "confirmed", "lang": "en", "t1_ms": t1}
    >>> list(lags(0, [5000, 5100, 9000], [(9500, seg(250)), (9600, seg(50))]))
    [('confirmed', 'en', 4400), ('confirmed', 'en', 4600)]
    """
    for at, s in segments:
        mark = min(max(1, s["t1_ms"] // 100), len(levels)) - 1  # the 100 ms mark at or before t1
        yield s["state"], s["lang"], at - levels[mark]


def capture(start, levels):
    """(ms from session_started to the first 100 ms of audio, ms of audio lost by the end).

    >>> capture(1000, [3000, 3100, 3700])
    (2000, 500)
    """
    return levels[0] - start, levels[-1] - levels[0] - (len(levels) - 1) * 100


def main(path):
    with open(path, encoding="utf-8") as f:
        start, levels, segments = read(f)
    if not segments or not levels:
        print("no levels and segment lines after session_started")
        return 1
    found = list(lags(start, levels, segments))
    first, lost = capture(start, levels)
    print(f"capture    first audio {first} ms after session_started; lost {lost} ms over {len(levels) / 600:.1f} min")
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
