#!/usr/bin/env python3
"""Evaluate a trading algorithm against Propr-style prop-challenge rules.

Challenge rules (defaults):
  * PASS  when equity reaches +10% over the starting balance.
  * FAIL  on a daily drawdown of 5%.
  * FAIL  on a cumulative drawdown of 8%.
  * Whichever comes first wins; if neither happens the attempt is UNDECIDED.

Equity comes from the realised equity curve only: the ``Profit Sum`` column of
the "Invest Test All" files, which is the cumulative realised return in percent
of the starting balance. Open-position (intra-trade) excursions are deliberately
ignored, so results are optimistic relative to a live challenge.

Each "Invest Test All <date>.csv" file is one period and, by default, one
challenge attempt starting on that file's date. ``--chain`` instead lets an
attempt started in one period run on through later periods until it resolves.
"""

import argparse
import csv
import os
import re
import sys
from datetime import datetime

DATE_IN_NAME = re.compile(r"(\d{4}-\d{2}-\d{2})")

PASS, FAIL_DAILY, FAIL_CUM, UNDECIDED = "PASS", "FAIL_DAILY", "FAIL_CUM", "UNDECIDED"
OUTCOMES = (PASS, FAIL_DAILY, FAIL_CUM, UNDECIDED)


# --------------------------------------------------------------------------- io

def parse_ts(text):
    return datetime.strptime(text.strip(), "%d/%m/%Y %H:%M:%S")


def load_period(path):
    """Return (start_date, [(timestamp, equity_pct), ...]) for one Invest file.

    ``equity_pct`` is 100 at the starting balance, i.e. 100 + Profit Sum.
    """
    with open(path, newline="") as handle:
        rows = list(csv.DictReader(handle))

    points = []
    for row in rows:
        raw = (row.get("Profit Sum") or "").strip()
        points.append((parse_ts(row["Date"]), 100.0 + (float(raw) if raw else 0.0)))
    points.sort(key=lambda point: point[0])

    match = DATE_IN_NAME.search(os.path.basename(path))
    start = datetime.strptime(match.group(1), "%Y-%m-%d") if match else points[0][0]
    return start, points


def find_algos(root):
    """Map algorithm label -> sorted list of (start_date, path)."""
    algos = {}
    for dirpath, _dirnames, filenames in os.walk(root):
        invest = [f for f in filenames if f.startswith("Invest Test All") and f.endswith(".csv")]
        if not invest:
            continue
        label = os.path.relpath(dirpath, root)
        if label == ".":
            label = os.path.basename(os.path.abspath(root))
        periods = []
        for name in sorted(invest):
            match = DATE_IN_NAME.search(name)
            if not match:
                print(f"skipping (no date in filename): {name}", file=sys.stderr)
                continue
            periods.append((datetime.strptime(match.group(1), "%Y-%m-%d"), os.path.join(dirpath, name)))
        algos[label] = sorted(periods)
    return algos


# ------------------------------------------------------------------------ rules

def run_attempt(points, target=10.0, daily_dd=5.0, cum_dd=8.0, trailing=False):
    """Walk a realised equity curve under the challenge rules.

    ``points`` is a chronological list of (timestamp, equity_pct), rebased so
    that the first point is the challenge's starting balance. ``trailing`` makes
    the cumulative drawdown float up from the equity high water mark instead of
    staying static against the starting balance.

    Returns a dict describing how the attempt ended.
    """
    start = points[0][1]
    equity = start
    peak = start
    day = points[0][0].date()
    day_open = start
    previous_equity = start
    win_level = start + target
    static_floor = start - cum_dd

    def result(outcome, timestamp):
        return {
            "outcome": outcome,
            "at": timestamp,
            "days": (timestamp.date() - points[0][0].date()).days,
            "equity": equity - start,
            "peak": peak - start,
        }

    for timestamp, equity in points:
        if timestamp.date() != day:
            # A new calendar day resets the daily loss allowance against the
            # equity carried into it.
            day = timestamp.date()
            day_open = previous_equity

        peak = max(peak, equity)
        floor = max(static_floor, peak - cum_dd) if trailing else static_floor

        # Breaches are checked before the target: a rule violation ends the
        # attempt even if the same instant would also have cleared the goal.
        if equity - day_open <= -daily_dd:
            return result(FAIL_DAILY, timestamp)
        if equity <= floor:
            return result(FAIL_CUM, timestamp)
        if equity >= win_level:
            return result(PASS, timestamp)

        previous_equity = equity

    return result(UNDECIDED, points[-1][0])


