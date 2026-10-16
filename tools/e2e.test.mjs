// End-to-end tests: the real stage, running in a real (headless) Chrome, against small fixture sites.
// They need Chrome (or Chromium/Edge) and are skipped when none is found.   node --test tools/e2e.test.mjs
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { inflateSync } from "node:zlib";
import { findChrome, launchBrowser, startServer } from "./lib/browser.mjs";

const siteDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dwitter");
let skip = false;
try { findChrome(); } catch (e) { skip = "Chrome not found"; }

const GOOD = [
    "c.width=1920;x.fillStyle=R(255,S(t)*99+99,0);x.fillRect(S(t)*500+900,500,200,200)",
    "c.width=1920;x.fillStyle=R(0,S(t)*99+99,255);x.fillRect(300,C(t)*300+400,300,300)",
    "c.width=1920;x.fillStyle=R(S(t)*99+99,255,0);x.beginPath();x.arc(960,540,200+S(t)*60,0,7);x.fill()",
];

// A small database in the Dweetabase format (percent-encoded code, trailing comma, closing "];").
const FIXTURE_DB = "let dweets = [\n" + GOOD.map((code, i) => JSON.stringify({
    id: 1001 + i, username: "tester" + i, comment: "", code: escape(code), posted: "2020-01-01", awesome_count: 60 - i * 10,
})).join(",\n") + ",\n];\n";

const CUSTOM = [
    { id: "good-a", username: "u1", code: GOOD[0] },
    { id: "good-b", username: "u2", code: GOOD[1] },
    { id: "good-c", username: "u3", code: GOOD[2] },
    { id: "bad-syntax", username: "b1", code: "x.fillRect(" },
    { id: "bad-runtime", username: "b2", code: "x.fillRect(0,0,50,50);nope.nothing()" },
    { id: "blank", username: "b3", code: "1" },
    { id: "flash", username: "b4", code: "c.width=1920;x.fillStyle=(frame>>3)%2?'#fff':'#000';x.fillRect(0,0,1920,1080)" },
    { id: "slow", username: "b5", code: "x.fillRect(0,0,50,50);for(s=performance.now();performance.now()-s<55;);" },
    { id: "no-canvas", username: "b7", code: "if(frame==1)c.remove();x.fillRect(0,0,50,50)" },
    {
        id: "probe",
        username: "b6",
        code: 'if(frame==1){' +
            'try{parent.document.title="pwned"}catch(e){parent.postMessage({type:"probe",what:"title",blocked:true},"*")}' +
            'try{top.location.href="about:blank"}catch(e){}' +
            'fetch("/config.js").then(function(){parent.postMessage({type:"probe",what:"fetch",blocked:false},"*")},function(){parent.postMessage({type:"probe",what:"fetch",blocked:true},"*")});' +
            'try{localStorage.x=1;parent.postMessage({type:"probe",what:"storage",blocked:false},"*")}catch(e){parent.postMessage({type:"probe",what:"storage",blocked:true},"*")}' +
            '}x.fillRect(0,0,99,99)',
    },
];

let tmp;
let browser;
const servers = [];
const extraBrowsers = [];

before(async () => {
    if (skip) return;
    tmp = mkdtempSync(path.join(os.tmpdir(), "dwitter-e2e-"));
    browser = await launchBrowser();
});

after(async () => {
    for (const s of servers) await s.close();
    for (const b of extraBrowsers) await b.close();
    if (browser) await browser.close();
    if (tmp) rmSync(tmp, { recursive: true, force: true });
});

function makeSite(name, { database = true, config, custom = CUSTOM, extraCustom = [] } = {}) {
    const dir = path.join(tmp, name);
    cpSync(siteDir, dir, { recursive: true, filter: (src) => path.basename(src) !== "dweets.js" });
    if (database) writeFileSync(path.join(dir, "dweets.js"), FIXTURE_DB);
    writeFileSync(path.join(dir, "custom-dweets.js"), "const CUSTOM_DWEETS = " + JSON.stringify([...custom, ...extraCustom]) + ";\n");
    if (config) writeFileSync(path.join(dir, "config.js"), config);
    return dir;
}

async function open(dir, query, { useFile = false, headers, beforeLoad } = {}) {
    let url;
    if (useFile) {
        url = pathToFileURL(path.join(dir, "index.html")).href + "?" + query;
    } else {
        const server = await startServer(dir, { headers });
        servers.push(server);
        url = server.url + "/index.html?" + query;
    }
    const tab = await browser.newTab(null);
    const messages = [];
    tab.onMessage((kind, text) => messages.push(kind + ": " + text));
    if (beforeLoad) await beforeLoad(tab);
    await tab.goto(url);
    return { tab, messages };
}

const snapshot = async (tab) => JSON.parse(await tab.evaluate("JSON.stringify(window.__dwitter ? window.__dwitter.snapshot() : null)"));
const failures = async (tab) => JSON.parse(await tab.evaluate("JSON.stringify(window.__dwitter.failures)"));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(description, fn, timeoutMs = 20000) {
    const started = Date.now();
    let last;
    while (Date.now() - started < timeoutMs) {
        try {
            last = await fn();
            if (last) return last;
        } catch (e) {
            last = e.message;
        }
        await sleep(250);
    }
    throw new Error("Timed out waiting for " + description + " (last: " + JSON.stringify(last) + ")");
}

