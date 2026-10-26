# Queue Refresh

A small Chrome extension that keeps retrying a **Join queue** button while the
server answers `RESOURCE_EXHAUSTED` ("This task queue is full").

No third-party tools. Chrome loads it directly.

## What it does

1. Waits `CLICK_DELAY_SECONDS` for the page to settle.
2. Finds the button whose text is exactly `Join queue` and clicks it.
3. Watches the GraphQL response for the `joinTaskQueue` operation.
4. Queue full -> waits a random 5 to 10 seconds, reloads, clicks again.
5. Page came back blank -> waits the same random 5 to 10 seconds and reloads,
   the way pressing F5 would. See [When the page comes back
   blank](#when-the-page-comes-back-blank).
6. Anything else (joined, other error, no response) -> stops.

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
| **Arm** | You pick when the task should be **ready**. It works out when to join from the page's time estimate, then logs once through. See [Scheduled start](#scheduled-start) |
| **Wake the queue tab when the browser starts** | A tickbox, not a button. Wakes the pinned queue tab on launch, but only while an arm is ahead. For a cold launch from Task Scheduler |
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
| `TELEGRAM_BOT_TOKEN` | blank | From @BotFather. Blank turns Telegram off |
| `TELEGRAM_CHAT_ID` | blank | From @userinfobot. Negative for a group |
| `TELEGRAM_INTERVAL_SECONDS` | `300` | How often a position is pushed to your phone |

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
position 412 to position 1 is the data the formula needs.

### How a session ends

By itself, when the position line goes away. There are two ways that happens,
and the CSV records which:

| Page says | `state` | Meaning |
| --- | --- | --- |
| `Task offer expired` | `offer-expired` | You reached the front and the offer lapsed |
| `Join the queue to get the next available task.` | `not-joined` | Out of the queue, no offer involved |

Both send a Telegram message, loudly, because both mean the night is over.

Ending needs **two consecutive readings**, not one. A page can render the join
view for a moment while hydrating, and ending a session on a single frame would
be worse than the runaway logging it replaces. A page that says nothing at all,
mid-load, never counts: a blank read is not evidence of having left.

The row that shows the ending is written before the session stops, so the last
line of the CSV is the one that says what happened.

Press **Stop** to end it by hand at any point.

## Two campaigns at once

Each tab knows its campaign. It reads the `Task queue · Guild Signal V2` line,
or falls back to the tab title.

| Where | What it shows |
| --- | --- |
| Popup, under the buttons | `This tab: Guild Prism V2 · join loop running` |
| Popup status and queue | That tab's own status and reading, never the other tab's |
| Popup logging | `Logging Guild Signal V2` |
| Popup arm | `For Guild Signal V2` |
| Telegram | `Queue Refresh · Guild Signal V2` at the top of each message |
| `/status` | One block per open campaign. See [Commands from your phone](#commands-from-your-phone) |

**An arm belongs to the campaign it was set on.** Both tabs check the arm, but
only that campaign's tab refreshes for estimates and joins. On a browser start,
that tab is the one woken.

**Logging is shared.** One session at a time, whichever tab started it.

## Telegram

Optional. With a token in `.env`, the position is pushed to your phone on the
same tick that writes a CSV row, on its own interval.

```
Queue Refresh
Position 412 of 456
Up 44 since the last update
Elapsed 1h 04m
```

Routine updates arrive **silently**, so an overnight run does not buzz a
hundred times. Three things are worth waking the phone for and are sent loud:
joining the queue, the session finishing, and a failure.

### Setting it up

**1. Make the bot.** In Telegram, message [@BotFather](https://t.me/BotFather):

```
/newbot
```

It asks for a name, then a username ending in `bot`. It replies with a token
like `8123456789:AAE-abcdefGHIJklmnoPQRstuvWXyz123456`.

**2. Get your chat id.** Message [@userinfobot](https://t.me/userinfobot) and it
replies with your numeric id. For a group, add the bot to the group first; group
ids are negative.

**3. Send your bot a message.** Any message, once. A bot cannot start a
conversation, so it can only reach you after you have spoken to it first. Skip
this and every send fails with `chat not found`.

**4. Put both in `.env`.**

```
TELEGRAM_BOT_TOKEN=8123456789:AAE-abcdefGHIJklmnoPQRstuvWXyz123456
TELEGRAM_CHAT_ID=123456789
TELEGRAM_INTERVAL_SECONDS=300
```

**5. Check it before involving the extension.**

```
node check-telegram.js
```

It sends one test message using the settings already in `.env`, so the token
never has to be retyped. It checks only the Telegram half, because a wrong
`SITE_URL` has nothing to do with whether a bot token works.

**6. Apply it.**

```
node build.js
```

Then reload the extension card and the page.

Leave both blank to turn it off. Set only one and `build.js` stops: a token with
nowhere to send is a silent no-op you would not notice until morning.

The token is written into `src/config.js`, which is gitignored, and `build.js`
never prints it. It is still readable by anyone who can read the extension
folder, so treat it as you would any credential on that machine. If it leaks,
`/revoke` in BotFather.

### Commands from your phone

Send these to your bot. It answers in the same chat.

| Command | What it does |
| --- | --- |
| `/join` | Presses **Start** on the queue tab |
| `/stop` | Presses **Stop**. An arm is left alone, and the reply says so |
| `/status` | Each open campaign: join loop, last message, queue. `/status prism` for one |
| `/arm 21:30` | Arms for the next 21:30 on the VPS clock: today, or tomorrow if it has passed |
| `/help` | Lists the commands. Any unknown command gets this too |

**Two campaigns open?** Add which one. Any part of the name works, in any case:

```
/join prism
/arm signal 21:30
/stop signal
```

Leave the name out and the bot asks rather than guessing:

```
Which campaign?
/join signal
/join prism
```

Every message is headed with the campaign it is about, e.g.
`Queue Refresh · Guild Signal V2`.

`/status` gives each campaign its own block, so nothing one tab said can be
read as the other's:

```
Queue Refresh · status

Guild Signal V2
Join loop: stopped
Last (17:13): Stopped: no enabled "Join queue" button after 30s.
Queue: not joined, 434 waiting (read 16m ago)

Guild Prism V2
Join loop: running
Last (17:29): Attempt 2: queue full. Refreshing in 7.2s.
Queue: not joined, 512 waiting (read 1m ago)

Logging: off
Armed: no
```

`Join loop: not started` means that tab has not done anything since it loaded.

**When a join stops without joining**, the phone hears about it, loudly. A
missing button also lists what was on the page instead:

```
Queue Refresh · Guild Prism V2
Stopped: no enabled "Join queue" button after 30s.
Buttons on the page: Comments
```

Things to know:

- **Up to 30 seconds' delay.** The extension checks for commands every 30
  seconds, the shortest Chrome allows.
- **The queue tab must be open.** Telegram cannot start the browser. With no
  tab, the reply says so.
- **A tab that does not answer is reloaded once.** A tab left open across an
  extension reload keeps the old code until it is reloaded. The reply says when
  this happened.
- **A folder that was not rebuilt is named as such.** The reply says to run
  `node build.js`, rather than leaving a tab that cannot answer.
- **The tab is brought to the front**, as the watchdog does, so its timers run
  at full speed and screenshots work.
- **Only your `TELEGRAM_CHAT_ID` is obeyed.** Messages from anyone else are
  ignored. If the chat id is a group, everyone in the group can send commands.
- **Old commands are dropped.** Telegram keeps unread messages for a day; one
  older than 5 minutes is ignored, so last night's `/join` cannot fire now.

Nothing to set up beyond the steps above. If reading commands fails, the popup's
Telegram line says `FAILED reading commands`. `Conflict` there means something
else is reading the same bot, such as a webhook or a second copy of the
extension.

### When Telegram fails

The popup carries the last send result, red when it failed. Telegram's own
wording is passed through:

| Message | Cause |
| --- | --- |
| `chat not found` | You have not messaged the bot yet, or the chat id is wrong |
| `Unauthorized` | The token is wrong or was revoked |
| `Forbidden: bot was blocked by the user` | You blocked it |

A failure never interrupts logging. The CSV and screenshots carry on.

## Running it unattended on a VPS

The page stops loading the moment nobody is looking at it. There are two causes
and they need different fixes.

**1. Edge suspends the renderer when the session has no display.** Disconnecting
an RDP session leaves it running but with nothing to draw on. Windows reports the
window as hidden, Edge concludes nobody can see it, and stops rendering: the tab
never loads, timers freeze, and screenshots come back blank. Reconnecting gives
it a display again, which is why everything springs to life when you log in.

**2. Tabs restored from a previous session load lazily.** Edge brings back the
tab strip but does not fetch anything until a tab is clicked. A queue tab
restored this way is an empty placeholder with no content script in it.

### The fix, in order of what matters

**Launch Edge with occlusion detection off.** `windows/start-edge.bat`:

```
windows\start-edge.bat
```

`--disable-features=CalculateNativeWinOcclusion` is the one that counts: it stops
Edge concluding the window is hidden.

Run it with **no arguments**. Edge then restores its pinned tabs, and the pinned
Mercor tab is the campaign page. A URL can still be passed for a one-off on a
different page, but the pinned tab is the normal route — see
[Cold launch](#cold-launch).

**Disconnect, never log off.** Logging off ends the session and closes Edge.
Closing the remote window is fine: just disconnect.

**Do not use `tscon`.** `windows/keep-session-alive.bat` is kept for reference
but is no longer part of the routine. Tested on 20 September 2026: with the
occlusion flag set, a plain RDP disconnect left `log.csv` growing normally, so
handing the session to the console was solving a problem that no longer exists.

It is worth avoiding rather than merely unnecessary. `tscon` swaps the display
mid-session, so `screen.width`, `screen.height` and `devicePixelRatio` all
change at once in a live page — which reads as a headless browser and is the
most likely reason Cloudflare was asking for verification. See
[Cloudflare](#cloudflare).

**Turn off sleeping tabs.** `windows/edge-policies.reg`, then restart Edge. A
discarded tab has no content script at all.

**Stop the machine idling.**

```
powercfg /change standby-timeout-ac 0
powercfg /change monitor-timeout-ac 0
powercfg /change disk-timeout-ac 0
```

### The watchdog

Settings can still be got wrong, so the extension checks its own page.

The content script writes a heartbeat every 30 seconds. A suspended renderer
cannot write one, which is precisely how it gives itself away. The service
worker checks every minute on a `chrome.alarms` tick, which keeps firing when
page timers do not, and after three minutes of silence it brings the tab to the
front and reloads it.

It only watches while a logging session is running, a schedule is armed, or a
browser-start join is still waiting for its tab, waits three minutes between
attempts so it cannot sit in a reload loop, and reopens the last known queue URL
if the tab has gone entirely.

The result is in the popup, and Telegram gets a loud message if it fires. A
revive in the log means the settings above are not right yet: the watchdog is a
net, not a fix.

## Cold launch

A tab that has been open all day is the problem the rest of this file keeps
working around. The alternative is not to have one: launch Edge fresh a few
minutes before the estimate checks begin (two hours before the ready time), and
let the arm take it from there.

Three pieces, and only one of them is new:

| Piece | Job |
| --- | --- |
| **Task Scheduler** | Runs `start-edge.bat` at the time you set. Built into Windows |
| **The pinned Mercor tab** | Holds the campaign URL and comes back when Edge restores |
| **Wake the queue tab when the browser starts** | The popup tickbox. Wakes that tab; the arm decides when to join |

### Setting it up

Once, on the machine that runs the queue. Steps 1 to 3 are the ordinary update
routine; the rest is the new part.

**1. Get the code.**

```
git pull
```

**2. Rebuild.** Not optional this time. `manifest.template.json` gained a file,
so an old `manifest.json` will not load it.

```
node build.js
```

**3. Reload.** The reload arrow on the card in `edge://extensions`, then reload
the queue page.

**4. Pin the campaign tab.** Right-click the tab -> **Pin**. This is the only
place the campaign URL lives, so when the campaign changes, open the new link
in this tab and the update is done.

**5. Tick "Wake the queue tab when the browser starts"** in the popup. Stored,
so it survives restarts and stays on until you untick it.

It only does anything while an arm is ahead. A browser started on any other
day — by a `daily` task, a Windows update, anything — wakes nothing and joins
nothing. Before this, the tickbox joined on **every** launch, which is why a
`daily` task joined every day.

**5b. Arm the ready time** in the popup. See [Scheduled start](#scheduled-start).

**6. Schedule the launch.**

```
windows\schedule-launch.bat 05:45          once, at the next 05:45
windows\schedule-launch.bat 05:45 daily    every day
windows\schedule-launch.bat /delete        remove it
```

Launch at **ready time − 2 hours − a few minutes**. Ready at 08:00 means a
launch at 05:55: the first estimate check is at 06:00, and the tab usually
wakes on the watchdog tick about a minute after Edge opens.

**Edge does not need to be open beforehand, and it does not need to be closed
either.** The task closes it first. See [Why it closes Edge
first](#why-it-closes-edge-first).

**7. Stop using `keep-session-alive.bat`.** Just close the RDP window.

### Checking it worked

Without waiting for the morning:

```
windows\schedule-launch.bat          shows the scheduled task, or says there is none
```

Then run the launch exactly as the task will:

```
windows\start-edge.bat /restart
```

With an arm ahead, the pinned tab should come forward within about a minute,
and the popup status should say
`Browser started and the queue tab is awake. The schedule decides when to join.`

With nothing armed, it says
`Browser started, but nothing is armed for an upcoming ready time.`

If nothing happens, the usual cause is that Edge never actually restarted —
check the console for `Browser started` under the extension's service worker in
`edge://extensions`.

### Why the pinned tab, and not a URL somewhere

Because the campaign changes and the pinned tab is already how you deal with
that. Open the new campaign in the pinned tab and the update is done: no
`.env`, no `node build.js`, no extension reload, no scheduled task to edit.
Nothing in the repo holds a campaign URL, which is the point.

### Why it closes Edge first

The extension joins on `chrome.runtime.onStartup`, and that only fires when Edge
really starts. Launching it while it is already running adds a window to the
existing process: no startup event, nothing joins, and the night passes quietly.

A browser left open from last night is the normal state on a machine that does
this every day, so the scheduled task always passes `/restart`, which closes
Edge before launching it.

The close is a **graceful** one — `taskkill` with no `/f`. That is what makes
Edge write its session file, which is what puts the pinned tabs back. Only if
it is still there after fifteen seconds does it get forced, and the script says
so, because a forced close can lose the pinned tabs and the campaign URL with
them.

```
start-edge.bat              launch, leave a running Edge alone
start-edge.bat /restart     close it first, then launch
```

By hand, without `/restart`, nothing of yours gets closed.

**One thing to know:** if a queue run from the night before is still going at
the scheduled time, the restart ends it. Move the schedule, or use **Arm** in
the popup instead, which joins in the browser you already have open.

### Why it does not need a program to click the tab

A restored pinned tab is an empty placeholder until something activates it,
which is why it has always needed a click to come alive. That click is two
lines in the service worker:

```js
await chrome.tabs.update(tab.id, { active: true });
await chrome.tabs.reload(tab.id);
```

Same code the watchdog already used to revive a dead page. No second program,
no screen coordinates, nothing that breaks when the screen resolution changes.

### The order it happens in

1. Task Scheduler runs `start-edge.bat /restart`, with no URL. Any running Edge
   is closed gracefully first, so `onStartup` has a real start to fire on.
2. Edge starts and restores the pinned tabs.
3. `chrome.runtime.onStartup` fires. If the tickbox is on **and an arm is
   ahead**, it sets a pending flag and tries to wake the tab. Otherwise it
   stops here.
4. That first try usually finds nothing: the tab strip is rebuilt before the
   tabs can be queried. It says so and waits rather than opening a second tab.
5. The watchdog tick, a minute later, finds the tab and wakes it.
6. The content script loads and claims the pending flag. From here the arm
   runs as normal: estimate checks, then the join.

## When the page comes back blank

A reload sometimes lands on nothing: the URL is right, the tab is there, and
the page is an empty rectangle. No button, no position line, no text at all.

The loop treats that as a page that has not answered yet rather than an answer,
so it waits the usual random 5 to 10 seconds and reloads — the same thing you
would do by pressing F5, except it carries on doing it at four in the morning.

| Page after a reload | What happens |
| --- | --- |
| Blank | Reload, up to 20 times in a row |
| Rendered, with the button | Normal attempt: click, read the answer |
| Rendered, no button (some other page) | Stops, as before |
| Cloudflare interstitial | Stops and sends a loud Telegram. See [Cloudflare](#cloudflare) |

Three things keep it from becoming a reload loop:

- **A blank page has to be truly empty.** Any readable text means the page
  rendered, and a rendered page is judged on what it says.
- **It is capped at 20 blanks in a row**, about twelve minutes, after which it
  stops and says so. A run that is ended by a blank page was not going to be
  saved by a twenty-first reload.
- **The count is consecutive.** One page that renders resets it, so a bad patch
  in the middle of a long night does not use the allowance up.

Blank reloads do **not** count against `MAX_ATTEMPTS`. That limit is there to
cap clicks on the button, and a blank page never got as far as one.

Pulling this needs a rebuild: `manifest.template.json` gained `src/blank.js`, so
run `node build.js`, then the reload arrow on the extension card.

## Cloudflare

Cloudflare sometimes puts a "verify you are human" page in front of the campaign.
It cannot be clicked past from here, and the extension does not try:

- The checkbox is in a **cross-origin iframe** the content script cannot reach.
- A scripted click carries `isTrusted: false`, which the widget rejects.
- The checkbox is only the visible part of a fingerprinting check anyway.

What it does instead is **notice**. Before anything else on a page load, the
content script checks for an interstitial. Left alone it would look like a page
that is merely slow, and the retry loop would reload into it until it ran out of
attempts — a night lost in silence.

On a hit it stops the loop, does **not** reload (reloading is what turns one
challenge into a run of them), sends a loud Telegram, and tries for a screenshot.

The message names the signal it went on, because a report nobody can check is a
report nobody can argue with:

```
Queue Refresh
Cloudflare is asking you to verify.
The run is stopped until you clear it by hand.
Spotted by the page title (Just a moment...).
```

### The minute it gets first

The automatic challenge passes itself and takes the page with it. Only the kind
that waits for a human is worth waking anyone up for, so a suspected challenge
gets **up to a minute** to resolve before anything is reported.

It is checked every second during that minute, not once at the end, so a
challenge that clears in two seconds costs two seconds. And when it clears the
usual way — by navigating the page away — the script asking the question is
gone before it can report anything at all.

This was eight seconds until 22 September 2026, when one cleared by itself, the
campaign page came back normally, and the report had already gone out: a loud
Telegram, a stopped run and a red banner over a page that was fine. Waiting on a
real challenge costs a minute. Reporting one that would have cleared costs the
night.

### When it clears anyway

A challenge can still pass just after the minute runs out, so the report is not
the last word on it.

On the next page load, if nothing challenge-shaped is there any more, the
extension waits for the page to prove itself — a **Join queue** button, or a
position — and then takes the stop back: the banner comes down, a quiet Telegram
says so, and the loop carries on where it left off.

| | |
| --- | --- |
| Page proves itself | Banner cleared, loop resumes |
| Page still not back | Stays stopped, and says so |
| Stopped by **you** | Never resumed. Cloudflare's stop is the only one this undoes |
| Cleared and came back 4 times | Stays stopped. Something that keeps returning is not clearing itself |

### What seems to trigger it

Worth knowing, because avoiding it beats detecting it:

| Trigger | Notes |
| --- | --- |
| **`tscon` to the console** | The likely one, and now avoidable. Changes the display mid-session: `screen.width`, `screen.height` and `devicePixelRatio` all jump at once, which reads as a headless browser |
| **Datacenter IP** | A VPS gets far more scrutiny than a home connection |
| **A fresh profile** | No `cf_clearance` cookie yet. A persistent profile usually walks straight through |

The first one is settled. Tested on 20 September 2026: a plain RDP disconnect,
with no `tscon`, left the logging running. So `keep-session-alive.bat` is out of
the routine and the display no longer changes under the page.

The other two remain, which is why the detection stays. A cookie expires or an
IP gets reclassified and the challenge comes back on a night nobody is watching.

## Scheduled start

Pick when the task should be **ready**, press **Arm**, and leave the queue page
open. The extension works out when to join from the page's own estimate:

```
Join the queue to get the next available task.
568 experts currently waiting
Estimated 60–120 min to front if you join now
```

**Join time = ready time − the shortest estimate.** Ready at 08:00 with
60–120 min means joining at 07:00. You reach the front at 08:00 at the
earliest, never before it: arriving early means an offer that lapses and a
second trip through the queue.

```
Task ready at  [ 13/10/2026 08:00 ]
[ Arm ] [ Disarm ]
Ready at 13/10/2026, 08:00:00
Joining in 52m (07:00:00)
Next estimate check in 7m 12s
Estimate 60–120 min (read 8m ago).
```

### The estimate checks

The estimate only changes on a fresh page load, so the page reloads itself:

- **First check:** two hours before the ready time.
- **Then:** every 15 minutes, until it joins or the ready time passes.
- **Each check** sets a new join time and sends it to Telegram.

| The page says | What happens |
| --- | --- |
| Join time still ahead | Waits for it. Telegram, silent |
| Join time already passed (e.g. 150–200 min) | Joins right away. Telegram, loud |
| Longest estimate **30 min or less** (incl. "under 2 min") | Does not join: join by hand. Telegram, loud |
| No estimate at all | Does not join, and drops any earlier join time. Tries again at the next check. Telegram, loud |

Each check decides afresh, so a short queue at 06:00 that has grown by 06:15
gets a join time then.

If the ready time passes without a join, the arm is cleared and Telegram says
so. An arm whose date has passed never does anything again.

The time is **local wall-clock time on that machine** — the clock in the corner
of the server's screen. No timezone is attached, so what you type is what counts.

It lives in the popup rather than `.env` on purpose: you will change it nightly,
and `.env` would mean `node build.js`, an extension reload and a page reload
every time.

### Already in the queue

Joining twice is the one thing that must not happen, so it is checked twice:

- **When you press Arm.** If you are already in, it refuses to arm and says so,
  rather than looking like a plan for the night that will do nothing.
- **At every estimate check.** If you are already in, the arm is cleared.
- **When the join time comes.** If you are already in, the join is skipped.

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
behind another one, the alarm still nudges it at the first check and at the
join time. Whichever gets there first claims the arm, so it can only happen
once.

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
| `Failed to capture tab: image readback failed` | Nothing was composited to read: the page was mid-navigation, or the tab had only just come forward. Retried once automatically, and this is what is left when the retry fails too |
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
| `src/queue-exit.js` | Spots the two ways a queue run ends |
| `src/challenge.js` | Spots a Cloudflare interstitial in front of the page |
| `src/blank.js` | Spots a page that rendered nothing at all |
| `src/csv.js` | Builds the CSV text and names each session folder |
| `src/schedule.js` | Reads the picked time, plans the join time, counts down |
| `src/queue-estimate.js` | Reads the "Estimated 60–120 min to front" line off the page |
| `src/telegram.js` | Builds the text that goes to your phone, and reads the commands that come back |
| `src/campaign.js` | Reads which campaign a page is, and picks a tab by name |
| `src/watchdog.js` | Decides when a silent page needs reloading |
| `check-telegram.js` | Sends one test message to prove the bot works |
| `windows/start-edge.bat` | Launches Edge with the flags that survive a disconnect |
| `windows/schedule-launch.bat` | Registers the Task Scheduler job that runs it |
| `windows/keep-session-alive.bat` | Not needed any more. Kept for reference |
| `windows/edge-policies.reg` | Turns off sleeping tabs and efficiency mode |
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
