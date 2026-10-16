// Small helpers for tools that drive a real browser: a static file server and a minimal Chrome DevTools Protocol
// client. No dependencies; needs Node 22.4+ (built-in WebSocket) and an installed Chrome, Chromium or Edge.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".md": "text/plain; charset=utf-8",
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function findChrome(explicit) {
    const candidates = [
        explicit,
        process.env.CHROME_PATH,
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
        "/snap/bin/chromium",
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    ].filter(Boolean);
    const found = candidates.find((p) => existsSync(p));
    if (!found) throw new Error("Could not find Chrome. Install it or set CHROME_PATH (or pass --chrome).");
    return found;
}

// Serves a folder over http://127.0.0.1. options.headers(path) may return extra response headers for a file.
export async function startServer(root, options = {}) {
    const base = path.resolve(root);
    const cache = new Map();
    const server = http.createServer(async (req, res) => {
        try {
            let rel = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
            if (rel.endsWith("/")) rel += "index.html";
            const file = path.join(base, path.normalize(rel));
            if (file !== base && !file.startsWith(base + path.sep)) {
                res.writeHead(403).end();
                return;
            }
            if (!cache.has(file)) cache.set(file, await readFile(file));
            res.writeHead(200, {
                "Content-Type": MIME[path.extname(file)] || "application/octet-stream",
                "Cache-Control": "max-age=3600",
                ...(options.headers ? options.headers(rel) : {}),
            });
            res.end(cache.get(file));
        } catch (e) {
            res.writeHead(404).end();
        }
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    return {
        url: "http://127.0.0.1:" + server.address().port,
        close: () => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }),
    };
}

function freePort() {
    return new Promise((resolve, reject) => {
        const s = net.createServer();
        s.once("error", reject);
        s.listen(0, "127.0.0.1", () => {
            const { port } = s.address();
            s.close(() => resolve(port));
        });
    });
}

class Tab {
    constructor(browser, targetId, sessionId) {
        this.browser = browser;
        this.targetId = targetId;
        this.sessionId = sessionId;
        this.handlers = [];
        this.listeners = new Map();
    }

    send(method, params, timeoutMs) {
        return this.browser.send(method, params, this.sessionId, timeoutMs);
    }

    // handler(kind, text) where kind is "console", "exception" or "log"
    onMessage(handler) {
        this.handlers.push(handler);
    }

    emit(kind, text) {
        for (const handler of this.handlers) handler(kind, text);
    }

    // handler(params) for any raw DevTools event, for example "Network.loadingFailed" or "Fetch.requestPaused"
    on(method, handler) {
        if (!this.listeners.has(method)) this.listeners.set(method, []);
        this.listeners.get(method).push(handler);
    }

    dispatch(method, params) {
        for (const handler of this.listeners.get(method) || []) handler(params);
    }

    async goto(url) {
        await this.send("Page.navigate", { url });
    }

    async evaluate(expression, timeoutMs = 5000) {
        const result = await this.send("Runtime.evaluate", { expression, returnByValue: true }, timeoutMs);
        if (result.exceptionDetails) {
            throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
        }
        return result.result.value;
    }

    async screenshot() {
        const { data } = await this.send("Page.captureScreenshot", { format: "png" }, 10000);
        return Buffer.from(data, "base64");
    }

    async close() {
        try {
            await this.browser.send("Target.closeTarget", { targetId: this.targetId }, undefined, 3000);
        } catch (e) {
            // Already gone, or the page is hung; the browser is closed at the end anyway.
        }
    }
}

export async function launchBrowser(options = {}) {
    if (typeof WebSocket === "undefined") throw new Error("This needs Node 22.4 or newer (built-in WebSocket).");
    const chrome = findChrome(options.chrome);
    const port = await freePort();
    const profile = mkdtempSync(path.join(os.tmpdir(), "dwitter-chrome-"));
    const child = spawn(chrome, [
        "--headless=new",
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${profile}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-gpu",
        "--hide-scrollbars",
        "--mute-audio",
        "--enable-precise-memory-info",
        "--disable-background-timer-throttling",
        "--disable-renderer-backgrounding",
        "--disable-backgrounding-occluded-windows",
        ...(process.platform === "linux" ? ["--no-sandbox"] : []),
        ...(options.args || []),
        "about:blank",
    ], { stdio: "ignore" });

    let version = null;
    for (let i = 0; i < 80 && !version; i++) {
        try {
            const response = await fetch(`http://127.0.0.1:${port}/json/version`);
            if (response.ok) version = await response.json();
        } catch (e) {
            await sleep(250);
        }
    }
    if (!version) {
        child.kill();
        throw new Error("Chrome did not start.");
    }

    const ws = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });

    let nextId = 0;
    const pending = new Map();
    const tabs = new Map();
    ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.id !== undefined && pending.has(msg.id)) {
            const { resolve, reject } = pending.get(msg.id);
            pending.delete(msg.id);
            if (msg.error) reject(new Error(msg.error.message));
            else resolve(msg.result);
            return;
        }
        const tab = msg.sessionId && tabs.get(msg.sessionId);
        if (!tab) return;
        if (msg.method === "Runtime.consoleAPICalled") {
            tab.emit("console", msg.params.args.map((a) => a.value ?? a.description ?? "").join(" "));
        } else if (msg.method === "Runtime.exceptionThrown") {
            const d = msg.params.exceptionDetails;
            tab.emit("exception", d.exception?.description || d.text);
        } else if (msg.method === "Log.entryAdded") {
            tab.emit("log", msg.params.entry.level + ": " + msg.params.entry.text);
        }
        if (msg.method) tab.dispatch(msg.method, msg.params);
    };

    const browser = {
        send(method, params = {}, sessionId, timeoutMs = 15000) {
            const id = ++nextId;
            const message = { id, method, params };
            if (sessionId) message.sessionId = sessionId;
            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    pending.delete(id);
                    reject(new Error("Timed out waiting for " + method));
                }, timeoutMs);
                pending.set(id, {
                    resolve: (value) => { clearTimeout(timer); resolve(value); },
                    reject: (error) => { clearTimeout(timer); reject(error); },
                });
                ws.send(JSON.stringify(message));
            });
        },
    };

    return {
        chrome,
        // Every tab gets its own window, so none of them is treated as a background tab and throttled.
        async newTab(url, { width = 1280, height = 720 } = {}) {
            const { targetId } = await browser.send("Target.createTarget", { url: "about:blank", newWindow: true, width, height });
            const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });
            const tab = new Tab(browser, targetId, sessionId);
            tabs.set(sessionId, tab);
            await tab.send("Page.enable");
            await tab.send("Runtime.enable");
            await tab.send("Log.enable");
            await tab.send("Emulation.setFocusEmulationEnabled", { enabled: true });
            if (url) await tab.goto(url);
            return tab;
        },
        async close() {
            try { ws.close(); } catch (e) { /* ignore */ }
            child.kill();
            await sleep(300);
            try { rmSync(profile, { recursive: true, force: true }); } catch (e) { /* ignore */ }
        },
    };
}