test("a pinned dweet is shown and keeps running at full speed", { skip }, async () => {
    const { tab } = await open(makeSite("pinned"), "id=good-a&rotate=0");
    const snap = await until("the dweet to be shown", async () => {
        const s = await snapshot(tab);
        return s && s.current === "good-a" && s;
    });
    assert.equal(snap.iframes, 1);
    await sleep(1500);
    const stats = await tab.evaluate("JSON.stringify(window.__dwitter.log.filter(e => e.msg.type === 'stats').slice(-1)[0].msg)");
    assert.ok(JSON.parse(stats).frame > 60, "the dweet should have run for more than a second at speed: " + stats);
    await tab.close();
});

test("dweets rotate, with at most two frames alive during a cross-fade", { skip }, async () => {
    const { tab } = await open(makeSite("rotation"), "debug=1&rotate=2&include=" + encodeURIComponent("IDS_good-a,good-b,good-c"));
    const seen = new Set();
    let maxFrames = 0;
    await until("three different dweets", async () => {
        const s = await snapshot(tab);
        if (s && s.current) seen.add(s.current);
        if (s) maxFrames = Math.max(maxFrames, s.iframes);
        return seen.size >= 3;
    }, 30000);
    assert.ok(maxFrames <= 2, "iframes alive at once: " + maxFrames);
    assert.deepEqual(await failures(tab), []);
    await tab.close();
});

for (const [bad, reason] of [["bad-syntax", "compile-error"], ["bad-runtime", "runtime-error"], ["blank", "blank"], ["no-canvas", "blank"], ["slow", "slow"]]) {
    test(`a ${bad} dweet is skipped (${reason}) and never stays on screen`, { skip }, async () => {
        const { tab } = await open(makeSite("skip-" + bad), "debug=1&rotate=2&include=" + encodeURIComponent(`IDS_${bad},good-a,good-b`));
        const shownBad = [];
        await until("the bad dweet to be rejected", async () => {
            const s = await snapshot(tab);
            if (s && s.current === bad && reason !== "slow") shownBad.push(s.current);
            return (await failures(tab)).some((f) => f.id === bad && f.reason === reason);
        }, 60000);
        const s = await snapshot(tab);
        assert.deepEqual(shownBad, [], "the bad dweet was on screen");
        if (reason === "slow") {
            await until("a replacement for the slow dweet", async () => (await snapshot(tab)).current !== bad, 15000);
        } else {
            assert.notEqual(s.current, bad);
        }
        await tab.close();
    });
}

test("a flashing dweet is cut, and remembered so it is not shown again", { skip }, async () => {
    const dir = makeSite("flash");
    const { tab } = await open(dir, "debug=1&rotate=2&include=" + encodeURIComponent("IDS_flash,good-a,good-b"));
    await until("the flashing dweet to be cut", async () => (await failures(tab)).some((f) => f.id === "flash" && f.reason === "flash"), 90000);
    const flashy = JSON.parse(await tab.evaluate("localStorage.getItem('dwitter.flashy')"));
    assert.deepEqual(flashy, ["flash"]);
    const s = await until("a replacement", async () => {
        const snap = await snapshot(tab);
        return snap.current && snap.current !== "flash" && snap;
    }, 20000);
    assert.notEqual(s.current, "flash");
    await tab.close();
});

test("dweets cannot reach the screensaver page, the network or storage", { skip }, async () => {
    const { tab } = await open(makeSite("sandbox"), "id=probe&rotate=0");
    const probes = await until("the dweet to report back", async () => {
        const log = JSON.parse(await tab.evaluate("JSON.stringify(window.__dwitter.log.filter(e => e.msg.type === 'probe').map(e => e.msg))"));
        return log.length >= 3 && log;
    });
    assert.deepEqual(probes.filter((p) => p.blocked !== true), [], "something was not blocked: " + JSON.stringify(probes));
    assert.deepEqual(probes.map((p) => p.what).sort(), ["fetch", "storage", "title"]);
    assert.equal(await tab.evaluate("document.title"), "Dwitter Screensaver");
    assert.match(await tab.evaluate("location.pathname"), /index\.html$/);
    await tab.close();
});

const HOSTILE_TAIL = 'window.__ran = 1; document.title = "pwned";\n';

test("a database that contains code is not used and nothing in it is run", { skip }, async () => {
    for (const config of [undefined, 'const CONFIG = { DATABASE_MODE: "data" };\n']) {
        const dir = makeSite("hostile-db-" + (config ? "data" : "auto"), { config });
        writeFileSync(path.join(dir, "dweets.js"), FIXTURE_DB + HOSTILE_TAIL);
        const { tab } = await open(dir, "debug=1&rotate=0&include=" + encodeURIComponent("IDS_1001,good-a"));
        const snap = await until("the screensaver to start", async () => {
            const s = await snapshot(tab);
            return s && s.current && s;
        });
        assert.equal(snap.current, "good-a", "the database must not be used, only the custom dweet is left");
        assert.equal(snap.pool, 1);
        assert.equal(await tab.evaluate("document.title"), "Dwitter Screensaver");
        assert.equal(await tab.evaluate("typeof window.__ran"), "undefined");
        assert.match(await tab.evaluate("document.getElementById('hint').textContent"), /not in the expected format/);
        await tab.close();
    }
});

