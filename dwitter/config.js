// Dwitter screensaver settings. Edit this file; changes apply the next time the screensaver starts.
const CONFIG = {

    // Which dweets may be shown: a preset, a list of presets (a dweet is shown if it matches any of them),
    // or a function.
    //
    //   "ALL"                         every dweet in the database
    //   "TOP_100"                     the 100 most-liked dweets
    //   "MIN_LIKES_20"                dweets with at least 20 likes
    //   "ALL_BY_USERNAME_<name>"      everything by one author, e.g. "ALL_BY_USERNAME_KilledByAPixel"
    //   "TOP_10_BY_USERNAME_<name>"   one author's 10 most-liked dweets
    //   "TAG_<tag>"                   dweets with a tag, e.g. "TAG_fractal"
    //   "IDS_701,1494"                specific dweets, by id
    //   "CUSTOM"                      your own dweets from custom-dweets.js
    //
    // A function is called with each dweet and returns true to include it, for example
    //   (d) => d.awesome_count >= 30 && !d.remix_of
    // A dweet has: id, username, awesome_count, posted, remix_of, tags and code.
    INCLUDE: ["MIN_LIKES_20", "CUSTOM"],

    // Same syntax as INCLUDE. Dweets that match are removed from the INCLUDE result.
    EXCLUDE: [],

    // Seconds each dweet is shown before the next one starts (minimum 5). 0 = never switch.
    ROTATE_SECONDS: 60,

    // Cross-fade between dweets, in milliseconds. 0 = hard cut.
    TRANSITION_MS: 500,

    // Dweets that run slower than this many frames per second on your device are skipped. 0 = never skip.
    MIN_FPS: 30,

    // Skip dweets that flash rapidly (more than 3 large brightness changes per second).
    // A safety measure for people who are sensitive to flashing. It is a heuristic, not a guarantee.
    FLASH_GUARD: true,

    // Skip dweets that wait for the mouse, keyboard or touch, or that play sound. They have no use on a screensaver.
    EXCLUDE_INTERACTIVE: true,

    // "contain" shows the whole 16:9 picture (black bars on other screen shapes).
    // "cover" fills the screen and crops the edges.
    FIT: "contain",

    // The colour of the canvas dweets are drawn on, which is what shows wherever a dweet draws nothing. Any CSS colour
    // works: "#e6e6e6", "gainsboro", "rgb(230 230 230)", "hsl(0 0% 90%)"... White is how dwitter.net shows dweets. A light
    // grey is easier on the eyes in a dark room ("#e6e6e6" is a gentle one, "#d4d4d4" is clearly grey). Keep it light:
    // most dweets draw in black unless they say otherwise, so a dark colour hides them.
    // It has no effect on a dweet that paints its own background, and a dweet that filters its canvas (CSS contrast(),
    // for example) can turn it back to white.
    BACKGROUND_COLOR: "#e6e6e6",

    // Seconds a setup hint (for example "database not found") stays on screen.
    HINT_SECONDS: 10,

    // Where the credit for the dweet on screen goes: its author and, for dweets from the database, where to find it
    // ("by KilledByAPixel · dwitter.net/d/36024"). One of
    //   TOP_LEFT  TOP_MIDDLE  TOP_RIGHT  BOTTOM_LEFT  BOTTOM_MIDDLE  BOTTOM_RIGHT
    // or
    //   RANDOM    a different one of those places with every dweet, never the same twice in a row. Use this on an
    //             OLED screen, where a line of text that stays lit in one spot for hours can burn in.
    //   OFF       no credit at all.
    // It is white with a dark outline, so it can be read over any picture. For your own dweets it shows the "username"
    // from custom-dweets.js, and nothing if that is empty.
    ATTRIBUTION_POSITION: "BOTTOM_LEFT",

    // Show what the screensaver is doing in the top left corner: the current dweet's id, author and speed, and a log
    // (version, how the database was read, every dweet that was skipped and why, and how the previous run ended).
    // Handy for finding the id of a dweet you want to leave out: put it in EXCLUDE as "IDS_<id>".
    DEBUG: false,

    // How dweets are isolated from the rest of the screensaver.
    //   "auto"    use inline frames, and switch to the runner.html frame by itself if those never start
    //   "srcdoc"  always use inline frames (the default way; they need no request, so nothing can fail to load)
    //   "iframe"  always use the runner.html frame, which is loaded by its address
    RUN_MODE: "auto",

    // How the database (dweets.js) is read.
    //   "auto"    read it as plain data, so that nothing in the file is ever run; if it cannot be fetched at all
    //             (for instance when index.html is opened straight from the file system), run it as a script instead
    //   "data"    only ever read it as plain data: strictest
    //   "direct"  always run it as a script, which also works for a file that is not plain data
    DATABASE_MODE: "auto",
};
