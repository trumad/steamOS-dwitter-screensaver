import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const S = require("../dwitter/selection.js");

const PLAIN = "x.fillRect(0,0,9,9)";

// A database entry in the Dweetabase dump format (code is percent-encoded).
function entry(id, username, likes, extra = {}) {
    const { code = PLAIN, ...rest } = extra;
    return { id, username, comment: "", code: escape(code), posted: "2020-01-01", awesome_count: likes, ...rest };
}

function fixture() {
    return [
        entry(1, "alice", 100, { tags: ["fractal"] }),
        entry(2, "Bob.Smith", 90, { code: "onclick=e=>1;" + PLAIN }),
        entry(3, "alice", 80),
        entry(4, "Bob.Smith", 70, { tags: ["Fractal", "tunnel"] }),
        entry(5, "carol", 60),
        entry(6, "alice", 50),
        entry(7, "carol", 20),
        entry(8, "Bob.Smith", 10),
    ];
}

function build(overrides = {}) {
    return S.buildDatabase({
        dweets: fixture(),
        custom: [{ id: "local-1", username: "me", awesome_count: 0, code: PLAIN }],
        blocklist: { 3: "flash" },
        ...overrides,
    });
}

const ids = (pool) => pool.map((d) => d.id);
const pick = (config, db = build(), options) => ids(S.resolve(db, config, options).pool);

test("database entries are decoded from escape() form, including non-ASCII characters", () => {
    const code = "x.fillText('é☃😀',9,9)";
    const db = S.buildDatabase({ dweets: [entry(1, "a", 5, { code }), entry(2, "a", 5), entry(3, "a", 5)] });
    assert.equal(db.records[0].code, code);
});

test("database status: missing, invalid or ok", () => {
    assert.equal(S.buildDatabase({}).databaseStatus, "missing");
    assert.equal(S.buildDatabase({ dweets: [] }).databaseStatus, "invalid");
    assert.equal(S.buildDatabase({ dweets: [{ nope: 1 }] }).databaseStatus, "invalid");
    assert.equal(S.buildDatabase({ dweets: "text" }).databaseStatus, "invalid");
    const ok = build();
    assert.equal(ok.databaseStatus, "ok");
    assert.equal(ok.databaseCount, 8);
    assert.equal(ok.customCount, 1);
});

test("a custom dweet that reuses a database id is skipped with a warning", () => {
    const db = build({ custom: [{ id: 4, code: PLAIN }] });
    assert.equal(db.customCount, 0);
    assert.match(db.warnings[0], /already used/);
});

test("ALL leaves out interactive and blocklisted dweets", () => {
    assert.deepEqual(pick({ INCLUDE: "ALL" }), [1, 4, 5, 6, 7, 8, "local-1"]);
});

test("interactive dweets are only kept when EXCLUDE_INTERACTIVE is switched off", () => {
    assert.deepEqual(pick({ INCLUDE: "ALL" }, build(), { excludeInteractive: false }), [1, 2, 4, 5, 6, 7, 8, "local-1"]);
});

test("TOP_n skips ineligible dweets and still returns n", () => {
    assert.deepEqual(pick({ INCLUDE: "TOP_3" }), [1, 4, 5]);
    assert.deepEqual(pick({ INCLUDE: "top_2" }), [1, 4]);
});

test("MIN_LIKES_n", () => {
    assert.deepEqual(pick({ INCLUDE: "MIN_LIKES_50" }), [1, 4, 5, 6]);
});

test("ALL_BY_USERNAME_name ignores case and accepts dots", () => {
    assert.deepEqual(pick({ INCLUDE: "ALL_BY_USERNAME_bob.smith" }), [4, 8]);
});

test("TOP_n_BY_USERNAME_name", () => {
    assert.deepEqual(pick({ INCLUDE: "TOP_2_BY_USERNAME_alice" }), [1, 6]);
});

test("TAG_tag ignores case", () => {
    assert.deepEqual(pick({ INCLUDE: "TAG_fractal" }), [1, 4]);
});