test('DATABASE_MODE "direct" is the explicit way to run dweets.js as a script', { skip }, async () => {
    const dir = makeSite("direct-db", { config: 'const CONFIG = { DATABASE_MODE: "direct" };\n' });
    writeFileSync(path.join(dir, "dweets.js"), FIXTURE_DB + HOSTILE_TAIL);
    const { tab } = await open(dir, "debug=1&rotate=0&include=IDS_1001");
    const snap = await until("a dweet from the database", async () => {
        const s = await snapshot(tab);
        return s && s.current === "1001" && s;
    });
    assert.equal(snap.pool, 1);
    assert.equal(await tab.evaluate("window.__ran"), 1);
    await tab.close();
});

test("the database is read as data, without a frame, and falls back to a script only when it cannot be fetched", { skip }, async () => {
    const failFetches = (tab) => tab.send("Fetch.enable", { patterns: [{ resourceType: "Fetch" }] }).then(() => {
        tab.on("Fetch.requestPaused", (p) => tab.send("Fetch.failRequest", { requestId: p.requestId, errorReason: "Failed" }).catch(() => {}));
    });

    const normal = await open(makeSite("db-data"), "debug=1&rotate=0&include=IDS_1001");
    const snap = await until("a dweet from the database", async () => {
        const s = await snapshot(normal.tab);
        return s && s.current === "1001" && s;
    });
    assert.equal(snap.pool, 1);
    assert.equal(await normal.tab.evaluate("document.querySelectorAll('iframe').length"), 1, "only the dweet's own frame exists");
    assert.ok((await normal.tab.evaluate("window.__dwitter.events.join('\\n')")).includes("read dweets.js as data"));
    await normal.tab.close();

    const auto = await open(makeSite("db-fetch-blocked-auto"), "debug=1&rotate=0&include=IDS_1001", { beforeLoad: failFetches });
    await until("the dweet from the database, read as a script", async () => {
        const s = await snapshot(auto.tab);
        return s && s.current === "1001" && s;
    });
    assert.ok((await auto.tab.evaluate("window.__dwitter.events.join('\\n')")).includes("running dweets.js as a script"));
    await auto.tab.close();

    const strict = await open(makeSite("db-fetch-blocked-data", { config: 'const CONFIG = { DATABASE_MODE: "data" };\n' }),
        "debug=1&rotate=0&include=IDS_1001", { beforeLoad: failFetches });
    await until("the hint about the missing database", async () => strict.tab.evaluate("!document.getElementById('hint').hidden"));
    assert.match(await strict.tab.evaluate("document.getElementById('hint').textContent"), /could not be read/);
    assert.notEqual((await snapshot(strict.tab)).current, "1001");
    await strict.tab.close();
});

test("a dweet cannot load a script from another origin", { skip }, async () => {
    const remoteDir = path.join(tmp, "remote");
    mkdirSync(remoteDir, { recursive: true });
    writeFileSync(path.join(remoteDir, "remote.js"), 'parent.postMessage({type:"probe",what:"remote-script",blocked:false},"*");');
    const remote = await startServer(remoteDir);
    servers.push(remote);
    const code = 'if(frame==1){var s=document.createElement("script");s.src="' + remote.url + '/remote.js";' +
        's.onerror=function(){parent.postMessage({type:"probe",what:"remote-script",blocked:true},"*")};' +
        'document.head.appendChild(s)}x.fillRect(0,0,99,99)';
    const dir = makeSite("remote-script", { extraCustom: [{ id: "remote", username: "r", code }] });
    const { tab } = await open(dir, "id=remote&rotate=0");
    const probes = await until("the dweet to report back", async () => {
        const log = JSON.parse(await tab.evaluate("JSON.stringify(window.__dwitter.log.filter(e => e.msg.type === 'probe').map(e => e.msg))"));
        return log.length >= 1 && log;
    });
    assert.deepEqual(probes.map((p) => [p.what, p.blocked]), [["remote-script", true]]);
    await tab.close();
});

test("a dweet that sends its frame somewhere else is removed at once", { skip }, async () => {
    const code = "x.fillRect(0,0,50,50);if(frame==150)location.href='about:blank'";
    const dir = makeSite("navigate", { extraCustom: [{ id: "wander", username: "w", code }] });
    // Rotation must be on: the shuffle picks the first dweet at random, and every dweet gets its turn only if it rotates.
    const { tab } = await open(dir, "debug=1&rotate=5&include=" + encodeURIComponent("IDS_wander,good-a,good-b"));
    await until("the wandering dweet to be rejected", async () => (await failures(tab)).some((f) => f.id === "wander" && f.reason === "navigated"), 60000);
    const s = await until("a replacement", async () => {
        const snap = await snapshot(tab);
        return snap.current && snap.current !== "wander" && snap;
    }, 20000);
    assert.ok(s.iframes <= 2);
    await tab.close();
});

test("a dweet that navigates away is never picked (d/5100 is one of them)", { skip }, async () => {
    const dir = makeSite("leaves-page", { database: false, custom: [], extraCustom: [
        { id: "ok-1", username: "a", code: GOOD[0] },
        { id: "5100", username: "b", code: 't||(location="//www.dwitter.net/d"+location.pathname.substring(3))' },
    ] });
    const { tab } = await open(dir, "debug=1&rotate=0&include=CUSTOM");
    const snap = await until("the screensaver to start", async () => {
        const s = await snapshot(tab);
        return s && s.current && s;
    });
    assert.equal(snap.pool, 1);
    assert.equal(snap.current, "ok-1");
    await tab.close();
});

