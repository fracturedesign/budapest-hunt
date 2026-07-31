/* ============================================================================
 * test.js — sanity checks for the game logic and the content file.
 *
 *   node test.js
 *
 * Run this after you edit content.js. It won't catch a bad riddle, but it will
 * catch a stop with no answers, a duplicate id, a typo'd field name, or an
 * answer you meant to fill in and didn't.
 * ========================================================================== */

const L = require("./app.js");      // pure logic (app.js no-ops without a DOM)
const HUNT = require("./content.js");

let pass = 0, fail = 0;
const failures = [];

function ok(name, cond, detail) {
  if (cond) { pass++; }
  else { fail++; failures.push(name + (detail ? "  → " + detail : "")); }
}
function eq(name, actual, expected) {
  ok(name, Object.is(actual, expected), "got " + JSON.stringify(actual) +
     ", expected " + JSON.stringify(expected));
}
function section(t) { console.log("\n\x1b[1m" + t + "\x1b[0m"); }

/* ══════════════════════════════════════════════ 1. ANSWER NORMALISATION ══ */
section("1. Answer normalisation");

eq("lowercases",                L.normalize("MAGYAR"), "magyar");
eq("trims whitespace",          L.normalize("   magyar   "), "magyar");
eq("collapses inner spaces",    L.normalize("oh    magyar"), "oh magyar");
eq("strips accents (ö)",        L.normalize("sör"), "sor");
eq("strips accents (é)",        L.normalize("hét"), "het");
eq("strips accents (ő, ű)",     L.normalize("Vörösmarty tér ő ű"), "vorosmarty ter o u");
eq("strips punctuation",        L.normalize("SÖR!!!"), "sor");
eq("strips trailing period",    L.normalize("tongue."), "tongue");
eq("handles quotes/hyphens",    L.normalize("it's a-tongue"), "it s a tongue");
eq("null-safe",                 L.normalize(null), "");
eq("undefined-safe",            L.normalize(undefined), "");
eq("keeps digits",              L.normalize("  72 "), "72");
eq("word number → digit",       L.canonical("Seven"), "7");
eq("'seventy two' squashed",    L.canonical("seventy two"), "seventytwo");
eq("'seventytwo' squashed",     L.canonical("seventytwo"), "seventytwo");

/* ══════════════════════════════════════════════════ 2. ANSWER MATCHING ══ */
section("2. Answer matching");

const stopSor = { id: "t", answers: ["sör", "beer"] };

ok("exact match",               L.checkAnswer(stopSor, "sör").ok);
ok("case-insensitive",          L.checkAnswer(stopSor, "SÖR").ok);
ok("accent-insensitive",        L.checkAnswer(stopSor, "sor").ok);
ok("whitespace-padded",         L.checkAnswer(stopSor, "  Sor  ").ok);
ok("punctuation-tolerant",      L.checkAnswer(stopSor, "sör!").ok);
ok("alternate answer",          L.checkAnswer(stopSor, "Beer").ok);
ok("rejects wrong answer",     !L.checkAnswer(stopSor, "wine").ok);
ok("rejects near-miss",        !L.checkAnswer(stopSor, "sör kérek").ok);
ok("empty flagged as empty",    L.checkAnswer(stopSor, "").empty);
ok("empty is not correct",     !L.checkAnswer(stopSor, "").ok);
ok("whitespace-only is empty",  L.checkAnswer(stopSor, "   ").empty);

const stopNum = { id: "n", answers: ["72", "seventy two"] };
ok("numeric answer",            L.checkAnswer(stopNum, "72").ok);
ok("numeric spelled out",       L.checkAnswer(stopNum, "Seventy Two").ok);
ok("numeric squashed",          L.checkAnswer(stopNum, "seventytwo").ok);
ok("rejects wrong number",     !L.checkAnswer(stopNum, "27").ok);

/* ═══════════════════════════════════════════ 3. PLACEHOLDER STOP BEHAVIOUR ══ */
section("3. Placeholder stops (unfilled personal content)");

