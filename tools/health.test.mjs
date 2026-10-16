import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const H = require("../dwitter/health.js");

// Brightness samples every 62.5 ms (16 per second) following `levelAt(seconds)`.
function brightness(seconds, levelAt) {
    const out = [];
    for (let t = 0; t < seconds * 1000; t += 62.5) out.push([t, levelAt(t / 1000)]);
    return out;
}

const square = (hz, low = 0, high = 1) => (s) => (Math.floor(s * hz * 2) % 2 === 0 ? low : high);

test("a steady picture is not flashing", () => {
    assert.equal(H.isFlashing(brightness(4, () => 0.4)), false);
});

test("a 4 Hz black and white strobe is flashing", () => {
    assert.equal(H.isFlashing(brightness(3, square(4))), true);
});

test("a slow 1 Hz blink is not flashing", () => {
    assert.equal(H.isFlashing(brightness(6, square(1))), false);
});

test("brightness noise below 10% is ignored", () => {
    assert.equal(H.isFlashing(brightness(4, (s) => 0.5 + 0.04 * Math.sin(s * 80))), false);
});

test("flicker where even the dark side is very bright does not count", () => {
    assert.equal(H.isFlashing(brightness(4, square(4, 0.85, 1))), false);
});

test("a single one-second burst is not enough, two are", () => {
    const burst = (from) => (s) => (s >= from && s < from + 1 ? square(4)(s - from) : 0.2);
    assert.equal(H.isFlashing(brightness(5, burst(1))), false);
    const twice = (s) => (s >= 0.5 && s < 1.5) || (s >= 2.5 && s < 3.5) ? square(4)(s) : 0.2;
    assert.equal(H.isFlashing(brightness(5, twice)), true);
});

function stats(frame, extra = {}) {
    return { type: "stats", frame, now: frame * (1000 / 60), ok: frame, err: 0, painted: true, bg: false, samples: [], ...extra };
}

function play(monitor, frames, build = stats, step = 15) {
    const events = [];
    for (let f = step; f <= frames; f += step) {
        const event = monitor.push(build(f));
        if (event) events.push([f, event]);
    }
    return events;
}

test("a dweet that draws is ready after the warm-up frames and a few updates", () => {
    const events = play(H.createMonitor(), 90);
    assert.deepEqual(events, [[60, { type: "ready" }]]);
});

test("a compile error fails straight away", () => {
    const event = H.createMonitor().push({ type: "error", phase: "compile", message: "SyntaxError: x" });
    assert.deepEqual(event, { type: "fail", reason: "compile-error", detail: "SyntaxError: x" });
});

test("a dweet that never draws is blank", () => {
    const events = play(H.createMonitor(), 240, (f) => stats(f, { painted: false }));
    assert.equal(events[0][1].reason, "blank");
    assert.equal(events[0][0], 180);
});

test("a dweet that only changes the background counts as drawing", () => {
    const events = play(H.createMonitor(), 90, (f) => stats(f, { painted: false, bg: true }));
    assert.equal(events[0][1].type, "ready");
});

test("an error on the first frame only is fine", () => {
    const monitor = H.createMonitor();
    const events = play(monitor, 120, (f) => stats(f, { err: 1, ok: f - 1 }));
    assert.equal(events.some(([, e]) => e.type === "fail"), false);
});

test("a dweet that throws on every frame is rejected before it is ever shown", () => {
    const monitor = H.createMonitor();
    monitor.push({ type: "error", phase: "runtime", message: "ReferenceError: nope is not defined" });
    const events = play(monitor, 120, (f) => stats(f, { ok: 0, err: f }));
    assert.equal(events.some(([, e]) => e.type === "ready"), false);
    const failure = events.find(([, e]) => e.type === "fail")[1];
    assert.equal(failure.reason, "runtime-error");
    assert.match(failure.detail, /nope is not defined/);
});

test("a slow dweet fails once the speed has been measured, a fast one does not", () => {
    const run = (fpsOfDweet) => {
        const monitor = H.createMonitor({ minFps: 30 });
        const build = (f) => ({ ...stats(f), now: f * (1000 / fpsOfDweet) });
        let revealed = false;
        for (let f = 15; f <= 600; f += 15) {
            const event = monitor.push(build(f));
            if (event && event.type === "ready") { monitor.reveal(); revealed = true; }
            if (event && event.type === "fail") return event;
        }
        assert.ok(revealed);
        return null;
    };
    assert.equal(run(60), null);
    const slow = run(15);
    assert.equal(slow.reason, "slow");
    assert.match(slow.detail, /^1[45]\.\d fps$/);
});

test("minFps 0 turns the speed check off", () => {
    const monitor = H.createMonitor({ minFps: 0 });
    let failed = false;
    for (let f = 15; f <= 600; f += 15) {
        const event = monitor.push({ ...stats(f), now: f * 100 });
        if (event && event.type === "ready") monitor.reveal();
        if (event && event.type === "fail") failed = true;
    }
    assert.equal(failed, false);
});

test("the flash guard fails a strobing dweet and can be switched off", () => {
    const strobe = (monitorOptions) => {
        const monitor = H.createMonitor(monitorOptions);
        const samples = brightness(4, square(4)).map(([t, v]) => [t, v, Math.round(v * 255)]);
        let failure = null;
        for (let f = 15; f <= 240 && !failure; f += 15) {
            const now = f * (1000 / 60);
            const event = monitor.push({ ...stats(f), samples: samples.filter(([t]) => t > now - 250 && t <= now) });
            if (event && event.type === "fail") failure = event;
        }
        return failure;
    };
    assert.equal(strobe({}).reason, "flash");
    assert.equal(strobe({ flashGuard: false }), null);
});

test("evaluateLog: ok, static, incomplete", () => {
    const moving = (f) => ({ ...stats(f), samples: [[f * (1000 / 60), 0.5, f]] });
    const frozen = (f) => ({ ...stats(f), samples: [[f * (1000 / 60), 0.5, 7]] });
    const log = (build, frames) => Array.from({ length: frames / 15 }, (_, i) => build((i + 1) * 15));

    assert.equal(H.evaluateLog(log(moving, 180), { minFps: 0 }).verdict, "ok");
    assert.equal(H.evaluateLog(log(frozen, 180), { minFps: 0 }).verdict, "static");
    assert.equal(H.evaluateLog(log(frozen, 180), { minFps: 0, static: false }).verdict, "ok");
    assert.equal(H.evaluateLog(log(moving, 15), { minFps: 0 }).verdict, "incomplete");
});

test("metrics report the frame rate", () => {
    const monitor = H.createMonitor();
    play(monitor, 300);
    const metrics = monitor.metrics();
    assert.equal(metrics.frames, 300);
    assert.ok(Math.abs(metrics.fps - 60) < 0.5, String(metrics.fps));
});