test("a dweet cannot overload the page with messages", { skip }, async () => {
    const code = 'if(frame==1){parent.postMessage({type:"stats",frame:2,now:2,ok:2,err:0,painted:true,samples:new Array(2e6).fill([0.5,0.5,1,1])},"*");' +
        'for(var i=0;i<4000;i++)parent.postMessage({type:"stats",frame:1,now:1,ok:1,err:0,painted:true,samples:[]},"*")}x.fillRect(0,0,50,50)';
    const dir = makeSite("flood", { extraCustom: [{ id: "flood", username: "f", code }] });
    const { tab } = await open(dir, "debug=1&rotate=2&include=" + encodeURIComponent("IDS_flood,good-a,good-b"));
    await until("the flooding dweet to be rejected", async () => (await failures(tab)).some((f) => f.id === "flood" && f.reason === "flooding"), 60000);
    const s = await until("the page to stay responsive and show something else", async () => {
        const snap = await snapshot(tab);
        return snap.current && snap.current !== "flood" && snap;
    }, 30000);
    assert.ok(s.iframes <= 2);
    await tab.close();
});

test("a missing database shows a hint and falls back to the custom dweets", { skip }, async () => {
    // Only well-behaved custom dweets here, so how long the bad fixtures take to be rejected cannot make this test flaky.
    const { tab } = await open(makeSite("no-db", { database: false, custom: CUSTOM.slice(0, 3) }), "debug=1&rotate=0&include=TOP_10");
    const snap = await until("a custom dweet", async () => {
        const s = await snapshot(tab);
        return s && s.current && s;
    });
    assert.ok(snap.pool >= 1);
    const hint = await tab.evaluate("document.getElementById('hint').hidden ? '' : document.getElementById('hint').textContent");
    assert.match(hint, /dweets\.js was not found/);
    await tab.close();
});

test("a bad value in config.js is reported and replaced by the default", { skip }, async () => {
    const config = 'const CONFIG = { ROTATE_SECONDS: "fast", FIT: "wide", INCLUDE: "TOPP_5", ATTRIBUTION_POSITION: "middle-ish", BACKGROUND_COLOR: "not-a-colour" };\n';
    const { tab } = await open(makeSite("bad-config", { config, custom: CUSTOM.slice(0, 3) }), "debug=1");
    await until("the hint", async () => tab.evaluate("!document.getElementById('hint').hidden"));
    const hint = await tab.evaluate("document.getElementById('hint').textContent");
    assert.match(hint, /ROTATE_SECONDS/);
    assert.match(hint, /FIT/);
    assert.match(hint, /ATTRIBUTION_POSITION in config\.js should be TOP_LEFT, .*BOTTOM_RIGHT, RANDOM or OFF\. Using "BOTTOM_LEFT"/);
    assert.match(hint, /BACKGROUND_COLOR in config\.js should be a CSS colour.* Using "white"/);
    assert.match(hint, /Unknown preset "TOPP_5"/);
    const snap = await until("a dweet from the default selection", async () => {
        const s = await snapshot(tab);
        return s && s.current && s;
    });
    assert.ok(snap.pool >= 3);
    assert.equal(snap.background, "rgb(255, 255, 255)");
    await tab.close();
});

test("dweets run in inline frames by default: no frame is loaded by its address", { skip }, async () => {
    const dir = makeSite("inline-default");
    rmSync(path.join(dir, "runner.html"));
    const { tab } = await open(dir, "debug=1&rotate=2&include=" + encodeURIComponent("IDS_good-a,good-b,good-c"));
    await until("three different dweets", async () => {
        const s = await snapshot(tab);
        return s && s.rotations >= 3 && s;
    });
    assert.equal((await snapshot(tab)).runMode, "srcdoc");
    assert.equal(await tab.evaluate("document.querySelectorAll('iframe[src]').length"), 0);
    assert.ok(await tab.evaluate("document.querySelectorAll('iframe[srcdoc]').length") >= 1);
    await tab.close();
});

test("RUN_MODE iframe uses the runner.html frame", { skip }, async () => {
    const { tab } = await open(makeSite("iframe-mode"), "id=good-b&rotate=0&mode=iframe");
    const snap = await until("the dweet", async () => {
        const s = await snapshot(tab);
        return s && s.current === "good-b" && s;
    });
    assert.equal(snap.runMode, "iframe");
    assert.equal(await tab.evaluate("document.querySelectorAll('iframe[src]').length"), 1);
    await tab.close();
});

test("when inline frames cannot start, it switches to the runner.html frame by itself and remembers that", { skip }, async () => {
    // A page whose policy forbids inline scripts stops them in the inline frames too, which inherit it.
    const headers = (rel) => (rel === "/index.html" ? { "Content-Security-Policy": "script-src 'self'" } : {});
    const dir = makeSite("inline-blocked");
    const { tab } = await open(dir, "debug=1&rotate=0&id=good-a", { headers });
    const snap = await until("the dweet in a runner.html frame", async () => {
        const s = await snapshot(tab);
        return s && s.current === "good-a" && s;
    }, 30000);
    assert.equal(snap.runMode, "iframe");
    assert.equal(JSON.parse(await tab.evaluate("localStorage.getItem('dwitter.runMode')")).mode, "iframe");

    // The next start goes straight to the way that worked.
    await tab.goto((await tab.evaluate("location.href")));
    const again = await until("the second start", async () => {
        const s = await snapshot(tab);
        return s && s.pool >= 1 && s;
    });
    assert.equal(again.runMode, "iframe");
    await tab.close();
});

