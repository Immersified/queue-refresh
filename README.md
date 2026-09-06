# Queue Refresh

A small Chrome extension that keeps retrying a **Join queue** button while the
server answers `RESOURCE_EXHAUSTED` ("This task queue is full").

No third-party tools. Chrome loads it directly.

## What it does

1. Waits `CLICK_DELAY_SECONDS` for the page to settle.
2. Finds the button whose text is exactly `Join queue` and clicks it.
3. Watches the GraphQL response for the `joinTaskQueue` operation.
4. Queue full -> waits a random 5 to 10 seconds, reloads, clicks again.
5. Anything else (joined, other error, no response) -> stops.

## Setup (about 10 minutes)

**1. Put your settings in `.env`.** The file is already there. Open it and paste any
page of your site into `SITE_URL`, then adjust the numbers if you want:

```
SITE_URL=https://app.yoursite.com/campaigns/abc-123
MAX_ATTEMPTS=200
RETRY_INTERVAL_MIN_SECONDS=5
RETRY_INTERVAL_MAX_SECONDS=10
RESPONSE_TIMEOUT_SECONDS=15
CLICK_DELAY_SECONDS=1
```

**2. Apply them.**

```
node build.js
```

Chrome cannot read `.env` itself, so this generates `manifest.json` (from
`manifest.template.json`) and `src/config.js`. Run it again after every `.env`
change.

Only the domain of `SITE_URL` reaches the extension: the path, query and port are
dropped, so `https://app.yoursite.com/campaigns/abc-123` and any other link on that
host both become `https://app.yoursite.com/*`. When a campaign link changes, the
generated files come out identical, so there is nothing to rebuild or reload.

`.env`, `manifest.json` and `src/config.js` are all gitignored, so pulling or
committing never overwrites your settings. Edit `.env`, never the generated files.

**3. Load it in Chrome.**
- Go to `chrome://extensions`
- Turn on **Developer mode** (top right)
- Click **Load unpacked** and pick this folder

**4. Use it.** Open the queue page, click the extension icon, then:

| Button | What it does |
| --- | --- |
| **Start** | Retries the Join queue button. Logging begins when the join lands |
| **Log only** | Logs without touching the button, for when you joined by hand |
| **Stop** | Ends both the retry loop and the logging |
| **Stop logging** | Ends the logging only, leaving the retry loop alone |
| **Test shot** | Takes a screenshot right now, so you can prove capture works without waiting for the interval |
| **Arm** | Joins when the clock reaches the time you picked, then logs once through |
| **Disarm** | Cancels it |

The popup shows the status, your position (or the queue length before you join),
and the folder the current session is writing to.

After any `.env` change: `node build.js`, then the reload arrow on the extension
card, then reload the page. Changing which campaign you use is not an `.env` change
— open the new link and press Start.

## Settings

All in `.env`. Run `node build.js` to apply.

| Name | Default | Meaning |
| --- | --- | --- |
| `SITE_URL` | none | Any page on the site with the button. Only the domain is used, so campaign links can change without a rebuild |
| `MAX_ATTEMPTS` | `200` | Safety limit on clicks |
| `RETRY_INTERVAL_MIN_SECONDS` | `5` | Shortest wait after "queue is full" |
| `RETRY_INTERVAL_MAX_SECONDS` | `10` | Longest wait. Each retry picks a random time in between |
| `RESPONSE_TIMEOUT_SECONDS` | `15` | Give up if the server stays silent |
| `CLICK_DELAY_SECONDS` | `1` | Settle time after the page loads, before clicking. Decimals allowed, `0` disables |
| `LOG_INTERVAL_SECONDS` | `30` | How often a row is written to `log.csv`. This is the resolution of your position data |
| `SCREENSHOT_INTERVAL_SECONDS` | `1800` | How often a screenshot is saved. Cannot be smaller than `LOG_INTERVAL_SECONDS` |

`build.js` refuses to run on a bad value and tells you which one, so a typo cannot
quietly turn into a broken extension.