// A blank row is what the editor creates the instant you click "+ Add answer".
// It must behave exactly like no answer at all — in the draft, in the preview,
// and in the exported file (which strips blank rows out).
const stopBlank = { id: "b", answers: [""] };
ok("blank-only answers = placeholder",  L.isPlaceholderStop(stopBlank));
ok("blank-only accepts anything",       L.checkAnswer(stopBlank, "tongue").ok);
ok("blank-only still rejects empty",   !L.checkAnswer(stopBlank, "").ok);
eq("usableAnswers drops blanks",        L.usableAnswers(stopBlank).length, 0);

const stopWhitespace = { id: "w", answers: ["   ", "\n"] };
ok("whitespace-only rows = placeholder", L.isPlaceholderStop(stopWhitespace));

// Punctuation-only rows LOOK filled in but can never match — still a real error.
const stopPunct = { id: "q", answers: ["???"] };
eq("punctuation-only is not usable",    L.usableAnswers(stopPunct).length, 0);
ok("punctuation-only = placeholder",    L.isPlaceholderStop(stopPunct));

// A half-typed row alongside a real answer must not break the real one.
const stopMixed = { id: "m", answers: ["tongue", ""] };
ok("mixed: real answer still matches",  L.checkAnswer(stopMixed, "tongue").ok);
ok("mixed: not a placeholder",         !L.isPlaceholderStop(stopMixed));
ok("mixed: wrong answer still wrong",  !L.checkAnswer(stopMixed, "tail").ok);
ok("mixed: blank input still rejected",!L.checkAnswer(stopMixed, "  ").ok);
eq("mixed: one usable answer",          L.usableAnswers(stopMixed).length, 1);

// Draft (blank row present) and export (blank row stripped) must agree.
const beforeExport = { id: "e", answers: ["", ""] };
const afterExport  = { id: "e" };
eq("draft and export agree on placeholder",
   L.isPlaceholderStop(beforeExport), L.isPlaceholderStop(afterExport));
eq("draft and export agree on matching",
   L.checkAnswer(beforeExport, "x").ok, L.checkAnswer(afterExport, "x").ok);

const stopPH = { id: "p", answers: ["[ANSWER: fill in later]"] };
ok("detected as placeholder",   L.isPlaceholderStop(stopPH));
ok("accepts any text",          L.checkAnswer(stopPH, "literally anything").ok);
ok("flags itself as placeholder", L.checkAnswer(stopPH, "x").placeholder);
ok("still rejects empty",      !L.checkAnswer(stopPH, "  ").ok);
ok("filled stop is not placeholder", !L.isPlaceholderStop(stopSor));
ok("empty answers list = placeholder", L.isPlaceholderStop({ id: "z", answers: [] }));

/* ══════════════════════════════════════════════════ 3b. TASK TYPES ══ */
section("3b. Task types");

eq("default type is text",      L.stopType({}), "text");
eq("unknown type falls back",   L.stopType({ type: "wibble" }), "text");
eq("choice recognised",         L.stopType({ type: "choice" }), "choice");
ok("text needs an answer",      L.typeNeedsAnswer("text"));
ok("choice needs an answer",    L.typeNeedsAnswer("choice"));
ok("dare needs no answer",     !L.typeNeedsAnswer("dare"));
ok("info needs no answer",     !L.typeNeedsAnswer("info"));

const dare = { id: "d", type: "dare" };
ok("dare is never a placeholder", !L.isPlaceholderStop(dare));
ok("dare always accepts",          L.checkAnswer(dare, "done").ok);
ok("dare accepts even empty",      L.checkAnswer(dare, "").ok);
ok("info always accepts",          L.checkAnswer({ id: "i", type: "info" }, "").ok);

const choice = { id: "c", type: "choice", choices: ["Tongue", "Tail", "Teeth"], answers: ["tongue"] };
ok("choice matches its option",    L.checkAnswer(choice, "Tongue").ok);
ok("choice rejects wrong option", !L.checkAnswer(choice, "Tail").ok);
ok("choice is not a placeholder", !L.isPlaceholderStop(choice));
ok("choice with no answers is a placeholder",
   L.isPlaceholderStop({ id: "c2", type: "choice", choices: ["a", "b"] }));