test("opened straight from the file system it runs dweets.js as a script and still plays dweets", { skip }, async () => {
    const { tab } = await open(makeSite("file"), "debug=1&rotate=0&include=IDS_1001", { useFile: true });
    const snap = await until("a dweet from the database", async () => {
        const s = await snapshot(tab);
        return s && s.current === "1001" && s;
    }, 30000);
    assert.equal(snap.pool, 1);
    assert.equal(snap.runMode, "srcdoc");
    await tab.close();
});

// Steam shows a screensaver from a host name that exists only inside Steam (uioverride-<folder>.steamscreensavers.host),
// and a request that Steam does not serve ends in a full-screen "Error Code: -105" (ERR_NAME_NOT_RESOLVED).
// This runs the screensaver the same way: the page is on a name that only this browser knows, every other name fails
// to resolve, and anything that tries to load a frame by its address fails the same way.
test("on a host name that only exists inside the browser it makes no request that could fail", { skip }, async () => {
    const host = "uioverride-dwitter.steamscreensavers.host";
    const server = await startServer(makeSite("steam-like"));
    servers.push(server);
    const steam = await launchBrowser({ args: [`--host-resolver-rules=MAP ${host} 127.0.0.1, EXCLUDE 127.0.0.1, EXCLUDE localhost, MAP * ~NOTFOUND`] });
    extraBrowsers.push(steam);
    const tab = await steam.newTab(null);
    await tab.send("Network.enable");
    const mainFrame = (await tab.send("Page.getFrameTree")).frameTree.frame.id;
    const hosts = new Set();
    const subframes = [];
    const failed = [];
    tab.on("Network.requestWillBeSent", (p) => {
        if (!p.request.url.startsWith("http")) return;
        hosts.add(new URL(p.request.url).hostname);
        if (p.type === "Document" && p.frameId !== mainFrame) subframes.push(p.request.url);
    });
    tab.on("Network.loadingFailed", (p) => failed.push(p.errorText + " " + (p.type || "")));
    await tab.send("Fetch.enable", { patterns: [{ resourceType: "Document" }] });
    tab.on("Fetch.requestPaused", (p) => {
        const action = p.frameId !== mainFrame
            ? tab.send("Fetch.failRequest", { requestId: p.requestId, errorReason: "NameNotResolved" })
            : tab.send("Fetch.continueRequest", { requestId: p.requestId });
        action.catch(() => {});
    });
    await tab.goto(`http://${host}:${new URL(server.url).port}/index.html?debug=1&rotate=2&include=` + encodeURIComponent("IDS_1001,good-a,good-b"));

    const snap = await until("dweets from the database and the custom ones to be shown", async () => {
        const s = await snapshot(tab);
        return s && s.rotations >= 3 && s;
    });
    assert.equal(snap.pool, 3, "the database was read");
    assert.equal(snap.runMode, "srcdoc");
    assert.deepEqual(subframes, [], "no frame may be loaded by its address");
    assert.deepEqual(failed, [], "nothing may fail to load");
    assert.deepEqual([...hosts], [host], "every request goes to the screensaver's own host");
    await tab.close();
});

test("a new dweet starts whenever the page is shown again", { skip }, async () => {
    const { tab } = await open(makeSite("visible"), "debug=1&rotate=0&include=" + encodeURIComponent("IDS_good-a,good-b,good-c"));
    const first = await until("the first dweet", async () => (await snapshot(tab)).current);
    let second = first;
    for (let i = 0; i < 5 && second === first; i++) {
        await tab.evaluate("document.dispatchEvent(new Event('visibilitychange'))");
        second = await until("a dweet", async () => {
            const s = await snapshot(tab);
            return s.rotations >= i + 2 && s.current;
        });
    }
    assert.notEqual(second, first);
    await tab.close();
});

test("DEBUG shows what the screensaver is doing, and how the run before it ended", { skip }, async () => {
    // Inline frames are forced and blocked here, so no dweet ever appears and the overlay keeps the earlier run on screen.
    const headers = (rel) => (rel === "/index.html" ? { "Content-Security-Policy": "script-src 'self'" } : {});
    const { tab } = await open(makeSite("debug-overlay"), "debug=1&rotate=0&mode=srcdoc&include=IDS_good-a", { headers });
    const overlay = () => tab.evaluate("document.getElementById('debug').textContent");
    await until("the overlay to describe the start", async () => /read dweets\.js as data/.test(await overlay()));
    assert.match(await overlay(), /index\.html/);
    await sleep(1200); // the log is saved shortly after it changes
    await tab.goto(await tab.evaluate("location.href"));
    const text = await until("the overlay to show the run before", async () => {
        const t = await overlay();
        return /the run before this one/.test(t) && t;
    });
    assert.match(text, /read dweets\.js as data/);
    await tab.close();
});