test("IDS_ returns exactly the ids asked for, even if they would normally be filtered out", () => {
    assert.deepEqual(pick({ INCLUDE: "IDS_2,3,local-1,999" }), [2, 3, "local-1"]);
});

test("CUSTOM selects only custom dweets", () => {
    assert.deepEqual(pick({ INCLUDE: "CUSTOM" }), ["local-1"]);
});

test("a function can be used instead of a preset", () => {
    assert.deepEqual(pick({ INCLUDE: (d) => d.awesome_count >= 60 && d.username === "carol" }), [5]);
    assert.deepEqual(pick({ INCLUDE: [(d) => d.id === 7, "IDS_8"] }), [7, 8]);
});

test("a list of presets is a union without duplicates", () => {
    assert.deepEqual(pick({ INCLUDE: ["TOP_2", "ALL_BY_USERNAME_alice", "CUSTOM"] }), [1, 4, 6, "local-1"]);
});

test("EXCLUDE removes from the INCLUDE result, and may remove dweets that were already filtered out", () => {
    assert.deepEqual(pick({ INCLUDE: "ALL", EXCLUDE: ["ALL_BY_USERNAME_carol", "IDS_1"] }), [4, 6, 8, "local-1"]);
    assert.deepEqual(pick({ INCLUDE: "ALL", EXCLUDE: (d) => d.source === "custom" }), [1, 4, 5, 6, 7, 8]);
});

test("an unknown preset is reported and ignored", () => {
    const result = S.resolve(build(), { INCLUDE: ["TOP_2", "TOPP_5"] });
    assert.deepEqual(ids(result.pool), [1, 4]);
    assert.match(result.warnings.join("\n"), /Unknown preset "TOPP_5"/);
});

test("a filter function that throws is reported", () => {
    const result = S.resolve(build(), { INCLUDE: [() => { throw new Error("boom"); }, "IDS_5"] });
    assert.deepEqual(ids(result.pool), [5]);
    assert.match(result.warnings.join("\n"), /boom/);
});

test("INCLUDE defaults to 20+ likes plus custom dweets", () => {
    assert.deepEqual(pick({}), [1, 4, 5, 6, 7, "local-1"]);
});

test("an INCLUDE that matches nothing falls back to the default selection with a warning", () => {
    const result = S.resolve(build(), { INCLUDE: "ALL_BY_USERNAME_nobody" });
    assert.equal(result.fallback, "default");
    assert.deepEqual(ids(result.pool), [1, 4, 5, 6, 7, "local-1"]);
    assert.match(result.warnings.join("\n"), /Nothing in INCLUDE/);
});

test("without a database the custom dweets are used, with a hint only if the selection needs the database", () => {
    const noDatabase = S.buildDatabase({ custom: [{ id: "mine", code: PLAIN }] });
    const needs = S.resolve(noDatabase, { INCLUDE: "TOP_100" });
    assert.deepEqual(ids(needs.pool), ["mine"]);
    assert.match(needs.warnings.join("\n"), /dweets\.js was not found/);

    const nothingMatches = S.resolve(noDatabase, { INCLUDE: "ALL_BY_USERNAME_nobody" });
    assert.deepEqual(ids(nothingMatches.pool), ["mine"]);
    assert.equal(nothingMatches.fallback, "default");

    const customOnly = S.resolve(noDatabase, { INCLUDE: "CUSTOM" });
    assert.deepEqual(ids(customOnly.pool), ["mine"]);
    assert.deepEqual(customOnly.warnings, []);

    const invalid = S.resolve(S.buildDatabase({ dweets: [{ nope: 1 }] }), { INCLUDE: "ALL" });
    assert.match(invalid.warnings.join("\n"), /not in the expected format/);
});

test("with nothing at all the built-in dweet is used", () => {
    const result = S.resolve(S.buildDatabase({}), { INCLUDE: "ALL" });
    assert.equal(result.fallback, "builtin");
    assert.deepEqual(ids(result.pool), ["builtin-1"]);
});