/* ═══════════════════════════════════════════════════ 3c. LABELS ══ */
section("3c. Labels & tokens");

eq("fills one token",   L.fillTokens("Hint {n}", { n: 3 }), "Hint 3");
eq("fills two tokens",  L.fillTokens("{n} of {total}", { n: 2, total: 9 }), "2 of 9");
eq("leaves unknown tokens alone", L.fillTokens("Hi {nope}", { n: 1 }), "Hi {nope}");
eq("handles no tokens", L.fillTokens("Plain", {}), "Plain");
eq("null-safe",         L.fillTokens(null, {}), "");

const merged = L.resolveLabels({ labels: { submitButton: "GO!" } });
eq("override applied",       merged.submitButton, "GO!");
eq("defaults preserved",     merged.nextButton, L.DEFAULT_LABELS.nextButton);
eq("empty string honoured",  L.resolveLabels({ labels: { startKicker: "" } }).startKicker, "");
eq("null falls back",
   L.resolveLabels({ labels: { submitButton: null } }).submitButton, L.DEFAULT_LABELS.submitButton);
eq("no labels object at all is fine",
   L.resolveLabels({}).submitButton, L.DEFAULT_LABELS.submitButton);
eq("no config at all is fine",
   L.resolveLabels(undefined).submitButton, L.DEFAULT_LABELS.submitButton);

// Every label the editor exposes must be a real key, or it silently does nothing.
ok("DEFAULT_LABELS has >= 40 keys (" + Object.keys(L.DEFAULT_LABELS).length + ")",
   Object.keys(L.DEFAULT_LABELS).length >= 40);
Object.keys(HUNT.config.labels || {}).forEach(k => {
  ok('content.js label "' + k + '" is a recognised key',
     Object.prototype.hasOwnProperty.call(L.DEFAULT_LABELS, k));
});

/* ═══════════════════════════════════════ 3d. POINTS & STAG LEVELS ══ */
section("3d. Points, per-stop timer & STAG levels");

// --- feature toggle ---------------------------------------------------------
// Hardcoded on, deliberately, with no way to switch it off — a stale draft
// missing `config.scoring` entirely (or one with `enabled: false` left over
// from earlier testing) must never be able to make the timer/points quietly
// vanish before a live event. Every input below must still come back true.
ok("on with no config at all",              L.isScoringEnabled());
ok("on with an empty config",               L.isScoringEnabled({}));
ok("on when the scoring block is missing",  L.isScoringEnabled({ notScoring: true }));
ok("on even if explicitly disabled",        L.isScoringEnabled({ scoring: { enabled: false } }));
ok("on when explicitly enabled",            L.isScoringEnabled({ scoring: { enabled: true } }));

// --- which stops are scored ------------------------------------------------
ok("text stop scores by default",            L.isScoredStop({ type: "text" }));
ok("choice stop scores by default",          L.isScoredStop({ type: "choice" }));
ok("dare stop scores by default",            L.isScoredStop({ type: "dare" }));
ok("info stop does NOT score by default",   !L.isScoredStop({ type: "info" }));
ok("explicit true overrides an info stop",   L.isScoredStop({ type: "info", scored: true }));
ok("explicit false overrides a text stop",  !L.isScoredStop({ type: "text", scored: false }));

// --- resolving scoring rules: per-stop > global > hard-coded fallback ------
eq("hard-coded fallback with nothing set",
   L.resolveScoring({}, {}).targetSeconds, 180);
eq("global default used",
   L.resolveScoring({ scoring: { targetSeconds: 90 } }, {}).targetSeconds, 90);
eq("per-stop override beats the global default",
   L.resolveScoring({ scoring: { targetSeconds: 90 } }, { targetSeconds: 45 }).targetSeconds, 45);
eq("basePoints fallback",  L.resolveScoring({}, {}).basePoints, 100);
eq("minPoints fallback",   L.resolveScoring({}, {}).minPoints, 10);
eq("decayWindow fallback", L.resolveScoring({}, {}).decayWindowSeconds, 300);
eq("hint penalty fallback", L.resolveScoring({}, {}).hintPointPenalty, 20);
eq("a real 0 override is honoured, not treated as unset",
   L.resolveScoring({ scoring: { minPoints: 0 } }, {}).minPoints, 0);