const credit = (tab) => tab.evaluate("document.getElementById('attribution').textContent");
const creditShown = (tab) => tab.evaluate("document.getElementById('attribution').classList.contains('on')");
const boxOf = async (tab, id) => JSON.parse(await tab.evaluate(`JSON.stringify((() => {
    const r = document.getElementById(${JSON.stringify(id)}).getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: innerWidth, height: innerHeight };
})())`));

test("the credit goes in the corner that ATTRIBUTION_POSITION names, and is white with a dark outline", { skip }, async () => {
    const nearTop = (b) => b.top < b.height * 0.1;
    const nearBottom = (b) => b.bottom > b.height * 0.9;
    const centred = (b) => Math.abs((b.left + b.right) / 2 - b.width / 2) < 2;
    const cases = {
        TOP_LEFT: (b) => b.left < b.width * 0.1 && nearTop(b),
        TOP_MIDDLE: (b) => centred(b) && nearTop(b),
        TOP_RIGHT: (b) => b.right > b.width * 0.9 && nearTop(b),
        BOTTOM_LEFT: (b) => b.left < b.width * 0.1 && nearBottom(b),
        BOTTOM_MIDDLE: (b) => centred(b) && nearBottom(b),
        BOTTOM_RIGHT: (b) => b.right > b.width * 0.9 && nearBottom(b),
    };
    for (const [position, isThere] of Object.entries(cases)) {
        const { tab } = await open(makeSite("credit-" + position, { config: `const CONFIG = { ATTRIBUTION_POSITION: "${position}" };\n` }), "rotate=0&include=IDS_1001");
        await until("the credit", () => creditShown(tab));
        assert.equal(await credit(tab), "by tester0 \u00b7 dwitter.net/d/1001");
        const box = await boxOf(tab, "attribution");
        assert.ok(isThere(box), position + " is not where it should be: " + JSON.stringify(box));
        if (position === "TOP_LEFT") {
            // What makes it readable over any picture: white text with a dark outline all round, and a glow.
            const style = JSON.parse(await tab.evaluate("JSON.stringify((() => { const s = getComputedStyle(document.getElementById('attribution')); return { color: s.color, shadow: s.textShadow }; })())"));
            assert.equal(style.color, "rgb(255, 255, 255)");
            assert.ok((style.shadow.match(/rgba?\(0, 0, 0/g) || []).length >= 10, "the outline and glow are missing: " + style.shadow);
        }
        await tab.close();
    }
});

test("the credit is on by default in the bottom left, and can be switched off or spelled loosely", { skip }, async () => {
    const byDefault = await open(makeSite("credit-default"), "rotate=0&include=IDS_1001");
    await until("the credit", () => creditShown(byDefault.tab));
    assert.equal(await byDefault.tab.evaluate("document.getElementById('attribution').dataset.at"), "bottom-left");
    await byDefault.tab.close();

    for (const value of ['"OFF"', "false", '"off"']) {
        const { tab } = await open(makeSite("credit-off-" + value.replace(/\W/g, ""), { config: `const CONFIG = { ATTRIBUTION_POSITION: ${value} };\n` }), "debug=1&rotate=0&include=IDS_1001");
        await until("the dweet", async () => (await snapshot(tab)).current === "1001");
        await sleep(1300);
        assert.equal(await tab.evaluate("document.getElementById('attribution').hidden"), true, value);
        assert.equal(await creditShown(tab), false, value);
        assert.equal(await tab.evaluate("document.getElementById('hint').hidden"), true, value + " is a valid value, so there is no hint");
        await tab.close();
    }

    const loose = await open(makeSite("credit-loose", { config: 'const CONFIG = { ATTRIBUTION_POSITION: " top-right " };\n' }), "rotate=0&include=IDS_1001");
    await until("the credit", () => creditShown(loose.tab));
    assert.equal(await loose.tab.evaluate("document.getElementById('attribution').dataset.at"), "top-right");
    assert.equal(await loose.tab.evaluate("document.getElementById('hint').hidden"), true);
    await loose.tab.close();
});

test("the credit follows the dweet on screen, and a fixed position stays where it is", { skip }, async () => {
    const { tab } = await open(makeSite("credit-follows"), "debug=1&rotate=3&include=" + encodeURIComponent("IDS_1001,1002,1003"));
    const seen = new Set();
    const places = new Set();
    await until("a credit for each of the three dweets", async () => {
        const s = await snapshot(tab);
        if (s && s.current && (await creditShown(tab))) {
            const expected = `by tester${Number(s.current) - 1001} \u00b7 dwitter.net/d/${s.current}`;
            if ((await credit(tab)) === expected) {
                seen.add(s.current);
                places.add(await tab.evaluate("document.getElementById('attribution').dataset.at"));
            }
        }
        return seen.size >= 3;
    }, 45000);
    assert.deepEqual([...places], ["bottom-left"]);
    await tab.close();
});

// Records every change of the credit's place together with how visible the credit was at that moment.
const watchCreditMoves = (tab) => tab.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `document.addEventListener("DOMContentLoaded", () => {
        window.__moves = [];
        const el = document.getElementById("attribution");
        new MutationObserver(() => window.__moves.push({ at: el.dataset.at, opacity: Number(getComputedStyle(el).opacity) }))
            .observe(el, { attributes: true, attributeFilter: ["data-at"] });
    });`,
});

