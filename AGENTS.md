# AGENTS.md

How this project works, for AI coding assistants and for people. Read **section 2 (hard rules)** before changing anything: each rule exists because breaking it cost real debugging on real hardware.

## 1. What this is

A Steam **Big Picture screensaver** made of plain HTML and JavaScript (no build step, no runtime dependencies). It plays **dweets** (tiny golfed JavaScript canvas animations from [dwitter.net](https://www.dwitter.net)) full screen, one at a time, and switches to a new random one every `ROTATE_SECONDS` (default 60). It works offline: the dweets come from a database file, `dwitter/dweets.js` (the [Dweetabase](https://dweetabase.3d2k.com) dump, about 12 MB, 26,161 dweets in the 2026-07-29 snapshot), which each user downloads once. **The database is not in the repository.**

Status: runs end to end on a Steam Machine (SteamOS) with the default config. Steam Deck and Windows have the same folder layout but were not tried.

```
dwitter/                      THE SCREENSAVER: this folder is what gets copied into Steam
  index.html  main.css  main.js   the stage: boot, database, frames, rotation, cross-fade, hints, DEBUG overlay
  config.js                       user settings (global CONFIG), edited in the installed copy
  selection.js                    INCLUDE/EXCLUDE presets, eligibility filters, shuffle order (UMD: browser + Node)
  health.js                       checks on a playing dweet (UMD: browser + Node)
  runner.js                       the dweet player, a port of Dwitter's; its source also runs in the inline frames
  runner.html                     the same player as a page of its own: fallback frame only
  custom-dweets.js                the user's own dweets (global CUSTOM_DWEETS)
  blocklist.js                    generated: ids known to be bad (global BLOCKLIST)
  NOTICE.md  LICENSE-dwitter.txt  Apache-2.0 notices for runner.js
  dweets.js                       NOT in the repository (git-ignored): the database
get-database.sh  install.sh       scripts for users (macOS, Linux, SteamOS)
LICENSE                           MIT, for everything except runner.js (see section 16)
README.md  AGENTS.md              user documentation, and this file
tools/                            development only
  e2e.test.mjs  selection.test.mjs  health.test.mjs    tests
  verify.mjs                      plays dweets in Chrome to build the blocklist; soak test
  lib/browser.mjs                 dependency-free Chrome DevTools client + static file server
  out/                            git-ignored scratch written by verify.mjs
```

## 2. Hard rules

1. **Never load a frame by its address in the normal path.** Steam shows a custom screensaver at `https://uioverride-<folder>.steamscreensavers.host/index.html`: a host name that exists only inside Steam (it is not in public DNS; Steam answers requests for it from the folder). Any *navigation* that Steam does not answer falls through to a real DNS lookup, fails, and Steam shows a full-screen **"Error Code: -105. Unable to connect to server"** page (`ERR_NAME_NOT_RESOLVED`). An earlier version loaded `dbloader.html` and `runner.html` with `<iframe src>` and showed exactly that on a Steam Machine. Failed *subresource* requests (scripts, `fetch`, CSS, images) never produce that page; only navigations do. So: dweets run in `sandbox="allow-scripts"` **`srcdoc`** frames (no request at all), and `runner.html` is only an automatic fallback (`RUN_MODE: "auto"` switches to it once, and only when inline frames never start). No links, forms, `window.open` or `location` changes anywhere.
2. **`index.html` follows Valve's own example screensaver:** external `defer` scripts and one stylesheet, no inline `<script>` or `<style>`, relative URLs only, nothing from another host. Every file the page needs is in its folder.
3. **The database is read as data and never executed** (in the default modes). `fetch("dweets.js")`, cut off the `let dweets = ` prefix and the trailing `,];`, `JSON.parse` (`parseDatabase()` in main.js; the dump is plain JSON inside that wrapper). `DATABASE_MODE: "direct"` (run it as a script) is an explicit opt-in, and `"auto"` only falls back to a script tag when the file cannot be fetched at all (for example under `file://`). Do not `eval` the file, and do not bring back a "sandboxed database loader" frame: it needed a frame loaded by address (rule 1).
4. **Dweets are untrusted code.** Each runs in its own fresh `sandbox="allow-scripts"` frame (never add `allow-same-origin`) under the policy `RUNNER_CSP` in main.js: `default-src 'none'`, scripts and styles only inline (plus `'unsafe-eval'`, which dweets need), images and media only from `data:` and `blob:`, no forms. runner.html carries the same policy except that its script comes from `'self'`. Dweets have no network, no storage and no access to the parent page or anything Steam exposes to it. Everything a frame posts back goes through `sanitize()` and a rate limit.
5. **`DwitterRunnerMain` must stay self-contained.** main.js embeds `DwitterRunnerMain.toString()` into the inline frame, so anything it uses from outside its own function silently breaks the inline frames. The end-to-end tests catch this.
6. **Keep the player faithful to dwitter.net** (section 5). Dweets are one-line programs that depend on the exact globals, timing and quirks of Dwitter's player.
7. **The only text on screen is the dweet's credit (`#attribution`), setup hints (`#hint`) and the opt-in DEBUG overlay.** The credit must stay legible over any picture, because a dweet can draw anything under it: white text, a dark outline built from eight `text-shadow`s (it works in every browser) and a soft glow. A solid-coloured chip would hide part of the picture, and black text with a white outline reads worse on dark pictures. Names in it come from files somebody else produced, so they only ever go in through `textContent`, never `innerHTML`.
8. **Never commit `dwitter/dweets.js`, a copy of the dump, or other people's dweets.** Dweets belong to their authors; users download the database themselves (`get-database.sh`). `custom-dweets.js` ships with a single example that was written for this project.
9. **No dependencies and no build step.** Browser code is plain classic scripts (no modules, no bundler). Tools need only Node 22.4+ and an installed Chrome, Chromium or Edge, driven over the DevTools protocol by `tools/lib/browser.mjs`.
10. **A dweet cannot be stopped from navigating its own frame.** The Navigation API fires no events inside sandboxed `srcdoc` frames (tested), so protection is layered: `leavesPage()` in selection.js keeps dweets that mention `location`, `.href`, `open(`, `history`, `sendBeacon`, `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource` or `import(` out of every selection (d/5100 redirects to dwitter.net on its first frame), and the parent removes any frame that fires a second `load` (`navigated`, immediately).
11. **Never make a dweet frame translucent: no `opacity` below 1, `filter`, `mask`, `mix-blend-mode` or `backdrop-filter` on the iframe or on anything around it.** With GPU compositing (what Steam's browser uses, and what a headed browser uses by default), a cross-origin frame that is partly transparent, or inside something that is, is drawn on top of an *opaque white background*: the picture is blended with white instead of with what is underneath. A frame waiting at `opacity: .01` turns the whole screen white (instantly, for as long as it waits), and a frame fading in goes from white to its picture. An earlier version did exactly this, and a viewer reported that the screen "flashbangs" at every change. It was invisible on a Mac in software-compositing mode, and in the test harness, which launches Chrome with `--disable-gpu`. Wrapping the iframe in a `div` and fading that does not help (tried). It only happens when the frame is out of process (site isolation, which `sandbox` without `allow-same-origin` gets by default): with `--disable-site-isolation-trials --disable-features=IsolateSandboxedIframes,SitePerProcess`, or with software compositing, it does not happen. What works, and is what main.js does: every frame is fully opaque, a frame that waits is *underneath* the one on screen (`z-index` 0 against 1, so it is hidden by occlusion and still runs at full speed), the first dweet waits under the curtain (a black `div` that is above the frames), and the change from one dweet to the next dips through the curtain, which is an ordinary element and can be translucent. There is therefore no cross-fade, by design. **The curtain must also never be fully opaque** (`CURTAIN_DARK` is 0.99): the browser stops giving animation frames to a frame that is completely hidden behind something it knows to be opaque, such as a solid colour at 100%, so a first dweet waiting under a fully black curtain never started (measured in software and GPU mode: it never became ready, unless something forced a repaint, such as a screenshot; at 99% it started in about a second). Iframes never count as known-opaque, which is why a frame can wait underneath another one (tested with an animating and with a static dweet on top). The checks are the e2e tests "with GPU compositing ..." (which launches Chrome with `launchBrowser({ gpu: true })` and asserts the brightness never goes above the dweets' own, that a waiting dweet is invisible, and that the curtain stays below 1) and every rotation test (a curtain at 100% stalls them); if you touch anything that stacks, hides or fades frames, run them.

## 3. How Steam runs a custom screensaver

Established from Valve's example (`steamui/screensavers/bouncinglogo`), Steam's UI bundle (`steamui/sp.js`, mirrored publicly by SteamDatabase/SteamTracking), other people's custom screensavers, and testing on hardware:

- **Where:** `<Steam>/config/uioverrides/screensavers/<folder>/index.html` (`~/.steam/root/...` on SteamOS, `C:\Program Files (x86)\Steam\...` on Windows). One folder is one screensaver; it is listed under Settings > Customization > Screensaver as "*folder* (User Created)", and *Test your screensaver selection* previews it. There is no manifest, and the folder name is the id.
- **How:** Steam creates a dedicated BrowserView (`SteamClient.BrowserView.Create` with `bBrowserViewDomainMapping`) each time the screensaver starts and loads `https://uioverride-<folder>.steamscreensavers.host/index.html`. Input is blocked and any input dismisses the screensaver, so the page handles no input. The page is new on every activation, so anything that must survive lives in `localStorage` (all uses are guarded; it may not persist).
- **Valve's example** is `index.html` + `main.js` + `main.css` and uses nothing Steam-specific (no API).
- **Known to work** (default config, on a Steam Machine): loading from the mapped host, many sibling files, inline sandboxed frames, and `new Function` inside them. DEBUG shows whether the database was read as data or through the script fallback.
- **Not known:** whether Steam replaces the whole view when a *sub-frame* navigation fails (the -105 incident points that way), performance on a Steam Deck, whether `localStorage` persists between activations.
- Steam's error text comes from `resource/vgui_english.txt` (`vgui_Webkit_connectionproblem`).

## 4. How it runs (main.js)

**Boot**, in `boot()`: `readConfig()` merges `CONFIG` over `DEFAULTS`, validates every value (a bad one becomes a hint plus the default) and applies the developer URL parameters. `loadDatabase()` reads `dweets.js`. `Selection.buildDatabase({dweets, custom: CUSTOM_DWEETS, blocklist: BLOCKLIST})` builds the records, `Selection.resolve(db, cfg)` makes the **pool**, and `Selection.createOrder(pool, {storage, key})` makes the shuffled order. Then `startNext()`.

**The credit**: `renderAttribution()` shows `state.current.rec.attribution` (see `Dweet.attribution` in section 7) in the place named by `ATTRIBUTION_POSITION`. It is called when a dweet is revealed and when the on-screen dweet is taken away: the old credit fades out during the first half of the change, and the new one is put there half a `TRANSITION_MS` (plus `CREDIT_MARGIN_MS`) later and fades in during the second half (the CSS variable `--fade` is half of `TRANSITION_MS`). The place is the `data-at` attribute of `#attribution` (for example `bottom-left`), set by `placeCredit()`, and the styles for each place are in main.css. `RANDOM` (for OLED screens, where a fixed line of text can burn in) makes `placeCredit()` pick a place other than the previous one for every dweet; it runs in the same timeout that swaps the text, when the credit is faded out, so it never visibly jumps. With `BOTTOM_MIDDLE` or `RANDOM`, body gets the class `credit-bottom-middle`, which lifts `#hint` clear of the credit. The credit, the hints and the DEBUG overlay come after the curtain in the page, so they are drawn above it.

**One dweet**: `startNext()` takes the next dweet that is not in `state.skipped` or `state.flashy` and builds an *attempt* `{rec, frame, monitor, holdUntil, ...}`. `createFrame()` makes the sandboxed iframe (`srcdoc = buildSrcdoc()`, or `src = "runner.html"` in iframe mode), fully opaque (rule 11) and at `z-index: 0`, which is underneath the dweet on screen (`z-index: 1`); the first dweet waits under the curtain. The runner posts `ready`; main.js answers `{type: "run", code, background}`; the runner compiles and loops and posts `stats` about every 250 ms. `onMessage()` sanitises each message and feeds `attempt.monitor.push()` (health.js). When the monitor says `ready` (30 frames, something painted), `settle()` reveals the attempt at once or, when `attempt.holdUntil` is still in the future, waits for it with `attempt.holdTimer`. `reveal()` calls `change(previous, attempt)`, which is the dip through the curtain (below), and `scheduleRotation()` plans the next switch. At most two frames exist at any time. When the page is hidden the timer stops; when it is shown again `onVisibility()` starts a fresh dweet.

**The curtain and the change** (rule 11 is why). `curtain` is a black, full-screen `div` created by main.js right after `#stage`, with its properties set from script (so a stale main.css cannot break it); `setCurtain(opacity, ms, easing)` is the only thing that animates. It starts at `CURTAIN_DARK` (0.99, never fully opaque: rule 11), so the first dweet is hidden while it starts but still runs. `change(previous, attempt)`: with a previous dweet the curtain goes dark over the first half of `TRANSITION_MS` (`halfFade()`; the old dweet keeps running under it), then `swap()` runs: the new frame gets `z-index: 1` and the class `visible` (a marker; the tests and DevTools use it), the old frame is removed, and the curtain lifts over the second half. With no previous dweet (the first one, or after a cut) it only lifts, over the whole `TRANSITION_MS`. With `TRANSITION_MS` 0 it is a hard cut. `state.swap` and `state.swapTimer` hold a change that is under way: `finishChange()` completes it at once when another reveal arrives, and `blackout()` (a dweet was cut: `flash`, `navigated`, `flooding`) cancels it, removes the old frame, and darkens the curtain instantly (followed by `void curtain.offsetWidth`, so that the next change starts from dark, not from wherever the curtain was).

**Timeline** (why the screen does not show an empty canvas). A dweet is *current* for `ROTATE_SECONDS`, from its reveal to the next one's. `scheduleRotation()` (called by `reveal()`) starts a timer for `startNext()` after `max(ROTATE_SECONDS * 1000 - lead, halfFade() + FADE_MARGIN_MS)`. `lead` is `preloadMs()`: `PRELOAD_SECONDS`, cut down so that the dweet being replaced (removed half a `TRANSITION_MS` after its reveal) is gone before the next one starts, and 0 when `ROTATE_SECONDS` is 0. `startNext()` gives the new attempt `holdUntil = now + preloadMs()`, or 0 when nothing is on screen (the first dweet, or after a cut: there is nothing to dip from). So the next dweet has been running out of sight for `lead` ms when it is shown, and the pace stays one dweet every `ROTATE_SECONDS`. A replacement for a dweet that failed also waits `preloadMs()`, and so does the fresh dweet when the page is shown again. Why: many dweets start from an empty (bright) canvas. Measured on 72 dweets of the default pool, at the 30-frame mark where a dweet used to be shown, 1 in 4 showed less than half of its final picture and 1 in 8 looked blank (a black dweet to d/11085 went from brightness 0.01 to 0.65 in half a second). The brightness of the picture is within 0.15 of its final value for 83% of dweets after 0.5 s, 89% after 2 s, 94% after 5 s and 99% after 7.5 s, hence the default of 5 s. Details that matter: flash detection keeps running while a dweet waits, so one that flashes from the start is usually caught before it is shown; a waiting dweet that has gone quiet (`HOLD_STALL_MS`) is dropped instead of shown; when the current dweet is cut `release()` shows the waiting one at once; the speed check starts `max(1000, halfFade() + 500)` ms after a reveal (`fpsGraceMs`), so that it does not measure the overlap with the old dweet.

**Failures**, in `fail(attempt, result)`. Reasons: `compile-error`, `runtime-error`, `blank`, `slow`, `flash`, `stalled`, `no-runner`, `navigated`, `flooding`.
- `no-runner` (the frame never said `ready` within `START_TIMEOUT_MS`, 6 s) before a reveal: `switchRunMode()` flips inline <-> iframe once (`state.autoSwitched`; never under `file://`), and the attempt is retried.
- A pinned dweet (`?id=`) stays on screen whatever happens.
- Otherwise the id goes into `state.skipped`; `flash` ids are also saved in `localStorage` for good. `flash`, `navigated` and `flooding` take an on-screen dweet away at once; `slow` or errors on a revealed dweet keep it until a replacement is ready. Failures before a reveal retry up to `MAX_ATTEMPTS` (3), then `diagnose()` may show a hint and the next try comes after `RETRY_MS` (10 s).
- `checkStalled()` runs every 2 s: no message from the current dweet for `STALL_MS` (10 s) is `stalled`; nothing shown 30 s after boot shows the "Nothing has been shown yet" hint.

**Database** (`loadDatabase()`): `"auto"`/`"data"` call `readDatabaseAsData()` (`fetch` with `cache: "no-cache"` and a 15 s abort, `parseDatabase()`, `plainEntries()` keeps only the fields in use and drops the comments); `"auto"` then falls back to `loadDatabaseDirect()` (a `<script>` tag) only if the fetch itself failed. A file that was fetched but is not plain data gives `dweets: false` and the "not in the expected format" hint, and is not run. `buildDatabase` treats `null` as missing, a non-array as invalid, an array as ok.

**Run mode**: `RUN_MODE: "auto"` starts with inline frames, unless `DwitterRunnerMain` is not loaded or `localStorage["dwitter.runMode"]` records that inline frames failed within the last 3 days.

## 5. The runner (runner.js)

A port of Dwitter's own player (`dwitter/templates/dweet/dweet.html`, commit `84bc3bf`, Apache-2.0; the list of changes is in NOTICE.md and must be kept current). What follows is deliberate fidelity:

- A real DOM canvas `c`, 1920x1080, CSS width 100% and clipped by the frame. Dweets that make `c.width` smaller are scaled up by the page. `x = c.getContext("2d")`. Globals: `S = Math.sin`, `C = Math.cos`, `T = Math.tan`, `R(r, g, b, a)` (returns an `rgba()` string), `FPS = 60`, `frame`, `time`, `u` (the compiled function), `code`.
- Dweets are compiled with `new Function("t", code)`, so they can only see globals: that is why everything is a real global. The fallback is `(0, eval)("function u(t){\n" + code + "\n}")`. Packed dweets `eval(unescape(escape`...`.replace(...)))` are unpacked first, with Dwitter's regex.
- Loop: `requestAnimationFrame`, capped at 60 fps (frames that come early are skipped, for 120 Hz screens); `time = frame / 60; time += frame && 0.000001` (intentional, from Dwitter, and dweets depend on it); `frame++` happens *before* `u(time)` is called.
- An error in the dweet is counted, reported, and **rethrown after the frame**, as Dwitter does, so the next frame still runs.
- The canvas and the page around it are painted with `BACKGROUND_COLOR` (white by default, as on dwitter.net). Dweets draw on a transparent canvas, so this is what shows wherever they draw nothing. It goes on the body as well as the canvas, so a dweet that makes its canvas shorter than the frame still has one colour all round. The runner is handed a plain opaque `rgb()` (see §8), and the probe measures pictures against it.
- **Probe:** about every 60 ms the visible part of the canvas is drawn into a 64x36 canvas and reduced to `[time, linear luminance, hash, number of pixels that differ from the background]`. This feeds the flash, blank and static checks. The hash also covers `styleSignature()` (inline style and markup), so dweets that animate through CSS count as changing. A dweet that removes or hides its canvas counts as not painting.

**Messages.** Frame to parent (`parent.postMessage(msg, "*")`): `{type: "ready"}`; `{type: "error", phase: "compile" | "runtime", message, frame}`; `{type: "stats", frame, now, ok, err, painted, bg, samples}`. Parent to frame: `{type: "run", code, background}` (the frame checks `event.source === parent`); the runner also understands `{type: "stop"}`, which the screensaver no longer sends, because a dweet that is replaced keeps running until its frame is removed. On the parent side `onMessage()` finds the attempt by `event.source`, allows 60 messages a second per frame (over 500 dropped ones is `flooding`), and keeps at most 32 samples per update, finite numbers only, strings cut to 300 characters.

## 6. Health checks (health.js)

`createMonitor(options).push(msg)` returns `null`, `{type: "ready"}` or `{type: "fail", reason, detail}`. Thresholds are in `DEFAULTS` at the top of the file:

| Check | Rule |
| --- | --- |
| ready | at least 30 frames and 4 updates, and something painted (or the background or style changed) |
| `compile-error` | immediately |
| `runtime-error` | 3 updates in a row in which at least 8 frames threw and none succeeded (one failing first frame is fine: d/4671) |
| `blank` | nothing painted after 180 frames |
| `flash` | brightness reversals of 10% or more, with the darker side under 0.8, at least 6 in a second, in two separate one-second windows. A WCAG-style heuristic on whole-picture brightness: it can miss flashing in a small area |
| `slow` | measured speed under `MIN_FPS`, after a 1 s grace and a 2.5 s window |

`evaluateLog()` (used by tools/verify.mjs, not by the screensaver) adds `static` (120 or more frames and at most one distinct picture) and `incomplete`. The screensaver does not skip static dweets; verify.mjs puts them in the blocklist.

## 7. Selection (selection.js)

- `Dweet` records: `id, username, awesome_count, posted, remix_of, tags, source` (`"database"`, `"custom"` or `"builtin"`), and a `code` getter (database code is `escape()`-encoded, so it is `unescape`d). `remix_of` chains give each record a family (the root of its remix chain). A custom dweet whose id collides with a database id is skipped with a warning.
- **Presets** (case-insensitive; `INCLUDE` and `EXCLUDE` take one, a list that is a union, or a function `(dweet) => boolean`): `ALL`, `TOP_n`, `MIN_LIKES_n`, `ALL_BY_USERNAME_x`, `TOP_n_BY_USERNAME_x`, `TAG_x`, `IDS_a,b`, `CUSTOM`. `EXCLUDE` is subtracted from the `INCLUDE` result.
- **Eligibility** is applied to `INCLUDE` *before ranking* (so `TOP_100` still returns 100): not in the blocklist; `!leavesPage(code)` always; `!isUnsuitable(code)` when `EXCLUDE_INTERACTIVE` is on (input handlers, `addEventListener`, `AudioContext`, `new Audio`). Both also look inside packed code through `unpack()`, which only follows a whitelisted pattern and never evaluates anything. `IDS_` bypasses eligibility; `EXCLUDE` matches without it.
- **Fallbacks:** an `INCLUDE` that matches nothing falls back to `DEFAULT_INCLUDE` (`["MIN_LIKES_20", "CUSTOM"]`) with a warning, and then to the built-in dweet, so the screen is never blank.
- **The credit text** is `Dweet.attribution`: `by <username> · dwitter.net/d/<id>` for a database dweet (just the address when the username is empty), `by <username>` for a custom dweet (nothing when it is empty), and nothing for the built-in one. Names are cleaned first (control and text-direction characters removed, whitespace tidied, 40 characters at most). It lives on the record so that Node tests can reach it.
- **Order** (`createOrder`): a shuffle bag. Every dweet is shown once per cycle in a seeded random order (mulberry32). The same author is kept at least 3 apart and the same remix family at least 10 apart, relaxed automatically for small pools. The position is saved as `localStorage["dwitter.bag." + signature]` = `{v: 1, seed, pos, skip, recent}`; `signature()` hashes INCLUDE, EXCLUDE and every id in the pool, so any change starts a new shuffle.
- The user-facing strings for a missing, invalid or unmatched selection are in `MESSAGES`.

## 8. Configuration

`DEFAULTS` in main.js is the source of truth for defaults. `readConfig()` validates, and `config.js` documents each key for users.

| Key | Default | Valid values |
| --- | --- | --- |
| `INCLUDE` / `EXCLUDE` | `["MIN_LIKES_20", "CUSTOM"]` / `[]` | presets, a list of them, or a function |
| `ROTATE_SECONDS` | 60 | 0 (never switch) or 5 and up |
| `TRANSITION_MS` | 2000 | 0 to 5000; the whole change (dark over the first half, light over the second), not a cross-fade (rule 11) |
| `PRELOAD_SECONDS` | 5 | 0 to 60; cut down automatically when `ROTATE_SECONDS` is short (see `preloadMs()` and the timeline in section 4) |
| `MIN_FPS` | 30 | 0 (never skip) to 60 |
| `FLASH_GUARD`, `EXCLUDE_INTERACTIVE`, `DEBUG` | true, true, false | booleans |
| `FIT` | `"contain"` | `"contain"`, `"cover"` |
| `BACKGROUND_COLOR` | `"white"` | any CSS colour (the old name, `CANVAS_BACKGROUND`, is still read when `BACKGROUND_COLOR` is absent) |
| `HINT_SECONDS` | 10 | 1 to 600 |
| `ATTRIBUTION_POSITION` | `"BOTTOM_LEFT"` | `TOP_LEFT`, `TOP_MIDDLE`, `TOP_RIGHT`, `BOTTOM_LEFT`, `BOTTOM_MIDDLE`, `BOTTOM_RIGHT`, `RANDOM` (a different one of those six for every dweet), `OFF`; any capitalisation, spaces or dashes for underscores, and `false` for `OFF` |
| `RUN_MODE` | `"auto"` | `"auto"`, `"srcdoc"`, `"iframe"` |
| `DATABASE_MODE` | `"auto"` | `"auto"`, `"data"`, `"direct"` |

`BACKGROUND_COLOR` is checked with `CSS.supports("color", …)`, and a bad value gets a hint and falls back to white. `CSS.supports` also accepts `inherit` and `var(--x)`, which a canvas silently paints black, so the value has to get through `solidColour()` in main.js as well: it paints the value onto a 1x1 canvas and reads it back as a plain opaque `rgb()`, or returns `null` when the canvas ignored it (detected by starting from two different colours). Anything translucent is laid over black, which is what shows behind the screensaver (`transparent` becomes black). That is the only way to read every notation (`oklch()`, `color-mix()`, names, 8-digit hex), and it hands the runner something its probe can parse, so the flash and blank checks measure against the colour the viewer really sees: `getComputedStyle()` serialises `oklch()` and `color-mix()` colours in their own notation, which the probe cannot read. Do not pass the user's raw string on to the runner. The old name `CANVAS_BACKGROUND` is read when `BACKGROUND_COLOR` is absent.

Developer URL parameters (open `index.html` over http, for example `python3 -m http.server --directory dwitter 8000`): `?id=` pins one dweet and turns DEBUG on, `?rotate=`, `?include=` and `?exclude=` (presets separated by `|`), `?minfps=`, `?mode=srcdoc|iframe`, `?debug=1`.

## 9. State kept in `localStorage`

Every access is guarded, because storage may be unavailable.

| Key | Content |
| --- | --- |
| `dwitter.flashy` | ids that tripped the flash guard; never shown again |
| `dwitter.runMode` | `{mode: "iframe", at}` after inline frames failed to start; ignored after 3 days |
| `dwitter.lastRun` | the last 40 log lines of the previous run (DEBUG shows them until the first dweet appears) |
| `dwitter.bag.<signature>` | the shuffle position |

## 10. Diagnosing on the device

`DEBUG: true` (or `?debug=1`) shows an overlay in the top left corner: the current dweet, pool size, mode, frames and fps, the page address (without the query), the last 12 log lines (version, how the database was read and how long it took, mode switches, every skipped dweet as `d/<id>: <reason>`), and, until the first dweet appears, how the previous run ended. The `VERSION` constant in main.js is logged first: **bump it whenever behaviour changes**, so a user can tell which build Steam is actually running.

`window.__dwitter` exists only in debug mode: `{log, events, failures, solidColour, snapshot()}` (`solidColour` is the colour conversion described in §8, exposed so that the tests can try many notations quickly; `snapshot()` includes the resolved `background`, the id of the `pending` dweet and the effective `preloadMs`). The tests and tools/verify.mjs depend on it, so keep its shape.

Steam's remote debugger: create `~/.steam/steam/.cef-enable-remote-debugging`, restart Steam, open `http://<host>:8080`; the screensaver is the target whose URL contains `steamscreensavers.host`, and the console names any address that failed.

## 11. Tests

```sh
node --test tools/*.test.mjs        # unit and end-to-end, about 4 to 5 minutes; everything must pass
```

- `selection.test.mjs` and `health.test.mjs` test the pure modules through `require`.
- `e2e.test.mjs` needs Chrome (skipped without it). Each test copies `dwitter/` into a temporary site (`makeSite(name, {database, config, custom, extraCustom})`) with a fixture database (three dweets, ids 1001 to 1003, in the Dweetabase format) and fixture custom dweets (`good-a/b/c`, and bad ones: `bad-syntax`, `bad-runtime`, `blank`, `flash`, `slow`, `no-canvas`, `probe`). It serves the site over `http://127.0.0.1` and drives the page through `window.__dwitter`.
- **The Steam-like test** is the one that guards rule 1. It starts a second Chrome with `--host-resolver-rules=MAP uioverride-dwitter.steamscreensavers.host 127.0.0.1, EXCLUDE 127.0.0.1, EXCLUDE localhost, MAP * ~NOTFOUND` and a DevTools `Fetch` interceptor that fails every sub-frame document request with `NameNotResolved`. It asserts that no sub-frame was requested, nothing failed to load, and every request went to the one host. If you change how frames or the database load, this test must keep passing.
- Gotchas learned the hard way:
  - With `rotate=0` and a pool of several dweets the first one is random: use `IDS_` with a single dweet, or let it rotate.
  - Every test tab is its own window (`Target.createTarget` with `newWindow`), because background tabs are throttled.
  - The default test browser runs with `--disable-gpu`, i.e. software compositing, and that **hides a whole class of bugs** (rule 11: partly transparent cross-origin frames go white only with GPU compositing). Anything about how frames are stacked, hidden or faded needs a second browser with `launchBrowser({ gpu: true })`, as the "with GPU compositing" test does.
  - Chrome stops painting (and slows `requestAnimationFrame` to a crawl in) cross-origin frames at `opacity: 0`, or when they are off screen or hidden; a frame hidden *under* another opaque frame is not throttled, which is why that is how a frame waits.
  - To read something back from inside a dweet's frame, a test dweet posts `{type: "probe", what, blocked}` to the parent (`what` is cut to 40 characters) and the page keeps it in `window.__dwitter.log` (see `BG_PROBE` and `probeReports()`). To check what the screen really shows, `pixels()` decodes a screenshot of any area (`pixelAt()` is one point of it); allow a tolerance of 2 per channel.
  - The shuffle order comes from `Math.random`, so which dweet is first is random. `startWith(first, ids, extraCustom)` works out, with the real selection.js, a value for `Math.random` that makes the page start with `first`, and returns what to pass to `open()` as `beforeLoad`. `watch(tab, done)` follows the screen about ten times a second (current and waiting dweet, brightness) and is how the transition tests look at what a viewer sees.
  - The shipped config.js is what `makeSite()` copies, so a test that depends on a setting must write its own config (`{ config: "const CONFIG = {};\n" }` for the built-in defaults). The speed check only runs a few seconds after a dweet is shown, so a test about a slow dweet needs a rotation longer than that.
  - Loops that call `failures(tab)` or read `window.__dwitter` before the page has finished booting must tolerate the error; `until()` already does.
  - Sandboxed frames cannot load external scripts under `file://`; that is why the inline frame exists and why the database falls back to a script tag there.
  - To emulate a page whose policy forbids inline scripts, serve `index.html` with `Content-Security-Policy: script-src 'self'`; inline frames inherit it and never start.
  - Keep the generous timeouts: Chrome start-up time varies.

## 12. Tools and scripts

- `node tools/verify.mjs` plays every dweet of the default selection (about 1,575, 30 to 40 minutes at 4 windows) in a real Chrome through `?id=...&mode=srcdoc`, judges each with `Health.evaluateLog`, and writes `tools/out/`. `--write-blocklist` regenerates `dwitter/blocklist.js`; `--fresh` re-checks blocklisted dweets; `--no-cache`, `--only ids`, `--include spec`, `--limit n`, `--concurrency n`. `--soak` runs 60 fast rotations (2 s apart, through a temporary copy of the site with a 500 ms fade and a 1 s pre-load, so that the hold-and-reveal path is exercised) and checks that the heap, the DOM and the number of frames stay flat. It needs the real database (`./get-database.sh`).
- `tools/lib/browser.mjs`: `startServer(root, {headers})`, `launchBrowser({chrome, args, gpu})` (software compositing unless `gpu: true`) giving `newTab(url)` and `close()`, and a `Tab` with `send`, `on(event, handler)`, `onMessage`, `goto`, `evaluate`, `screenshot`, `close`.
- `get-database.sh [folder]` downloads the dump with curl, checks size, first and last bytes, and keeps the previous copy as `dweets.js.bak`.
- `install.sh [user@host]` copies `dwitter/` into Steam's folder (locally, or over SSH with rsync). It never overwrites an existing `config.js` or `custom-dweets.js` (it writes `.new` next to them), and it removes the files listed in `LEFTOVERS`.

## 13. Making changes: what else to touch

| If you... | Also do |
| --- | --- |
| add a config key | `DEFAULTS` and validation in `readConfig()`, `config.js` comment, README settings table, a test |
| add a selection preset | `parseItem()` and `evaluate()` in selection.js, README preset table, `config.js` comment, a unit test |
| add an exclusion filter | the regex in selection.js (`UNSUITABLE` or `LEAVES_PAGE`), keep the `unpack()` check, unit tests |
| change a health threshold | `DEFAULTS` in health.js, health.test.mjs, then re-run `verify.mjs` (the blocklist may change) |
| change runner.js | rule 5, NOTICE.md's list of changes, the full e2e run, `verify.mjs --only` on a few known dweets (701, 1494, 4671 which errors once on frame 1, 20478 which is heavy recursion), and `--soak` |
| change how frames or the database load | rule 1 and the Steam-like e2e test |
| delete or rename a file in `dwitter/` | add the old name to `LEFTOVERS` in install.sh, update the README file table |
| change behaviour in any way | bump `VERSION` in main.js |
| meet a new database format | `parseDatabase()`, `looksLikeDatabase()`, the e2e fixture, the head and tail checks in get-database.sh |

## 14. Decisions already made by the owner

Do not reopen these without being asked:

- The Dweetabase dump is the only source of dweets; stale like counts are fine. The default pool is dweets with 20 or more likes (about 1,500 after the filters).
- A new dweet every minute, configurable in `config.js` (`ROTATE_SECONDS`).
- Selection is config-driven through presets (`INCLUDE` and `EXCLUDE`).
- Every dweet is credited on screen by default ("by <author> · dwitter.net/d/<id>"), in a place the user can choose (`ATTRIBUTION_POSITION`; `RANDOM` moves it with every dweet, for OLED screens) or switch off. This replaced an earlier decision to show no attribution at all.
- The database is not in the repository; the README explains how to download it, by browser or by script, and how to install by hand or by script.
- The folder is called `dwitter`, so Steam lists it as "dwitter (User Created)".
- The canvas colour is a setting, `BACKGROUND_COLOR`: white by default (how Dwitter shows dweets), any CSS colour allowed. The owner's reason is to be able to use a light grey that is easier on the eyes.
- Changing from one dweet to the next must be gentle (a viewer said the screen "flashbangs" at every change, going back to the white canvas for a second; on a Steam Machine it turned out to be the GPU-compositing bug in rule 11, made worse by the first attempt at a fix): the next dweet is loaded early and runs out of sight under the one on screen (`PRELOAD_SECONDS`), and the screen dips through black to the next one (`TRANSITION_MS`, 2 s by default). The owner accepted dropping the cross-fade for this.
- `dwitter/dweets.js` is the owner's local copy of the database. It is git-ignored and stays where it is: never delete, move or overwrite it, not even as tidying up before publishing. The owner removes it by hand when they want to.
- The project is MIT licensed. The owner does not feel the need to protect the code.

## 15. Known limits

- The flash guard is a heuristic and says so in the README.
- A dweet with an endless loop freezes the screensaver until it is dismissed (it shares a process with the page).
- Around every switch two dweets run at once: for `PRELOAD_SECONDS` out of sight, then for half of `TRANSITION_MS` while the screen goes dark. A slow device may feel that; `PRELOAD_SECONDS: 0` turns it off. The speed check starts `max(1000, halfFade() + 500)` ms after a reveal and needs 2.5 s of data, so a dweet that is on screen for less than about 4 s (`ROTATE_SECONDS` of 4 or less) is never checked for speed.
- The change dips through black and is not a cross-fade (rule 11). A dark dweet followed by a light one is still a big change in brightness; a longer `TRANSITION_MS` only spreads it out.
- `static` detection can have false positives, and `blocklist.js` was generated for one database snapshot.
- Not tried on a Steam Deck or on Windows.
- `BACKGROUND_COLOR` only shows where a dweet draws nothing. In a sample of 60 dweets of the default pool, about half were mostly that colour, one in eight showed it in part, and four in ten painted over everything. A CSS `contrast()` filter on the canvas (d/17628) turns any light grey to white, and a dark colour hides the many dweets that draw in the default black.
- A fixed credit could burn into an OLED screen that the screensaver keeps lit for hours. `RANDOM` spreads it over six places and `OFF` removes it; the README says so. Pixel shifting, or a credit that fades out after a while, would be the next steps if that is not enough.

## 16. Style and licensing

- **Markdown: one line per paragraph or list item, never hard-wrapped** (README.md, AGENTS.md, dwitter/NOTICE.md). Renderers join the lines anyway, but an editor that soft-wraps them, or a preview that turns newlines into line breaks, shows every forced break as a ragged line. Let the editor wrap. Only code comments are wrapped by hand, at about 120 columns.
- Browser files are IIFEs with `"use strict"`; the runner uses `var` and plain functions because it is embedded as text; selection.js and health.js use a UMD wrapper so Node can `require` them. Comments only where the code is not obvious. User-facing text is short and plain. Keep README.md, config.js and this file in step with the behaviour.
- The project is released under the MIT License (`LICENSE`), except `runner.js`: it is derived from Dwitter (Apache License 2.0), so keep NOTICE.md and LICENSE-dwitter.txt next to it and the list of changes current. Dweets belong to their authors: never add other people's dweets to the repository.
