/*
 * Dweet selection: turns the database plus the INCLUDE / EXCLUDE settings into a pool of dweets and hands
 * them out in a shuffled order. It runs as a plain <script> in the screensaver and with require() in Node
 * (tools and tests), so it must not touch the DOM.
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.DwitterSelection = factory();
    }
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    const DEFAULT_INCLUDE = ["MIN_LIKES_20", "CUSTOM"];

    // Dweets that register input handlers wait for the mouse or keyboard, and ones that make sound would play it
    // through the TV: neither belongs in a screensaver.
    const UNSUITABLE = /\bon(click|dblclick|mouse\w*|key\w*|touch\w*|pointer\w*|wheel|resize|contextmenu|blur|focus|scroll|drag\w*)\s*=|addEventListener|\b(?:webkit)?AudioContext\b|new\s+Audio\b/;

    // Many dweets are packed as eval(unescape(escape`...`.replace(/u../g,''))), which hides what they do. This unpacks
    // them without running anything: the text comes from a file somebody else produced, so only the few harmless
    // replace patterns the packers use are accepted.
    const PACKED = /^\s*eval\(unescape\(escape`([^`]*)`\.replace\(\/([uD.()]+)\/g,\s*(['"])([^'"]*)\3\)\)\)\s*$/;

    function unpack(code) {
        const m = PACKED.exec(code);
        if (!m) return code;
        try {
            return unescape(escape(m[1]).replace(new RegExp(m[2], "g"), m[4]));
        } catch (e) {
            return code;
        }
    }

    function isUnsuitable(code) {
        if (UNSUITABLE.test(code)) return true;
        const unpacked = unpack(code);
        return unpacked !== code && UNSUITABLE.test(unpacked);
    }

    // Dweets that go somewhere else: they navigate away from their frame or ask the network for something. Their frames
    // can do neither, and where the screensaver is shown a navigation that is not served ends in an error page for the
    // whole screen, so these are never part of a selection (only IDS_ still returns exactly what was asked for).
    const LEAVES_PAGE = /\blocation\b|\.href\b|\bopen\s*\(|\bhistory\b|\bsendBeacon\b|\bfetch\b|\bXMLHttpRequest\b|\bWebSocket\b|\bEventSource\b|\bimport\s*\(/;

    function leavesPage(code) {
        if (LEAVES_PAGE.test(code)) return true;
        const unpacked = unpack(code);
        return unpacked !== code && LEAVES_PAGE.test(unpacked);
    }

    // Last resort when there is no database and no custom dweets, so the screen is never blank.
    const BUILTIN_RAW = [{
        id: "builtin-1",
        username: "builtin",
        awesome_count: 0,
        code: "c.width=1920;for(i=60;i--;x.fillRect(960+S(t+i/9)*i*9,540+C(t*.7+i/5)*i*5,i/2+4,i/2+4))x.fillStyle=R(i*4,99+i*2,255-i*3)",
    }];

    const MESSAGES = {
        missing: "dweets.js was not found or could not be read. Download the database (see the README). Showing your custom dweets for now.",
        invalid: "dweets.js is not in the expected format. Download it again (see the README). Showing your custom dweets for now.",
        empty: "Nothing in INCLUDE (config.js) matched. Showing the default selection instead.",
    };

    // Names come from files somebody else produced: drop control and text-direction characters, keep it short.
    function cleanName(text) {
        return String(text == null ? "" : text)
            .replace(/[\u0000-\u001f\u007f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 40);
    }

    class Dweet {
        constructor(raw, source) {
            this.id = raw.id;
            this.username = typeof raw.username === "string" ? raw.username : "";
            this.awesome_count = Number(raw.awesome_count) || 0;
            this.posted = raw.posted ? String(raw.posted) : "";
            this.remix_of = raw.remix_of == null ? null : raw.remix_of;
            this.tags = Array.isArray(raw.tags) ? raw.tags : [];
            this.source = source;
            this._raw = String(raw.code);
            this._user = this.username.toLowerCase();
            this._family = String(raw.id);
        }

        // The database stores code percent-encoded (escape() style); custom dweets are plain text.
        get code() {
            return this.source === "database" ? unescape(this._raw) : this._raw;
        }

        // What the screen says about this dweet (see ATTRIBUTION_POSITION): the author and, for a dweet from the
        // database, where to find it on dwitter.net. Custom dweets show just their username, and the built-in
        // fallback dweet shows nothing.
        get attribution() {
            if (this.source === "builtin") return "";
            const author = cleanName(this.username);
            const link = this.source === "database" ? "dwitter.net/d/" + this.id : "";
            if (author && link) return "by " + author + " \u00b7 " + link;
            return author ? "by " + author : link;
        }
    }

    const BUILTIN = BUILTIN_RAW.map((raw) => new Dweet(raw, "builtin"));

    function compareIds(a, b) {
        const aNumber = typeof a === "number";
        const bNumber = typeof b === "number";
        if (aNumber && bNumber) return a - b;
        if (aNumber !== bNumber) return aNumber ? -1 : 1;
        return a < b ? -1 : a > b ? 1 : 0;
    }

    function looksLikeDatabase(raw) {
        if (!Array.isArray(raw) || raw.length === 0) return false;
        return [raw[0], raw[raw.length >> 1], raw[raw.length - 1]].every((d) =>
            d && typeof d === "object" && d.id !== undefined && typeof d.code === "string" &&
            typeof d.username === "string" && typeof d.awesome_count === "number");
    }

    // Remixes of the same original look alike, so each dweet gets the id of the root of its remix chain.
    function computeFamilies(records, byId) {
        const memo = new Map();
        for (const rec of records) {
            const path = [];
            const seen = new Set();
            let cur = rec;
            let root;
            for (;;) {
                if (memo.has(cur)) { root = memo.get(cur); break; }
                if (seen.has(cur)) { root = String(cur.id); break; }
                seen.add(cur);
                path.push(cur);
                if (cur.remix_of == null) { root = String(cur.id); break; }
                const parent = byId.get(String(cur.remix_of));
                if (!parent) { root = "missing-" + cur.remix_of; break; }
                cur = parent;
            }
            for (const item of path) memo.set(item, root);
            rec._family = root;
        }
    }

    // input: { dweets, custom, blocklist } straight from dweets.js, custom-dweets.js and blocklist.js (any may be absent).
    function buildDatabase(input) {
        input = input || {};
        const warnings = [];
        const records = [];
        const byId = new Map();
        let databaseStatus = "missing";

        if (input.dweets != null) {
            if (looksLikeDatabase(input.dweets)) {
                databaseStatus = "ok";
                for (const entry of input.dweets) {
                    if (!entry || typeof entry.code !== "string" || entry.id == null) continue;
                    const rec = new Dweet(entry, "database");
                    records.push(rec);
                    byId.set(String(rec.id), rec);
                }
            } else {
                databaseStatus = "invalid";
            }
        }
        const databaseCount = records.length;

        let customCount = 0;
        (Array.isArray(input.custom) ? input.custom : []).forEach((entry, index) => {
            if (!entry || typeof entry.code !== "string") return;
            const id = entry.id == null ? "custom-" + (index + 1) : entry.id;
            if (byId.has(String(id))) {
                warnings.push('custom-dweets.js: the id "' + id + '" is already used, skipping that dweet.');
                return;
            }
            const rec = new Dweet(Object.assign({}, entry, { id }), "custom");
            records.push(rec);
            byId.set(String(id), rec);
            customCount++;
        });

        computeFamilies(records, byId);
        return {
            records,
            byId,
            blocklist: new Set(Object.keys(input.blocklist || {})),
            databaseStatus,
            databaseCount,
            customCount,
            warnings,
        };
    }

    function parseItem(item) {
        if (typeof item === "function") return { kind: "function", fn: item };
        if (typeof item !== "string") return { error: "INCLUDE and EXCLUDE entries must be preset names or functions." };
        const text = item.trim();
        let m;
        if (/^ALL$/i.test(text)) return { kind: "all" };
        if (/^CUSTOM$/i.test(text)) return { kind: "custom" };
        if ((m = /^TOP_(\d+)$/i.exec(text))) return { kind: "top", n: Number(m[1]) };
        if ((m = /^MIN_LIKES_(\d+)$/i.exec(text))) return { kind: "minLikes", n: Number(m[1]) };
        if ((m = /^TOP_(\d+)_BY_USERNAME_(.+)$/i.exec(text))) return { kind: "top", n: Number(m[1]), user: m[2].trim().toLowerCase() };
        if ((m = /^ALL_BY_USERNAME_(.+)$/i.exec(text))) return { kind: "user", user: m[1].trim().toLowerCase() };
        if ((m = /^TAG_(.+)$/i.exec(text))) return { kind: "tag", tag: m[1].trim().toLowerCase() };
        if ((m = /^IDS_(.+)$/i.exec(text))) return { kind: "ids", ids: m[1].split(",").map((s) => s.trim()).filter(Boolean) };
        return { error: 'Unknown preset "' + text + '" in config.js.' };
    }

    function createContext(db, excludeInteractive) {
        const cache = new Map();
        let sorted = null;
        return {
            db,
            eligible(rec) {
                let ok = cache.get(rec);
                if (ok === undefined) {
                    ok = !db.blocklist.has(String(rec.id)) && !leavesPage(rec.code) && !(excludeInteractive && isUnsuitable(rec.code));
                    cache.set(rec, ok);
                }
                return ok;
            },
            byLikes() {
                if (!sorted) sorted = db.records.slice().sort((a, b) => b.awesome_count - a.awesome_count || compareIds(a.id, b.id));
                return sorted;
            },
        };
    }

    // applyEligibility: INCLUDE drops blocklisted, page-leaving and interactive dweets before ranking (so TOP_100 still
    // returns 100); EXCLUDE just matches. IDS_ always returns exactly what was asked for.
    function evaluate(parsed, ctx, applyEligibility, warn) {
        const keep = (rec) => !applyEligibility || ctx.eligible(rec);
        const records = ctx.db.records;
        switch (parsed.kind) {
            case "all":
                return records.filter(keep);
            case "custom":
                return records.filter((r) => r.source === "custom" && keep(r));
            case "minLikes":
                return records.filter((r) => r.awesome_count >= parsed.n && keep(r));
            case "user":
                return records.filter((r) => r._user === parsed.user && keep(r));
            case "tag":
                return records.filter((r) => r.tags.some((t) => String(t).toLowerCase() === parsed.tag) && keep(r));
            case "ids":
                return parsed.ids.map((id) => ctx.db.byId.get(id)).filter(Boolean);
            case "top": {
                const out = [];
                if (parsed.n <= 0) return out;
                for (const rec of ctx.byLikes()) {
                    if (parsed.user !== undefined && rec._user !== parsed.user) continue;
                    if (!keep(rec)) continue;
                    out.push(rec);
                    if (out.length >= parsed.n) break;
                }
                return out;
            }
            case "function":
                return records.filter((rec) => {
                    try {
                        return Boolean(parsed.fn(rec)) && keep(rec);
                    } catch (e) {
                        warn("A filter function in config.js threw: " + (e && e.message ? e.message : e));
                        return false;
                    }
                });
            default:
                return [];
        }
    }

    function toItems(spec, fallback) {
        if (spec === undefined || spec === null) return fallback;
        return Array.isArray(spec) ? spec : [spec];
    }

    function needsDatabase(items) {
        return items.some((item) => typeof item === "function" || !/^CUSTOM$/i.test(String(item).trim()));
    }

    function byIdOrder(a, b) {
        return compareIds(a.id, b.id);
    }

    function resolve(db, config, options) {
        config = config || {};
        const excludeInteractive = !(options && options.excludeInteractive === false);
        const warnings = db.warnings.slice();
        const warned = new Set();
        const warn = (message) => {
            if (!warned.has(message)) { warned.add(message); warnings.push(message); }
        };
        const ctx = createContext(db, excludeInteractive);

        function run(items) {
            const matched = new Set();
            for (const item of items) {
                const parsed = parseItem(item);
                if (parsed.error) { warn(parsed.error); continue; }
                for (const rec of evaluate(parsed, ctx, true, warn)) matched.add(rec);
            }
            const removed = new Set();
            for (const item of toItems(config.EXCLUDE, [])) {
                const parsed = parseItem(item);
                if (parsed.error) { warn(parsed.error); continue; }
                for (const rec of evaluate(parsed, ctx, false, warn)) removed.add(rec);
            }
            return [...matched].filter((rec) => !removed.has(rec)).sort(byIdOrder);
        }

        const include = toItems(config.INCLUDE, DEFAULT_INCLUDE);
        if (db.databaseStatus !== "ok" && needsDatabase(include)) {
            warn(db.databaseStatus === "invalid" ? MESSAGES.invalid : MESSAGES.missing);
        }

        let pool = run(include);
        let fallback = null;
        if (pool.length === 0) {
            if (db.databaseStatus === "ok") warn(MESSAGES.empty);
            pool = run(DEFAULT_INCLUDE);
            fallback = "default";
        }
        if (pool.length === 0) {
            pool = BUILTIN.slice();
            fallback = "builtin";
        }
        return { pool, warnings, fallback };
    }

    function mulberry32(seed) {
        let a = seed >>> 0;
        return function () {
            a = (a + 0x6D2B79F5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    function hashString(text) {
        let h = 2166136261;
        for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
        return (h >>> 0).toString(16);
    }

    // Identifies a selection, so a saved shuffle is only reused while the settings and the whole pool stay the same.
    function signature(config, pool) {
        const part = (v) => Array.isArray(v) ? v.map(part).join(",") : typeof v === "function" ? v.toString() : String(v);
        return hashString(part(config.INCLUDE) + "|" + part(config.EXCLUDE) + "|" + pool.map((r) => r.id).join(","));
    }

    // A shuffle bag: every dweet is shown once, in random order, before any is repeated. It also keeps the same
    // author (within 3 dweets) and the same remix family (within 10) apart where the pool allows it. The position
    // is saved to `storage` (if given) so the order carries on across screensaver sessions.
    function createOrder(pool, options) {
        options = options || {};
        const rng = options.rng || Math.random;
        const storage = options.storage || null;
        const storageKey = "dwitter.bag." + (options.key || "default");
        const n = pool.length;
        const distinct = (field) => new Set(pool.map((r) => r[field])).size;
        const authorWindow = Math.max(0, Math.min(3, distinct("_user") - 1));
        const familyWindow = Math.max(0, Math.min(10, distinct("_family") - 1));
        const idWindow = Math.max(0, Math.min(10, n - 1));
        const LOOKAHEAD = 40;
        const byKey = new Map(pool.map((r) => [String(r.id), r]));
        const keyAt = (i) => String(pool[order[i]].id);

        let seed = 0;
        let order = [];
        let pos = 0;
        let skip = new Set();
        let recent = [];

        function shuffled(forSeed) {
            const indices = Array.from({ length: n }, (_, i) => i);
            const random = mulberry32(forSeed);
            for (let i = n - 1; i > 0; i--) {
                const j = Math.floor(random() * (i + 1));
                [indices[i], indices[j]] = [indices[j], indices[i]];
            }
            return indices;
        }

        function newCycle() {
            seed = Math.floor(rng() * 4294967296) >>> 0;
            order = shuffled(seed);
            pos = 0;
            skip = new Set();
        }

        function load() {
            if (!storage) return false;
            try {
                const saved = JSON.parse(storage.getItem(storageKey));
                if (!saved || saved.v !== 1 || !Number.isFinite(saved.seed) || !Number.isInteger(saved.pos) ||
                    saved.pos < 0 || saved.pos > n || !Array.isArray(saved.skip) || !Array.isArray(saved.recent)) return false;
                seed = saved.seed >>> 0;
                order = shuffled(seed);
                pos = saved.pos;
                skip = new Set(saved.skip.map(String));
                recent = saved.recent.map(String).slice(-12);
                return true;
            } catch (e) {
                return false;
            }
        }

        function save() {
            if (!storage) return;
            try {
                storage.setItem(storageKey, JSON.stringify({ v: 1, seed, pos, skip: [...skip], recent }));
            } catch (e) {
                // Storage may be full or unavailable; the order simply will not carry over.
            }
        }

        function tail(count) {
            return count > 0 ? recent.slice(-count) : [];
        }

        function violates(rec) {
            if (tail(idWindow).includes(String(rec.id))) return true;
            if (authorWindow > 0 && rec._user && tail(authorWindow).some((k) => byKey.has(k) && byKey.get(k)._user === rec._user)) return true;
            return familyWindow > 0 && tail(familyWindow).some((k) => byKey.has(k) && byKey.get(k)._family === rec._family);
        }

        function next() {
            if (n === 0) return null;
            if (pos >= n) newCycle();
            for (let attempt = 0; attempt < 2; attempt++) {
                let first = -1;
                let chosen = -1;
                let seen = 0;
                for (let j = pos; j < n && seen < LOOKAHEAD; j++) {
                    if (skip.has(keyAt(j))) continue;
                    if (first < 0) first = j;
                    seen++;
                    if (!violates(pool[order[j]])) { chosen = j; break; }
                }
                if (first < 0) { newCycle(); continue; }
                if (chosen < 0) chosen = first;
                const rec = pool[order[chosen]];
                if (chosen === first) {
                    for (let k = pos; k <= chosen; k++) skip.delete(keyAt(k));
                    pos = chosen + 1;
                    while (pos < n && skip.has(keyAt(pos))) { skip.delete(keyAt(pos)); pos++; }
                } else {
                    skip.add(String(rec.id));
                }
                recent.push(String(rec.id));
                if (recent.length > 12) recent.shift();
                save();
                return rec;
            }
            return pool[order[0]];
        }

        if (!load()) newCycle();
        return { next, state: () => ({ seed, pos, skip: [...skip], recent: recent.slice(), size: n }) };
    }

    return {
        DEFAULT_INCLUDE,
        BUILTIN,
        Dweet,
        buildDatabase,
        parseItem,
        resolve,
        createOrder,
        signature,
        isUnsuitable,
        leavesPage,
        unpack,
        mulberry32,
        hashString,
    };
});
