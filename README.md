# Dwitter screensaver for Steam

A screensaver for Steam's Big Picture mode that plays [Dwitter](https://www.dwitter.net) dweets, the tiny JavaScript animations, full screen and switches to a new random one every minute. It works offline: the dweets come from a database file that you download once. (Note: You alone are responsible for what appears on your TV while using this screensaver)


https://github.com/user-attachments/assets/c75cde27-7089-45cd-976a-5443a04c8afd


**Status:** working on a Steam Machine running SteamOS. Steam Deck and Windows use the same folder layout, but have not been tried. If some dweets cause any kind of crashing, please open an issue.

## Quick start

1. **Get the database** (once, about 12 MB): see [Getting the database](#getting-the-database).
2. **Install the screensaver**: see [Installing](#installing).
3. In Steam, open **Settings > Customization > Screensaver** and choose `dwitter (User Created)`. The button *Test your screensaver selection* previews it.

## Getting the database

The screensaver reads a copy of the [Dweetabase](https://dweetabase.3d2k.com), an archive of every dweet (about 26,000). It is not part of this project, so you download it yourself.

**In a browser:** open <https://dweetabase.3d2k.com/dweets.js>, save the page as `dweets.js` (Ctrl+S, or right-click and *Save As*) and put the file in the `dwitter` folder: the one in this project, or the one you installed into Steam.

OR:

**With the script** (macOS, Linux and the Steam Deck; needs `curl`):

```sh
./get-database.sh                       # saves dwitter/dweets.js in this project
./get-database.sh ~/.steam/root/config/uioverrides/screensavers/dwitter      # or straight into the installed copy
```

The script checks that the download is complete before it replaces anything, and keeps the previous copy as `dweets.js.bak`. Run it again whenever you want newer dweets.

Without the database the screensaver only plays the dweets in `custom-dweets.js` and shows a hint saying so.

## Installing

Steam loads custom screensavers from the `config/uioverrides/screensavers` folder inside its own folder, one folder per screensaver. Create the `uioverrides` and `screensavers` folders if they are not there yet. Copy the `dwitter` folder there:

**Manually**

| System | Steam folder | Screensaver goes in |
| --- | --- | --- |
| Steam Deck / SteamOS / Linux | `~/.steam/root` | `~/.steam/root/config/uioverrides/screensavers/dwitter` |
| Windows | `C:\Program Files (x86)\Steam` | `C:\Program Files (x86)\Steam\config\uioverrides\screensavers\dwitter` |


OR:

**With the script** (macOS, Linux and the Steam Deck):

```sh
./install.sh                          # install on this computer
./install.sh deck@steamdeck.local     # install on a Steam Deck over SSH (needs ssh and rsync)
STEAM_ROOT=/path/to/Steam ./install.sh    # if your Steam folder is somewhere unusual
```

Your own `config.js` and `custom-dweets.js` are never overwritten when you install again. If the new versions differ, they are saved next to yours as `config.js.new` and `custom-dweets.js.new`. If `dwitter` does not appear in the Screensaver settings, restart Steam.

## Settings

Everything is in `config.js`, in the installed folder (for example `~/.steam/root/config/uioverrides/screensavers/dwitter/config.js`). Close and reopen the screensaver to apply changes; if that is not enough, restart Steam. Mistakes in the file are shown as a hint on screen for a few seconds.

| Setting | Default | What it does |
| --- | --- | --- |
| `INCLUDE` | `["MIN_LIKES_20", "CUSTOM"]` | Which dweets may be shown, see below. |
| `EXCLUDE` | `[]` | Dweets to leave out; same syntax as `INCLUDE`. |
| `ROTATE_SECONDS` | `60` | Seconds before the next dweet (minimum 5). `0` = never switch. |
| `TRANSITION_MS` | `500` | Cross-fade between dweets. `0` = hard cut. |
| `MIN_FPS` | `30` | Dweets that run slower than this on your device are skipped. `0` = never skip. |
| `FLASH_GUARD` | `true` | Skip dweets that flash rapidly (see [Safety](#safety)). |
| `EXCLUDE_INTERACTIVE` | `true` | Skip dweets that wait for mouse, keyboard or touch, or that play sound. |
| `FIT` | `"contain"` | `"contain"` shows the whole 16:9 picture, `"cover"` fills the screen and crops. |
| `BACKGROUND_COLOR` | `"white"` | The colour of the canvas dweets are drawn on, which shows wherever a dweet draws nothing. Any CSS colour; a light grey such as `"#e6e6e6"` is easier on the eyes than white. Keep it light, because most dweets draw in black. See [Background colour](#background-colour). |
| `HINT_SECONDS` | `10` | How long a setup hint stays on screen. |
| `ATTRIBUTION_POSITION` | `"BOTTOM_LEFT"` | Where the credit for the dweet on screen goes: `TOP_LEFT`, `TOP_MIDDLE`, `TOP_RIGHT`, `BOTTOM_LEFT`, `BOTTOM_MIDDLE`, `BOTTOM_RIGHT`, `RANDOM` (a different one of those with every dweet, for OLED screens) or `OFF` to hide it. |
| `DEBUG` | `false` | Show what the screensaver is doing in the top left corner: the current dweet and a log. See [Troubleshooting](#troubleshooting). |
| `RUN_MODE` | `"auto"` | How dweets are isolated: `"auto"`, `"srcdoc"` (inline frames) or `"iframe"` (`runner.html`). Leave it alone unless you are told otherwise. |
| `DATABASE_MODE` | `"auto"` | How `dweets.js` is read: `"auto"`, `"data"` (never run anything in the file) or `"direct"`. See [Safety](#safety). |

### Background colour

Dweets are drawn on a transparent canvas, and `BACKGROUND_COLOR` is the colour that shows through wherever a dweet draws nothing. White is how dwitter.net shows them. A light grey such as `"#e6e6e6"` (gentle) or `"#d4d4d4"` (clearly grey) is easier on the eyes. Any CSS colour works, in any notation (`"gainsboro"`, `"rgb(230 230 230)"`, `"hsl(0 0% 90%)"`), and a colour with transparency is shown over black. The black bars that `FIT: "contain"` leaves on a screen that is not 16:9 are not part of this and stay black.

It only changes what a dweet leaves empty. In a sample of 60 dweets, about half were mostly that colour, one in eight showed it in part, and the other four in ten paint over the whole picture themselves and ignore it. A few dweets alter their canvas with a CSS filter (`contrast()`, for example) and can turn a grey back to white. Most dweets draw in black unless they say otherwise, so keep the colour light: a dark one hides them.

### Choosing dweets: `INCLUDE` and `EXCLUDE`

Each is a preset, a list of presets (a dweet is included if it matches any of them), or a function.

| Preset | Meaning |
| --- | --- |
| `"ALL"` | every dweet in the database |
| `"TOP_100"` | the 100 most-liked dweets |
| `"MIN_LIKES_20"` | dweets with at least 20 likes |
| `"ALL_BY_USERNAME_<name>"` | everything by one author, for example `"ALL_BY_USERNAME_KilledByAPixel"` |
| `"TOP_10_BY_USERNAME_<name>"` | one author's 10 most-liked dweets |
| `"TAG_<tag>"` | dweets with a tag, for example `"TAG_fractal"` |
| `"IDS_701,1494"` | specific dweets, by id (the number in `dwitter.net/d/701`) |
| `"CUSTOM"` | your own dweets from `custom-dweets.js` |

Names and tags ignore capital letters. Examples:

```js
INCLUDE: "TOP_100",
INCLUDE: ["ALL_BY_USERNAME_KilledByAPixel", "ALL_BY_USERNAME_p01"],
INCLUDE: ["MIN_LIKES_30", "CUSTOM"],
EXCLUDE: ["IDS_4671", "ALL_BY_USERNAME_someone"],
INCLUDE: (d) => d.awesome_count >= 30 && !d.remix_of,    // a function: d has id, username, awesome_count, posted, remix_of, tags, code
```

`TOP_n` counts only dweets that can be shown, so `TOP_100` really gives 100 even if some of the most-liked ones are interactive or broken.

### Your own dweets

Add them to `custom-dweets.js`: give each an `id` (any unique text) and its code as plain text, copied from dwitter.net. They are shown by the `CUSTOM` preset. The file comes with one example that shows the format. The `username` is the credit shown on screen (leave it empty for none); if you add somebody else's dweet, put their name there.

## How it works

- Each dweet runs in its own sandboxed frame, played by a port of Dwitter's own player, so it looks the way it does on dwitter.net: a 1920x1080 canvas, 60 frames per second, and the same `c`, `x`, `S`, `C`, `T`, `R`, `t` and `frame`.
- A new dweet is picked every `ROTATE_SECONDS`. The order is a shuffle that shows every dweet in the pool once before repeating, remembered between sessions, and it keeps the same author (within 3 dweets) and the same remix family (within 10) apart.
- The next dweet warms up behind the current one and fades in once it has drawn something.
- Every dweet is credited on screen: its author and, for dweets from the database, its dwitter.net address ("by KilledByAPixel · dwitter.net/d/36024"). The text is white with a dark outline, which stays readable over whatever the dweet draws. `ATTRIBUTION_POSITION` picks the corner or switches it off. A line of text that stays lit in one spot can burn into an OLED screen, so for those set it to `RANDOM`: every dweet then gets a different place (never the same twice in a row), and the credit only moves while it is faded out. `OFF` is the other safe choice.
- **Nothing is fetched from the internet while it runs.** The only requests the page makes are for the files in its own folder (`main.js`, `dweets.js` and so on). Steam serves those from a made-up host name, see [Error Code: -105](#error-code--105).

### Safety

Dweets are other people's programs, and so is the database file, so the screensaver does not trust either.

- **Sandboxed dweets:** a dweet cannot reach the screensaver page or anything Steam exposes to it, cannot load anything from the network (requests, scripts, images), and cannot store anything. A dweet that tries to send its frame somewhere else, or floods the page with messages, is removed at once, and dweets that navigate away or use the network are never picked in the first place (`IDS_` can still ask for one by name).
- **The database is read as data:** `dweets.js` is a JavaScript file that somebody else produced, but the dump is just a list of plain JSON entries behind `let dweets =`. The screensaver reads it as text and parses it, so nothing in the file is ever run. A file with anything else in it is not used, and you get a hint. Only where a file cannot be fetched at all (for example when `index.html` is opened straight from the file system) is it run as a script instead, unless you set `DATABASE_MODE: "data"`. `DATABASE_MODE: "direct"` always runs it, for a file that is not plain data.
- **Skipped while playing:** dweets that fail to compile or throw on every frame, draw nothing (or hide their canvas), run slower than `MIN_FPS` on your device, or flash. A dweet on screen that stops responding is replaced. `dwitter/blocklist.js` lists ones found to be bad in advance.
- **The flash check is a heuristic.** It looks at the average brightness of the whole picture, modelled on the WCAG rule of at most three flashes per second. It can miss flashing that covers only part of the screen. If you or anyone who watches is sensitive to flashing, do not rely on it: pick a small, hand-checked set, for example `INCLUDE: "IDS_..."`, and look at it first.
- A dweet that contains an endless loop can still freeze the screensaver until it is dismissed, because it shares a process with the page (whether Steam separates them is not something the screensaver can control). If you find one, note its id (set `DEBUG: true`) and add it to `EXCLUDE`.

## Troubleshooting

Valve does not document the screensaver format. This project follows what Valve's own example screensaver and other custom screensavers do: an `index.html` with scripts and styles next to it, and no frames loaded by their address.

- **The screensaver is not listed in Steam:** check the folder is `.../config/uioverrides/screensavers/dwitter/index.html` and restart Steam.
- **Something is wrong and I cannot tell what:** set `DEBUG: true` in `config.js`. The top left corner then shows what the screensaver has been doing (the address it was loaded from, how the database was read, every dweet it skipped and why), and, until the first dweet appears, how the previous run ended. A photo of that screen is the most useful thing to send with a bug report.
- **Hint: "dweets.js was not found or could not be read":** download the database, see [Getting the database](#getting-the-database).
- **Hint: "dweets.js is not in the expected format":** the file is damaged or from a different source. Download it again.
- **Hint: "The dweet player did not start":** where Steam shows the screensaver does not let the inline frames start, and the `runner.html` frame did not start either. Set `DEBUG: true` and see the line about the player.
- **Hint: "Dweets cannot run in this environment":** where Steam shows the screensaver does not allow programs to be compiled on the fly, which dweets need. There is nothing to configure; please report the message.
- **Hint: "Nothing has been shown yet":** something stopped the first dweet from starting, see the `DEBUG` line above.
- **I do not like a dweet:** set `DEBUG: true`, note its id, and add `"IDS_<id>"` to `EXCLUDE`.
- **A dweet looks different from dwitter.net, or is hard to see:** set `BACKGROUND_COLOR` back to `"white"`, which is how Dwitter shows dweets.
- **Too many repeats:** widen `INCLUDE`, for example `"MIN_LIKES_10"` or `"ALL"`.
- **Changes to `config.js` are ignored:** close and reopen the screensaver, then restart Steam. Look for a hint that names a mistake in the file.

### Error Code: -105

If the preview shows a full-screen *"Error Code: -105. Unable to connect to server. Server may be offline or you may not be connected to the internet."*, that is Steam's page for a load that failed (-105 is `ERR_NAME_NOT_RESOLVED`). It does not mean the screensaver is trying to use the internet, or that yours is down.

Steam shows a custom screensaver from a host name that only exists inside Steam, `https://uioverride-<folder name>.steamscreensavers.host/index.html`, and answers requests for it from the screensaver's folder. The name is not in public DNS. Anything the page asks for that Steam does not answer that way falls through to a real name lookup, which fails, and the failure is shown full screen. A frame that is loaded by its address (`<iframe src="...">`) is such a request, which is why this screensaver never loads one: dweets run in inline frames, which involve no request at all, and the database is read with a plain `fetch`, which cannot produce that page. If you still see it:

1. Copy Valve's `bouncinglogo` folder (from `steamui/screensavers/` in the Steam folder) to `config/uioverrides/screensavers/bouncinglogo-test/` and preview that. If it shows the same error, the cause is not in this screensaver.
2. Move `dweets.js` out of the `dwitter` folder and preview again. Without it you should see your custom dweets and a hint about the missing database. If that works, the 12 MB file is what Steam did not like: please open an issue.
3. Set `DEBUG: true`, preview again, and look at what is printed in the corner.
4. If you can reach Steam's remote debugger (`http://<address of the Steam machine>:8080`, which needs the file `~/.steam/steam/.cef-enable-remote-debugging` and a restart of Steam), the console there names the exact address that failed.

## Development

Needs Node 22.4 or newer, and Chrome (or Chromium or Edge) for the browser tools. There are no packages to install. [`AGENTS.md`](AGENTS.md) explains how the code fits together and what not to break; it is written for AI coding assistants but is just as useful for people.

```sh
node --test tools/*.test.mjs                 # unit tests, and browser tests if Chrome is found
node tools/verify.mjs --help                 # play dweets in a real browser and report the bad ones
node tools/verify.mjs --write-blocklist      # check the default selection and update dwitter/blocklist.js
node tools/verify.mjs --soak                 # rotation soak test (memory, leftover frames)
```

The browser tests include one that runs the screensaver the way Steam shows it: on a host name that only the browser knows, with every other name failing to resolve (like -105) and every frame loaded by its address failing too. It checks that the page makes no request that could fail.

To try the screensaver in a desktop browser, serve the folder and add parameters to the address:

```sh
python3 -m http.server --directory dwitter 8000     # then open http://localhost:8000/
```

| Parameter | Effect |
| --- | --- |
| `?id=701` | play one dweet and keep it (also turns on the debug overlay) |
| `?rotate=5` | switch every 5 seconds (any value, `0` = never) |
| `?include=TOP_20\|CUSTOM` | choose dweets (`\|` between presets); `?exclude=` likewise |
| `?minfps=0` | do not skip slow dweets |
| `?mode=iframe` | use the `runner.html` frame instead of inline frames (`?mode=srcdoc` forces the inline ones) |
| `?debug=1` | show the debug overlay |

| File | Purpose |
| --- | --- |
| `index.html`, `main.css`, `main.js` | the screensaver: stage, database, rotation, cross-fade, hints |
| `config.js` | settings |
| `selection.js` | `INCLUDE`/`EXCLUDE` presets, shuffle order (also used by the tools) |
| `health.js` | checks on a playing dweet: errors, blank, slow, flashing (also used by the tools) |
| `runner.js` | the player for one dweet; its source is also what the inline frames run |
| `runner.html` | the same player as a page of its own, for `RUN_MODE: "iframe"` |
| `dweets.js` | the database (not in the repository) |
| `custom-dweets.js`, `blocklist.js` | your dweets; dweets known to be bad |

## License and credits

The project is released under the [MIT License](LICENSE), except `dwitter/runner.js`: it is derived from the player of [Dwitter](https://github.com/lionleaf/dwitter) and stays under the Apache License 2.0. Dweets belong to their authors. The database is the [Dweetabase](https://dweetabase.3d2k.com) by Frank Force. See [`dwitter/NOTICE.md`](dwitter/NOTICE.md).
