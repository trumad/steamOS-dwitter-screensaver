(function () {
    "use strict";

    const DEFAULTS = {
        INCLUDE: ["MIN_LIKES_20", "CUSTOM"],
        EXCLUDE: [],
        ROTATE_SECONDS: 60,
        TRANSITION_MS: 2000,
        PRELOAD_SECONDS: 5,
        MIN_FPS: 30,
        FLASH_GUARD: true,
        EXCLUDE_INTERACTIVE: true,
        FIT: "contain",
        BACKGROUND_COLOR: "white",
        HINT_SECONDS: 10,
        ATTRIBUTION_POSITION: "BOTTOM_LEFT",
        RUN_MODE: "auto",
        DATABASE_MODE: "auto",
        DEBUG: false,
    };

    const MAX_ATTEMPTS = 3;          // dweets tried in a row before giving up for a while
    const RETRY_MS = 10000;
    const START_TIMEOUT_MS = 6000;   // a dweet that has not drawn anything by now is replaced
    const READ_TIMEOUT_MS = 15000;   // how long to wait for the database to be read
    const NOTHING_MS = 30000;        // nothing on screen after this long: say how to find out why
    const STALL_MS = 10000;          // a dweet on screen that has reported nothing for this long is replaced
    const FADE_MARGIN_MS = 300;      // from the dweet that was replaced being removed to the next one starting to load
    const CREDIT_MARGIN_MS = 50;     // from a credit having faded out to the next one being put there
    const HOLD_STALL_MS = 3000;      // a dweet waiting out of sight that has reported nothing for this long is replaced
    const MAX_SAMPLES = 32;          // most brightness samples taken from one update
    const MAX_MESSAGES_PER_SECOND = 60;
    const FLASHY_KEY = "dwitter.flashy";
    const RUN_MODE_KEY = "dwitter.runMode";
    const RUN_MODE_MAX_AGE_MS = 3 * 24 * 3600 * 1000;
    const LAST_RUN_KEY = "dwitter.lastRun";
    // The inline (srcdoc) variant of runner.html carries the same policy as that page.
    const RUNNER_CSP = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; form-action 'none'; base-uri 'none'";

    const bootedAt = performance.now();
    const VERSION = "2026-10-18 curtain";
    const CREDIT_PLACES = ["TOP_LEFT", "TOP_MIDDLE", "TOP_RIGHT", "BOTTOM_LEFT", "BOTTOM_MIDDLE", "BOTTOM_RIGHT"];
    const ATTRIBUTION_POSITIONS = CREDIT_PLACES.concat(["RANDOM", "OFF"]);
    const Selection = window.DwitterSelection;
    const Health = window.DwitterHealth;
    const stage = document.getElementById("stage");
    const attributionEl = document.getElementById("attribution");
    const hintEl = document.getElementById("hint");
    const debugEl = document.getElementById("debug");
    const params = new URLSearchParams(location.search);

    if (!Selection || !Health) {
        hintEl.textContent = "Some screensaver files could not be loaded (selection.js or health.js). Install the screensaver again.";
        hintEl.hidden = false;
        return;
    }

    // A black sheet above the dweets, and below the credit and the hints (which come later in the page). It does the jobs
    // that making a dweet translucent would do, because a dweet must never be translucent: with GPU compositing, which is
    // what a console's browser uses, a cross-origin frame that is partly transparent (or inside something that is) is
    // drawn on top of an opaque white background, so a frame waiting at 1% opacity, or fading in, turns the whole screen
    // white. So a frame that waits sits underneath the one on screen, the first one waits under the curtain, and the
    // change from one dweet to the next dips through it. The properties are set here, not in main.css, so that they
    // cannot be missing.
    //
    // The curtain is never quite opaque. A frame that is hidden behind something the browser knows to be opaque (a solid
    // colour at 100%) stops getting animation frames, so a dweet under a fully black curtain never starts. At 99% the
    // frames behind it keep running, and the picture that shows through (1%, about 2.5 levels out of 255) is still black
    // to the eye. Frames never count as opaque themselves, so a frame can wait under another one.
    const CURTAIN_DARK = 0.99;
    const curtain = document.createElement("div");
    curtain.id = "curtain";
    Object.assign(curtain.style, { position: "fixed", top: "0", left: "0", width: "100%", height: "100%", background: "#000", opacity: String(CURTAIN_DARK), pointerEvents: "none" });
    stage.insertAdjacentElement("afterend", curtain);

    function setCurtain(opacity, ms, easing) {
        curtain.style.transition = ms > 0 ? "opacity " + ms + "ms " + easing : "none";
        curtain.style.opacity = String(opacity);
    }

    const storage = (function () {
        try {
            const s = window.localStorage;
            s.setItem("dwitter.probe", "1");
            s.removeItem("dwitter.probe");
            return s;
        } catch (e) {
            return null;
        }
    })();

    // What the screensaver has been doing, newest last. DEBUG shows it on screen, and (where storage works) it is kept
    // so that the next run can show how this one ended, which matters when the page does not get to say it itself.
    const events = [];
    let lastRun = null;
    try {
        lastRun = storage ? JSON.parse(storage.getItem(LAST_RUN_KEY)) : null;
    } catch (e) {
        lastRun = null;
    }
    let saveTimer = null;

    function saveEvents() {
        saveTimer = null;
        try {
            storage.setItem(LAST_RUN_KEY, JSON.stringify({ at: new Date().toISOString(), page: location.href, events: events.slice(-40) }));
        } catch (e) {
            // Without storage the log is only on screen.
        }
    }

    function log(text) {
        events.push(((performance.now() - bootedAt) / 1000).toFixed(1) + "s " + text);
        if (events.length > 80) events.shift();
        console.log("[dwitter] " + text);
        if (storage && !saveTimer) saveTimer = setTimeout(saveEvents, 500);
    }

    // Any CSS colour (a name, hex, rgb(), hsl(), oklch()...) as the opaque rgb() that shows over the black page behind
    // the screensaver, or null when it is not a colour. Painting it is the one way to read every syntax, and it leaves
    // the runner, which measures its pictures against this colour, a plain rgb() to understand.
    function solidColour(value) {
        try {
            const canvas = document.createElement("canvas");
            canvas.width = canvas.height = 1;
            const g = canvas.getContext("2d", { willReadFrequently: true });
            // A canvas ignores a value that is not a colour (CSS.supports still accepts "inherit" and "var(--x)") and
            // keeps the colour it had. Starting from two different colours shows whether the value was taken.
            g.fillStyle = "#010203";
            g.fillStyle = value;
            const kept = g.fillStyle === "#010203";
            g.fillStyle = "#040506";
            g.fillStyle = value;
            if (kept && g.fillStyle === "#040506") return null;
            g.fillRect(0, 0, 1, 1);
            const pixel = g.getImageData(0, 0, 1, 1).data;
            const alpha = pixel[3] / 255;
            return "rgb(" + [0, 1, 2].map((i) => Math.round(pixel[i] * alpha)).join(", ") + ")";
        } catch (e) {
            return value;
        }
    }

    function readConfig() {
        const warnings = [];
        const user = typeof CONFIG === "object" && CONFIG !== null ? CONFIG : {};
        const cfg = Object.assign({}, DEFAULTS, user);
        // BACKGROUND_COLOR used to be called CANVAS_BACKGROUND, and a config.js written for that name keeps working.
        if (user.BACKGROUND_COLOR === undefined && user.CANVAS_BACKGROUND !== undefined) cfg.BACKGROUND_COLOR = user.CANVAS_BACKGROUND;
        const fix = (name, message) => {
            warnings.push(name + " in config.js " + message + " Using " + JSON.stringify(DEFAULTS[name]) + ".");
            cfg[name] = DEFAULTS[name];
        };
        const isNumber = (v) => typeof v === "number" && Number.isFinite(v);

        if (!isNumber(cfg.ROTATE_SECONDS) || cfg.ROTATE_SECONDS < 0) {
            fix("ROTATE_SECONDS", "should be 0 (never switch) or a number of seconds.");
        } else if (cfg.ROTATE_SECONDS > 0 && cfg.ROTATE_SECONDS < 5) {
            warnings.push("ROTATE_SECONDS in config.js must be at least 5. Using 5.");
            cfg.ROTATE_SECONDS = 5;
        }
        if (!isNumber(cfg.TRANSITION_MS) || cfg.TRANSITION_MS < 0 || cfg.TRANSITION_MS > 5000) fix("TRANSITION_MS", "should be between 0 and 5000.");
        if (!isNumber(cfg.PRELOAD_SECONDS) || cfg.PRELOAD_SECONDS < 0 || cfg.PRELOAD_SECONDS > 60) fix("PRELOAD_SECONDS", "should be between 0 and 60.");
        if (!isNumber(cfg.MIN_FPS) || cfg.MIN_FPS < 0 || cfg.MIN_FPS > 60) fix("MIN_FPS", "should be between 0 and 60.");
        if (!isNumber(cfg.HINT_SECONDS) || cfg.HINT_SECONDS < 1 || cfg.HINT_SECONDS > 600) fix("HINT_SECONDS", "should be between 1 and 600.");
        if (cfg.FIT !== "contain" && cfg.FIT !== "cover") fix("FIT", 'should be "contain" or "cover".');
        // Any capitalisation, with spaces or dashes for underscores ("bottom-left"), and false for OFF.
        const position = cfg.ATTRIBUTION_POSITION === false
            ? "OFF"
            : typeof cfg.ATTRIBUTION_POSITION === "string" ? cfg.ATTRIBUTION_POSITION.trim().toUpperCase().replace(/[\s-]+/g, "_") : "";
        if (ATTRIBUTION_POSITIONS.includes(position)) cfg.ATTRIBUTION_POSITION = position;
        else fix("ATTRIBUTION_POSITION", "should be " + ATTRIBUTION_POSITIONS.slice(0, -1).join(", ") + " or OFF.");
        let background = typeof cfg.BACKGROUND_COLOR === "string" && window.CSS && CSS.supports("color", cfg.BACKGROUND_COLOR)
            ? solidColour(cfg.BACKGROUND_COLOR)
            : null;
        if (background === null) {
            fix("BACKGROUND_COLOR", 'should be a CSS colour, for example "#e6e6e6" or "gainsboro".');
            background = solidColour(cfg.BACKGROUND_COLOR);
        }
        cfg.BACKGROUND_COLOR = background;
        if (!["auto", "iframe", "srcdoc"].includes(cfg.RUN_MODE)) fix("RUN_MODE", 'should be "auto", "iframe" or "srcdoc".');
        if (!["auto", "data", "direct"].includes(cfg.DATABASE_MODE)) fix("DATABASE_MODE", 'should be "auto", "data" or "direct".');
        cfg.FLASH_GUARD = cfg.FLASH_GUARD !== false;
        cfg.EXCLUDE_INTERACTIVE = cfg.EXCLUDE_INTERACTIVE !== false;
        cfg.DEBUG = cfg.DEBUG === true;

        // Address-bar overrides for testing, for example index.html?id=701 or ?rotate=5&include=TOP_20|CUSTOM
        const rotate = Number(params.get("rotate"));
        if (params.has("rotate") && Number.isFinite(rotate) && rotate >= 0) cfg.ROTATE_SECONDS = rotate;
        const minFps = Number(params.get("minfps"));
        if (params.has("minfps") && Number.isFinite(minFps) && minFps >= 0) cfg.MIN_FPS = minFps;
        if (params.has("include")) cfg.INCLUDE = params.get("include").split("|");
        if (params.has("exclude")) cfg.EXCLUDE = params.get("exclude").split("|");
        if (["iframe", "srcdoc"].includes(params.get("mode"))) cfg.RUN_MODE = params.get("mode");
        return { cfg, warnings };
    }

    const { cfg, warnings: configWarnings } = readConfig();

    const pinnedId = params.get("id");
    const debug = cfg.DEBUG || params.get("debug") === "1" || Boolean(pinnedId);

    // These are filled in by boot() once the database has been read.
    let db = null;
    let pool = [];
    let order = null;
    let pinned = null;
    let ready = false;

    // A frame that is loaded by URL is a second navigation inside the screensaver's view. Steam serves the screensaver
    // from a host name that only exists inside Steam, and a navigation that does not get served ends in its own
    // full-screen "Error Code: -105" page, so dweets run in inline (srcdoc) frames, which involve no request at all.
    // The runner.html frame is the fallback for the case where inline frames cannot start.
    const fromFile = location.protocol === "file:";

    function savedRunMode() {
        try {
            const saved = JSON.parse(storage.getItem(RUN_MODE_KEY));
            return saved && saved.mode === "iframe" && Date.now() - saved.at < RUN_MODE_MAX_AGE_MS ? "iframe" : null;
        } catch (e) {
            return null;
        }
    }

    function saveRunMode(mode) {
        try {
            storage.setItem(RUN_MODE_KEY, JSON.stringify({ mode, at: Date.now() }));
        } catch (e) {
            // The other way of running dweets is simply tried first again next time.
        }
    }

    let runMode = cfg.RUN_MODE !== "auto"
        ? cfg.RUN_MODE
        : (typeof DwitterRunnerMain === "function" && !(storage && savedRunMode()) ? "srcdoc" : "iframe");

    const state = {
        current: null,       // the dweet on screen
        pending: null,       // the dweet that is warming up behind it, out of sight
        retiring: null,      // the dweet that is on its way out, still on screen while the screen goes dark
        swap: null,          // what is done when the screen is dark during a change, or null when no change is going on
        swapTimer: null,
        attempts: [],        // every iframe that exists
        timer: null,
        failures: 0,
        history: [],
        skipped: new Set(),  // dweets that failed during this session
        flashy: loadFlashy(),
        rotations: 0,
        autoSwitched: false,
        stickyHint: false,
        databaseMs: null,
    };
    let hintTimer = null;

    function loadFlashy() {
        try {
            return new Set(JSON.parse(storage.getItem(FLASHY_KEY) || "[]").map(String));
        } catch (e) {
            return new Set();
        }
    }

    function markFlashy(id) {
        state.flashy.add(id);
        try {
            storage.setItem(FLASHY_KEY, JSON.stringify([...state.flashy]));
        } catch (e) {
            // Without storage the dweet is only skipped for this session.
        }
    }

    function showHint(text, sticky) {
        clearTimeout(hintTimer);
        hintEl.textContent = text;
        hintEl.hidden = false;
        state.stickyHint = Boolean(sticky);
        if (!sticky) hintTimer = setTimeout(hideHint, cfg.HINT_SECONDS * 1000);
    }

    function hideHint() {
        clearTimeout(hintTimer);
        hintEl.hidden = true;
        state.stickyHint = false;
    }

    // The credit for the dweet on screen, in the place chosen by ATTRIBUTION_POSITION. When the dweet changes, the old
    // credit fades out while the pictures cross-fade and the new one fades in after them. The text is set with
    // textContent only: names come from a file somebody else produced.
    //
    // RANDOM is for OLED screens, where a line of text that stays lit in one spot can burn in: every dweet gets one of
    // the six places, never the same as the one before. The credit only moves while it is faded out.
    let attributionTimer = null;
    let creditPlace = null;

    function placeCredit() {
        const wanted = cfg.ATTRIBUTION_POSITION;
        if (wanted === "RANDOM") {
            const others = CREDIT_PLACES.filter((place) => place !== creditPlace);
            creditPlace = others[Math.floor(Math.random() * others.length)];
        } else {
            creditPlace = wanted;
        }
        const at = creditPlace.toLowerCase().replace(/_/g, "-");
        if (attributionEl.dataset.at !== at) attributionEl.dataset.at = at;
    }

    if (cfg.ATTRIBUTION_POSITION !== "OFF") {
        placeCredit();
        attributionEl.hidden = false;
        // Setup hints sit at the bottom centre: keep them clear of a credit that can be there.
        document.body.classList.toggle("credit-bottom-middle", cfg.ATTRIBUTION_POSITION === "BOTTOM_MIDDLE" || cfg.ATTRIBUTION_POSITION === "RANDOM");
    }

    function renderAttribution() {
        if (cfg.ATTRIBUTION_POSITION === "OFF") return;
        const text = state.current ? state.current.rec.attribution : "";
        clearTimeout(attributionTimer);
        attributionEl.classList.remove("on");
        if (!text) return;
        // The old credit fades out in half of TRANSITION_MS (the first half of the change), the new one fades in during the
        // second half.
        attributionTimer = setTimeout(function () {
            placeCredit();
            attributionEl.textContent = text;
            attributionEl.classList.add("on");
        }, Math.round(cfg.TRANSITION_MS / 2) + CREDIT_MARGIN_MS);
    }

    function buildSrcdoc() {
        return '<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="' +
            RUNNER_CSP + '"></head><body data-dweet-runner><canvas id="c"></canvas><script>(' +
            DwitterRunnerMain.toString() + ")();<\/script></body></html>";
    }

    // dweets.js is "let dweets = [ {...}, {...}, ];" around a plain JSON list. It is read as text and parsed, so nothing
    // in it is ever run. Returns the list, or null when the text is anything else.
    function parseDatabase(text) {
        const head = /^\s*(?:(?:let|var|const)\s+dweets\s*=\s*)?\[/.exec(text.slice(0, 256));
        const tail = /,?\s*\]\s*;?\s*$/.exec(text.slice(-256));
        if (!head || !tail) return null;
        try {
            const list = JSON.parse(text.slice(head[0].length - 1, text.length - tail[0].length) + "]");
            return Array.isArray(list) ? list : null;
        } catch (e) {
            return null;
        }
    }

    // Only what the screensaver uses, and not the comments, which take up a third of the file.
    function plainEntries(list) {
        return list.map(function (d) {
            return d && typeof d === "object"
                ? { id: d.id, username: d.username, code: d.code, posted: d.posted, awesome_count: d.awesome_count, remix_of: d.remix_of, tags: d.tags }
                : d;
        });
    }

    // { dweets } when the file could be fetched (an array, or false if it is not plain data), otherwise { failed }.
    async function readDatabaseAsData() {
        const controller = typeof AbortController === "function" ? new AbortController() : null;
        const timer = setTimeout(function () { if (controller) controller.abort(); }, READ_TIMEOUT_MS);
        try {
            const response = await fetch("dweets.js", { cache: "no-cache", signal: controller ? controller.signal : undefined });
            if (!response.ok) return { failed: "HTTP " + response.status };
            return { dweets: parseDatabase(await response.text()) || false };
        } catch (e) {
            return { failed: String((e && e.message) || e) };
        } finally {
            clearTimeout(timer);
        }
    }

    // Runs dweets.js as a script in this page, the way any other file in the folder runs.
    function loadDatabaseDirect() {
        return new Promise(function (resolve) {
            const script = document.createElement("script");
            let done = false;
            const finish = function () {
                if (done) return;
                done = true;
                clearTimeout(timer);
                resolve({ dweets: typeof dweets !== "undefined" ? dweets : null });
            };
            const timer = setTimeout(finish, READ_TIMEOUT_MS);
            script.onload = finish;
            script.onerror = finish;
            script.src = "dweets.js";
            document.head.appendChild(script);
        });
    }

    // See DATABASE_MODE in config.js. Resolves to { dweets }: null when there is no usable file, false when the file
    // is not a list of dweets.
    async function loadDatabase() {
        const mode = cfg.DATABASE_MODE;
        if (mode !== "direct") {
            const read = await readDatabaseAsData();
            if (read.dweets !== undefined) {
                log(read.dweets ? "read dweets.js as data: " + read.dweets.length + " entries" : "dweets.js is not plain data, so it is not used");
                return { dweets: read.dweets ? plainEntries(read.dweets) : false };
            }
            log("could not fetch dweets.js (" + read.failed + ")");
            if (mode === "data") return { dweets: null };
            log("running dweets.js as a script instead");
        }
        const direct = await loadDatabaseDirect();
        log(direct.dweets ? "dweets.js ran as a script" : "dweets.js could not be loaded");
        return direct;
    }

    // Dweets are other people's code, so each one runs in its own sandboxed frame: no access to this page (or to
    // anything Steam exposes to it), no network, and a clean set of globals every time.
    function createFrame() {
        const frame = document.createElement("iframe");
        frame.className = "dweet";
        frame.setAttribute("sandbox", "allow-scripts");
        frame.setAttribute("tabindex", "-1");
        frame.setAttribute("aria-hidden", "true");
        frame.setAttribute("referrerpolicy", "no-referrer");
        // Never translucent (see the curtain). Below the frame on screen, which is at z-index 1, so a new frame is hidden
        // by it while it warms up; on top of it in the page, so it would be seen if this were not set. These are set
        // here and not only in main.css so that an out-of-date style sheet cannot bring the old behaviour back.
        frame.style.opacity = "1";
        frame.style.transition = "none";
        frame.style.zIndex = "0";
        if (runMode === "srcdoc" && typeof DwitterRunnerMain === "function") frame.srcdoc = buildSrcdoc();
        else frame.src = "runner.html";
        stage.appendChild(frame);
        return frame;
    }

    function pickNext() {
        if (pinned) return pinned;
        for (let i = 0; i <= pool.length; i++) {
            const rec = order.next();
            if (!rec) return null;
            const id = String(rec.id);
            if (!state.skipped.has(id) && !state.flashy.has(id)) return rec;
        }
        return null;
    }

    // The first half of a change: the old dweet is still on screen while the screen goes dark; the new dweet is shown during
    // the second half.
    const halfFade = () => Math.round(cfg.TRANSITION_MS / 2);

    // How long the next dweet runs out of sight before it is shown, so that it is already underway when it is seen (many
    // dweets start from an empty canvas and take seconds to build their picture). It is what PRELOAD_SECONDS asks for, or
    // less when ROTATE_SECONDS is short, because the dweet being replaced has to be gone before the next one starts
    // loading.
    function preloadMs() {
        if (!(cfg.ROTATE_SECONDS > 0)) return 0;
        return Math.max(0, Math.min(cfg.PRELOAD_SECONDS * 1000, cfg.ROTATE_SECONDS * 1000 - halfFade() - FADE_MARGIN_MS));
    }

    function scheduleRotation() {
        clearTimeout(state.timer);
        state.timer = null;
        const pinnedStays = pinned && !params.has("rotate");
        if (pinnedStays || !(cfg.ROTATE_SECONDS > 0) || document.hidden) return;
        if (!pinned && pool.length <= 1) return;
        // The next dweet starts early and waits out of sight under this one until it is time to switch.
        const lead = preloadMs();
        state.timer = setTimeout(startNext, Math.max(cfg.ROTATE_SECONDS * 1000 - lead, halfFade() + FADE_MARGIN_MS));
    }

    function startNext() {
        clearTimeout(state.timer);
        state.timer = null;
        if (state.pending) return;
        const rec = pickNext();
        if (!rec) {
            showHint("There is nothing to show. Check INCLUDE and EXCLUDE in config.js.", true);
            return;
        }
        const attempt = {
            rec,
            frame: createFrame(),
            // The old dweet is still running while the screen goes dark, so the speed check starts after that.
            monitor: Health.createMonitor({ minFps: cfg.MIN_FPS, flashGuard: cfg.FLASH_GUARD, fpsGraceMs: Math.max(1000, halfFade() + 500) }),
            revealed: false,
            dead: false,
            failed: false,
            readySeen: false,
            settled: false,
            // Nothing is on screen to fade from at first, so the first dweet is shown as soon as it has started. Any other
            // one is shown after it has run out of sight for preloadMs() (the rotation timer starts it that long before
            // the switch is due).
            holdUntil: state.current ? performance.now() + preloadMs() : 0,
            holdTimer: null,
            timeout: null,
            loads: 0,
            lastMessageAt: performance.now(),
            windowStart: 0,
            windowCount: 0,
            dropped: 0,
        };
        // A frame loads once. A second load means the dweet sent its frame somewhere else.
        attempt.frame.addEventListener("load", function () {
            if (++attempt.loads > 1 && !attempt.dead) fail(attempt, { reason: "navigated", detail: "the dweet tried to leave its frame" });
        });
        attempt.timeout = setTimeout(function () {
            if (attempt.revealed || attempt.dead) return;
            fail(attempt, {
                reason: attempt.readySeen ? "stalled" : "no-runner",
                detail: "nothing drawn after " + START_TIMEOUT_MS / 1000 + " s",
            });
        }, START_TIMEOUT_MS);
        state.attempts.push(attempt);
        state.pending = attempt;
    }

    function finite(n) {
        return typeof n === "number" && Number.isFinite(n);
    }

    // Whatever a dweet posts to this page is untrusted: keep only the fields the screensaver uses, within limits.
    function sanitize(data) {
        switch (data.type) {
            case "ready":
                return { type: "ready" };
            case "error":
                return {
                    type: "error",
                    phase: data.phase === "compile" ? "compile" : "runtime",
                    message: String(data.message).slice(0, 300),
                    frame: finite(data.frame) ? data.frame : 0,
                };
            case "stats": {
                if (!finite(data.frame) || !finite(data.now) || !finite(data.ok) || !finite(data.err) || !Array.isArray(data.samples)) return null;
                const samples = [];
                for (const s of data.samples.slice(0, MAX_SAMPLES)) {
                    if (Array.isArray(s) && finite(s[0]) && finite(s[1]) && finite(s[2])) samples.push([s[0], s[1], s[2], finite(s[3]) ? s[3] : 0]);
                }
                return {
                    type: "stats", frame: data.frame, now: data.now, ok: data.ok, err: data.err,
                    painted: data.painted === true, bg: data.bg === true, samples,
                };
            }
            default:
                return null;
        }
    }

    function onMessage(event) {
        const attempt = state.attempts.find((a) => a.frame.contentWindow === event.source);
        const data = event.data;
        if (!attempt || attempt.dead || !data || typeof data !== "object") return;

        const now = performance.now();
        if (now - attempt.windowStart >= 1000) {
            attempt.windowStart = now;
            attempt.windowCount = 0;
        }
        if (++attempt.windowCount > MAX_MESSAGES_PER_SECOND) {
            if (++attempt.dropped > 500) fail(attempt, { reason: "flooding", detail: "too many messages" });
            return;
        }

        const msg = sanitize(data);
        if (window.__dwitter) recordMessage(attempt, data, msg);
        if (!msg) return;
        attempt.lastMessageAt = now;
        if (msg.type === "ready") {
            attempt.readySeen = true;
            attempt.frame.contentWindow.postMessage({ type: "run", code: attempt.rec.code, background: cfg.BACKGROUND_COLOR }, "*");
        } else {
            const result = attempt.monitor.push(msg);
            if (result && result.type === "ready") settle(attempt);
            else if (result && result.type === "fail") fail(attempt, result);
        }
    }

    // A dweet that has started properly waits out of sight until it is time to switch (see PRELOAD_SECONDS).
    function settle(attempt) {
        if (attempt.settled || attempt.revealed || attempt.dead) return;
        attempt.settled = true;
        clearTimeout(attempt.timeout);
        const wait = attempt.holdUntil - performance.now();
        if (wait <= 0) {
            reveal(attempt);
            return;
        }
        log("d/" + attempt.rec.id + " is ready, showing it in " + (wait / 1000).toFixed(1) + " s");
        attempt.holdTimer = setTimeout(function () {
            if (attempt.revealed || attempt.dead) return;
            // Nothing else is looking at a dweet that is not shown yet, so one that has gone quiet is not shown at all.
            // (A hidden page makes every dweet quiet, which proves nothing.)
            if (!document.hidden && performance.now() - attempt.lastMessageAt > HOLD_STALL_MS) fail(attempt, { reason: "stalled", detail: "no updates while waiting to be shown" });
            else reveal(attempt);
        }, wait);
    }

    // The dweet on screen is gone, so the one that is waiting is shown at once.
    function release(attempt) {
        attempt.holdUntil = 0;
        if (attempt.settled) reveal(attempt);
    }

    function reveal(attempt) {
        if (attempt.revealed || attempt.dead) return;
        clearTimeout(attempt.timeout);
        clearTimeout(attempt.holdTimer);
        attempt.revealed = true;
        attempt.monitor.reveal();
        finishChange();
        const previous = state.current;
        state.current = attempt;
        renderAttribution();
        if (state.pending === attempt) state.pending = null;
        state.failures = 0;
        state.history = [];
        if (state.stickyHint) hideHint();
        if (state.autoSwitched && storage) saveRunMode(runMode);
        state.rotations++;
        log("showing d/" + attempt.rec.id + " (" + state.rotations + ")");
        change(previous, attempt);
        scheduleRotation();
    }

    // From one dweet to the next the screen dips through the curtain: it goes dark over the first half of TRANSITION_MS
    // (the old dweet keeps running meanwhile), the frames are swapped while it is dark, and it lifts again over the second
    // half. The first dweet, with nothing before it, only lifts. The dweet that comes next waited under the one on
    // screen, so it is already running and nothing is loaded while the screen is dark.
    function change(previous, attempt) {
        const half = halfFade();
        const swap = function () {
            clearTimeout(state.swapTimer);
            state.swap = null;
            state.swapTimer = null;
            attempt.frame.style.zIndex = "1";
            attempt.frame.classList.add("visible");
            if (previous) {
                remove(previous);
                state.retiring = null;
            }
            setCurtain(0, previous ? half : cfg.TRANSITION_MS, previous ? "ease-out" : "ease-in-out");
        };
        if (previous && half > 0) {
            previous.dead = true;
            state.retiring = previous;
            state.swap = swap;
            state.swapTimer = setTimeout(swap, half + 40);
            setCurtain(CURTAIN_DARK, half, "ease-in");
        } else {
            swap();
        }
    }

    // A change that is going on is completed at once, because another one is about to start.
    function finishChange() {
        if (state.swap) state.swap();
    }

    // The screen goes black at once and whatever was being changed is dropped: the dweet on screen was cut.
    function blackout() {
        clearTimeout(state.swapTimer);
        state.swap = null;
        state.swapTimer = null;
        if (state.retiring) {
            remove(state.retiring);
            state.retiring = null;
        }
        setCurtain(CURTAIN_DARK, 0);
        // So that the next change starts from black rather than from wherever the curtain was.
        void curtain.offsetWidth;
    }

    function remove(attempt) {
        attempt.dead = true;
        clearTimeout(attempt.timeout);
        clearTimeout(attempt.holdTimer);
        attempt.frame.remove();
        state.attempts = state.attempts.filter((a) => a !== attempt);
    }

    // Used once, when the first way of running dweets does not start at all.
    function switchRunMode() {
        if (cfg.RUN_MODE !== "auto" || state.autoSwitched || fromFile) return false;
        const next = runMode === "srcdoc" ? "iframe" : "srcdoc";
        if (next === "srcdoc" && typeof DwitterRunnerMain !== "function") return false;
        log("the dweet player did not start in " + runMode + " mode, trying " + next);
        runMode = next;
        state.autoSwitched = true;
        return true;
    }

    function fail(attempt, result) {
        if (attempt.dead || attempt.failed) return;
        const id = String(attempt.rec.id);
        log("d/" + id + ": " + result.reason + (result.detail ? " (" + result.detail + ")" : ""));
        if (window.__dwitter) window.__dwitter.failures.push({ id, reason: result.reason, detail: result.detail });

        // The player itself did not start (not the dweet's fault): try the other way of running it.
        if (!attempt.revealed && result.reason === "no-runner" && switchRunMode()) {
            remove(attempt);
            if (state.pending === attempt) state.pending = null;
            state.failures = 0;
            startNext();
            return;
        }

        // When looking at a single dweet, keep it on screen whatever happens.
        if (pinned) {
            if (!attempt.revealed) reveal(attempt);
            return;
        }

        state.skipped.add(id);
        if (result.reason === "flash") markFlashy(id);
        // These must not stay on screen for a moment longer: a flashing picture, or a frame that has gone elsewhere.
        const immediate = result.reason === "flash" || result.reason === "navigated" || result.reason === "flooding";

        if (attempt.revealed && !immediate) {
            // Slow or erroring, but harmless: keep showing it until a replacement is ready.
            attempt.failed = true;
            state.failures = 0;
            startNext();
            return;
        }
        if (attempt.revealed) {
            state.current = null;
            renderAttribution();
            remove(attempt);
            blackout();
            state.failures = 0;
            // The next dweet may already be waiting out of sight: show it now rather than at its turn.
            if (state.pending) release(state.pending);
            else startNext();
            return;
        }

        remove(attempt);
        if (state.pending === attempt) state.pending = null;
        state.history.push(result);
        if (state.history.length > MAX_ATTEMPTS) state.history.shift();
        state.failures++;
        if (state.failures < MAX_ATTEMPTS) {
            startNext();
            return;
        }

        state.failures = 0;
        diagnose();
        if (state.current) scheduleRotation();
        else state.timer = setTimeout(startNext, RETRY_MS);
    }

    function diagnose() {
        const reasons = state.history.map((h) => h.reason);
        if (reasons.length >= MAX_ATTEMPTS && reasons.every((r) => r === "compile-error")) {
            showHint("Dweets cannot run in this environment: " + String(state.history[0].detail).slice(0, 200) + "\nSee Troubleshooting in the README.", true);
        } else if (reasons.length >= MAX_ATTEMPTS && reasons.every((r) => r === "no-runner")) {
            showHint("The dweet player did not start.\nSet DEBUG: true in config.js to see why. See Troubleshooting in the README.", true);
        }
    }

    function onVisibility() {
        if (!ready) return;
        if (document.hidden) {
            clearTimeout(state.timer);
            state.timer = null;
            return;
        }
        if (state.current) state.current.lastMessageAt = performance.now();
        // A fresh dweet whenever the page is shown again.
        if (!pinned) startNext();
    }

    // A dweet on screen that has gone quiet (for example stuck in a very long loop) is replaced. This can only work
    // when the page is not frozen along with it.
    function checkStalled() {
        if (!pinned && !document.hidden && !state.rotations && !state.stickyHint && performance.now() - bootedAt > NOTHING_MS) {
            log("nothing has been shown after " + NOTHING_MS / 1000 + " s");
            showHint("Nothing has been shown yet.\nSet DEBUG: true in config.js to see what the screensaver is doing.", true);
        }
        const cur = state.current;
        if (!ready || pinned || document.hidden || !cur || cur.dead || cur.failed) return;
        if (performance.now() - cur.lastMessageAt > STALL_MS) {
            fail(cur, { reason: "stalled", detail: "no updates for " + STALL_MS / 1000 + " s" });
        }
    }

    // What the debug log keeps of a message: the cleaned-up version if it is one the screensaver understands,
    // otherwise only a few short fields (the test suite's probes use these).
    function recordMessage(attempt, data, clean) {
        const recorded = window.__dwitter.log;
        const msg = clean || {
            type: String(data.type).slice(0, 20),
            what: typeof data.what === "string" ? data.what.slice(0, 40) : undefined,
            blocked: data.blocked === true,
        };
        recorded.push({ id: String(attempt.rec.id), msg });
        if (recorded.length > 3000) recorded.shift();
    }

    if (debug) {
        window.__dwitter = {
            log: [],
            events,
            failures: [],
            solidColour,
            snapshot() {
                return {
                    rotations: state.rotations,
                    iframes: document.querySelectorAll("iframe").length,
                    nodes: document.getElementsByTagName("*").length,
                    current: state.current ? String(state.current.rec.id) : null,
                    pending: state.pending ? String(state.pending.rec.id) : null,
                    pool: pool.length,
                    background: cfg.BACKGROUND_COLOR,
                    curtain: Number(getComputedStyle(curtain).opacity),
                    preloadMs: preloadMs(),
                    runMode,
                    timers: state.timer !== null ? 1 : 0,
                    databaseMs: state.databaseMs,
                    heap: performance.memory ? performance.memory.usedJSHeapSize : null,
                };
            },
        };
        debugEl.hidden = false;
        setInterval(function () {
            const cur = state.current;
            const metrics = cur ? cur.monitor.metrics() : null;
            const lines = [
                "d/" + (cur ? cur.rec.id + "  @" + cur.rec.username + "  " + cur.rec.awesome_count + " likes" : "-"),
                "pool " + pool.length + "  mode " + runMode + "  shown " + state.rotations + (metrics ? "  frames " + metrics.frames + "  fps " + metrics.fps : "") + (state.pending ? "  next d/" + state.pending.rec.id : ""),
                location.href.replace(/[?#].*/, ""),
                "",
            ].concat(events.slice(-12));
            if (lastRun && Array.isArray(lastRun.events) && !state.rotations) {
                lines.push("", "the run before this one (" + lastRun.at + "):");
                for (const line of lastRun.events.slice(-8)) lines.push(String(line).slice(0, 160));
            }
            debugEl.textContent = lines.join("\n");
        }, 500);
    }

    async function boot() {
        log("version " + VERSION);
        log("page " + location.href.replace(/[?#].*/, ""));
        log("dweets run in " + runMode + " frames (RUN_MODE " + cfg.RUN_MODE + "), the database is read in " + cfg.DATABASE_MODE + " mode");
        const started = performance.now();
        const result = await loadDatabase();
        state.databaseMs = Math.round(performance.now() - started);

        db = Selection.buildDatabase({
            dweets: result.dweets,
            custom: typeof CUSTOM_DWEETS !== "undefined" ? CUSTOM_DWEETS : [],
            blocklist: typeof BLOCKLIST !== "undefined" ? BLOCKLIST : {},
        });
        const selection = Selection.resolve(db, cfg, { excludeInteractive: cfg.EXCLUDE_INTERACTIVE });
        pool = selection.pool;
        order = Selection.createOrder(pool, { storage, key: Selection.signature(cfg, pool) });
        pinned = pinnedId
            ? db.byId.get(pinnedId) || Selection.BUILTIN.find((d) => String(d.id) === pinnedId) || null
            : null;
        const warnings = configWarnings.concat(selection.warnings);
        if (pinnedId && !pinned) warnings.push('There is no dweet with the id "' + pinnedId + '".');
        ready = true;
        log("database " + db.databaseStatus + " (" + db.databaseCount + " dweets, " + db.customCount + " custom) read in " + state.databaseMs + " ms, " + pool.length + " to show");

        if (warnings.length) {
            warnings.forEach((w) => log("warning: " + w));
            showHint(warnings.join("\n"));
        }
        if (!document.hidden) startNext();
    }

    document.body.classList.toggle("cover", cfg.FIT === "cover");
    document.documentElement.style.setProperty("--fade", halfFade() + "ms");
    window.addEventListener("message", onMessage);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", function (event) {
        if (event.persisted) onVisibility();
    });
    setInterval(checkStalled, 2000);
    boot();
})();
