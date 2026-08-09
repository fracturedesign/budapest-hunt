/* ============================================================================
 * app.js — game engine. You shouldn't need to edit this file.
 * All content, copy, answers and tuning knobs live in content.js.
 *
 * Structured so the pure logic (answer normalisation, matching, timing,
 * penalties) can be require()'d by test.js under Node with no DOM.
 * ========================================================================== */

(function (global) {
  "use strict";

  /* ==========================================================================
   * PART 1 — PURE LOGIC (testable, no DOM)
   * ======================================================================== */

  /**
   * Normalise an answer for comparison.
   *   - lowercase
   *   - strip accents/diacritics  (sör → sor, hét → het, VÖRÖSMARTY → vorosmarty)
   *   - strip punctuation and anything that isn't a letter/digit/space
   *   - collapse runs of whitespace, trim
   * Deliberately does NOT do fuzzy/edit-distance matching — that produces
   * false positives on short answers like "72" or "sör".
   */
  function normalize(input) {
    if (input == null) return "";
    return String(input)
      .normalize("NFD")                    // split base letters from accents
      .replace(/[\u0300-\u036f]/g, "")  // drop the accents (ö→o, ő→o, é→e)
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")   // punctuation → space
      .replace(/\s+/g, " ")
      .trim();
  }

  /** Word-number spellings we quietly accept for numeric answers. */
  var NUMBER_WORDS = {
    zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5",
    six: "6", seven: "7", eight: "8", nine: "9", ten: "10",
    eleven: "11", twelve: "12"
  };

  /** Extra normalisation pass applied to both sides before comparing. */
  function canonical(input) {
    var n = normalize(input);
    if (Object.prototype.hasOwnProperty.call(NUMBER_WORDS, n)) return NUMBER_WORDS[n];
    // "seventy two" / "seventytwo" → "seventytwo" so both forms agree
    if (/^[a-z ]+$/.test(n) && n.indexOf(" ") !== -1) {
      var squashed = n.replace(/ /g, "");
      if (/^(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)/.test(squashed)) {
        return squashed;
      }
    }
    return n;
  }

  /* ---- task types ----------------------------------------------------------
   * "text"   — type the answer into a box (the default, and what every stop
   *            was before types existed)
   * "choice" — tap one of several options
   * "dare"   — nothing to answer; one button confirms they did the thing
   * "info"   — no challenge at all; a story beat or a waypoint
   * "picker" — tap one of several options to jump straight to that stop,
   *            by id; not "did you get it right", just "which path".
   * "onetry" — multiple choice with no retry: get it wrong and it's an
   *            outright fail (own failure screen), not "try again". Right
   *            answers work exactly like "choice".
   * "sequence" — several timed sub-tasks in a row, each with its own
   *            countdown; purely passive (no button, no answer) — when a
   *            sub-task's clock hits 0 it auto-advances to the next one,
   *            and the whole stop is "solved" once the last one finishes.
   * Anything unrecognised falls back to "text".                             */

  var TASK_TYPES = ["text", "choice", "dare", "info", "picker", "onetry", "sequence"];

  function stopType(stop) {
    var t = stop && stop.type;
    return TASK_TYPES.indexOf(t) !== -1 ? t : "text";
  }

  /** Does this type require the player to get something right? */
  function typeNeedsAnswer(type) {
    return type === "text" || type === "choice" || type === "onetry";
  }

  /** A "picker" stop's options — each { label, description, color, animated,
   *  targetStopId }. Missing/malformed is just no options (nothing to show,
   *  same "degrade gracefully on bad content" convention as choices/hints). */
  function pickerOptions(stop) {
    return (stop && Array.isArray(stop.pickerOptions)) ? stop.pickerOptions : [];
  }

  /** A "sequence" stop's sub-tasks — each { label, instructions, image,
   *  durationSeconds }. Missing/malformed is just no sub-tasks, same
   *  degrade-gracefully convention as pickerOptions()/choices/hints. */
  function subTasks(stop) {
    return (stop && Array.isArray(stop.subTasks)) ? stop.subTasks : [];
  }

  /** A sub-task's countdown length in seconds — a real per-sub-task number
   *  wins, otherwise a hard-coded 60s so a blank/malformed one still ticks
   *  down to something instead of instantly completing or hanging forever. */
  function subTaskDurationSeconds(sub) {
    var n = sub && Number(sub.durationSeconds);
    return (typeof n === "number" && !isNaN(n) && n > 0) ? n : 60;
  }

  /** Find a stop's array index by id, or -1. Used to jump straight to a
   *  picker option's target regardless of where it sits in the list. */
  function stopIndexById(stops, id) {
    for (var i = 0; i < (stops || []).length; i++) {
      if (stops[i] && stops[i].id === id) return i;
    }
    return -1;
  }

  /** Is this stop excluded from the current playthrough? A picker option
   *  NOT chosen gets its target stop id added to state.excludedStopIds —
   *  only one path through a picker is ever played in one run. */
  function isExcludedStop(stop, state) {
    return !!(stop && state && state.excludedStopIds &&
              state.excludedStopIds.indexOf(stop.id) !== -1);
  }

  /** The stops that are actually in play this run — every stop minus
   *  whichever picker paths weren't taken. */
  function effectiveStops(stops, state) {
    return (stops || []).filter(function (s) { return !isExcludedStop(s, state); });
  }

  /** Some puzzles are solved right where the group already is — no walk,
   *  no travel screen. Set on the stop by the editor's "On-site" toggle. */
  function hasTravelClue(stop) {
    return !(stop && stop.skipTravel);
  }

  /**
   * The answers that could actually ever match something.
   *
   * Blank rows (and rows of pure punctuation like "???") are dropped: the
   * editor creates an empty row the moment you click "+ Add answer", and
   * exporting strips blank rows out entirely. Ignoring them here keeps the
   * draft, the preview and the exported file behaving identically, and stops
   * a half-typed row from making a stop unsolvable.
   */
  function usableAnswers(stop) {
    if (!stop || !Array.isArray(stop.answers)) return [];
    return stop.answers.filter(function (a) { return normalize(a).length > 0; });
  }

  /** True if this stop has no real answer yet (so it accepts anything). */
  function isPlaceholderStop(stop) {
    // dare/info stops have nothing to answer, so they're never "unfilled".
    if (!typeNeedsAnswer(stopType(stop))) return false;
    var usable = usableAnswers(stop);
    if (usable.length === 0) return true;
    return usable.some(function (a) {
      return /^\s*\[ANSWER:/i.test(String(a));
    });
  }

  /**
   * Check a submitted answer.
   * @returns {{ ok:boolean, empty:boolean, placeholder:boolean }}
   */
  function checkAnswer(stop, input) {
    // dare/info: there's nothing to be wrong about.
    if (!typeNeedsAnswer(stopType(stop))) {
      return { ok: true, empty: false, placeholder: false };
    }

    var empty = normalize(input).length === 0;
    var placeholder = isPlaceholderStop(stop);

    if (empty) return { ok: false, empty: true, placeholder: placeholder };
    // Unfilled placeholder stops accept anything non-empty so the game is
    // playable end-to-end before the personal content has been written.
    if (placeholder) return { ok: true, empty: false, placeholder: true };

    var given = canonical(input);
    var ok = usableAnswers(stop).some(function (a) { return canonical(a) === given; });
    return { ok: ok, empty: false, placeholder: false };
  }

  /** ms → "M:SS" or "H:MM:SS". */
  function formatTime(ms) {
    if (!isFinite(ms) || ms < 0) ms = 0;
    var total = Math.floor(ms / 1000);
    var h = Math.floor(total / 3600);
    var m = Math.floor((total % 3600) / 60);
    var s = total % 60;
    var pad = function (n) { return n < 10 ? "0" + n : String(n); };
    return h > 0 ? h + ":" + pad(m) + ":" + pad(s) : m + ":" + pad(s);
  }

  /** Total hints revealed across all stops. */
  function countHints(state) {
    return Object.keys(state.hintsUsed || {}).reduce(function (sum, id) {
      return sum + (state.hintsUsed[id] || []).length;
    }, 0);
  }

  /** Total wrong guesses across all stops. */
  function countWrong(state) {
    return Object.keys(state.wrong || {}).reduce(function (sum, id) {
      return sum + (state.wrong[id] || 0);
    }, 0);
  }

  /** Penalty time in ms, from hints revealed + stops skipped. */
  function penaltyMs(state, config) {
    var hintMin = Number(config.hintPenaltyMinutes) || 0;
    var skipMin = Number(config.skipPenaltyMinutes) || 0;
    var skipped = (state.skipped || []).length;
    return (countHints(state) * hintMin + skipped * skipMin) * 60000;
  }

  /** Raw wall-clock elapsed ms (keeps running while the page is closed). */
  function elapsedMs(state, now) {
    // Note the explicit null checks — a timestamp of 0 is a legitimate value
    // (and the test harness uses it), so `if (!startedAt)` would be wrong.
    if (state.startedAt == null) return 0;
    var end = state.finishedAt != null ? state.finishedAt
            : (now != null ? now : Date.now());
    return end - state.startedAt;
  }

  /* ==========================================================================
   * SCORING — a per-stop timer, bonus/penalty points, and a STAG level.
   *
   * This is a second, independent scoring system layered on top of the
   * original one above (overall wall-clock time + minute penalties, which
   * still runs exactly as before). It's opt-in: a content.js written before
   * this existed has no `config.scoring` block, so it stays off automatically.
   *
   * Only stops the organiser has marked as scored count. By default every
   * task type scores except "info" — a pure waypoint has nothing to time or
   * judge. The clock for a stop starts only once the group reaches its
   * puzzle screen, so time spent walking there never counts against them.
   * ======================================================================== */

  /**
   * Is the points/STAG-level feature switched on for this hunt?
   *
   * Hardcoded true. This used to read `config.scoring.enabled`, but that
   * created a real failure mode: an older saved draft with no `scoring`
   * block at all (or the flag sitting at `false` from earlier testing) would
   * silently disable the per-task timer and the whole points system, with
   * no obvious sign anything was wrong short of noticing the clock wasn't
   * there. For a one-shot live event that's not an acceptable way to fail —
   * so scoring is unconditionally on, for every stop, every time. The
   * `config` parameter is kept (and still passed everywhere) purely so this
   * function's signature doesn't have to change if that ever needs
   * revisiting; it's intentionally unused. Per-stop opt-out (a stop's own
   * `scored: false`) is unaffected — that's a deliberate authorial choice
   * made once while writing that stop, not something that can drift.
   */
  function isScoringEnabled(config) {
    return true;
  }

  /**
   * Is the final group-selfie step switched on? Off unless `config.finalSelfie`
   * exists (mirrors how isScoringEnabled used to work, before it was
   * hardcoded on) — a content.js written before this feature existed simply
   * has no such block, so nothing new appears for it unasked.
   */
  function isFinalSelfieEnabled(config) {
    return !!(config && config.finalSelfie && config.finalSelfie.enabled !== false);
  }

  /** Does this stop count toward the score? An explicit `scored` flag wins;
   *  otherwise every type scores except "info" (a pure waypoint) and
   *  "sequence" (a fixed-duration timed activity, not a race to solve). */
  function isScoredStop(stop) {
    if (stop && typeof stop.scored === "boolean") return stop.scored;
    var type = stopType(stop);
    return type !== "info" && type !== "sequence";
  }

  /**
   * Should the live ⏱ clock show on this stop's puzzle screen? Deliberately
   * independent of both task type and whether the stop is scored — an
   * explicit `showTimer` flag wins outright; otherwise it defaults to
   * whatever isScoredStop() says, which is exactly the behaviour this app
   * had before the two were split apart. That means a stop can show a clock
   * purely for pace with no points attached (nice on an info stop or a
   * dare), or rack up points with no visible clock at all.
   */
  function shouldShowTimer(stop) {
    if (stop && typeof stop.showTimer === "boolean") return stop.showTimer;
    return isScoredStop(stop);
  }

  /**
   * Should this stop offer an in-app "take a photo" control? An explicit
   * `photoCapture` flag wins; otherwise it's on by default for "dare" stops
   * (the type built around doing something and proving it) and off for
   * everything else.
   */
  function wantsPhotoCapture(stop) {
    if (stop && typeof stop.photoCapture === "boolean") return stop.photoCapture;
    return stopType(stop) === "dare";
  }

  /**
   * Must a photo be attached before this stop can be completed?
   *
   * Defaults to YES wherever photo capture is switched on — if a stop asks
   * for photo proof, letting the group tap past it without one defeats the
   * point. Set `photoRequired: false` on a stop to make the photo optional
   * instead. Never true when photo capture is off, obviously.
   */
  function isPhotoRequired(stop) {
    if (!wantsPhotoCapture(stop)) return false;
    return !(stop && stop.photoRequired === false);
  }

  /** First argument that's an actual number, or 0. */
  function numberOr() {
    for (var i = 0; i < arguments.length; i++) {
      if (typeof arguments[i] === "number" && !isNaN(arguments[i])) return arguments[i];
    }
    return 0;
  }

  /** Resolve one stop's scoring rules: per-stop override, then the hunt's
   *  global default, then a hard-coded fallback so nothing is ever NaN. */
  function resolveScoring(config, stop) {
    var g = (config && config.scoring) || {};
    return {
      targetSeconds:      numberOr(stop && stop.targetSeconds,      g.targetSeconds,      180),
      basePoints:         numberOr(stop && stop.basePoints,         g.basePoints,         100),
      minPoints:          numberOr(stop && stop.minPoints,          g.minPoints,          10),
      decayWindowSeconds: numberOr(stop && stop.decayWindowSeconds, g.decayWindowSeconds, 300),
      hintPointPenalty:   numberOr(stop && stop.hintPointPenalty,   g.hintPointPenalty,   20),
      wrongAnswerPointPenalty:
                          numberOr(stop && stop.wrongAnswerPointPenalty, g.wrongAnswerPointPenalty, 10)
    };
  }

  /**
   * Points for one stop, given how long it took, how many hints were used,
   * and how many wrong answers were submitted. Full marks at or under the
   * target time; a straight-line decay down to `minPoints` over
   * `decayWindowSeconds` after that, then it holds at the floor. Each hint
   * and each wrong answer subtracts its own flat penalty on top — a wrong
   * multiple-choice tap counts the same as a wrong typed answer. A skip is
   * always 0 — the one outcome that's worse than just being slow.
   */
  function computeStopPoints(stop, config, elapsedSeconds, hintCount, skipped, wrongCount) {
    if (skipped) return 0;
    var s = resolveScoring(config, stop);
    var elapsed = Math.max(0, Number(elapsedSeconds) || 0);

    var points;
    if (elapsed <= s.targetSeconds) {
      points = s.basePoints;
    } else if (s.decayWindowSeconds <= 0) {
      points = s.minPoints;
    } else {
      var over = elapsed - s.targetSeconds;
      var frac = Math.min(1, over / s.decayWindowSeconds);
      points = s.basePoints - frac * (s.basePoints - s.minPoints);
    }

    points -= Math.max(0, hintCount || 0) * s.hintPointPenalty;
    points -= Math.max(0, wrongCount || 0) * s.wrongAnswerPointPenalty;
    return Math.round(Math.max(0, Math.min(s.basePoints, points)));
  }

  /**
   * Everything needed to show one stop's score: how many points it's worth,
   * how many were earned (once reached), and whether it's been reached yet.
   * Returns null for a stop that isn't scored at all.
   */
  function stopPointsEarned(stop, state, config) {
    if (!isScoredStop(stop)) return null;
    var scoring = resolveScoring(config, stop);
    var skipped = (state.skipped || []).indexOf(stop.id) !== -1;
    var failed = (state.failed || []).indexOf(stop.id) !== -1;
    var solved = (state.solved || []).indexOf(stop.id) !== -1;

    if (!skipped && !failed && !solved) {
      return { possible: scoring.basePoints, earned: null, reached: false, skipped: false, failed: false };
    }

    var elapsedMsVal = (state.puzzleElapsedMs || {})[stop.id];
    var elapsedSeconds = elapsedMsVal != null ? elapsedMsVal / 1000 : 0;
    var hintCount = ((state.hintsUsed || {})[stop.id] || []).length;
    var wrongCount = (state.wrong || {})[stop.id] || 0;
    // A failed "onetry" stop scores 0, same treatment as a skip.
    var earned = computeStopPoints(stop, config, elapsedSeconds, hintCount, skipped || failed, wrongCount);

    return {
      possible: scoring.basePoints, earned: earned, reached: true, skipped: skipped, failed: failed,
      elapsedSeconds: elapsedSeconds, hintCount: hintCount, wrongCount: wrongCount
    };
  }

  /** The maximum score achievable across every scored stop — fixed, regardless
   *  of how the run actually goes. */
  function totalPossiblePoints(stops, config) {
    return (stops || []).filter(isScoredStop)
      .reduce(function (sum, stop) { return sum + resolveScoring(config, stop).basePoints; }, 0);
  }

  /** Points actually banked so far. Stops not yet reached contribute 0. */
  function totalEarnedPoints(state, stops, config) {
    return (stops || []).reduce(function (sum, stop) {
      var p = stopPointsEarned(stop, state, config);
      return sum + (p && p.reached ? p.earned : 0);
    }, 0);
  }

  /** Fun titles awarded at the end, by percentage of possible points earned.
   *  Sorted highest-first; the last entry (minPercent: 0) is the catch-all. */
  var DEFAULT_STAG_LEVELS = [
    { minPercent: 95, name: "🦌👑 Legendary Stag",
      blurb: "Wedding-speech material. They'll be telling this one for years." },
    { minPercent: 80, name: "🦌⚡ Alpha Stag",
      blurb: "Led the herd all night. Barely broke a sweat." },
    { minPercent: 65, name: "🦌 Stag in Training",
      blurb: "Solid work. A hint or two never hurt anybody." },
    { minPercent: 45, name: "🩹 Wounded Stag",
      blurb: "Limped across the finish line, but you made it." },
    { minPercent: 25, name: "🐣 Lost Fawn",
      blurb: "Got there eventually, mostly by accident." },
    { minPercent: 0,  name: "🍖 Roadkill Stag",
      blurb: "We're not saying the hints did all the solving. We're just very glad they were there." }
  ];

  /** Pick the highest tier this percentage still qualifies for. */
  function stagLevelFor(percent, levels) {
    var list = (levels && levels.length ? levels : DEFAULT_STAG_LEVELS)
      .slice()
      .sort(function (a, b) { return b.minPercent - a.minPercent; });
    for (var i = 0; i < list.length; i++) {
      if (percent >= list[i].minPercent) return list[i];
    }
    return list[list.length - 1];
  }

  /**
   * Plain-language explanation of the points/STAG system for the start
   * screen — separate from `howToPlay` above, which only covers the core
   * clue → puzzle → answer loop. {target} and {totalPoints} are filled at
   * render time from this hunt's actual config, so the copy can't drift out
   * of sync with what it's describing.
   */
  var DEFAULT_SCORING_EXPLAINER = [
    "There are {totalPoints} points up for grabs across this hunt.",
    "Each stop has its own clock, starting the moment you arrive — not while you're still walking there.",
    "Solve within the target time (default {target}) for full points; take longer and they decay down to a floor.",
    "Every hint you reveal costs points too, on top of the extra minutes it adds.",
    "Every wrong guess costs points too — think before you tap or type.",
    "Add it all up at the end and you're crowned with a STAG title, from Roadkill Stag to Legendary Stag."
  ];

  /** The bullet list to actually render: the hunt's own, or the default. */
  function resolveScoringExplainer(config) {
    return (config && config.scoringExplainer && config.scoringExplainer.length)
      ? config.scoringExplainer
      : DEFAULT_SCORING_EXPLAINER;
  }

  /* ==========================================================================
   * LABELS — every visible bit of UI text, all overridable from content.js.
   *
   * `config.labels` is merged over these, so a content.js that predates this
   * feature (or only overrides two of them) still works.
   *
   * Tokens: {n} = hint number, {min} = the relevant penalty in minutes.
   * ======================================================================== */

  var DEFAULT_LABELS = {
    // start screen
    startKicker:      "",   // blank by default — the element hides itself when empty
    howToTitle:       "How this works",
    scoringExplainerTitle: "🏆 How scoring works",
    startFootnote:    "",   // blank by default — hides itself, same convention as startKicker
    hintCostNote:     "",   // blank by default — hides itself
    hintCostNoteFree: "",   // blank by default — hides itself
    factGroom:        "Groom",
    factStops:        "Stops",
    factDuration:     "Time",
    factDistance:     "Walking",

    // travel screen
    travelEyebrow:    "🧭 Travel clue",
    arrivedButton:    "WE'RE HERE →",
    travelFootnote:   "Only tap this once you're actually standing there.",

    // puzzle screen
    puzzleEyebrow:    "🧩 The puzzle",
    answerLabel:      "Your answer",
    answerPlaceholder:"Type it here…",
    submitButton:     "SUBMIT",
    choiceLabel:      "Pick one",
    onetryLabel:      "Pick one — you only get one shot",
    pickerLabel:      "Choose one",
    sequenceSubProgress: "Sub-task {n} of {total}",
    dareButton:       "✅ DONE — WE HAVE PROOF",
    infoButton:       "CONTINUE →",
    hintButton:       "💡 Reveal hint {n}  (+{min} min)",
    hintButtonFree:   "💡 Reveal hint {n}",
    hintButtonScored: "💡 Reveal hint {n}  (+{min} min, −{pts} pts)",
    hintButtonFreeScored: "💡 Reveal hint {n}  (−{pts} pts)",
    hintButtonLocked: "🔒 Hint {n}",
    hintLockedTitle:  "Reveal the earlier hints first",
    hintZoneLabel:    "Hints",
    hintTag:          "Hint {n}",
    skipButton:       "Give up on this one (+{min} min penalty)",
    backToClue:       "← re-read the travel clue",
    emptyAnswer:      "Type something first.",
    placeholderBadge: "⚠️ Placeholder stop — the real answer hasn't been written yet, so anything you type will be accepted.",
    taskTimerTarget:  "🎯 target < {target}",
    taskPoints:       "🏆 {points}/{possible}",
    photoCaptureLabel: "📸 Photo proof",
    takePhotoButton:   "📸 Take a photo",
    retakePhotoButton: "↺ Retake",
    pickPhotoButton:   "Or choose one from your photos",
    savePhotoButton:   "⬇️ Save to my Photos",
    photoRequiredNote: "📸 Take the photo first — no proof, no progress.",
    photoCaptureNote:  "Photos taken in here do NOT go to your camera roll on their own — tap \"Save to my Photos\" and choose Save Image to keep one. The app also keeps a small copy on this phone for the recap at the end; nothing is uploaded anywhere.",

    // solved screen
    solvedTick:       "✅",
    skippedTitle:     "Fine. Moving on.",
    skippedMessage:   "Nobody has to know. (The scoreboard knows.)",
    failTick:         "💀",
    failureTitle:     "Nope. That was your one shot.",
    nextButton:       "NEXT CLUE →",
    finishButton:     "FINISH →",
    solvedPoints:        "+{earned} pts  (of {possible})",
    solvedPointsSkipped: "0 pts — skipped (missed {possible})",
    solvedPointsFailed:  "0 pts — failed (missed {possible})",

    // finish screen
    finishKicker:     "🇭🇺 · Done · 🇭🇺",
    scoreFinalLabel:  "Final time",
    scoreRawLabel:    "On the clock",
    scorePenaltyLabel:"Penalties",
    scoreStopsLabel:  "Stops solved",
    scoreHintsLabel:  "Hints burned",
    scoreWrongLabel:  "Wrong guesses",
    scoreGirlsMetLabel:"Girls met",
    noPenalty:        "none 😤",
    recapSummary:     "The full route, in case anyone wants to argue about it",
    recapSolved:      " — solved ✅",
    recapSkipped:     " — skipped 🫠",
    recapFailed:      " — failed 💀",
    recapPoints:      " · {earned}/{possible} pts",
    resetButton:      "Reset the hunt (start over)",
    stagKicker:       "🦌 STAG SCORE",
    stagPoints:       "{earned} / {possible} pts  ({percent}%)",

    // final selfie screen (only shown if config.finalSelfie is set up)
    finalSelfieTitle:  "One last thing",
    finalSelfiePrompt: "Get the whole group in frame — this is the one that ends up in the wedding slideshow.",
    finalSelfiePhotoLabel: "📸 Group selfie",
    finalSelfieButton: "CONTINUE TO RESULTS →",
    thenNowTitle:      "🤳 Then & Now",
    thenNowFirstLabel: "The group, at the start",
    thenNowSelfieLabel:"The group, at the end",

    // hud
    hudProgress:      "Stop {n} of {total}",
    hudFinished:      "Finished · {total} stops"
  };

  /** Fill {token} placeholders from a values object. */
  function fillTokens(template, values) {
    return String(template == null ? "" : template).replace(/\{(\w+)\}/g, function (m, key) {
      return Object.prototype.hasOwnProperty.call(values || {}, key) ? values[key] : m;
    });
  }

  function resolveLabels(config) {
    var merged = {};
    Object.keys(DEFAULT_LABELS).forEach(function (k) { merged[k] = DEFAULT_LABELS[k]; });
    var custom = (config && config.labels) || {};
    Object.keys(custom).forEach(function (k) {
      // An empty string is a legitimate "hide this"; only undefined/null fall back.
      if (custom[k] != null) merged[k] = custom[k];
    });
    return merged;
  }

  var Logic = {
    normalize: normalize,
    canonical: canonical,
    isPlaceholderStop: isPlaceholderStop,
    usableAnswers: usableAnswers,
    stopType: stopType,
    typeNeedsAnswer: typeNeedsAnswer,
    hasTravelClue: hasTravelClue,
    pickerOptions: pickerOptions,
    subTasks: subTasks,
    subTaskDurationSeconds: subTaskDurationSeconds,
    stopIndexById: stopIndexById,
    isExcludedStop: isExcludedStop,
    effectiveStops: effectiveStops,
    TASK_TYPES: TASK_TYPES,
    DEFAULT_LABELS: DEFAULT_LABELS,
    resolveLabels: resolveLabels,
    fillTokens: fillTokens,
    checkAnswer: checkAnswer,
    formatTime: formatTime,
    countHints: countHints,
    countWrong: countWrong,
    penaltyMs: penaltyMs,
    elapsedMs: elapsedMs,
    isScoringEnabled: isScoringEnabled,
    isFinalSelfieEnabled: isFinalSelfieEnabled,
    isScoredStop: isScoredStop,
    shouldShowTimer: shouldShowTimer,
    wantsPhotoCapture: wantsPhotoCapture,
    isPhotoRequired: isPhotoRequired,
    resolveScoring: resolveScoring,
    computeStopPoints: computeStopPoints,
    stopPointsEarned: stopPointsEarned,
    totalPossiblePoints: totalPossiblePoints,
    totalEarnedPoints: totalEarnedPoints,
    stagLevelFor: stagLevelFor,
    DEFAULT_SCORING_EXPLAINER: DEFAULT_SCORING_EXPLAINER,
    resolveScoringExplainer: resolveScoringExplainer,
    DEFAULT_STAG_LEVELS: DEFAULT_STAG_LEVELS,
    freshState: freshState
  };

  function freshState() {
    return {
      v: 1,
      startedAt: null,
      finishedAt: null,
      stopIndex: 0,
      view: "travel",       // "travel" | "puzzle" | "solved"
      hintsUsed: {},        // { stopId: [hintIndex, ...] }
      wrong: {},            // { stopId: count }
      answers: {},          // { stopId: acceptedAnswerText }
      solved: [],           // [stopId]
      skipped: [],          // [stopId]
      failed: [],           // [stopId] — a "onetry" stop's wrong first (only) guess
      excludedStopIds: [],  // [stopId] — picker paths not taken this run
      puzzleStartedAt: {},  // { stopId: timestamp } — when the group reached this stop's puzzle screen
      puzzleElapsedMs: {},  // { stopId: ms } — frozen the moment it's solved or skipped
      msgIdx: { wrong: 0, correct: 0 },
      // Progress through a "sequence" stop's sub-tasks. Only ever describes
      // the CURRENT stop — reset the moment stopId no longer matches
      // wherever the group actually is (see paintSequenceStop()).
      sequence: null         // { stopId, index, startedAt } | null
    };
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = Logic;
  } else {
    global.HuntLogic = Logic;
  }

  /* Node (test harness) stops here — everything below needs a DOM. */
  if (typeof document === "undefined") return;

  /* admin.html also loads this file, but only wants the pure logic above.
   * If the game's markup isn't on the page, stop here. */
  if (!document.getElementById("screen-start")) return;

  /* ==========================================================================
   * PART 2 — THE APP
   * ======================================================================== */

  var $ = function (id) { return document.getElementById(id); };

  /* ---- content source ------------------------------------------------------
   * Normally the game plays whatever is in content.js. Opening the page as
   * index.html?preview=1 makes it play the editor's unsaved draft instead, and
   * keeps its progress under a separate storage key so a preview run can never
   * clobber the real game state. admin.html writes that draft. */

  var PREVIEW = /[?&]preview=1\b/.test(location.search);
  var DATA = HUNT;

  if (PREVIEW) {
    try {
      var draft = JSON.parse(localStorage.getItem("budapest-hunt-preview"));
      if (draft && draft.config && Array.isArray(draft.stops) && draft.stops.length) {
        DATA = draft;
      }
    } catch (e) { /* fall back to content.js */ }
    $("previewBanner").hidden = false;
  }

  var C = DATA.config;
  var STOPS = DATA.stops;
  var L = resolveLabels(C);
  var STORAGE_KEY = PREVIEW ? "budapest-hunt-preview-progress" : "budapest-hunt-v1";

  /** Shorthand: look up a label and fill its {tokens}. */
  function t(key, values) { return fillTokens(L[key], values || {}); }

  /* ---- theme ---------------------------------------------------------------
   * config.theme lets the whole look be recoloured from the editor without
   * touching CSS. Anything not set keeps the stylesheet's default. */

  (function applyTheme() {
    var theme = C.theme || {};
    var root = document.documentElement;
    var map = {
      accent: "--gold",
      accentDark: "--gold-dark",
      background: "--bg",
      card: "--bg-raised",
      text: "--text"
    };
    Object.keys(map).forEach(function (k) {
      if (theme[k]) root.style.setProperty(map[k], theme[k]);
    });
    if (theme.background) {
      var meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute("content", theme.background);
    }
  })();

  /* ---- state persistence -------------------------------------------------- */

  var state = load();

  function load() {
    var fresh = freshState();
    var raw;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) { raw = null; }
    if (!raw) return fresh;

    var saved;
    try { saved = JSON.parse(raw); } catch (e) { return fresh; }
    if (!saved || typeof saved !== "object") return fresh;

    // Merge onto a fresh object so a partially-written or older save can't
    // leave a field undefined, and clamp the index in case content.js was
    // edited (stops added/removed) between sessions.
    var merged = Object.assign(fresh, saved);
    merged.stopIndex = Math.max(0, Math.min(merged.stopIndex | 0, STOPS.length - 1));
    merged.hintsUsed = merged.hintsUsed || {};
    merged.wrong = merged.wrong || {};
    merged.answers = merged.answers || {};
    merged.solved = Array.isArray(merged.solved) ? merged.solved : [];
    merged.skipped = Array.isArray(merged.skipped) ? merged.skipped : [];
    merged.failed = Array.isArray(merged.failed) ? merged.failed : [];
    merged.excludedStopIds = Array.isArray(merged.excludedStopIds) ? merged.excludedStopIds : [];
    merged.puzzleStartedAt = merged.puzzleStartedAt || {};
    merged.puzzleElapsedMs = merged.puzzleElapsedMs || {};
    merged.msgIdx = merged.msgIdx || { wrong: 0, correct: 0 };
    merged.sequence = (merged.sequence && typeof merged.sequence === "object") ? merged.sequence : null;
    return merged;
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (e) { /* private browsing / quota — game still works, just not resumable */ }
  }

  /* ---- photo capture --------------------------------------------------------
   * Deliberately kept in its OWN localStorage key, separate from `state`.
   * Photos are the one thing in this app that can be large, and a save that
   * fails because of them must never be able to take the actual game
   * progress (stopIndex, solved, hints, timers) down with it. */

  var PHOTOS_KEY = STORAGE_KEY + "-photos";
  var photos = loadPhotos();     // { stopId: "data:image/jpeg;base64,..." }

  // Reserved key for the final-selfie screen's photo, in the same `photos`
  // map as every stop's. No real stop can ever have this id — content.js
  // ids come from user-typed slugs and this one starts with a double
  // underscore specifically so it can't collide.
  var FINAL_SELFIE_ID = "__finalSelfie";

  /**
   * The untouched File objects exactly as the camera handed them over, kept
   * in memory for this page-session only — never persisted, since a handful
   * of full-resolution phone photos would blow the localStorage quota
   * instantly. Used purely so "Save to Photos" can hand iOS the real
   * full-res shot rather than the downscaled preview copy. Lost on reload,
   * which is fine: saveToPhotos() falls back to the stored copy then.
   */
  var originalPhotoFiles = {};   // { stopId: File }

  function loadPhotos() {
    try {
      var parsed = JSON.parse(localStorage.getItem(PHOTOS_KEY));
      return (parsed && typeof parsed === "object") ? parsed : {};
    } catch (e) { return {}; }
  }

  /** @returns {boolean} whether the save actually succeeded. */
  function savePhotos() {
    try { localStorage.setItem(PHOTOS_KEY, JSON.stringify(photos)); return true; }
    catch (e) { return false; }   // most likely storage quota — see the caller
  }

  /**
   * Downscale a photo before storing it, so localStorage isn't handed a
   * multi-megabyte original.
   *
   * NOTE: this copy is the app's own preview/recap thumbnail. It is NOT a
   * throwaway duplicate of something already in the camera roll — a photo
   * taken through <input type=file capture> is handed straight to the page
   * and never written to the iOS Photos app at all. Getting it into the
   * album takes an explicit share (see saveToPhotos below).
   */
  function downscalePhoto(file) {
    return new Promise(function (resolve, reject) {
      if (!file || !/^image\//.test(file.type)) {
        reject(new Error("That doesn't look like an image."));
        return;
      }
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error("Couldn't read that photo.")); };
      reader.onload = function () {
        var img = new Image();
        img.onerror = function () {
          reject(new Error("Couldn't open that photo. If it's a HEIC file, try again — " +
                            "the camera capture button gives a JPEG directly."));
        };
        img.onload = function () {
          // 1000px/0.78 looks fine as a grid thumbnail AND holds up reasonably
          // when tapped open full-screen in the lightbox — 640px/0.6 (the old
          // numbers) was fine as a thumbnail but turned soft/blocky full-screen.
          // Still comfortably small per photo, so a handful of stops' worth
          // won't come close to blowing the ~5MB localStorage quota.
          var maxDim = 1000;
          var scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
          var w = Math.max(1, Math.round(img.naturalWidth * scale));
          var h = Math.max(1, Math.round(img.naturalHeight * scale));
          var canvas = document.createElement("canvas");
          canvas.width = w; canvas.height = h;
          canvas.getContext("2d").drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL("image/jpeg", 0.78));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  /** Rebuild a File from a stored data URI, for sharing after a page reload. */
  function dataUriToFile(uri, filename) {
    var parts = String(uri).split(",");
    var mimeMatch = /^data:([^;]+)/.exec(parts[0]);
    var mime = mimeMatch ? mimeMatch[1] : "image/jpeg";
    var binary = atob(parts[1]);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new File([bytes], filename, { type: mime });
  }

  /**
   * Get a stop's photo into the phone's actual photo album.
   *
   * There is no web API that can write to the iOS Photos app directly, and a
   * photo taken via <input type=file capture> is never auto-saved there —
   * Safari hands it to the page and drops it. The Web Share API is the only
   * real route: it opens the native share sheet, where "Save Image" files it
   * into Photos. Falls back to a plain download where sharing files isn't
   * supported (most desktop browsers), which at least gets it onto disk.
   *
   * Must be called straight from a tap — iOS requires transient user
   * activation for navigator.share.
   */
  function saveToPhotos(stop) {
    var file = originalPhotoFiles[stop.id];   // full-res, if still in memory
    if (!file) {
      var uri = photos[stop.id];              // else the downscaled copy
      if (!uri) return;
      try { file = dataUriToFile(uri, "hunt-photo.jpg"); }
      catch (e) { return; }
    }

    var name = (stop.name || stop.id || "photo").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    var shareFile = new File([file], name + ".jpg", { type: file.type || "image/jpeg" });

    if (navigator.canShare && navigator.canShare({ files: [shareFile] })) {
      navigator.share({ files: [shareFile] }).catch(function (err) {
        // AbortError just means they dismissed the sheet — not worth a message.
        if (err && err.name !== "AbortError") {
          setFeedback("Couldn't open the share sheet. Long-press the photo above " +
                      "and choose \"Add to Photos\" instead.", "bad");
        }
      });
      return;
    }

    // No file sharing available: download it instead.
    var url = URL.createObjectURL(shareFile);
    var a = document.createElement("a");
    a.href = url;
    a.download = shareFile.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  /* ---- small helpers ------------------------------------------------------ */

  function currentStop() { return STOPS[state.stopIndex]; }
  function isFinished() { return !!state.finishedAt; }

  /** The next stop index in play, skipping over any picker path not taken
   *  this run — or -1 if that was the last one. */
  function nextStopIndex(fromIndex) {
    for (var i = fromIndex + 1; i < STOPS.length; i++) {
      if (!isExcludedStop(STOPS[i], state)) return i;
    }
    return -1;
  }
  function isLastEffectiveStop(index) { return nextStopIndex(index) === -1; }

  /** { n, total } for "STOP n OF total" — counts only stops actually in
   *  play this run, same convention effectiveStops() uses everywhere else. */
  function effectiveProgress() {
    var eff = effectiveStops(STOPS, state);
    var rank = eff.indexOf(currentStop());
    return { n: (rank === -1 ? eff.length : rank + 1), total: eff.length };
  }

  function nextMessage(bucket, list) {
    var i = state.msgIdx[bucket] || 0;
    state.msgIdx[bucket] = (i + 1) % list.length;
    return list[i % list.length];
  }

  function screens() {
    return ["start", "travel", "puzzle", "solved", "failed", "selfie", "finish"];
  }

  function show(name) {
    screens().forEach(function (s) {
      var el = $("screen-" + s);
      if (el) el.hidden = (s !== name);
    });
    // No stop progress is relevant on the selfie screen — it isn't a stop.
    $("hud").hidden = (name === "start" || name === "selfie");
    window.scrollTo(0, 0);
  }

  /* ---- timer -------------------------------------------------------------- */

  var timerHandle = null;

  function paintTimer() {
    $("hudTimer").textContent = formatTime(elapsedMs(state, Date.now()));
  }

  /** One clock tick: the HUD's overall timer, plus the current stop's own
   *  timer when one is showing. Both are wall-clock based, so they read
   *  correctly the instant the page reopens — no separate resume logic. */
  function tick() {
    paintTimer();
    paintTaskTimer();
    paintTaskPoints();
    tickSequenceCountdown();
  }

  function startTimerLoop() {
    if (timerHandle) clearInterval(timerHandle);
    tick();
    if (state.startedAt == null || isFinished()) return;
    timerHandle = setInterval(tick, 1000);
  }

  // Re-sync the clock the moment the phone comes back from sleep / tab switch.
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) { tick(); requestWakeLock(); }
  });

  /* ---- keep the screen awake (best effort, silently ignored where absent) -- */

  var wakeLock = null;
  function requestWakeLock() {
    if (!("wakeLock" in navigator) || document.hidden || isFinished()) return;
    navigator.wakeLock.request("screen").then(function (lock) {
      wakeLock = lock;
      lock.addEventListener("release", function () { wakeLock = null; });
    }).catch(function () { /* not permitted — fine, the phone just dims */ });
  }

  /* ---- HUD ---------------------------------------------------------------- */

  function paintHud() {
    var vals = effectiveProgress();
    var done = isFinished() ? vals.total : vals.n - 1;
    $("hudProgress").textContent = isFinished() ? t("hudFinished", vals) : t("hudProgress", vals);
    $("hudBarFill").style.width = (done / vals.total * 100) + "%";
    paintTimer();
  }

  /* ==========================================================================
   * SCREEN: START
   * ======================================================================== */

  function paintStart() {
    document.title = C.title + " — Budapest";
    $("startTitle").textContent = C.title;
    $("startSubtitle").textContent = C.subtitle;
    // Hidden by default (see DEFAULT_LABELS) — only shows if an organiser
    // deliberately sets config.labels.startKicker to something.
    var kicker = t("startKicker");
    $("startKicker").textContent = kicker;
    $("startKicker").hidden = !kicker;
    $("howToTitle").textContent = t("howToTitle");
    var footnote = t("startFootnote");
    $("startFootnote").textContent = footnote;
    $("startFootnote").hidden = !footnote;

    setLabel("factGroom", "factGroom");
    setLabel("factStops", "factStops");
    setLabel("factDuration", "factDuration");
    setLabel("factDistance", "factDistance");

    $("factGroom").textContent = C.groomName;
    $("factStops").textContent = STOPS.length;
    $("factDuration").textContent = C.estimatedDuration;
    $("factDistance").textContent = C.estimatedDistance;

    paintFigure("start", C.startImage);

    var ul = $("howToList");
    ul.innerHTML = "";
    (C.howToPlay || []).forEach(function (line) {
      var li = document.createElement("li");
      li.textContent = line;
      ul.appendChild(li);
    });

    var costNote = C.hintPenaltyMinutes > 0
      ? t("hintCostNote", { min: C.hintPenaltyMinutes, skipMin: C.skipPenaltyMinutes })
      : t("hintCostNoteFree");
    $("hintCostNote").textContent = costNote;
    $("hintCostNote").hidden = !costNote;

    paintScoringExplainer();

    $("btnStart").textContent = C.startButtonLabel || "START";
  }

  /** The "🏆 How scoring works" card — explains the points/STAG system,
   *  which is a distinct layer on top of the minute-penalty stuff above.
   *  Setting the title label to "" hides the whole card, same convention
   *  as startKicker. */
  function paintScoringExplainer() {
    var card = $("scoringExplainerCard");
    if (!card) return;

    var title = t("scoringExplainerTitle");
    card.hidden = !title;
    if (!title) return;
    $("scoringExplainerTitle").textContent = title;

    var globalScoring = resolveScoring(C, {});
    var tokens = {
      target: formatTime(globalScoring.targetSeconds * 1000),
      totalPoints: totalPossiblePoints(STOPS, C)
    };

    var ul = $("scoringExplainerList");
    ul.innerHTML = "";
    resolveScoringExplainer(C).forEach(function (line) {
      var li = document.createElement("li");
      li.textContent = fillTokens(line, tokens);
      ul.appendChild(li);
    });
  }

  /** Set the small grey caption that sits before a .fact / .score value. */
  function setLabel(valueId, labelKey) {
    var span = $(valueId) && $(valueId).previousElementSibling;
    if (!span) return;
    if (span.classList.contains("fact-label") || span.classList.contains("score-label")) {
      span.textContent = t(labelKey);
    }
  }

  /* ==========================================================================
   * SCREEN: TRAVEL CLUE
   * ======================================================================== */

  function paintTravel() {
    var stop = currentStop();
    $("travelStopNum").textContent = t("hudProgress", effectiveProgress());
    $("travelTeaser").textContent = stop.teaser || "";
    $("travelEyebrow").textContent = stop.travelEyebrow || t("travelEyebrow");
    $("travelClue").textContent = stop.travelClue || "";
    // Per-stop overrides, e.g. "WE FOUND IT →" on one particular stop, or a
    // different footnote when the stop doesn't need the usual "stand there
    // first" reminder (an indoor puzzle, say).
    $("travelFootnote").textContent = stop.travelFootnote || t("travelFootnote");
    $("btnArrived").textContent = stop.arrivedButton || t("arrivedButton");
    paintFigure("travel", stop.travelImage);
    paintHud();
  }

  /**
   * Show or hide a stop's photo. `image` is either absent, or
   * { src: "<data-uri or relative path>", caption: "<optional>" }.
   * A bare string is accepted too, for anyone hand-editing content.js.
   */
  function paintFigure(which, image) {
    var fig = $(which + "Figure");
    var img = $(which + "Image");
    var cap = $(which + "Caption");

    var src = typeof image === "string" ? image : (image && image.src);
    if (!src) {
      fig.hidden = true;
      img.removeAttribute("src");
      return;
    }
    img.src = src;
    var caption = (image && image.caption) || "";
    cap.textContent = caption;
    cap.hidden = !caption;
    fig.hidden = false;
  }

  /* ==========================================================================
   * SCREEN: PUZZLE
   * ======================================================================== */

  function paintPuzzle() {
    var stop = currentStop();
    var type = stopType(stop);

    $("puzzleStopNum").textContent = t("hudProgress", effectiveProgress());
    $("puzzleName").textContent = stop.name || stop.teaser || "";
    $("arrivalNote").textContent = stop.arrivalNote || "";
    $("arrivalNote").hidden = !stop.arrivalNote;
    $("puzzleEyebrow").textContent = stop.puzzleEyebrow || t("puzzleEyebrow");
    $("puzzleText").textContent = stop.puzzle || "";
    $("btnBackToClue").textContent = t("backToClue");
    $("btnBackToClue").hidden = !hasTravelClue(stop);
    paintFigure("puzzle", stop.puzzleImage);

    $("placeholderBadge").textContent = t("placeholderBadge");
    $("placeholderBadge").hidden = !isPlaceholderStop(stop);

    // Start (once) this stop's own clock. Re-entering the puzzle screen —
    // e.g. after tapping back to re-read the travel clue — must NOT reset it.
    // Runs whenever the timer WOULD show OR the stop is scored — timer
    // visibility and scoring are independent settings, and a scored stop
    // needs a start time to compute real points from even if its clock is
    // hidden. Skipping this for an unscored, timer-off stop just avoids
    // storing a start time nobody will ever read.
    if ((shouldShowTimer(stop) || isScoredStop(stop)) && state.puzzleStartedAt[stop.id] == null) {
      state.puzzleStartedAt[stop.id] = Date.now();
      save();
    }

    paintAnswerUI(stop, type);
    paintPhotoCapture(stop);
    // Must run after BOTH of the above: it disables controls that
    // paintAnswerUI creates, based on the photo state paintPhotoCapture drew.
    applyPhotoGate(stop);
    setFeedback("", "");
    paintHints();
    paintSkip();
    paintTaskTimer();
    paintTaskPoints();
    paintHud();
  }

  /**
   * Lock every "move on" control until this stop's required photo exists.
   *
   * Covers all three answer mechanisms, since photo capture can be turned on
   * for any task type — the dare/info confirm button, the text Submit, and
   * each multiple-choice option. Always runs, including when no photo is
   * required, so controls can never stay stuck disabled from a previous stop.
   */
  function applyPhotoGate(stop) {
    var locked = isPhotoRequired(stop) && !photos[stop.id];

    var note = $("photoGateNote");
    if (note) {
      note.textContent = t("photoRequiredNote");
      note.hidden = !locked;
    }

    var controls = [$("btnConfirmDone"), $("btnSubmit")];
    var choices = document.querySelectorAll("#choiceButtons .btn-choice, #pickerButtons .btn-picker");
    for (var i = 0; i < choices.length; i++) controls.push(choices[i]);

    controls.forEach(function (el) {
      if (!el) return;
      el.disabled = locked;
      el.classList.toggle("btn-locked", locked);
    });
  }

  /** The optional "take a photo" control. See wantsPhotoCapture(). */
  function paintPhotoCapture(stop) {
    var box = $("photoCapture");
    if (!box) return;

    if (!wantsPhotoCapture(stop)) { box.hidden = true; return; }
    box.hidden = false;

    $("photoCaptureLabel").textContent = stop.photoCaptureLabel || t("photoCaptureLabel");
    $("photoCaptureNote").textContent = t("photoCaptureNote");

    var uri = photos[stop.id];
    $("photoCaptureEmpty").hidden = !!uri;
    $("photoCapturePreview").hidden = !uri;
    if (uri) $("photoCaptureImg").src = uri;

    $("btnTakePhoto").textContent = stop.takePhotoButton || t("takePhotoButton");
    $("btnRetakePhoto").textContent = t("retakePhotoButton");
    $("btnPickPhoto").textContent = t("pickPhotoButton");
    $("btnSavePhoto").textContent = t("savePhotoButton");
  }

  /** The live per-stop clock shown on the puzzle screen. Shown or hidden per
   *  shouldShowTimer() — independent of whether the stop is scored. */
  function paintTaskTimer() {
    var box = $("taskTimer");
    if (!box) return;
    var stop = currentStop();

    if (state.view !== "puzzle" || isFinished() || !shouldShowTimer(stop)) {
      box.hidden = true;
      return;
    }
    var startedAt = state.puzzleStartedAt[stop.id];
    if (startedAt == null) { box.hidden = true; return; }

    var scoring = resolveScoring(C, stop);
    var elapsedMsVal = Date.now() - startedAt;
    var elapsedSec = elapsedMsVal / 1000;

    box.hidden = false;
    $("taskTimerValue").textContent = formatTime(elapsedMsVal);
    $("taskTimerTarget").textContent = t("taskTimerTarget", { target: formatTime(scoring.targetSeconds * 1000) });
    box.classList.toggle("task-timer-warn",
      elapsedSec > scoring.targetSeconds && elapsedSec <= scoring.targetSeconds + scoring.decayWindowSeconds);
    box.classList.toggle("task-timer-bad",
      elapsedSec > scoring.targetSeconds + scoring.decayWindowSeconds);
  }

  /**
   * Live "if you solved it right now" points preview. Shown whenever the
   * stop is scored — independent of whether its visual clock is on — so
   * hint and time penalties are visible as they land instead of being a
   * surprise on the solved screen.
   */
  function paintTaskPoints() {
    var box = $("taskPoints");
    if (!box) return;
    var stop = currentStop();

    if (state.view !== "puzzle" || isFinished() || !isScoredStop(stop)) {
      box.hidden = true;
      return;
    }
    var startedAt = state.puzzleStartedAt[stop.id];
    if (startedAt == null) { box.hidden = true; return; }

    var scoring = resolveScoring(C, stop);
    var elapsedSec = (Date.now() - startedAt) / 1000;
    var hintCount = (state.hintsUsed[stop.id] || []).length;
    var wrongCount = state.wrong[stop.id] || 0;
    var points = computeStopPoints(stop, C, elapsedSec, hintCount, false, wrongCount);

    box.hidden = false;
    box.textContent = t("taskPoints", { points: points, possible: scoring.basePoints });
    // Same thresholds paintTaskTimer uses, so the two chips never disagree.
    box.classList.toggle("task-points-warn",
      elapsedSec > scoring.targetSeconds && elapsedSec <= scoring.targetSeconds + scoring.decayWindowSeconds);
    box.classList.toggle("task-points-bad",
      elapsedSec > scoring.targetSeconds + scoring.decayWindowSeconds);
  }

  /** Show whichever answer control this stop's type calls for, hide the rest. */
  function paintAnswerUI(stop, type) {
    $("answerForm").hidden = true;
    $("choiceZone").hidden = true;
    $("btnConfirmDone").hidden = true;
    $("pickerZone").hidden = true;
    $("sequenceZone").hidden = true;

    if (type === "text") {
      $("answerLabel").textContent = stop.answerLabel || t("answerLabel");
      $("answerInput").placeholder = stop.answerPlaceholder || t("answerPlaceholder");
      $("answerInput").value = "";
      $("answerInput").classList.remove("shake");
      $("btnSubmit").textContent = stop.submitButton || t("submitButton");
      $("answerForm").hidden = false;

    } else if (type === "choice" || type === "onetry") {
      $("choiceLabel").textContent = stop.answerLabel ||
        (type === "onetry" ? t("onetryLabel") : t("choiceLabel"));
      var box = $("choiceButtons");
      box.innerHTML = "";
      // Skip unfilled rows so a half-written stop doesn't render blank buttons.
      (stop.choices || []).filter(function (c) { return String(c).trim(); })
                          .forEach(function (choice) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn btn-choice";
        btn.textContent = choice;
        // "choice" lets you retry a wrong tap; "onetry" fails outright —
        // there's no second option here, so no shakeEl either.
        btn.addEventListener("click", type === "onetry"
          ? function () { submitOneTry(choice); }
          : function () { submitValue(choice, btn); });
        box.appendChild(btn);
      });
      $("choiceZone").hidden = false;

    } else if (type === "picker") {
      $("pickerLabel").textContent = stop.answerLabel || t("pickerLabel");
      var pbox = $("pickerButtons");
      pbox.innerHTML = "";
      pickerOptions(stop)
        .filter(function (opt) { return opt && String(opt.label || "").trim() && opt.targetStopId; })
        .forEach(function (opt) {
          var btn = document.createElement("button");
          btn.type = "button";
          btn.className = "btn btn-picker" + (opt.animated ? " btn-picker-animated" : "");
          if (opt.color) btn.style.setProperty("--picker-color", opt.color);

          var label = document.createElement("span");
          label.className = "picker-option-label";
          label.textContent = opt.label;
          btn.appendChild(label);

          if (opt.description) {
            var desc = document.createElement("span");
            desc.className = "picker-option-desc";
            desc.textContent = opt.description;
            btn.appendChild(desc);
          }

          btn.addEventListener("click", function () { choosePickerOption(stop, opt); });
          pbox.appendChild(btn);
        });
      $("pickerZone").hidden = false;

    } else if (type === "sequence") {
      $("sequenceZone").hidden = false;
      paintSequenceStop(stop);

    } else {
      // dare / info — one button, nothing to get wrong.
      $("btnConfirmDone").textContent = stop.confirmButton ||
        (type === "dare" ? t("dareButton") : t("infoButton"));
      $("btnConfirmDone").hidden = false;
    }
  }

  /* ==========================================================================
   * "sequence" — several timed sub-tasks in a row, purely passive: no
   * button, no answer. Each one counts down on its own; hitting 0 auto-
   * advances to the next, and the last one finishing solves the stop.
   * ======================================================================== */

  /**
   * Entered every time paintPuzzle() lands on a "sequence" stop. Starts
   * fresh at sub-task 0 the moment the group arrives here for the first
   * time (or arrives at a DIFFERENT sequence stop); does nothing if
   * they're just re-rendering the same in-progress sequence (e.g. after
   * tapping back to re-read the travel clue, or resuming after a reload —
   * state.sequence.startedAt is wall-clock based, so the countdown picks up
   * from the real elapsed time either way).
   */
  function paintSequenceStop(stop) {
    if (!state.sequence || state.sequence.stopId !== stop.id) {
      state.sequence = { stopId: stop.id, index: 0, startedAt: Date.now() };
      save();
    }
    renderCurrentSubTask();
  }

  function renderCurrentSubTask() {
    var stop = currentStop();
    var subs = subTasks(stop);
    var sub = subs[state.sequence.index];
    if (!sub) return;   // malformed content — nothing sane to render

    $("sequenceSubEyebrow").textContent =
      t("sequenceSubProgress", { n: state.sequence.index + 1, total: subs.length });
    $("sequenceSubLabel").textContent = sub.label || "";
    $("sequenceSubInstructions").textContent = sub.instructions || "";
    paintFigure("sequenceSub", sub.image);
    tickSequenceCountdown();
  }

  /**
   * Runs on every global tick (see tick() below) while a "sequence" stop is
   * showing. Wall-clock based like every other timer in this app, so it
   * reads correctly the instant the page reopens — including catching up
   * through any sub-tasks that fully expired while the tab was closed or
   * backgrounded (advanceSubTask() re-renders, which calls straight back
   * into this function; recursion depth is bounded by subs.length).
   */
  function tickSequenceCountdown() {
    if (state.view !== "puzzle") return;
    var stop = currentStop();
    if (stopType(stop) !== "sequence") return;
    if (!state.sequence || state.sequence.stopId !== stop.id) return;

    var sub = subTasks(stop)[state.sequence.index];
    if (!sub) return;

    var durationMs = subTaskDurationSeconds(sub) * 1000;
    var remaining = Math.max(0, durationMs - (Date.now() - state.sequence.startedAt));

    var box = $("sequenceCountdown");
    if (box) box.textContent = formatTime(remaining);

    if (remaining <= 0) advanceSubTask();
  }

  /** A sub-task's clock hit 0: move to the next one, or — if that was the
   *  last — solve the whole stop, exactly like any other stop finishing. */
  function advanceSubTask() {
    var stop = currentStop();
    var subs = subTasks(stop);
    var nextIndex = state.sequence.index + 1;

    if (nextIndex >= subs.length) {
      if (state.solved.indexOf(stop.id) === -1) state.solved.push(stop.id);
      recordTaskElapsed(stop);
      state.sequence = null;
      save();
      goSolved();
      return;
    }

    state.sequence.index = nextIndex;
    state.sequence.startedAt = Date.now();
    save();
    renderCurrentSubTask();
  }

  function paintHints() {
    var stop = currentStop();
    var used = state.hintsUsed[stop.id] || [];
    var zone = $("hintZone");
    zone.innerHTML = "";

    var hasHints = !!(stop.hints && stop.hints.length);
    $("hintZoneLabel").textContent = t("hintZoneLabel");
    $("hintZoneLabel").hidden = !hasHints;

    (stop.hints || []).forEach(function (text, i) {
      if (used.indexOf(i) !== -1) {
        var div = document.createElement("div");
        div.className = "hint-revealed";
        var tag = document.createElement("span");
        tag.className = "hint-tag";
        tag.textContent = t("hintTag", { n: i + 1 });
        var body = document.createElement("span");
        body.textContent = text;
        div.appendChild(tag);
        div.appendChild(body);
        zone.appendChild(div);
      } else if (i > used.length) {
        // Not next in line yet — shown so the group knows it exists, but
        // locked until every earlier hint has been revealed first.
        var locked = document.createElement("button");
        locked.type = "button";
        locked.className = "hint-btn hint-btn-locked";
        locked.disabled = true;
        locked.title = t("hintLockedTitle");
        locked.textContent = t("hintButtonLocked", { n: i + 1 });
        zone.appendChild(locked);
      } else {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "hint-btn";
        var scored = isScoringEnabled(C) && isScoredStop(stop);
        var hintCost = scored ? resolveScoring(C, stop).hintPointPenalty : 0;
        if (C.hintPenaltyMinutes > 0 && scored) {
          btn.textContent = t("hintButtonScored", { n: i + 1, min: C.hintPenaltyMinutes, pts: hintCost });
        } else if (C.hintPenaltyMinutes > 0) {
          btn.textContent = t("hintButton", { n: i + 1, min: C.hintPenaltyMinutes });
        } else if (scored) {
          btn.textContent = t("hintButtonFreeScored", { n: i + 1, pts: hintCost });
        } else {
          btn.textContent = t("hintButtonFree", { n: i + 1 });
        }
        btn.addEventListener("click", function () {
          var list = state.hintsUsed[stop.id] || (state.hintsUsed[stop.id] = []);
          if (list.indexOf(i) === -1) list.push(i);
          save();
          paintHints();
          paintSkip();
          paintTaskPoints();   // the penalty should land the instant it's incurred
        });
        zone.appendChild(btn);
      }
    });
  }

  /**
   * The escape hatch. Only appears once the group has revealed every hint on
   * this stop AND been wrong `skipAfterWrongAnswers` times — so it can never
   * be stumbled into, but nobody ends the night stuck on a puzzle because a
   * statue got moved.
   */
  function paintSkip() {
    var stop = currentStop();
    var used = (state.hintsUsed[stop.id] || []).length;
    var totalHints = (stop.hints || []).length;
    var wrong = state.wrong[stop.id] || 0;
    // dare/info/picker stops can't be failed, so they never need an escape
    // hatch — and a "onetry" stop is already resolved (solved or failed) the
    // instant a wrong tap lands, so it never lingers long enough to need one.
    var eligible = typeNeedsAnswer(stopType(stop)) && stopType(stop) !== "onetry" &&
                   used >= totalHints && wrong >= (C.skipAfterWrongAnswers || 4);

    var btn = $("btnSkip");
    btn.hidden = !eligible;
    btn.textContent = t("skipButton", { min: C.skipPenaltyMinutes });
  }

  function setFeedback(text, kind) {
    var el = $("feedback");
    el.textContent = text;
    el.className = "feedback" + (kind ? " " + kind : "");
  }

  /* ==========================================================================
   * ANSWER SUBMISSION
   * ======================================================================== */

  function submitAnswer(e) {
    if (e) e.preventDefault();
    submitValue($("answerInput").value, $("answerInput"));
  }

  /**
   * Shared by the text box, the multiple-choice buttons and the dare/info
   * confirm button. `shakeEl` is whatever should wobble on a wrong answer.
   */
  function submitValue(raw, shakeEl) {
    var stop = currentStop();

    // Hard gate, not just a greyed-out button: a text stop can still be
    // submitted with the keyboard's Enter/Go key, which bypasses the disabled
    // state on the Submit button entirely.
    if (isPhotoRequired(stop) && !photos[stop.id]) {
      setFeedback(t("photoRequiredNote"), "bad");
      return;
    }

    var result = checkAnswer(stop, raw);

    if (result.empty) {
      setFeedback(t("emptyAnswer"), "bad");
      return;
    }

    if (result.ok) {
      state.answers[stop.id] = String(raw).trim();
      if (state.solved.indexOf(stop.id) === -1) state.solved.push(stop.id);
      recordTaskElapsed(stop);
      save();
      if ($("answerInput")) $("answerInput").blur();
      // Info stops are pure waypoints — nothing was "solved", so no
      // celebration screen. Straight on to whatever's next.
      if (stopType(stop) === "info") { advance(); return; }
      goSolved();
      return;
    }

    state.wrong[stop.id] = (state.wrong[stop.id] || 0) + 1;
    save();
    setFeedback(nextMessage("wrong", C.wrongAnswerMessages), "bad");
    if (shakeEl) {
      shakeEl.classList.remove("shake");
      void shakeEl.offsetWidth;         // restart the animation
      shakeEl.classList.add("shake");
      if (shakeEl.select) shakeEl.select();
    }
    paintSkip();
    paintTaskPoints();   // the penalty should land the instant it's incurred
  }

  /**
   * "onetry" stops: no retry, no shake-and-try-again. A correct tap works
   * exactly like a normal choice stop; a wrong one is an outright fail —
   * straight to the failure screen, no second guess.
   */
  function submitOneTry(raw) {
    var stop = currentStop();

    if (isPhotoRequired(stop) && !photos[stop.id]) {
      setFeedback(t("photoRequiredNote"), "bad");
      return;
    }

    var result = checkAnswer(stop, raw);
    state.answers[stop.id] = String(raw).trim();

    if (result.ok) {
      if (state.solved.indexOf(stop.id) === -1) state.solved.push(stop.id);
      recordTaskElapsed(stop);
      save();
      goSolved();
      return;
    }

    // Wrong on the only try this stop allows: failed, not "try again".
    state.wrong[stop.id] = (state.wrong[stop.id] || 0) + 1;
    if (state.failed.indexOf(stop.id) === -1) state.failed.push(stop.id);
    recordTaskElapsed(stop);
    save();
    goFailed();
  }

  function skipStop() {
    var stop = currentStop();
    if (state.skipped.indexOf(stop.id) === -1) state.skipped.push(stop.id);
    recordTaskElapsed(stop);
    save();
    goSolved(true);
  }

  /** Freeze this stop's task-timer reading the moment it's solved or skipped,
   *  so revisiting the solved screen later (e.g. after a reload) always shows
   *  the same number instead of one that kept climbing in the background. */
  function recordTaskElapsed(stop) {
    var startedAt = state.puzzleStartedAt[stop.id];
    if (startedAt != null && state.puzzleElapsedMs[stop.id] == null) {
      state.puzzleElapsedMs[stop.id] = Date.now() - startedAt;
    }
  }

  /* ==========================================================================
   * NAVIGATION
   * ======================================================================== */

  function goStart() { state.view = "start"; paintStart(); show("start"); }

  function goTravel() {
    // On-site puzzles skip the travel screen entirely — nothing to walk to.
    if (!hasTravelClue(currentStop())) { goPuzzle(); return; }
    state.view = "travel"; save(); requestWakeLock();
    paintTravel(); show("travel");
  }

  function goPuzzle() {
    state.view = "puzzle"; save(); requestWakeLock();
    paintPuzzle(); show("puzzle");
  }

  function goSolved(skippedParam) {
    state.view = "solved"; save();
    var stop = currentStop();
    // Derive from state too, not just the caller's flag — resuming straight
    // onto this screen after a reload calls goSolved() with no argument.
    var skipped = !!skippedParam || state.skipped.indexOf(stop.id) !== -1;

    $("solvedTick").textContent = stop.solvedTick || t("solvedTick");
    $("solvedTitle").textContent = skipped
      ? t("skippedTitle")
      : (stop.solvedTitle || nextMessage("correct", C.correctAnswerMessages));

    var body = stop.successMessage || "";
    $("solvedMessage").textContent = skipped
      ? (t("skippedMessage") + (body ? "\n\n" + body : ""))
      : body;
    $("solvedCard").hidden = !$("solvedMessage").textContent;

    // Only show the celebration photo when they actually earned it.
    paintFigure("success", skipped ? null : stop.successImage);
    paintPointsBadge("solvedPoints", stop, skipped ? "skipped" : "solved");

    $("btnNext").textContent = isLastEffectiveStop(state.stopIndex)
      ? (stop.nextButton || t("finishButton"))
      : (stop.nextButton || t("nextButton"));
    paintHud();
    show("solved");
  }

  /**
   * The failure screen: a "onetry" stop's wrong (and only) guess. No retry
   * button here — same as the solved screen, tapping through just calls
   * advance() and moves on to whatever's next.
   */
  function goFailed() {
    state.view = "failed"; save();
    var stop = currentStop();

    $("failedTick").textContent = stop.failTick || t("failTick");
    $("failedTitle").textContent = stop.failureTitle || t("failureTitle");

    var body = stop.failureMessage || "";
    $("failedMessage").textContent = body;
    $("failedCard").hidden = !body;

    paintFigure("failure", stop.failureImage);
    paintPointsBadge("failedPoints", stop, "failed");

    $("btnFailedNext").textContent = isLastEffectiveStop(state.stopIndex)
      ? (stop.nextButton || t("finishButton"))
      : (stop.nextButton || t("nextButton"));
    paintHud();
    show("failed");
  }

  /**
   * The "+82 pts (of 100)" badge — shared by the solved screen (mode
   * "solved" or "skipped") and the failure screen (mode "failed"). A failed
   * "onetry" stop always earns 0, same visual treatment as a skip.
   */
  function paintPointsBadge(badgeId, stop, mode) {
    var badge = $(badgeId);
    if (!badge) return;
    if (!isScoringEnabled(C) || !isScoredStop(stop)) { badge.hidden = true; return; }

    var p = stopPointsEarned(stop, state, C);
    if (!p || !p.reached) { badge.hidden = true; return; }

    badge.hidden = false;
    badge.className = "points-badge" +
      (mode !== "solved" ? " points-badge-skipped" : p.earned >= p.possible ? " points-badge-full" : "");
    badge.textContent = mode === "failed"
      ? t("solvedPointsFailed", { possible: p.possible })
      : mode === "skipped"
      ? t("solvedPointsSkipped", { possible: p.possible })
      : t("solvedPoints", { earned: p.earned, possible: p.possible });
  }

  function advance() {
    var next = nextStopIndex(state.stopIndex);
    if (next === -1) {
      // The selfie screen (if switched on) sits between the last stop and
      // the finish screen — it isn't a stop itself, so it doesn't touch
      // stopIndex, just state.view.
      if (isFinalSelfieEnabled(C)) { goSelfie(); return; }
      finishGame();
      return;
    }
    state.stopIndex = next;
    goTravel();
  }

  /**
   * A "picker" stop's option was tapped: jump straight to that option's
   * target stop, and make sure every *other* option's target is excluded
   * from the rest of this run — only one path through a picker is ever
   * played in one playthrough (see effectiveStops()/isExcludedStop() above).
   *
   * No "correct!" interstitial — there's nothing to get right, just a
   * choice — so this goes straight to the target's travel/puzzle screen.
   */
  function choosePickerOption(stop, chosen) {
    var targetIndex = stopIndexById(STOPS, chosen && chosen.targetStopId);
    if (targetIndex === -1) return;   // misconfigured stop — nothing to jump to

    pickerOptions(stop).forEach(function (opt) {
      if (opt === chosen || !opt.targetStopId) return;
      if (state.excludedStopIds.indexOf(opt.targetStopId) === -1) {
        state.excludedStopIds.push(opt.targetStopId);
      }
    });

    if (state.solved.indexOf(stop.id) === -1) state.solved.push(stop.id);
    recordTaskElapsed(stop);
    state.stopIndex = targetIndex;
    save();
    goTravel();
  }

  /** Stop the clocks and show the results. The one and only way the run
   *  actually ends, whether or not a selfie screen came first. */
  function finishGame() {
    state.finishedAt = Date.now();
    save();
    if (timerHandle) clearInterval(timerHandle);
    if (wakeLock) { try { wakeLock.release(); } catch (e) {} }
    goFinish();
  }

  function goSelfie() {
    state.view = "selfie"; save();
    paintSelfieScreen();
    show("selfie");
  }

  /** The one-off "take a group selfie" screen. Reuses downscalePhoto/
   *  photos/savePhotos/saveToPhotos exactly like a stop's photo capture
   *  does, under the reserved key FINAL_SELFIE_ID so it can never collide
   *  with a real stop id. */
  function paintSelfieScreen() {
    $("selfieTitle").textContent = t("finalSelfieTitle");
    $("selfiePrompt").textContent = t("finalSelfiePrompt");
    $("selfiePhotoCaptureLabel").textContent = t("finalSelfiePhotoLabel");
    $("selfiePhotoCaptureNote").textContent = t("photoCaptureNote");
    $("btnTakeSelfie").textContent = t("takePhotoButton");
    $("btnRetakeSelfie").textContent = t("retakePhotoButton");
    $("btnPickSelfie").textContent = t("pickPhotoButton");
    $("btnSaveSelfie").textContent = t("savePhotoButton");

    var uri = photos[FINAL_SELFIE_ID];
    $("selfiePhotoCaptureEmpty").hidden = !!uri;
    $("selfiePhotoCapturePreview").hidden = !uri;
    if (uri) $("selfiePhotoCaptureImg").src = uri;

    var locked = !uri;
    var btn = $("btnSelfieContinue");
    btn.disabled = locked;
    btn.classList.toggle("btn-locked", locked);
    btn.textContent = t("finalSelfieButton");
    $("selfieGateNote").textContent = t("photoRequiredNote");
    $("selfieGateNote").hidden = !locked;
  }

  /* ==========================================================================
   * SCREEN: FINISH
   * ======================================================================== */

  function paintFinish() {
    var raw = elapsedMs(state, Date.now());
    var pen = penaltyMs(state, C);

    $("finishTitle").textContent = C.finishTitle;
    $("finishKicker").textContent = t("finishKicker");
    $("scoreFinal").textContent = formatTime(raw + pen);
    $("scoreRaw").textContent = formatTime(raw);
    $("scorePenalty").textContent = pen > 0 ? "+" + formatTime(pen) : t("noPenalty");
    $("scoreStops").textContent = state.solved.length + "/" + effectiveStops(STOPS, state).length;
    $("scoreHints").textContent = countHints(state);
    $("scoreWrong").textContent = countWrong(state);
    // Not tracked by the game — a manual, joke stat the organiser sets once
    // in Game settings (defaults to 0, same as everyone starts the night).
    $("scoreGirlsMet").textContent = numberOr(C.girlsMet, 0);

    setLabel("scoreFinal", "scoreFinalLabel");
    setLabel("scoreRaw", "scoreRawLabel");
    setLabel("scorePenalty", "scorePenaltyLabel");
    setLabel("scoreStops", "scoreStopsLabel");
    setLabel("scoreHints", "scoreHintsLabel");
    setLabel("scoreWrong", "scoreWrongLabel");
    setLabel("scoreGirlsMet", "scoreGirlsMetLabel");

    paintFigure("finish", C.finishImage);
    paintStagCard();
    paintThenNow();

    var blurb = $("finishBlurb");
    blurb.textContent = (C.finishBlurb || []).join("\n\n");
    $("recapSummary").textContent = t("recapSummary");
    $("btnReset").textContent = t("resetButton");

    var ol = $("recapList");
    ol.innerHTML = "";
    // Picker paths not taken this run never happened — leave them off the
    // route recap entirely rather than listing them as "skipped".
    effectiveStops(STOPS, state).forEach(function (stop) {
      var li = document.createElement("li");
      var mark = state.failed.indexOf(stop.id) !== -1 ? t("recapFailed")
               : state.skipped.indexOf(stop.id) !== -1 ? t("recapSkipped")
               : state.solved.indexOf(stop.id) !== -1 ? t("recapSolved")
               : "";
      var pts = "";
      if (isScoringEnabled(C)) {
        var p = stopPointsEarned(stop, state, C);
        if (p && p.reached) pts = t("recapPoints", { earned: p.earned, possible: p.possible });
      }
      li.textContent = (stop.name || stop.id) + mark + pts;
      ol.appendChild(li);
    });

    paintHud();
  }

  /**
   * The "🤳 Then & Now" comparison: the final selfie paired with the
   * earliest photo taken during the hunt (first match in stop order).
   * Hidden entirely if no selfie was taken (screen switched off, or a group
   * that closed the tab before reaching it — resuming lands them on the
   * selfie screen itself, not skips past it). Degrades to just the selfie
   * alone if no stop photo exists to pair it with.
   */
  function paintThenNow() {
    var card = $("thenNowCard");
    if (!card) return;

    var selfieUri = photos[FINAL_SELFIE_ID];
    if (!selfieUri) { card.hidden = true; return; }

    var firstStop = null;
    for (var i = 0; i < STOPS.length; i++) {
      if (photos[STOPS[i].id]) { firstStop = STOPS[i]; break; }
    }

    card.hidden = false;
    $("thenNowTitle").textContent = t("thenNowTitle");

    var grid = $("thenNowGrid");
    grid.innerHTML = "";
    if (firstStop) {
      grid.appendChild(thenNowFigure(photos[firstStop.id],
        t("thenNowFirstLabel", { name: firstStop.name || firstStop.id }), firstStop.id));
    }
    grid.appendChild(thenNowFigure(selfieUri, t("thenNowSelfieLabel"), FINAL_SELFIE_ID));
  }

  function thenNowFigure(uri, caption, photoId) {
    var fig = document.createElement("figure");
    var img = document.createElement("img");
    img.src = uri;
    img.alt = caption;
    img.addEventListener("click", function () {
      openLightbox(fullResPhotoUrl(photoId) || this.src);
    });
    var figcap = document.createElement("figcaption");
    figcap.textContent = caption;
    fig.appendChild(img);
    fig.appendChild(figcap);
    return fig;
  }

  /** The "🦌 STAG SCORE" card: total points, percentage and the earned level. */
  function paintStagCard() {
    var card = $("stagCard");
    if (!card) return;
    if (!isScoringEnabled(C)) { card.hidden = true; return; }

    var eff = effectiveStops(STOPS, state);
    var possible = totalPossiblePoints(eff, C);
    var earned = totalEarnedPoints(state, eff, C);
    var percent = possible > 0 ? Math.round((earned / possible) * 100) : 0;
    var level = stagLevelFor(percent, C.stagLevels);

    card.hidden = false;
    $("stagKicker").textContent = t("stagKicker");
    $("stagLevelName").textContent = level.name;
    $("stagPointsValue").textContent = t("stagPoints", { earned: earned, possible: possible, percent: percent });
    $("stagBarFill").style.width = Math.max(0, Math.min(100, percent)) + "%";
    $("stagBlurb").textContent = level.blurb;
  }

  function goFinish() { state.view = "finish"; save(); paintFinish(); show("finish"); }

  /* ==========================================================================
   * WIRING
   * ======================================================================== */

  function beginFreshRun() {
    state = freshState();
    state.startedAt = Date.now();
    save();
    requestWakeLock();
    startTimerLoop();
    goTravel();
  }

  $("btnStart").addEventListener("click", beginFreshRun);

  // The ⟲ in the HUD — the only way to abandon a run in progress.
  // Double-confirmed on purpose: an accidental tap here would be a disaster.
  $("btnHudReset").addEventListener("click", function () {
    if (!confirm("Abandon this run and start over from Stop 1?\n\nThe clock resets too.")) return;
    if (!confirm("Really? Everything goes. Last chance.")) return;
    try { localStorage.removeItem(STORAGE_KEY); localStorage.removeItem(PHOTOS_KEY); } catch (e) {}
    state = freshState();
    photos = {};
    if (timerHandle) clearInterval(timerHandle);
    goStart();
  });

  /* ---- photo lightbox ----------------------------------------------------- */

  /**
   * Prefer the full-res original still sitting in memory (see
   * originalPhotoFiles above) over the downscaled copy that's actually
   * displayed — same-session viewing gets full quality for free; after a
   * reload this just returns null and the caller falls back to the
   * downscaled src that's on screen already.
   */
  function fullResPhotoUrl(photoId) {
    var file = photoId && originalPhotoFiles[photoId];
    return file ? URL.createObjectURL(file) : null;
  }

  function openLightbox(src) {
    $("lightboxImage").src = src;
    $("lightbox").hidden = false;
  }
  function closeLightbox() {
    $("lightbox").hidden = true;
    $("lightboxImage").removeAttribute("src");
  }

  ["travelImage", "puzzleImage", "successImage", "startImage", "finishImage",
   "failureImage", "sequenceSubImage", "photoCaptureImg", "selfiePhotoCaptureImg"]
    .forEach(function (id) {
      $(id).addEventListener("click", function () { openLightbox(this.src); });
    });
  $("lightbox").addEventListener("click", closeLightbox);
  $("lightboxClose").addEventListener("click", closeLightbox);
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !$("lightbox").hidden) closeLightbox();
  });

  $("btnArrived").addEventListener("click", goPuzzle);
  $("btnBackToClue").addEventListener("click", goTravel);
  $("answerForm").addEventListener("submit", submitAnswer);
  // dare / info stops: the button IS the answer.
  $("btnConfirmDone").addEventListener("click", function () { submitValue("done", null); });
  $("btnSkip").addEventListener("click", skipStop);
  $("btnNext").addEventListener("click", advance);
  $("btnFailedNext").addEventListener("click", advance);

  /* ---- photo capture -------------------------------------------------------
   * TWO hidden file inputs, both feeding the same handler:
   *   - #photoCaptureInput has capture=environment — opens the camera app
   *     directly on phones (desktop just falls back to a file picker).
   *   - #photoPickInput has no `capture` attribute — opens the phone's
   *     ordinary photo picker instead. This exists as a fallback: iOS gates
   *     direct camera capture behind a per-site permission that's easy to
   *     fumble (deny once, accidentally, with no obvious way back short of
   *     digging into Settings), while the plain picker uses iOS's modern
   *     one-shot photo picker, which asks for no permission at all. Either
   *     way the photo already exists in the camera roll — the OS put it
   *     there the moment it was taken with any camera app — so picking it
   *     from the library afterward produces an identical result to a direct
   *     capture; it's a full alternate path, not a lesser one. */

  $("btnTakePhoto").addEventListener("click", function () { $("photoCaptureInput").click(); });
  $("btnRetakePhoto").addEventListener("click", function () { $("photoCaptureInput").click(); });
  $("btnPickPhoto").addEventListener("click", function () { $("photoPickInput").click(); });
  $("btnSavePhoto").addEventListener("click", function () { saveToPhotos(currentStop()); });

  function handlePickedPhoto() {
    var file = this.files && this.files[0];
    this.value = "";                    // so picking the same file again still fires "change"
    if (!file) return;

    var stop = currentStop();
    // Hold on to the untouched original so "Save to my Photos" can hand iOS
    // the full-resolution shot rather than the shrunken preview copy.
    originalPhotoFiles[stop.id] = file;

    downscalePhoto(file).then(function (dataUri) {
      photos[stop.id] = dataUri;
      var ok = savePhotos();
      paintPhotoCapture(stop);
      applyPhotoGate(stop);          // unlock the proceed button straight away
      if (!ok) {
        setFeedback("Photo attached, but this browser is out of storage space to " +
                     "keep a copy for the recap. Save it to your Photos now so it isn't lost.", "bad");
      }
    }).catch(function (err) {
      alert("Couldn't use that photo: " + err.message);
    });
  }

  $("photoCaptureInput").addEventListener("change", handlePickedPhoto);
  $("photoPickInput").addEventListener("change", handlePickedPhoto);

  /* ---- final selfie screen ---------------------------------------------
   * Same pipeline as the per-stop photo capture above, just pointed at
   * FINAL_SELFIE_ID instead of a stop id, and its own set of element ids so
   * neither screen can interfere with the other's DOM. */

  $("btnTakeSelfie").addEventListener("click", function () { $("selfiePhotoCaptureInput").click(); });
  $("btnRetakeSelfie").addEventListener("click", function () { $("selfiePhotoCaptureInput").click(); });
  $("btnPickSelfie").addEventListener("click", function () { $("selfiePhotoPickInput").click(); });
  $("btnSaveSelfie").addEventListener("click", function () {
    saveToPhotos({ id: FINAL_SELFIE_ID, name: "group selfie" });
  });

  function handlePickedSelfie() {
    var file = this.files && this.files[0];
    this.value = "";
    if (!file) return;

    originalPhotoFiles[FINAL_SELFIE_ID] = file;
    downscalePhoto(file).then(function (dataUri) {
      photos[FINAL_SELFIE_ID] = dataUri;
      var ok = savePhotos();
      paintSelfieScreen();
      if (!ok) {
        setFeedback("Photo attached, but this browser is out of storage space to " +
                     "keep a copy. Save it to your Photos now so it isn't lost.", "bad");
      }
    }).catch(function (err) {
      alert("Couldn't use that photo: " + err.message);
    });
  }

  $("selfiePhotoCaptureInput").addEventListener("change", handlePickedSelfie);
  $("selfiePhotoPickInput").addEventListener("change", handlePickedSelfie);

  $("btnSelfieContinue").addEventListener("click", function () {
    // Hard gate, not just the disabled button — mirrors submitValue()'s
    // guard on a stop's required photo.
    if (!photos[FINAL_SELFIE_ID]) return;
    finishGame();
  });

  $("btnReset").addEventListener("click", function () {
    if (!confirm("Wipe everything and start a fresh hunt?")) return;
    try { localStorage.removeItem(STORAGE_KEY); localStorage.removeItem(PHOTOS_KEY); } catch (e) {}
    state = freshState();
    photos = {};
    if (timerHandle) clearInterval(timerHandle);
    goStart();
  });

  /* ---- boot --------------------------------------------------------------- */

  function restoreView() {
    if (isFinished()) { goFinish(); return; }
    if (state.startedAt == null) { goStart(); return; }
    startTimerLoop();
    if (state.view === "solved") { goSolved(false); return; }
    if (state.view === "failed") { goFailed(); return; }
    if (state.view === "selfie") { goSelfie(); return; }
    if (state.view === "puzzle") { goPuzzle(); return; }
    goTravel();
  }

  function boot() {
    paintStart();
    if (state.startedAt != null) {
      // Mid-run or finished: drop them straight back where they were.
      restoreView();
    } else {
      show("start");
    }
  }

  boot();

})(typeof globalThis !== "undefined" ? globalThis : this);
