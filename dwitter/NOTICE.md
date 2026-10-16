# Notices

## This project

Apart from `runner.js` (see below), the code in this project is released under the MIT License: see the `LICENSE` file in the project's repository. The player, `runner.js`, is a derivative work and stays under the license of the original.

## The dweet player

`runner.js` (the part that plays a dweet) is derived from the dweet player of Dwitter, `dwitter/templates/dweet/dweet.html` in <https://github.com/lionleaf/dwitter> (commit `84bc3bf`). Dwitter is licensed under the Apache License, Version 2.0; a copy of the license is in [`LICENSE-dwitter.txt`](LICENSE-dwitter.txt). Copyright belongs to Dwitter's contributors (<https://github.com/lionleaf/dwitter/graphs/contributors>).

Changes made to the original:

- removed the GIF recorder, the stats panel, the infinite-loop guard and the polyfills for old browsers;
- the dweet is handed to the player by the page that embeds it (`postMessage`) instead of being read from the address;
- the player reports its progress, errors and brightness samples back to that page, which uses them to skip dweets that are broken, blank, slow or flashing;
- the player's page styling is applied from script, so it also works where inline styles are not allowed;
- the colour of the canvas and of the page around it is chosen by the page that embeds the player (the screensaver's `BACKGROUND_COLOR` setting, white by default) instead of being fixed.

The parts that decide how a dweet behaves (the 1920x1080 canvas, `c`, `x`, `S`, `C`, `T`, `R`, `t`, `frame`, 60 frames per second, the way packed dweets are unpacked) follow Dwitter on purpose, so that dweets look the way they do there.

## Dweets

A dweet is a tiny program written by someone on <https://www.dwitter.net>, and it belongs to its author. This project does not contain any dweets by other people: the example in `custom-dweets.js` and the fallback dweet built into `selection.js` were written for it. The database the screensaver reads (`dweets.js`) is a copy of the Dweetabase, <https://dweetabase.3d2k.com>, an archive of Dwitter by Frank Force. It is not part of this repository; each person who installs the screensaver downloads it themselves. The Dweetabase page says: "All dweets are property of their respective creators."

`custom-dweets.js` holds the dweets you add yourself. If you add somebody else's, credit them in its `username` field.

## Layout

The folder layout (`index.html` with `main.js` and `main.css`, no inline script or style) follows the example screensaver that ships with Steam. No code from it is used.