test("the pool comes back sorted by id", () => {
    const pool = S.resolve(build(), { INCLUDE: ["CUSTOM", "IDS_8,1,5"] }).pool;
    assert.deepEqual(ids(pool), [1, 5, 8, "local-1"]);
});

test("remix families follow remix_of to the root, survive cycles and group remixes of a missing original", () => {
    const db = S.buildDatabase({
        dweets: [
            entry(10, "a", 5),
            entry(11, "b", 5, { remix_of: 10 }),
            entry(12, "c", 5, { remix_of: 11 }),
            entry(13, "d", 5, { remix_of: 999 }),
            entry(14, "e", 5, { remix_of: 999 }),
            entry(15, "f", 5, { remix_of: 16 }),
            entry(16, "g", 5, { remix_of: 15 }),
        ],
    });
    const family = (id) => db.byId.get(String(id))._family;
    assert.equal(family(10), "10");
    assert.equal(family(12), "10");
    assert.equal(family(13), family(14));
    assert.notEqual(family(13), family(10));
    assert.equal(family(15), family(16));
});

test("unsuitable dweets are recognised: input handlers and sound", () => {
    for (const code of ["onclick=e=>1", "document.onmousemove = f", "window.onkeydown=a", "addEventListener('click',f)",
        "o=(a=new AudioContext).createOscillator()", "new webkitAudioContext", "new Audio('x')"]) {
        assert.ok(S.isUnsuitable(code), code);
    }
    for (const code of ["one=1", "onion=2", "con=3", "x.fillRect(0,0,1,1)", "Audience=3"]) {
        assert.ok(!S.isUnsuitable(code), code);
    }
});

test("dweets that navigate away or use the network are recognised", () => {
    for (const code of [
        't||(location="//www.dwitter.net/d"+location.pathname.substring(3))', // d/5100, the real one
        "location.href='x'", "a.href=1", "open('http://x')", "window.open(1)", "history.back()", "navigator.sendBeacon(u)",
        "fetch('/x')", "new XMLHttpRequest", "new WebSocket(u)", "new EventSource(u)", "import('x')",
    ]) {
        assert.ok(S.leavesPage(code), code);
    }
    for (const code of ["x.fillRect(0,0,1,1)", "reopen=1", "allocation=2", "hrefs=3", "myhistory=[]", "f=fetchX", "important=1", "x.opened=1"]) {
        assert.ok(!S.leavesPage(code), code);
    }
});

test("they are never in a selection, whatever EXCLUDE_INTERACTIVE says", () => {
    const db = S.buildDatabase({
        dweets: [
            { id: 1, username: "a", code: "x.fillRect(0,0,9,9)", awesome_count: 90 },
            { id: 2, username: "b", code: 't||(location="//www.dwitter.net/d")', awesome_count: 99 },
            { id: 3, username: "c", code: "x.fillRect(1,1,9,9)", awesome_count: 80 },
        ],
    });
    for (const excludeInteractive of [true, false]) {
        const pool = S.resolve(db, { INCLUDE: "TOP_2" }, { excludeInteractive }).pool;
        assert.deepEqual(pool.map((d) => d.id), [1, 3], "TOP_2 still returns two dweets, and not the one that navigates");
        assert.deepEqual(S.resolve(db, { INCLUDE: "ALL" }, { excludeInteractive }).pool.map((d) => d.id), [1, 3]);
    }
    assert.deepEqual(S.resolve(db, { INCLUDE: "IDS_2" }, { excludeInteractive: true }).pool.map((d) => d.id), [2], "IDS_ returns what was asked for");
});

test("the credit names the author and, for the database, the dwitter.net address; custom dweets only their username", () => {
    const dweet = (raw, source) => new S.Dweet(raw, source);
    assert.equal(dweet({ id: 36024, username: "KilledByAPixel", code: "x" }, "database").attribution, "by KilledByAPixel \u00b7 dwitter.net/d/36024");
    assert.equal(dweet({ id: 5, username: "", code: "x" }, "database").attribution, "dwitter.net/d/5");
    assert.equal(dweet({ id: "mine", username: "Me", code: "x" }, "custom").attribution, "by Me");
    assert.equal(dweet({ id: "mine", username: "", code: "x" }, "custom").attribution, "", "no username, no credit");
    assert.equal(S.BUILTIN[0].attribution, "", "the built-in fallback dweet has no credit");
});