// --- the points decay curve -------------------------------------------------
const cfg = { scoring: { targetSeconds: 100, basePoints: 100, minPoints: 20, decayWindowSeconds: 100, hintPointPenalty: 15 } };
const stopA = {};

eq("full points right at 0s",     L.computeStopPoints(stopA, cfg, 0, 0, false), 100);
eq("full points at the target",   L.computeStopPoints(stopA, cfg, 100, 0, false), 100);
eq("half decayed halfway through the window",
   L.computeStopPoints(stopA, cfg, 150, 0, false), 60);   // 100 - 0.5*(100-20) = 60
eq("floors at minPoints at the end of the window",
   L.computeStopPoints(stopA, cfg, 200, 0, false), 20);
eq("stays at the floor well past the window",
   L.computeStopPoints(stopA, cfg, 10000, 0, false), 20);
eq("never negative even far past the window",
   L.computeStopPoints(stopA, cfg, 999999, 5, false), 0);

// --- hint penalty ------------------------------------------------------------
eq("one hint subtracts its cost",
   L.computeStopPoints(stopA, cfg, 0, 1, false), 85);      // 100 - 15
eq("two hints subtract twice",
   L.computeStopPoints(stopA, cfg, 0, 2, false), 70);      // 100 - 30
eq("hints can't push a stop below 0",
   L.computeStopPoints(stopA, cfg, 0, 20, false), 0);
eq("hints on top of decay still floor at 0",
   L.computeStopPoints(stopA, cfg, 200, 2, false), 0);     // 20 - 30 → 0

// --- skipping always scores 0, regardless of time or hints -----------------
eq("skip is 0 even at 0 seconds with no hints",
   L.computeStopPoints(stopA, cfg, 0, 0, true), 0);
eq("skip is 0 even with a huge time",
   L.computeStopPoints(stopA, cfg, 99999, 0, true), 0);

// --- decayWindowSeconds of 0 : an instant drop to the floor -----------------
const cliffCfg = { scoring: { targetSeconds: 60, basePoints: 100, minPoints: 30, decayWindowSeconds: 0 } };
eq("no decay window: full points up to target", L.computeStopPoints({}, cliffCfg, 60, 0, false), 100);
eq("no decay window: floor immediately after",  L.computeStopPoints({}, cliffCfg, 61, 0, false), 30);

// --- stopPointsEarned: the per-stop summary used by the UI ------------------
const scoredStop = { id: "sp1", type: "text" };
const infoStop   = { id: "sp2", type: "info" };
const st = L.freshState();

eq("unscored stop returns null",  L.stopPointsEarned(infoStop, st, cfg), null);
eq("not-yet-reached is not reached",
   L.stopPointsEarned(scoredStop, st, cfg).reached, false);

st.solved = ["sp1"];
st.puzzleElapsedMs = { sp1: 50000 };            // 50s, under a 100s target
st.hintsUsed = { sp1: [0] };                    // one hint
const summary = L.stopPointsEarned(scoredStop, st, cfg);
ok("solved stop is reached",       summary.reached);
ok("solved stop is not marked skipped", !summary.skipped);
eq("earned reflects the hint penalty", summary.earned, 85);   // full 100 - 15
eq("possible is the stop's basePoints", summary.possible, 100);

const st2 = L.freshState();
st2.skipped = ["sp1"];
const skippedSummary = L.stopPointsEarned(scoredStop, st2, cfg);
ok("skipped stop is reached (it was resolved, just badly)", skippedSummary.reached);
ok("skipped stop is flagged skipped", skippedSummary.skipped);
eq("skipped stop earns 0",   skippedSummary.earned, 0);
eq("skipped stop still shows what was possible", skippedSummary.possible, 100);

// --- totals: fixed denominator, regardless of what happens -----------------
const stops3 = [
  { id: "a", type: "text" },       // scored, default 100
  { id: "b", type: "text", basePoints: 50 },
  { id: "c", type: "info" }        // unscored — excluded entirely
];
eq("total possible sums only scored stops' basePoints",
   L.totalPossiblePoints(stops3, cfg), 150);