def attempt_points(periods, index, chain):
    """Equity points for an attempt started at ``periods[index]``.

    Without ``chain`` the attempt sees only its own period. With ``chain`` the
    later periods are appended, their returns compounded onto the running
    equity, so an attempt can span more than one 14-day window.
    """
    _start, path = periods[index]
    _date, points = load_period(path)
    if not chain:
        return points

    combined = list(points)
    carried = points[-1][1]
    for _later_start, later_path in periods[index + 1:]:
        _date, later = load_period(later_path)
        base = later[0][1]
        # Compound: the next period restarts at 100, so rescale it onto the
        # equity we are carrying forward.
        combined.extend((timestamp, carried * equity / base) for timestamp, equity in later[1:])
        carried = combined[-1][1]
    return combined


# ---------------------------------------------------------------------- report

def summarise(label, periods, args):
    rows = []
    for index, (start, path) in enumerate(periods):
        points = attempt_points(periods, index, args.chain)
        res = run_attempt(points, args.target, args.daily_dd, args.cum_dd, args.trailing)
        res["start"] = start
        res["file"] = os.path.basename(path)
        rows.append(res)

    counts = {outcome: sum(1 for r in rows if r["outcome"] == outcome) for outcome in OUTCOMES}
    total = len(rows)
    decided = total - counts[UNDECIDED]

    print(f"\n=== {label} ===")
    print(f"periods: {total}   target +{args.target:g}%   daily DD {args.daily_dd:g}%   "
          f"cumulative DD {args.cum_dd:g}% ({'trailing' if args.trailing else 'static'})"
          f"   mode: {'chained' if args.chain else 'per-period'}")

    if args.verbose:
        print(f"\n  {'start':<12} {'outcome':<10} {'day':>4} {'end %':>8} {'peak %':>8}")
        for r in rows:
            print(f"  {r['start']:%Y-%m-%d}   {r['outcome']:<10} {r['days']:>4} "
                  f"{r['equity']:>+8.2f} {r['peak']:>+8.2f}")

    print()
    for outcome in OUTCOMES:
        count = counts[outcome]
        print(f"  {outcome:<12} {count:>3}   {count / total:>6.1%} of all periods")

    print()
    print(f"  win rate (all periods):      {counts[PASS] / total:>6.1%}")
    if decided:
        print(f"  win rate (decided only):     {counts[PASS] / decided:>6.1%}   ({decided} decided)")
    failures = counts[FAIL_DAILY] + counts[FAIL_CUM]
    print(f"  blow-up rate:                {failures / total:>6.1%}")

    passes = [r for r in rows if r["outcome"] == PASS]
    if passes:
        days = sorted(r["days"] for r in passes)
        median = days[len(days) // 2]
        print(f"  days to pass:                min {days[0]}, median {median}, max {days[-1]}")
    return rows


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("root", help="folder holding the algorithm's period CSVs (searched recursively)")
    parser.add_argument("--target", type=float, default=10.0, help="profit target in %% (default: 10)")
    parser.add_argument("--daily-dd", type=float, default=5.0, help="daily drawdown limit in %% (default: 5)")
    parser.add_argument("--cum-dd", type=float, default=8.0, help="cumulative drawdown limit in %% (default: 8)")
    parser.add_argument("--trailing", action="store_true",
                        help="measure the cumulative drawdown from the equity high water mark "
                             "instead of the starting balance")
    parser.add_argument("--chain", action="store_true",
                        help="let an attempt continue into later periods instead of "
                             "expiring at the end of its own")
    parser.add_argument("-v", "--verbose", action="store_true", help="list every period's outcome")
    args = parser.parse_args(argv)

    algos = find_algos(args.root)
    if not algos:
        parser.error(f"no 'Invest Test All *.csv' files found under {args.root}")
    for label, periods in sorted(algos.items()):
        summarise(label, periods, args)
    return 0


if __name__ == "__main__":
    sys.exit(main())
