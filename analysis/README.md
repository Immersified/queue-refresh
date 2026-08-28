# Propr challenge win-rate analysis

`propr_challenge.py` replays a trading algorithm's backtest periods against
Propr-style prop-challenge rules and reports how often the challenge is passed.

## Rules modelled

| Rule | Default |
| --- | --- |
| Profit target (pass) | +10% |
| Daily drawdown (fail) | 5% |
| Cumulative drawdown (fail) | 8% |

Whichever trigger fires first ends the attempt. An attempt that reaches the end
of the available data without triggering anything is reported as `UNDECIDED`
rather than being counted as a win or a loss.

## Input

Point the script at a folder of backtest output; it recurses and treats every
directory containing `Invest Test All <date>.csv` files as one algorithm:

```
python3 analysis/propr_challenge.py "Naked RSI DeLeverage" --chain -v
```

Only the `Invest Test All` files are read. The `Profit Sum` column in them is
the cumulative *realised* return in percent of the starting balance — it agrees
with the `EUR` column exactly (`EUR == 500 * (1 + ProfitSum/100)`) — so it is
used directly as the equity curve. The `Crypto Trade All` files are not needed
for this measurement.

## Equity is realised-only

Equity moves only when a position closes. Open-position excursions are ignored,
so a trade that dipped far into the red before recovering never registers as a
drawdown. Real challenges mark to market continuously, which means **every
number here is an upper bound** — the true pass rate is lower, and the daily
drawdown rule is the one most affected.

## Two ways to count a period

Each `Invest Test All <date>.csv` is one contiguous 14-day window, and the
windows tile the backtest end to end without overlapping.

* **Per-period** (default) — an attempt lives only inside its own 14-day file.
  This is the literal reading of "start the challenge at each new file", but 14
  days is rarely long enough to resolve a 10% target, so most periods come back
  `UNDECIDED`.
* **Chained** (`--chain`) — an attempt starts at a period's date and carries on
  through the following periods, compounding, until it passes or breaches. This
  matches a real challenge, which has a drawdown limit but no 14-day deadline.

Chained attempts overlap heavily, so the 47 results are **not** 47 independent
samples: neighbouring start dates often resolve on the same trade.

## Drawdown variants

`--trailing` measures the cumulative drawdown from the equity high water mark
instead of from the starting balance. The static default is the more common
prop-firm rule; run both to see how much a result depends on the choice.

The daily limit is measured against the equity carried into that calendar day.

## Baseline: Naked RSI DeLeverage (Random State 43.0, ETH)

47 periods, 2024-10-26 to 2026-08-15, long-only.

| Mode | Pass | Fail daily | Fail cumulative | Undecided |
| --- | --- | --- | --- | --- |
| Chained, static DD | **74.5%** | 17.0% | 6.4% | 2.1% |
| Chained, trailing DD | 70.2% | 14.9% | 12.8% | 2.1% |
| Per-period, static DD | 17.0% | 4.3% | 4.3% | 74.5% |
| Per-period, trailing DD | 17.0% | 4.3% | 6.4% | 72.3% |

Chained median time to pass: 29 days (range 1–109).