const runState = L.freshState();
runState.solved = ["a"];
runState.puzzleElapsedMs = { a: 0 };            // instant solve, full marks
// "b" not reached yet, "c" is unscored — neither contributes.
eq("earned only counts reached, scored stops",
   L.totalEarnedPoints(runState, stops3, cfg), 100);

runState.solved.push("b");
runState.puzzleElapsedMs.b = 0;
eq("earned grows as more scored stops are solved",
   L.totalEarnedPoints(runState, stops3, cfg), 150);

runState.skipped = ["a"];   // pretend "a" also got recorded as skipped somehow —
runState.solved = ["b"];    // shouldn't happen in practice, but resolve cleanly
eq("a skip contributes 0 rather than double-counting",
   L.totalEarnedPoints(runState, stops3, cfg), 50);

eq("total possible with no scored stops at all is 0",
   L.totalPossiblePoints([{ id: "z", type: "info" }], cfg), 0);
eq("total earned with nothing reached yet is 0",
   L.totalEarnedPoints(L.freshState(), stops3, cfg), 0);

// --- STAG levels -------------------------------------------------------------
ok("has 6 default levels", L.DEFAULT_STAG_LEVELS.length === 6);
ok("a catch-all level exists at 0%",
   L.DEFAULT_STAG_LEVELS.some(l => l.minPercent === 0));

eq("100% gets the top tier",   L.stagLevelFor(100).name, L.DEFAULT_STAG_LEVELS[0].name);
eq("95% gets the top tier (boundary is inclusive)",
   L.stagLevelFor(95).name, L.DEFAULT_STAG_LEVELS[0].name);
eq("94.9% just misses the top tier",
   L.stagLevelFor(94.9).name, L.DEFAULT_STAG_LEVELS[1].name);
eq("0% gets the bottom tier",  L.stagLevelFor(0).name,
   L.DEFAULT_STAG_LEVELS[L.DEFAULT_STAG_LEVELS.length - 1].name);
eq("negative percentage still resolves to the bottom tier (never crashes)",
   L.stagLevelFor(-5).name, L.DEFAULT_STAG_LEVELS[L.DEFAULT_STAG_LEVELS.length - 1].name);

const customLevels = [
  { minPercent: 50, name: "Winner" },
  { minPercent: 0,  name: "Loser" }
];
eq("custom levels are used when supplied", L.stagLevelFor(75, customLevels).name, "Winner");
eq("custom levels fall through correctly", L.stagLevelFor(10, customLevels).name, "Loser");
// Deliberately out of order — stagLevelFor must sort, not trust input order.
const outOfOrder = [
  { minPercent: 0,  name: "Bottom" },
  { minPercent: 80, name: "Top" }
];
eq("out-of-order levels are still sorted correctly", L.stagLevelFor(90, outOfOrder).name, "Top");
eq("out-of-order levels: low percent still gets the bottom tier",
   L.stagLevelFor(10, outOfOrder).name, "Bottom");

// --- content.js's own scoring config ----------------------------------------
if (L.isScoringEnabled(HUNT.config)) {
  const possible = L.totalPossiblePoints(HUNT.stops, HUNT.config);
  ok("content.js: scoring is on and has a non-zero total (" + possible + " pts)", possible > 0);
  ok("content.js: stagLevels has a 0% catch-all",
     (HUNT.config.stagLevels || L.DEFAULT_STAG_LEVELS).some(l => l.minPercent === 0));
  (HUNT.config.stagLevels || []).forEach(l => {
    ok('stag level "' + l.name + '" has a minPercent', typeof l.minPercent === "number");
    ok('stag level "' + l.name + '" has a blurb', !!l.blurb);
  });
}

/* ═══════════════════════════════════ 3e. TIMER TOGGLE & PHOTO CAPTURE ══ */
section("3e. Per-stop timer toggle & photo capture");