test("RANDOM gives every dweet a different place for its credit, and moves it only while it is faded out", { skip }, async () => {
    const places = ["top-left", "top-middle", "top-right", "bottom-left", "bottom-middle", "bottom-right"];
    const config = 'const CONFIG = { ATTRIBUTION_POSITION: "random" };\n';
    const { tab } = await open(makeSite("credit-random", { config }), "debug=1&rotate=3&include=" + encodeURIComponent("IDS_1001,1002,1003"), { beforeLoad: watchCreditMoves });
    const shownAt = [];
    let last = null;
    await until("the credit of four different dweets", async () => {
        const s = await snapshot(tab);
        if (s && s.current && s.current !== last && (await creditShown(tab)) && (await credit(tab)).endsWith("/d/" + s.current)) {
            last = s.current;
            shownAt.push(await tab.evaluate("document.getElementById('attribution').dataset.at"));
        }
        return shownAt.length >= 4;
    }, 60000);
    assert.equal(await tab.evaluate("document.body.classList.contains('credit-bottom-middle')"), true, "hints must stay clear of a credit that can be at the bottom middle");
    assert.ok(shownAt.every((place) => places.includes(place)), JSON.stringify(shownAt));
    assert.ok(shownAt.slice(1).every((place, i) => place !== shownAt[i]), "never the same place twice in a row: " + JSON.stringify(shownAt));
    const moves = JSON.parse(await tab.evaluate("JSON.stringify(window.__moves)"));
    assert.ok(moves.length >= 3, "the credit should have moved: " + JSON.stringify(moves));
    assert.ok(moves.every((move) => move.opacity < 0.1), "the credit moved while it could be seen: " + JSON.stringify(moves));
    await tab.close();
});

test("a custom dweet is credited by its username, and one without a username has no credit", { skip }, async () => {
    const dir = makeSite("credit-custom", { extraCustom: [{ id: "anon", username: "", code: GOOD[0] }] });
    const named = await open(dir, "rotate=0&id=good-a");
    await until("the credit", () => creditShown(named.tab));
    assert.equal(await credit(named.tab), "by u1");
    await named.tab.close();

    const anon = await open(dir, "debug=1&rotate=0&id=anon");
    await until("the dweet", async () => (await snapshot(anon.tab)).current === "anon");
    await sleep(1500);
    assert.equal(await creditShown(anon.tab), false);
    await anon.tab.close();
});

test("a setup hint does not cover a credit at the bottom middle", { skip }, async () => {
    const dir = makeSite("credit-hint", { database: false, config: 'const CONFIG = { ATTRIBUTION_POSITION: "BOTTOM_MIDDLE" };\n' });
    const { tab } = await open(dir, "rotate=0&include=IDS_good-a");
    await until("the credit", () => creditShown(tab));
    assert.equal(await tab.evaluate("document.getElementById('hint').hidden"), false, "the missing database should be reported");
    const hint = await boxOf(tab, "hint");
    const credit = await boxOf(tab, "attribution");
    assert.ok(hint.bottom <= credit.top, "the hint overlaps the credit: " + JSON.stringify({ hint, credit }));
    await tab.close();
});

// Makes its canvas a quarter of the frame's height, so that the page around it shows, and reports both colours.
const BG_PROBE = {
    id: "bg-probe",
    username: "b8",
    code: 'c.height=270;x.fillRect(0,0,99,99);if(frame==1){var k=function(e){return getComputedStyle(e).backgroundColor.replace(/ /g,"")};' +
        'parent.postMessage({type:"probe",what:"canvas "+k(c),blocked:false},"*");' +
        'parent.postMessage({type:"probe",what:"body "+k(document.body),blocked:false},"*")}',
};

const probeReports = async (tab) => JSON.parse(await tab.evaluate("JSON.stringify(window.__dwitter.log.filter(e => e.msg.type === 'probe').map(e => e.msg.what))"));

// The colour of one point of the page as the screen shows it: a 1x1 screenshot, decoded.
async function pixelAt(tab, x, y) {
    const { data } = await tab.send("Page.captureScreenshot", { format: "png", clip: { x, y, width: 1, height: 1, scale: 1 } }, 10000);
    const png = Buffer.from(data, "base64");
    const parts = [];
    for (let pos = 8; pos < png.length;) {
        const length = png.readUInt32BE(pos);
        if (png.toString("latin1", pos + 4, pos + 8) === "IDAT") parts.push(png.subarray(pos + 8, pos + 8 + length));
        pos += length + 12;
    }
    // The first row starts with its filter byte, and the first pixel of a row is stored as it is: red, green, blue.
    const row = inflateSync(Buffer.concat(parts));
    return [row[1], row[2], row[3]];
}

test("by default the canvas and the page around it are white", { skip }, async () => {
    const { tab } = await open(makeSite("background-default", { extraCustom: [BG_PROBE] }), "rotate=0&id=bg-probe");
    const reports = await until("the dweet to report back", async () => {
        const r = await probeReports(tab);
        return r.length >= 2 && r;
    });
    assert.deepEqual(reports.sort(), ["body rgb(255,255,255)", "canvas rgb(255,255,255)"]);
    assert.equal((await snapshot(tab)).background, "rgb(255, 255, 255)");
    await tab.close();
});