test("names in the credit are cleaned: control and text-direction characters go, whitespace is tidied, long names are cut", () => {
    const credit = (username) => new S.Dweet({ id: 1, username, code: "x" }, "custom").attribution;
    assert.equal(credit("a\u202eb\u0007  c\n d"), "by ab c d");
    assert.equal(credit("x".repeat(100)), "by " + "x".repeat(40));
    assert.equal(credit("   "), "");
    assert.equal(credit("<b>bold</b>"), "by <b>bold</b>", "markup is left alone: main.js only ever sets it as text");
});

// Packs source the way dwitter packers do: two characters per UTF-16 unit.
function pack(source) {
    const padded = source.length % 2 ? source + " " : source;
    let packed = "";
    for (let i = 0; i < padded.length; i += 2) packed += String.fromCharCode((padded.charCodeAt(i) << 8) | padded.charCodeAt(i + 1));
    return "eval(unescape(escape`" + packed + "`.replace(/u(..)/g,\"$1%\")))";
}

test("packed dweets are unpacked (without running anything) to check what they do", () => {
    const source = "onmousemove=e=>X=e.x;x.fillRect(0,0,9,9)";
    assert.equal(S.unpack(pack(source)).trim(), source);
    assert.ok(S.isUnsuitable(pack(source)));
    assert.ok(S.isUnsuitable(pack("o=new AudioContext;o.resume()")));
    assert.ok(!S.isUnsuitable(pack("x.fillRect(0,0,9,9)")));
});

test("only harmless packing patterns are followed", () => {
    const hostile = "eval(unescape(escape`aaaa`.replace(/(a+)+$/g,'')))";
    const started = Date.now();
    assert.equal(S.unpack(hostile), hostile);
    assert.ok(Date.now() - started < 200);
    const withTail = pack("x.fillRect(0,0,9,9)") + "-drawing";
    assert.equal(S.unpack(withTail), withTail);
});

test("a packed interactive dweet does not get into a selection", () => {
    const db = S.buildDatabase({
        dweets: [
            entry(1, "a", 30, { code: pack("onmousedown=e=>1;x.fillRect(0,0,9,9)") }),
            entry(2, "a", 29, { code: pack("x.fillRect(0,0,9,9)") }),
            entry(3, "b", 28),
        ],
    });
    assert.deepEqual(ids(S.resolve(db, { INCLUDE: "TOP_2" }).pool), [2, 3]);
});

function numberedPool(count, userOf, familyOf) {
    return Array.from({ length: count }, (_, i) => {
        const d = new S.Dweet({ id: i + 1, username: userOf(i), awesome_count: 1, code: PLAIN }, "custom");
        if (familyOf) d._family = familyOf(i);
        return d;
    });
}

function memoryStorage() {
    const data = new Map();
    return {
        getItem: (k) => (data.has(k) ? data.get(k) : null),
        setItem: (k, v) => data.set(k, String(v)),
        data,
    };
}

function sequence(seed = 1) {
    const rng = S.mulberry32(seed);
    return rng;
}

test("the shuffle bag shows every dweet once before repeating, and does not repeat across the boundary", () => {
    const pool = numberedPool(25, (i) => "user" + (i % 5));
    const order = S.createOrder(pool, { rng: sequence(7) });
    const first = Array.from({ length: 25 }, () => order.next().id);
    assert.equal(new Set(first).size, 25);
    const second = Array.from({ length: 25 }, () => order.next().id);
    assert.equal(new Set(second).size, 25);
    assert.notEqual(first[24], second[0]);
});

test("the same author is not shown again within 3 dweets while the pool is varied", () => {
    const pool = numberedPool(60, (i) => "user" + (i % 6));
    const order = S.createOrder(pool, { rng: sequence(3) });
    const authors = Array.from({ length: 30 }, () => order.next().username);
    for (let i = 0; i < authors.length; i++) {
        for (let back = 1; back <= 3 && i - back >= 0; back++) {
            assert.notEqual(authors[i], authors[i - back], `position ${i} repeats ${authors[i]}`);
        }
    }
});