// --- shouldShowTimer: independent of both type and scored status ----------
eq("no override: text stop follows isScoredStop (true)",
   L.shouldShowTimer({ type: "text" }), true);
eq("no override: info stop follows isScoredStop (false)",
   L.shouldShowTimer({ type: "info" }), false);
eq("explicit true wins even on an unscored info stop",
   L.shouldShowTimer({ type: "info", showTimer: true }), true);
eq("explicit false wins even on a normally-scored text stop",
   L.shouldShowTimer({ type: "text", showTimer: false }), false);
eq("explicit showTimer is independent of an explicit scored flag",
   L.shouldShowTimer({ type: "text", scored: false, showTimer: true }), true);
ok("showTimer alone doesn't change whether points are earned",
   L.isScoredStop({ type: "text", showTimer: false }) === true);

// --- wantsPhotoCapture: on for dare by default, off otherwise, overridable -
ok("dare stop wants a photo control by default",      L.wantsPhotoCapture({ type: "dare" }));
ok("text stop has no photo control by default",      !L.wantsPhotoCapture({ type: "text" }));
ok("choice stop has no photo control by default",     !L.wantsPhotoCapture({ type: "choice" }));
ok("info stop has no photo control by default",       !L.wantsPhotoCapture({ type: "info" }));
ok("explicit true turns it on for a text stop",         L.wantsPhotoCapture({ type: "text", photoCapture: true }));
ok("explicit false turns it off for a dare stop",      !L.wantsPhotoCapture({ type: "dare", photoCapture: false }));

/* ══════════════════════════════════════════════ 4. TIMER & PENALTIES ══ */
section("4. Timer, penalties, scoring");

eq("formats seconds",           L.formatTime(45000), "0:45");
eq("formats minutes",           L.formatTime(90000), "1:30");
eq("pads seconds",              L.formatTime(65000), "1:05");
eq("formats hours",             L.formatTime(3725000), "1:02:05");
eq("clamps negatives",          L.formatTime(-500), "0:00");
eq("handles NaN",               L.formatTime(NaN), "0:00");

const s = L.freshState();
s.startedAt = 1000;
eq("elapsed from wall clock",   L.elapsedMs(s, 61000), 60000);
s.finishedAt = 31000;
eq("elapsed frozen after finish", L.elapsedMs(s, 999999), 30000);
eq("no start = zero elapsed",   L.elapsedMs(L.freshState(), 5000), 0);

const s2 = L.freshState();
s2.hintsUsed = { a: [0, 1], b: [0] };      // 3 hints
s2.skipped = ["c"];                        // 1 skip
eq("counts hints",              L.countHints(s2), 3);
eq("counts skips penalty+hints",
   L.penaltyMs(s2, { hintPenaltyMinutes: 5, skipPenaltyMinutes: 15 }),
   (3 * 5 + 15) * 60000);
eq("zero-penalty config",
   L.penaltyMs(s2, { hintPenaltyMinutes: 0, skipPenaltyMinutes: 0 }), 0);

const s3 = L.freshState();
s3.wrong = { a: 2, b: 5 };
eq("counts wrong guesses",      L.countWrong(s3), 7);
eq("fresh state has no hints",  L.countHints(L.freshState()), 0);

/* ════════════════════════════════════════════ 5. CONTENT FILE VALIDATION ══ */
section("5. content.js validation");

ok("config exists", !!HUNT.config);
// Not a fixed range — the whole point of the editor is that you reshape this
// hunt however you like, including down to a couple of stops. Just needs at
// least one, or there's no game.
ok("has at least 1 stop (" + HUNT.stops.length + ")", HUNT.stops.length >= 1);

