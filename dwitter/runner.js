/*
 * Dweet runner: plays one dweet on a 1920x1080 canvas, the way dwitter.net does.
 *
 * Derived from dwitter/templates/dweet/dweet.html in https://github.com/lionleaf/dwitter
 * (Apache License 2.0, see NOTICE.md and LICENSE-dwitter.txt).
 * Changes: removed the GIF recorder, stats panel, loop guard and old-browser polyfills. The dweet arrives
 * from the parent page by postMessage, and progress, errors and brightness samples go back the same way.
 *
 * Everything a dweet can see (c, x, S, C, T, R, frame, time, FPS, u, code) is a real global on purpose:
 * dweets are compiled with new Function, which can only reach global scope.
 *
 * This file is loaded by index.html, whose main.js embeds its source text in inline (srcdoc) frames: the default way
 * of running dweets. It is also loaded by runner.html, the fallback frame, which runs it. So DwitterRunnerMain has to
 * stay self-contained: it is copied into a frame as text and cannot use anything from outside itself.
 */
function DwitterRunnerMain() {
    var g = window;
    var parentWindow = g.parent;

    g.FPS = 60;
    g.frame = 0;
    g.time = 0;
    g.code = "";

    var canvas = g.c = document.getElementById("c");
    canvas.width = 1920;
    canvas.height = 1080;
    g.x = canvas.getContext("2d");
    g.S = Math.sin;
    g.C = Math.cos;
    g.T = Math.tan;
    g.R = function R(r, green, b, a) {
        a = a === undefined ? 1 : a;
        return "rgba(" + (r | 0) + "," + (green | 0) + "," + (b | 0) + "," + a + ")";
    };

    // Same page styling as dwitter.net (the canvas is scaled to the width of the frame and anything
    // taller is clipped), applied through the DOM so it also works where inline <style> is not allowed.
    [document.documentElement, document.body, canvas].forEach(function (el) {
        el.style.margin = "0";
        el.style.padding = "0";
        el.style.border = "0";
        el.style.outline = "0";
        el.style.overflow = "hidden";
    });
    document.body.style.background = "white";
    document.body.style.color = "black";
    canvas.style.width = "100%";
    canvas.style.display = "block";
    canvas.style.background = "white";

    // A small canvas used to look at what is on screen: brightness (for the flash check), whether anything has
    // been drawn, and a fingerprint of the picture.
    var PROBE_W = 64;
    var PROBE_H = 36;
    var probeCanvas = document.createElement("canvas");
    probeCanvas.width = PROBE_W;
    probeCanvas.height = PROBE_H;
    var probe = probeCanvas.getContext("2d", { willReadFrequently: true });
    var linear = new Float32Array(256);
    for (var i = 0; i < 256; i++) {
        var v = i / 255;
        linear[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    }

    var userFunction = null;
    var nextFrameMs = 0;
    var ok = 0;
    var err = 0;
    var started = false;
    var stopped = false;
    var everPainted = false;
    var initialBackground = "";
    var initialStyle = "";
    var samples = [];
    var lastSampleAt = 0;
    var lastStatsAt = 0;
    var lastErrorText = "";
    var lastErrorAt = -1e9;

    function post(msg) {
        parentWindow.postMessage(msg, "*");
    }

    // A dweet can remove or hide its canvas; then what it draws is not on screen.
    function canvasVisible() {
        if (!canvas.isConnected) return false;
        var style = getComputedStyle(canvas);
        return style.display !== "none" && style.visibility !== "hidden" && canvas.getBoundingClientRect().width > 0;
    }

    function report(e, phase) {
        var text = (e && e.name ? e.name + ": " : "") + (e && e.message !== undefined ? e.message : String(e));
        var now = performance.now();
        if (phase === "compile" || text !== lastErrorText || now - lastErrorAt > 1000) {
            lastErrorText = text;
            lastErrorAt = now;
            post({ type: "error", phase: phase, message: text, frame: g.frame });
        }
    }

    function parseRgb(css) {
        var m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?/.exec(css);
        return m ? [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]] : null;
    }

    function backgroundRgb() {
        var bg = parseRgb(getComputedStyle(canvas).backgroundColor);
        if (!bg || bg[3] === 0) bg = parseRgb(getComputedStyle(document.body).backgroundColor);
        return bg && bg[3] > 0 ? bg : [255, 255, 255, 1];
    }

    // Some dweets animate through CSS (a changing gradient or transform on the canvas) and leave the canvas itself
    // blank, so what the page styling and markup look like counts as part of the picture.
    function styleSignature() {
        var html = document.body.innerHTML;
        return canvas.style.cssText + "|" + document.body.style.cssText + "|" + document.documentElement.style.cssText +
            "|" + (html.length < 5000 ? html : html.length);
    }

    // Looks at the part of the canvas that is actually on screen (low-res dweets shrink c.width and are scaled up
    // by the page, so only the top 9/16 of the canvas width is visible).
    function sample(now) {
        var bg = backgroundRgb();
        probe.fillStyle = "rgb(" + bg[0] + "," + bg[1] + "," + bg[2] + ")";
        probe.fillRect(0, 0, PROBE_W, PROBE_H);
        var sw = canvas.width;
        var sh = Math.min(canvas.height, sw * 9 / 16);
        if (sw > 0 && sh > 0 && canvasVisible()) probe.drawImage(canvas, 0, 0, sw, sh, 0, 0, PROBE_W, PROBE_H);
        var d = probe.getImageData(0, 0, PROBE_W, PROBE_H).data;
        var lum = 0;
        var diff = 0;
        var hash = 2166136261;
        for (var p = 0; p < d.length; p += 4) {
            lum += 0.2126 * linear[d[p]] + 0.7152 * linear[d[p + 1]] + 0.0722 * linear[d[p + 2]];
            if (Math.abs(d[p] - bg[0]) > 4 || Math.abs(d[p + 1] - bg[1]) > 4 || Math.abs(d[p + 2] - bg[2]) > 4) diff++;
            hash = Math.imul(hash ^ d[p], 16777619);
            hash = Math.imul(hash ^ d[p + 1], 16777619);
            hash = Math.imul(hash ^ d[p + 2], 16777619);
        }
        var signature = styleSignature();
        for (var k = 0; k < signature.length; k++) hash = Math.imul(hash ^ signature.charCodeAt(k), 16777619);
        if (diff >= 1) everPainted = true;
        return [Math.round(now * 10) / 10, Math.round(lum / (PROBE_W * PROBE_H) * 10000) / 10000, hash >>> 0, diff];
    }

    function flushStats(now) {
        lastStatsAt = now;
        post({
            type: "stats",
            frame: g.frame,
            now: Math.round(now * 10) / 10,
            ok: ok,
            err: err,
            painted: everPainted,
            bg: canvasVisible() &&
                (getComputedStyle(canvas).backgroundColor !== initialBackground || canvas.style.cssText !== initialStyle),
            samples: samples,
        });
        samples = [];
    }

    function compile(source) {
        g.code = source;
        // Dwitter unpacks eval(unescape(escape`...`.replace(...))) dweets before compiling them.
        var decoded = source.replace(
            /eval[(](unescape[(]escape`.+`[.]replace[(].+[)][)])[)]/,
            function (match, expression) { return (0, eval)(expression); }
        );
        try {
            userFunction = g.u = new Function("t", decoded);
        } catch (e) {
            // Dwitter's fallback for source that does not compile as a function body.
            (0, eval)("function u(t) {\n" + source + "\n}");
            userFunction = g.u;
        }
    }

    function loop(frameTime) {
        if (stopped) return;
        requestAnimationFrame(loop);

        // Frame-locked to 60 fps like dwitter.net: skip animation frames that come too early (a 120 Hz screen),
        // and let t follow the frame counter rather than the clock.
        if (frameTime < nextFrameMs - 1.5) return;
        nextFrameMs = Math.max(nextFrameMs + 1000 / g.FPS, frameTime);
        g.time = g.frame / g.FPS;
        // Not a typo: since 2024 dwitter.net adds this to every non-zero frame and dweets depend on it.
        g.time += g.frame && 0.000001;
        g.frame++;

        var thrown = null;
        try {
            userFunction(g.time);
            ok++;
        } catch (e) {
            err++;
            report(e, "runtime");
            thrown = e;
        }

        var now = performance.now();
        if (now - lastSampleAt >= 60) {
            lastSampleAt = now;
            try {
                samples.push(sample(now));
            } catch (e) {
                // The canvas can be in a state that cannot be read (for example zero width); skip this sample.
            }
        }
        if (now - lastStatsAt >= 250) flushStats(now);

        // Like dwitter.net, let the error through after the frame is done: the next frame is already scheduled,
        // and the page's own error handlers (which a dweet may have set) see it.
        if (thrown !== null) throw thrown;
    }

    function start(msg) {
        // The page gets the colour too, so that a dweet which makes its canvas shorter than the frame has the same colour
        // around it.
        if (typeof msg.background === "string" && msg.background) {
            document.body.style.background = msg.background;
            canvas.style.background = msg.background;
        }
        initialBackground = getComputedStyle(canvas).backgroundColor;
        initialStyle = canvas.style.cssText;
        try {
            compile(String(msg.code));
        } catch (e) {
            report(e, "compile");
            return;
        }
        requestAnimationFrame(loop);
    }

    g.addEventListener("message", function (event) {
        if (event.source !== parentWindow || !event.data || typeof event.data !== "object") return;
        if (event.data.type === "run" && !started) {
            started = true;
            start(event.data);
        } else if (event.data.type === "stop") {
            stopped = true;
        }
    });

    post({ type: "ready" });
}

if (document.body && document.body.hasAttribute("data-dweet-runner")) {
    DwitterRunnerMain();
}