test("the same remix family is spaced out", () => {
    const pool = numberedPool(40, (i) => "u" + i, (i) => "family" + (i % 8));
    const order = S.createOrder(pool, { rng: sequence(11) });
    const families = Array.from({ length: 20 }, () => order.next()._family);
    for (let i = 0; i < families.length; i++) {
        for (let back = 1; back <= 7 && i - back >= 0; back++) {
            assert.notEqual(families[i], families[i - back], `position ${i}`);
        }
    }
});

test("spacing is relaxed when the pool has a single author", () => {
    const pool = numberedPool(6, () => "same");
    const order = S.createOrder(pool, { rng: sequence(5) });
    const seen = Array.from({ length: 6 }, () => order.next().id);
    assert.equal(new Set(seen).size, 6);
});

test("spacing swaps do not cause repeats within a cycle", () => {
    const pool = numberedPool(30, (i) => (i < 20 ? "big" : "small" + i));
    const order = S.createOrder(pool, { rng: sequence(21) });
    const seen = Array.from({ length: 30 }, () => order.next().id);
    assert.equal(new Set(seen).size, 30);
});

test("the position is saved and carries on in a new session", () => {
    const pool = numberedPool(20, (i) => "user" + (i % 4));
    const storage = memoryStorage();
    const before = S.createOrder(pool, { storage, key: "k", rng: sequence(9) });
    const firstHalf = Array.from({ length: 8 }, () => before.next().id);

    const after = S.createOrder(pool, { storage, key: "k", rng: sequence(99) });
    const secondHalf = Array.from({ length: 12 }, () => after.next().id);
    assert.equal(new Set([...firstHalf, ...secondHalf]).size, 20);
});

test("a different key starts a fresh shuffle", () => {
    const pool = numberedPool(10, (i) => "u" + i);
    const storage = memoryStorage();
    S.createOrder(pool, { storage, key: "one", rng: sequence(1) }).next();
    assert.ok(storage.data.has("dwitter.bag.one"));
    assert.ok(!storage.data.has("dwitter.bag.two"));
});

test("unusable storage is tolerated", () => {
    const pool = numberedPool(5, (i) => "u" + i);
    const broken = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); } };
    const order = S.createOrder(pool, { storage: broken, rng: sequence(2) });
    assert.equal(new Set(Array.from({ length: 5 }, () => order.next().id)).size, 5);
});

test("corrupt saved state is ignored", () => {
    const pool = numberedPool(5, (i) => "u" + i);
    const storage = memoryStorage();
    storage.setItem("dwitter.bag.k", "{not json");
    const order = S.createOrder(pool, { storage, key: "k", rng: sequence(4) });
    assert.equal(new Set(Array.from({ length: 5 }, () => order.next().id)).size, 5);
});

test("pools of one and zero", () => {
    const one = S.createOrder(numberedPool(1, () => "a"), { rng: sequence(1) });
    assert.equal(one.next().id, 1);
    assert.equal(one.next().id, 1);
    assert.equal(S.createOrder([], {}).next(), null);
});

test("the signature changes with the settings and the pool", () => {
    const pool = numberedPool(3, (i) => "u" + i);
    const base = S.signature({ INCLUDE: "ALL" }, pool);
    assert.equal(base, S.signature({ INCLUDE: "ALL" }, pool));
    assert.notEqual(base, S.signature({ INCLUDE: "TOP_5" }, pool));
    assert.notEqual(base, S.signature({ INCLUDE: "ALL" }, pool.slice(1)));
});

test("the signature tells apart pools that only differ in the middle", () => {
    const a = numberedPool(5, (i) => "u" + i);
    const b = numberedPool(5, (i) => "u" + i);
    b[2].id = 99;
    b[3].id = 98;
    assert.notEqual(S.signature({ INCLUDE: "ALL" }, a), S.signature({ INCLUDE: "ALL" }, b));
});