const ids = new Set();
HUNT.stops.forEach((stop, i) => {
  const at = "stop " + (i + 1) + " (" + (stop.id || "NO ID") + ")";
  ok(at + " has an id", !!stop.id);
  ok(at + " id is unique", !ids.has(stop.id));
  ids.add(stop.id);
  ok(at + " has a travel clue", !!stop.travelClue && stop.travelClue.length > 20);
  ok(at + " has a puzzle", !!stop.puzzle && stop.puzzle.length > 20);
  ok(at + " has a teaser", !!stop.teaser);
  ok(at + " has a name", !!stop.name);
  ok(at + " has a valid type", L.TASK_TYPES.includes(L.stopType(stop)));
  ok(at + " has a success message", !!stop.successMessage);

  if (L.typeNeedsAnswer(L.stopType(stop))) {
    // No upper bound — the editor doesn't cap hint count either, and 1-2 was
    // always a style suggestion for THIS demo content, not a real limit.
    ok(at + " has at least 1 hint", Array.isArray(stop.hints) && stop.hints.length >= 1);
    ok(at + " has a non-empty answers array",
       Array.isArray(stop.answers) && stop.answers.length > 0);
  }

  if (L.stopType(stop) === "choice") {
    ok(at + " has 2+ choices", Array.isArray(stop.choices) && stop.choices.length >= 2);
    if (!L.isPlaceholderStop(stop) && Array.isArray(stop.choices)) {
      ok(at + " has a winnable option",
         stop.choices.some(c => L.checkAnswer(stop, c).ok),
         "no listed option matches an accepted answer");
    }
  }

  // Every real (non-placeholder) answer must actually match itself once
  // normalised — catches answers that are pure punctuation or whitespace.
  // Only applies to types that have an `answers` array at all — dare/info
  // stops are never placeholders (isPlaceholderStop short-circuits false for
  // them) but also legitimately have no answers to check.
  if (L.typeNeedsAnswer(L.stopType(stop)) && !L.isPlaceholderStop(stop)) {
    (stop.answers || []).forEach(a => {
      ok(at + ' answer "' + a + '" survives normalisation', L.normalize(a).length > 0);
      ok(at + ' answer "' + a + '" matches itself', L.checkAnswer(stop, a).ok);
    });
  }
});

/* ─── image fields (added by the editor, or hand-written) ─────────────── */
HUNT.stops.forEach((stop, i) => {
  const at = "stop " + (i + 1) + " (" + stop.id + ")";
  ["travelImage", "puzzleImage", "successImage"].forEach(key => {
    const img = stop[key];
    if (img == null) return;                       // absent is fine
    ok(at + " " + key + " is an object or string",
       typeof img === "string" || (typeof img === "object" && !Array.isArray(img)));
    const src = typeof img === "string" ? img : img.src;
    ok(at + " " + key + " has a src", !!src);
    if (src && src.startsWith("data:")) {
      ok(at + " " + key + " data URI is an image",
         /^data:image\/(jpeg|png|gif|webp);base64,/.test(src));
      const kb = Math.round(src.length * 0.75 / 1024);
      ok(at + " " + key + " is under 500 KB (" + kb + " KB)", kb <= 500,
         "large embedded images make the page slow on 4G");
    }
  });
});

const totalKb = Math.round(JSON.stringify(HUNT).length / 1024);
ok("whole game is under 3 MB (" + totalKb + " KB)", totalKb <= 3072,
   "mostly driven by embedded photos");

const required = ["groomName", "title", "estimatedDuration", "howToPlay",
                  "hintPenaltyMinutes", "skipPenaltyMinutes", "skipAfterWrongAnswers",
                  "wrongAnswerMessages", "correctAnswerMessages",
                  "finishTitle", "finalPhotoPrompt"];
required.forEach(k => ok("config." + k + " is set", HUNT.config[k] !== undefined));
ok("wrongAnswerMessages is non-empty", HUNT.config.wrongAnswerMessages.length > 0);
ok("correctAnswerMessages is non-empty", HUNT.config.correctAnswerMessages.length > 0);

/* ══════════════════════════════════════ 6. SIMULATED FULL PLAYTHROUGH ══ */
section("6. Simulated playthrough (state machine, no DOM)");

// Replays a whole hunt against the same pure functions the app uses, so the
// scoring maths is exercised exactly as it will be on the night.
const run = L.freshState();
run.startedAt = 0;
let clock = 0;