Two things stay in the code because they rarely need changing: the button text
(`BUTTON_LABEL`) and how long to wait for the button to appear
(`BUTTON_TIMEOUT_MS`), both at the top of `src/controller.js`.

## Queue length and position

The page says two different things depending on where you stand:

| Screen | Line on the page | What it means |
| --- | --- | --- |
| Before joining | `442 experts currently waiting` | How long the queue is |
| After joining | `Position 412 of 456` | Where **you** are in it |

The popup shows whichever applies. Readings are taken when the page loads, when
the popup is opened, and on every logging tick, and each is shown with its age
so a value left over from an earlier page cannot be mistaken for the queue right
now.

A reading that is missing, malformed, or impossible (position past the end of
the queue, a decimal, an absurd total) counts as no reading at all, and the last
good value stays on screen rather than being replaced by a guess.

Nothing in the join loop acts on either number; they are recorded, not obeyed.

## Logging

To work out *when* to join, you first need data on how fast the queue moves.

**A session starts the moment there is a position to record**, not when you
press a button. That means:

| Moment | Logging |
| --- | --- |
| **Start** pressed, retry loop running | No. There is no position yet, only a button being clicked |
| The join lands | **Starts here** |
| The schedule fires and you were already in | **Starts here** |
| **Log only** pressed | **Starts here**, for when you joined by hand |

Rows from the retry loop would carry no position at all, so they are not
written. The folder appears when you are through, and its timestamp is the
moment you got in.

Each session gets its own folder, so sessions stay comparable:

```
Downloads/queue-refresh/2026-09-06_1916_e27f8b7b/
  log.csv
  shot-0001_191632.jpg
  shot-0002_194632.jpg
```

The folder name is the start time plus the campaign id, so folders sort in the
order they happened.

`log.csv` has one row per tick:

| Column | Meaning |
| --- | --- |
| `timestamp` | ISO time of the reading |
| `elapsed_seconds` | Seconds since the session started |
| `position` | Your place in line, blank before you join |
| `total` | Queue length as reported next to your position |
| `waiting` | The "N experts currently waiting" count, blank once you join |
| `state` | `in-queue`, `not-joined`, or `unknown` |
| `url` | The page the reading came from |

Two separate `.env` settings control the cadence, because a CSV row is cheap and
a screenshot is not:

```
LOG_INTERVAL_SECONDS=30
SCREENSHOT_INTERVAL_SECONDS=1800
```

Screenshots are the ground truth. If the page wording ever changes and the CSV
goes blank, the images still show what actually happened.

They are JPEGs, not PNGs. The image reaches `chrome.downloads` as a `data:` URL,
and a full-width PNG base64s into several megabytes, which downloads rejects. At
quality 85 the position line is still perfectly readable.

**Joining does not stop the logging.** That is deliberate: the climb from
position 412 to position 1 is the data the formula needs. Press **Stop** to end
the session.

## Scheduled start

Temporary, for collecting data. Pick a time in the popup, press **Arm**, and
leave the queue page open. When the machine's clock reaches it, the extension
joins and starts logging.

```
Join at  [ 07/09/2026 06:03 ]
[ Arm ] [ Disarm ]
Joining in 8h 42m (7/09/2026, 06:03:00)
```

The time is **local wall-clock time on that machine** — the clock in the corner
of the server's screen. No timezone is attached, so what you type is what fires.

It lives in the popup rather than `.env` on purpose: you will change it nightly,
and `.env` would mean `node build.js`, an extension reload and a page reload
every time.

### Already in the queue

Joining twice is the one thing that must not happen, so it is checked twice:

- **When you press Arm.** If you are already in, it refuses to arm and says so,
  rather than looking like a plan for the night that will do nothing.
- **When the schedule fires.** If you are already in, the join is skipped.

**Logging still starts.** Being already in the queue is still a night of
position data, which is the point of the exercise.

The check reads two independent signals, either of which is enough: the
`Position N of M` line, and a `Leave queue` button. One can render before the
other, and neither alone is worth trusting.

The retry loop carries the same guard on every attempt, not just the first, so a
reload that lands on an already-joined page stops instead of clicking again.

