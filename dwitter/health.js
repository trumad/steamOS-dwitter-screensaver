/*
 * Health checks for a dweet that is playing. The screensaver feeds it the messages sent by runner.js and acts
 * on the verdict; tools/verify.mjs replays recorded messages through the same code. It runs as a plain <script>
 * and with require() in Node, so it must not touch the DOM.
 *
 * The flash check is a heuristic modelled on WCAG 2.3.1 ("no more than three flashes in any one second"): it
 * looks at the average brightness of the whole picture, so it can miss flashing that covers a small area, and
 * it is not a substitute for proper photosensitivity testing.
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.DwitterHealth = factory();
    }
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    const DEFAULTS = {
        minFps: 30,
        flashGuard: true,
        warmupFrames: 30,        // frames to wait before a dweet may be shown
        minUpdates: 4,           // and updates from the runner, so repeated errors are noticed before it is shown
        blankFrames: 180,        // give up on a dweet that has drawn nothing after this many frames (some start slowly)
        fpsGraceMs: 1000,        // ignore the first second after a dweet is shown when measuring speed
        fpsWindowMs: 2500,
        flashDelta: 0.1,         // a brightness change of 10% of the maximum counts
        flashTransitions: 6,     // 3 flashes = 6 changes in one second
        flashWindowMs: 1000,
        flashBufferMs: 4000,
        errorFramesPerStats: 8,  // frames that threw, out of the ~15 reported in each update
        errorStatsInARow: 3,
    };

    // Times at which the brightness reversed direction by at least `delta`. A change only counts when the darker
    // side is below 0.8, as in WCAG.
    function flashTransitions(samples, delta) {
        const times = [];
        if (samples.length < 2) return times;
        let extreme = samples[0][1];
        let direction = 0;
        for (let i = 1; i < samples.length; i++) {
            const t = samples[i][0];
            const v = samples[i][1];
            let turned = false;
            if (direction === 0) {
                turned = Math.abs(v - extreme) >= delta;
            } else if (direction === 1) {
                if (v > extreme) extreme = v;
                else turned = extreme - v >= delta;
            } else if (v < extreme) {
                extreme = v;
            } else {
                turned = v - extreme >= delta;
            }
            if (turned) {
                if (Math.min(extreme, v) < 0.8) times.push(t);
                direction = v > extreme ? 1 : -1;
                extreme = v;
            }
        }
        return times;
    }

    // True when two separate one-second windows each contain enough brightness reversals to be 3+ flashes.
    function isFlashing(samples, options) {
        const o = Object.assign({}, DEFAULTS, options);
        const times = flashTransitions(samples, o.flashDelta);
        const need = o.flashTransitions;
        let firstWindow = null;
        for (let i = 0; i + need - 1 < times.length; i++) {
            if (times[i + need - 1] - times[i] > o.flashWindowMs) continue;
            if (firstWindow === null) firstWindow = times[i];
            else if (times[i] - firstWindow >= o.flashWindowMs) return true;
        }
        return false;
    }

    // Feed it every message from the runner with push(). It returns null, { type: "ready" } once the dweet has
    // drawn something and may be shown, or { type: "fail", reason, detail }.
    function createMonitor(options) {
        const o = Object.assign({}, DEFAULTS, options);
        const s = {
            frames: 0, ok: 0, err: 0, updates: 0, painted: false, background: false,
            ready: false, failure: null, revealedAt: null,
            lastOk: 0, lastErr: 0, errorRun: 0, lastError: "",
            lastNow: 0, start: null, points: [], samples: [], hashes: new Set(),
        };

        function fail(reason, detail) {
            if (!s.failure) s.failure = { reason, detail: detail === undefined ? "" : String(detail) };
            return { type: "fail", reason: s.failure.reason, detail: s.failure.detail };
        }

        function windowFps(now) {
            const from = s.points.find((p) => p[0] >= now - o.fpsWindowMs);
            const to = s.points[s.points.length - 1];
            if (!from || !to || to[0] <= from[0]) return null;
            return (to[1] - from[1]) * 1000 / (to[0] - from[0]);
        }

        function push(msg) {
            if (s.failure || !msg) return null;
            if (msg.type === "error") {
                if (msg.phase === "compile") return fail("compile-error", msg.message);
                s.lastError = msg.message;
                return null;
            }
            if (msg.type !== "stats") return null;

            s.frames = msg.frame;
            s.updates++;
            s.ok = msg.ok;
            s.err = msg.err;
            s.lastNow = msg.now;
            s.painted = s.painted || Boolean(msg.painted);
            s.background = s.background || Boolean(msg.bg);
            if (!s.start && msg.frame >= 10) s.start = [msg.now, msg.frame];
            s.points.push([msg.now, msg.frame]);
            while (s.points.length > 2 && s.points[0][0] < msg.now - o.fpsWindowMs - 1000) s.points.shift();

            // A dweet that throws on every frame is broken; one that throws once (for example on the first frame,
            // before it has set up its variables) is fine.
            const okNow = msg.ok - s.lastOk;
            const errNow = msg.err - s.lastErr;
            s.lastOk = msg.ok;
            s.lastErr = msg.err;
            if (okNow > 0) s.errorRun = 0;
            else if (errNow >= o.errorFramesPerStats) s.errorRun++;
            if (s.errorRun >= o.errorStatsInARow) return fail("runtime-error", s.lastError);

            for (const sample of msg.samples || []) {
                s.samples.push([sample[0], sample[1]]);
                if (s.hashes.size < 100) s.hashes.add(sample[2]);
            }
            while (s.samples.length && s.samples[0][0] < msg.now - o.flashBufferMs) s.samples.shift();
            if (o.flashGuard && isFlashing(s.samples, o)) return fail("flash");

            const visible = s.painted || s.background;
            if (!s.ready) {
                if (s.frames >= o.warmupFrames && s.updates >= o.minUpdates && visible) {
                    s.ready = true;
                    return { type: "ready" };
                }
                if (s.frames >= o.blankFrames && !visible) return fail("blank");
                return null;
            }

            if (o.minFps > 0 && s.revealedAt !== null && msg.now - s.revealedAt >= o.fpsGraceMs + o.fpsWindowMs) {
                const fps = windowFps(msg.now);
                if (fps !== null && fps < o.minFps) return fail("slow", fps.toFixed(1) + " fps");
            }
            return null;
        }

        return {
            push,
            // Call when the dweet becomes visible: the speed check starts from here.
            reveal() { s.revealedAt = s.lastNow; },
            isReady: () => s.ready,
            failure: () => s.failure,
            metrics() {
                let fps = null;
                if (s.start && s.lastNow > s.start[0]) fps = (s.frames - s.start[1]) * 1000 / (s.lastNow - s.start[0]);
                return {
                    frames: s.frames,
                    ok: s.ok,
                    err: s.err,
                    fps: fps === null ? null : Math.round(fps * 10) / 10,
                    visible: s.painted || s.background,
                    distinctFrames: s.hashes.size,
                };
            },
        };
    }

    // Replays the messages recorded from one dweet and returns { verdict, detail, metrics } with verdict one of
    // ok, compile-error, runtime-error, blank, flash, slow, static or incomplete.
    function evaluateLog(log, options) {
        const o = Object.assign({}, options);
        const monitor = createMonitor(o);
        let failure = null;
        for (const msg of log) {
            const event = monitor.push(msg);
            if (event && event.type === "ready") monitor.reveal();
            if (event && event.type === "fail") { failure = event; break; }
        }
        const metrics = monitor.metrics();
        if (failure) return { verdict: failure.reason, detail: failure.detail, metrics };
        if (!monitor.isReady()) return { verdict: "incomplete", detail: metrics.frames + " frames", metrics };
        if (o.static !== false && metrics.frames >= 120 && metrics.distinctFrames <= 1) {
            return { verdict: "static", detail: "", metrics };
        }
        return { verdict: "ok", detail: "", metrics };
    }

    return { DEFAULTS, flashTransitions, isFlashing, createMonitor, evaluateLog };
});