let solvedCount = 0;
HUNT.stops.forEach((stop, i) => {
  run.stopIndex = i;
  clock += 8 * 60000;                    // 8 min of walking + solving per stop

  const wrongFirst = (i % 3 === 0);      // every third stop, fumble once
  if (wrongFirst) {
    const guess = "definitely not the answer " + i;
    if (!L.checkAnswer(stop, guess).ok) {
      run.wrong[stop.id] = (run.wrong[stop.id] || 0) + 1;
    }
  }
  if (i === 1) {                         // burn a hint on stop 2
    run.hintsUsed[stop.id] = [0];
  }

  // dare/info stops don't need an answer — checkAnswer() accepts anything
  // for them, same as the real "confirm done" button does.
  const answer = !L.typeNeedsAnswer(L.stopType(stop)) ? "done"
               : L.isPlaceholderStop(stop) ? "whatever"
               : (stop.answers || [])[0];
  const res = L.checkAnswer(stop, answer);
  ok("stop " + (i + 1) + " (" + stop.id + ") is solvable with its own first answer", res.ok);
  if (res.ok) { run.solved.push(stop.id); solvedCount++; }
});

run.finishedAt = clock;

eq("all stops solved", solvedCount, HUNT.stops.length);
eq("elapsed = 8 min × stops", L.elapsedMs(run, clock), HUNT.stops.length * 8 * 60000);
eq("one hint burned", L.countHints(run), 1);
eq("penalty = 1 hint", L.penaltyMs(run, HUNT.config), HUNT.config.hintPenaltyMinutes * 60000);
ok("wrong guesses recorded", L.countWrong(run) > 0);
console.log("   → final time would read: " +
  L.formatTime(L.elapsedMs(run, clock) + L.penaltyMs(run, HUNT.config)) +
  "  (raw " + L.formatTime(L.elapsedMs(run, clock)) +
  " + " + L.formatTime(L.penaltyMs(run, HUNT.config)) + " penalty)");

/* ═══════════════════════════════════════════════ 7. SKIP-GATE LOGIC ══ */
section("7. Skip gate (the escape hatch)");

// Mirrors paintSkip() in app.js: needs ALL hints revealed AND N wrong answers.
function skipVisible(stop, st, cfg) {
  const used = (st.hintsUsed[stop.id] || []).length;
  const total = (stop.hints || []).length;
  const wrong = st.wrong[stop.id] || 0;
  return used >= total && wrong >= (cfg.skipAfterWrongAnswers || 4);
}

const gs = L.freshState();
const gstop = HUNT.stops[0];
const gcfg = HUNT.config;
const allHintIndexes = (gstop.hints || []).map((_, i) => i);   // however many this stop actually has
ok("hidden at the start",             !skipVisible(gstop, gs, gcfg));
gs.wrong[gstop.id] = 9;
ok("hidden with wrongs but no hints", !skipVisible(gstop, gs, gcfg));
gs.hintsUsed[gstop.id] = allHintIndexes;
ok("visible with all hints + wrongs",  skipVisible(gstop, gs, gcfg));
gs.wrong[gstop.id] = 1;
ok("hidden again if wrongs too few",  !skipVisible(gstop, gs, gcfg));

/* ═══════════════════════════════════════════════════════ SUMMARY ══ */
console.log("\n" + "─".repeat(60));
if (fail === 0) {
  console.log("\x1b[32m✅  " + pass + " checks passed, 0 failed.\x1b[0m");
} else {
  console.log("\x1b[31m❌  " + fail + " FAILED (" + pass + " passed):\x1b[0m");
  failures.forEach(f => console.log("   • " + f));
}

// Informational: which stops still need real content written.
const stubs = HUNT.stops.filter(L.isPlaceholderStop).map(s => s.id);
if (stubs.length) {
  console.log("\n\x1b[33m📝  Still placeholder (any answer accepted): " +
              stubs.join(", ") + "\x1b[0m");
}
const brackets = HUNT.stops.filter(s =>
  /\[INSERT:|\[ANSWER:/.test(JSON.stringify(s))).map(s => s.id);
if (brackets.length) {
  console.log("\x1b[33m📝  Contains [INSERT:...] text to replace: " +
              brackets.join(", ") + "\x1b[0m");
}

process.exit(fail === 0 ? 0 : 1);