### What drives the clock

The page's own timer, checked every second. The tab has to be alive to click the
button anyway, so nothing is gained by putting the clock elsewhere.

`chrome.alarms` in the service worker is a **backstop**, not the driver: Edge
throttles timers in a background tab to once a minute, so if the queue tab is
behind another one, the alarm still fires it. Whichever gets there first claims
the arm, so it can only happen once.

An arm survives page reloads and extension restarts, because it is stored, not
held in a variable.

### Where the files go, and why

Everything lands under the browser's **Downloads** folder. An extension cannot
write anywhere else without a native messaging host, which would mean a helper
program and registry entries. This is the whole reason for the `queue-refresh/`
subfolder.

Before an unattended run, turn **off** `edge://settings/downloads` -> "Ask me
what to do with each download", or every screenshot will sit waiting on a
prompt.

Screenshots capture the **visible area of the active tab**. If the queue tab is
minimised or behind another tab, the capture fails and says so in the popup
rather than silently writing nothing.

### When screenshots do not appear

The popup keeps the screenshot result on its own line, in red when it failed,
because it is the one thing that goes unnoticed until the folder turns out to be
empty in the morning. It is on a separate storage key from the main status for
exactly that reason: a CSV row lands every tick and would otherwise overwrite the
reason within seconds.

Press **Test shot** to trigger a capture immediately. Common answers:

| Message | Fix |
| --- | --- |
| `the queue tab is not the visible tab in its window` | Bring the tab to the front. Capture only ever sees the visible tab |
| `No session running` | Press **Start** or **Log only** first |
| `Either the '<all_urls>' or 'activeTab' permission is required` | You are on an old build. `git pull`, `node build.js`, reload the extension |

### Why the extension asks for all sites

`chrome.tabs.captureVisibleTab` refuses to run on a host permission alone. It
accepts only `<all_urls>` or `activeTab`, and `activeTab` is revoked on every
navigation, so the retry loop's own reloads would kill it within seconds.

`<all_urls>` therefore sits in `host_permissions`, and Edge will say the
extension can read all your data on all websites. What limits it in practice is
`content_scripts.matches`, which stays pinned to your `SITE_URL`: the extension
is only ever *injected* on the queue site. Nothing runs anywhere else.

If that trade is not one you want, say so. Dropping screenshots and saving the
page's queue text instead needs no extra permission at all, and the CSV, which
is what the formula actually reads, is unaffected either way.

For the full picture, open `edge://extensions`, click **service worker** on the
extension card, and read its Console. Every save and every failure is logged
there whether or not the popup is open.

## Why it finds the button by text

The button's `id` (`:rh:`) is a React `useId` value and its `css-og001r` class is
a generated Emotion hash. Both change on their own. The visible label is the only
stable handle, so no manual setup is needed.

## Files

| File | Role |
| --- | --- |
| `.env` | Your settings. Not committed |
| `.env.example` | Template with the defaults |
| `build.js` | Writes `.env` values into the extension |
| `manifest.template.json` | Extension config with a `__SITE_URL__` slot |
| `manifest.json` | Generated by `build.js`. Not committed |
| `src/config.js` | Generated by `build.js`. Not committed |
| `src/classify.js` | Reads a GraphQL body, decides full / joined / error |
| `src/queue-count.js` | Reads the "N experts currently waiting" line off the page |
| `src/queue-position.js` | Reads the "Position 412 of 456" line off the page |
| `src/csv.js` | Builds the CSV text and names each session folder |
| `src/schedule.js` | Reads the picked time and counts down to it |
| `src/interceptor.js` | Wraps `fetch` and `XMLHttpRequest` in the page |
| `src/controller.js` | One attempt per page load, plus the retry loop |
| `src/logger.js` | The logging clock, in the page so it survives reloads |
| `src/worker.js` | Service worker: screenshots and file writing |
| `src/popup.js` | Buttons, status, position and session folder |

## Tests

```
node --test
```

No dependencies.

## Note

Automating a queue may be against the site's terms of service. That is your call.