test("BACKGROUND_COLOR is the colour of the canvas and of the page around it, as the screen shows it", { skip }, async () => {
    const config = 'const CONFIG = { BACKGROUND_COLOR: "#e6e6e6", TRANSITION_MS: 0 };\n';
    const { tab } = await open(makeSite("background-grey", { config, extraCustom: [BG_PROBE] }), "rotate=0&id=bg-probe");
    const reports = await until("the dweet to report back", async () => {
        const r = await probeReports(tab);
        return r.length >= 2 && r;
    });
    assert.deepEqual(reports.sort(), ["body rgb(230,230,230)", "canvas rgb(230,230,230)"]);
    const frame = await until("the dweet to be on screen", async () => {
        const r = JSON.parse(await tab.evaluate(`JSON.stringify((() => {
            const f = document.querySelector("iframe.dweet.visible");
            if (!f) return null;
            const r = f.getBoundingClientRect();
            return { x: r.left, y: r.top, w: r.width, h: r.height };
        })())`));
        return r && r.w > 100 && r;
    });
    // The canvas is the top quarter of the frame. Its own colour shows there, and the page's colour below it.
    for (const [name, fx, fy] of [["canvas", 0.9, 0.1], ["page", 0.9, 0.9], ["page", 0.5, 0.6]]) {
        const pixel = await pixelAt(tab, frame.x + frame.w * fx, frame.y + frame.h * fy);
        assert.ok(pixel.every((v) => Math.abs(v - 230) <= 2), "the " + name + " should be #e6e6e6 on screen, and is " + JSON.stringify(pixel));
    }
    await tab.close();
});

test("any CSS colour is understood, and a colour that is not opaque is shown over black", { skip }, async () => {
    const { tab } = await open(makeSite("background-syntax"), "debug=1&rotate=0&include=IDS_1001");
    await until("the dweet", async () => (await snapshot(tab)).current === "1001");
    const cases = {
        gainsboro: [220, 220, 220],
        "#e6e6e6": [230, 230, 230],
        "#eee": [238, 238, 238],
        "#e6e6e6ff": [230, 230, 230],
        "rgb(230 230 230)": [230, 230, 230],
        "hsl(0 0% 90%)": [230, 230, 230],
        "oklch(0.9 0 0)": [222, 222, 222],
        "color-mix(in srgb, white 90%, black)": [230, 230, 230],
        "rgb(255 255 255 / 50%)": [128, 128, 128],
        transparent: [0, 0, 0],
        // The colours that are used to tell whether a canvas took a value are colours like any other.
        "#010203": [1, 2, 3],
        "#040506": [4, 5, 6],
    };
    for (const [css, expected] of Object.entries(cases)) {
        const got = await tab.evaluate(`window.__dwitter.solidColour(${JSON.stringify(css)})`);
        const channels = (got.match(/\d+/g) || []).map(Number);
        assert.ok(/^rgb\(\d+, \d+, \d+\)$/.test(got) && channels.every((v, i) => Math.abs(v - expected[i]) <= 1), css + " came out as " + got);
    }
    // CSS accepts these for a colour property, but they are not colours; a canvas would quietly paint them black.
    for (const css of ["inherit", "initial", "unset", "revert", "var(--x)", "not-a-colour", ""]) {
        assert.equal(await tab.evaluate(`window.__dwitter.solidColour(${JSON.stringify(css)})`), null, JSON.stringify(css) + " is not a colour");
    }
    await tab.close();
});

test("a value that CSS accepts but that is not a colour is reported, and white is used", { skip }, async () => {
    for (const value of ["inherit", "var(--x)"]) {
        const config = `const CONFIG = { BACKGROUND_COLOR: ${JSON.stringify(value)} };\n`;
        const { tab } = await open(makeSite("background-not-a-colour-" + value.replace(/\W/g, ""), { config }), "debug=1&rotate=0&include=IDS_1001");
        await until("the hint", async () => tab.evaluate("!document.getElementById('hint').hidden"));
        assert.match(await tab.evaluate("document.getElementById('hint').textContent"), /BACKGROUND_COLOR in config\.js should be a CSS colour.* Using "white"/, value);
        const snap = await until("the dweet", async () => {
            const s = await snapshot(tab);
            return s && s.current && s;
        });
        assert.equal(snap.background, "rgb(255, 255, 255)", value);
        await tab.close();
    }
});

test("CANVAS_BACKGROUND, the old name of the setting, still works, and BACKGROUND_COLOR wins when both are there", { skip }, async () => {
    const cases = [
        ["old-name", 'const CONFIG = { CANVAS_BACKGROUND: "#e6e6e6" };\n', "rgb(230, 230, 230)"],
        ["both", 'const CONFIG = { CANVAS_BACKGROUND: "red", BACKGROUND_COLOR: "#d4d4d4" };\n', "rgb(212, 212, 212)"],
    ];
    for (const [name, config, expected] of cases) {
        const { tab } = await open(makeSite("background-" + name, { config }), "debug=1&rotate=0&include=IDS_1001");
        const snap = await until("the dweet", async () => {
            const s = await snapshot(tab);
            return s && s.current && s;
        });
        assert.equal(snap.background, expected, name);
        assert.equal(await tab.evaluate("document.getElementById('hint').hidden"), true, name + " is valid, so there is no hint");
        await tab.close();
    }
});
