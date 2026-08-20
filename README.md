# Queue Refresh

A small Chrome extension that keeps retrying a **Join queue** button while the
server answers `RESOURCE_EXHAUSTED` ("This task queue is full").

No third-party tools. Chrome loads it directly.

## What it does

1. Finds the button whose text is exactly `Join queue` and clicks it.
2. Watches the GraphQL response for the `joinTaskQueue` operation.
3. Queue full -> waits 10 seconds, reloads the page, clicks again.
4. Anything else (joined, other error, no response) -> stops.

## Setup (about 10 minutes)

**1. Point it at your site.** Open `manifest.json` and replace
`https://REPLACE-ME.example.com/*` in **both** places with your site, for example
`https://app.yoursite.com/*`.

**2. Load it in Chrome.**
- Go to `chrome://extensions`
- Turn on **Developer mode** (top right)
- Click **Load unpacked** and pick this folder

**3. Use it.** Open the queue page, click the extension icon, press **Start**.
The popup shows the current status. Press **Stop** any time, or just close the tab.

After editing any file, hit the reload arrow on the extension card, then reload
the page.

## Settings

Constants at the top of `src/controller.js`:

| Name | Default | Meaning |
| --- | --- | --- |
| `BUTTON_LABEL` | `Join queue` | Exact button text to look for |
| `RETRY_DELAY_MS` | `10000` | Wait before reloading |
| `MAX_ATTEMPTS` | `200` | Safety limit |
| `RESPONSE_TIMEOUT_MS` | `15000` | Give up waiting for the server |
| `BUTTON_TIMEOUT_MS` | `30000` | Give up waiting for the button |

## Why it finds the button by text

The button's `id` (`:rh:`) is a React `useId` value and its `css-og001r` class is
a generated Emotion hash. Both change on their own. The visible label is the only
stable handle, so no manual setup is needed.

## Files

| File | Role |
| --- | --- |
| `manifest.json` | Extension config and the site URL |
| `src/classify.js` | Reads a GraphQL body, decides full / joined / error |
| `src/interceptor.js` | Wraps `fetch` and `XMLHttpRequest` in the page |
| `src/controller.js` | One attempt per page load, plus the retry loop |
| `src/popup.js` | Start / Stop buttons and status |

## Tests

```
node --test test/
```

No dependencies.

## Note

Automating a queue may be against the site's terms of service. That is your call.
