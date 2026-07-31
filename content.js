/* ============================================================================
 * content.js — ALL GAME CONTENT LIVES HERE.
 *
 * This is the ONLY file you need to edit to change the hunt.
 * Don't touch app.js / index.html / styles.css unless you want to change how
 * the game *works* (as opposed to what it *says*).
 *
 * ---------------------------------------------------------------------------
 * HOW TO EDIT
 * ---------------------------------------------------------------------------
 *  - Every stop is one object in the HUNT.stops array, in walking order.
 *  - `answers` is a LIST of accepted answers. Add as many variants as you like.
 *    Matching ignores: capitals, accents (sör === sor), punctuation, and extra
 *    spaces. So "Sör!" , "sor" and "SÖR" all match ["sör"].
 *  - PLACEHOLDER ANSWERS: any answer string that starts with "[ANSWER:" is
 *    treated by the app as "not filled in yet" — the stop shows an amber
 *    warning badge and accepts ANY non-empty text so the game still plays
 *    end-to-end. Replace it with real answers before the event and the badge
 *    disappears automatically.
 *  - Anything in [SQUARE BRACKETS] is a placeholder for you to replace.
 *  - You can freely reorder, delete or add stops. The progress counter,
 *    the "Stop N of M" display and the finish screen all adapt automatically.
 *
 * ---------------------------------------------------------------------------
 * ⚠️  BEFORE THE EVENT — READ THIS
 * ---------------------------------------------------------------------------
 *  1. WALK THE ROUTE and verify every on-site detail below. Statues get moved,
 *     scaffolding goes up, info boards get replaced, bars close. Each stop has
 *     a `// VERIFY:` comment telling you exactly what to check.
 *  2. Fill in the three [DANIL] stops (3, 5, 9) and the two bar stops (7, 8).
 *  3. The route is ~3.5 km total, all flat, District V → VI/VII.
 *     Deák tér → Vörösmarty tér → Danube promenade → Chain Bridge →
 *     Zrínyi utca → Basilica → Dohány utca → Gozsdu udvar → Kazinczy utca.
 *     It ends in the ruin bar district so the night flows straight into drinks.
 *  4. Deliberately NOT used as a puzzle site: the Shoes on the Danube Bank
 *     Holocaust memorial, and the memorials on Szabadság tér. They're a
 *     2-minute detour from stop 4 and worth seeing — but not worth turning
 *     into a bachelor-party riddle. Keep it that way.
 * ========================================================================== */

const HUNT = {

  /* ==========================================================================
   * 1. GLOBAL SETTINGS
   * ======================================================================== */
  config: {
    groomName: "Danil",
    title: "DANIL'S LAST STAND",
    subtitle: "A Budapest Scavenger Hunt",

    // ---- Look ---------------------------------------------------------------
    // Any of these can be left out to keep the stylesheet's default.
    // Easiest edited from admin.html → Theme.
    theme: {
      accent:     "#f0b323",   // buttons, timer, headings
      accentDark: "#b8851a",   // the 3D shadow under primary buttons
      background: "#12100e",
      card:       "#1d1a17",
      text:       "#f6f1e8"
    },

    // ---- Optional photos ----------------------------------------------------
    // { src: "<data URI or file path>", caption: "..." }. Add them in
    // admin.html — it downscales and embeds them for you.
    startImage: null,          // shown on the start screen
    finishImage: null,         // shown on the finish screen

    // ---- Points & STAG levels -------------------------------------------------
    // A second scoring system, independent of the minute-penalty one below.
    // It only times/scores stops on-site (the "puzzle" phase) — never the
    // walking/travel-clue phase — and only stops the organiser has actually
    // marked as scored (every type does by default except "info", a pure
    // waypoint with nothing to judge). Easiest edited from
    // admin.html → Scoring & Stag levels, including per-stop overrides.
    //
    // Always on — there's no enabled/disabled switch. Excluding a specific
    // stop is still a per-stop choice (that stop's own `scored: false`).
    scoring: {
      targetSeconds: 180,          // solve within this for full points
      basePoints: 100,             // points for solving at/under target
      minPoints: 10,               // floor points if it takes a long time
      decayWindowSeconds: 300,     // seconds after target until it hits the floor
      hintPointPenalty: 20         // points lost per hint revealed on that stop
    },

    // Awarded at the end based on % of total possible points earned.
    // Sorted highest-first; the last one (minPercent: 0) is the catch-all —
    // always keep one at 0 or nobody below the next tier gets a title at all.
    stagLevels: [
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
    ],

    // ---- Every visible button and label -------------------------------------
    // Anything omitted falls back to the default in app.js (DEFAULT_LABELS).
    // Tokens: {n} hint number · {total} stop count · {min} penalty minutes
    //         · {skipMin} skip penalty.
    labels: {
      arrivedButton:  "WE'RE HERE →",
      submitButton:   "SUBMIT",
      nextButton:     "NEXT CLUE →",
      finishButton:   "FINISH →",
      dareButton:     "✅ DONE — WE HAVE PROOF",
      infoButton:     "CONTINUE →",
      hintButton:     "💡 Reveal hint {n}  (+{min} min)",
      skipButton:     "Give up on this one (+{min} min penalty)",
      backToClue:     "← re-read the travel clue",
      answerLabel:    "Your answer",
      choiceLabel:    "Pick one",
      hudProgress:    "Stop {n} of {total}"
      // ...plus ~30 more, all listed in app.js's DEFAULT_LABELS and all
      // editable from admin.html → Buttons & labels.
    },

    // Shown on the start screen.
    estimatedDuration: "2.5 – 3.5 hours",
    estimatedDistance: "~3.5 km of walking",

    // "How to play" blurb on the start screen. Plain text, one string per line.
    howToPlay: [
      "You'll get a cryptic clue. Walk to where you think it points.",
      "Once you're standing there, tap WE'RE HERE and you'll get a puzzle that can only be solved by looking at the actual stuff around you. Count it, read it, squint at it.",
      "Type the answer in. Get it right and the next clue unlocks.",
      "Stuck? Each stop has hints. Using one costs you time on the final scoreboard, so use them like a man with dignity — sparingly and full of regret.",
      "The clock starts the second you tap the button below and does NOT stop for beer, photos, or Danil getting emotional.",
      "Phone dies, page closes, someone drops it in the Danube — your progress is saved. Reopen the link and carry on."
    ],

    // ---- Hint system --------------------------------------------------------
    // Hints are always available (no hard gates), but each one you reveal adds
    // a time penalty to your FINAL time. Set to 0 for "free hints, just a tap".
    hintPenaltyMinutes: 5,

    // ---- Escape hatch -------------------------------------------------------
    // A "skip this stop" button appears once the group has revealed every hint
    // AND got it wrong this many times. Set skipAfterWrongAnswers to a huge
    // number to effectively disable skipping. Skipping costs skipPenaltyMinutes.
    skipAfterWrongAnswers: 4,
    skipPenaltyMinutes: 15,

    // ---- Copy -------------------------------------------------------------
    startButtonLabel: "START THE HUNT",

    // Cycled through, in order, on each wrong answer (then repeats from the top).
    wrongAnswerMessages: [
      "Not quite. Try again — nobody's counting. (The app is counting.)",
      "Nope. Confidently wrong, though. Respect.",
      "That's a no. Look up. Look around. Look harder.",
      "Still no. Is Danil in charge of the typing? That would explain it.",
      "Wrong, but beautifully spelled.",
      "No. Have you tried reading the clue a second time? Radical, I know."
    ],

    // Cycled through on each correct answer.
    correctAnswerMessages: [
      "Correct. Don't let it go to your heads.",
      "Nailed it. Onward.",
      "Yes! Someone here can read.",
      "Correct. Budapest is mildly impressed.",
      "Got it. Keep moving, the bars aren't getting emptier."
    ],

    // ---- Finish screen ----------------------------------------------------
    finishTitle: "HUNT COMPLETE 🏆",
    finishBlurb: [
      "You dragged Danil across half of Pest, made him do things he'll deny tomorrow, and somehow nobody got lost, arrested or engaged to a stranger.",
      "That's a successful evening by any reasonable standard."
    ],
    // The final group-photo prompt. This is the last thing on the screen.
    finalPhotoPrompt:
      "ONE LAST THING: everyone in the frame, arms around each other, Danil in the middle looking exactly as tired as he feels. Someone count to three out loud. This is the photo that ends up in the wedding slideshow, so make it count.",
    finalToast:
      "Then raise whatever's in your hand and say it properly: EGÉSZSÉGEDRE! (egg-ay-shay-ged-reh) — \"to your health\".",
  },

  /* ==========================================================================
   * 2. THE STOPS
   * ======================================================================== */
  stops: [

    /* ------------------------------------------------------------------------
     * STOP 1 — DEÁK FERENC TÉR
     * Mechanic: on-site counting + arithmetic
     * VERIFY: that the M1 platform/entrance signage or the Millennium
     *         Underground Museum entrance at Deák tér still shows "1896".
     *         If it doesn't, hint 1 already gives them the year anyway.
     * ---------------------------------------------------------------------- */
    {
      id: "deak",
      // Organiser-only. Never shown to players. Survives an editor export.
      verifyNote: "Check the M1 platform/entrance signage or the Millennium Underground Museum entrance still shows 1896. Hint 1 gives the year anyway if it does not.",
      name: "Deák Ferenc tér",
      // Small grey label under the stop number. Keep it vague — it shouldn't
      // give away the location before they've solved the travel clue.
      teaser: "Where the city knots itself together",

      travelClue:
        "Start where everything in this city crosses.\n\n" +
        "Three coloured veins run under this square and nowhere else in Budapest do all three meet. Above ground it's a slab of open space with a church on one side, a park on the other, and roughly nine thousand people waiting for someone who is late.\n\n" +
        "Go there. Stand somewhere you can see a metro entrance.",

      // Optional: shown on the puzzle screen above the puzzle, as a heading.
      arrivalNote: "You made it approximately 200 metres. Pace yourself.",

      puzzle:
        "Look at the metro signage around you.\n\n" +
        "1️⃣ How many metro lines meet beneath this square?\n" +
        "2️⃣ The yellow one is the oldest underground railway on mainland Europe. Find the year it opened — it's written on the station signage and on the little museum entrance down in the underpass.\n\n" +
        "Now: add up the four digits of that year, then multiply the total by the number of lines.\n\n" +
        "Type the number.",

      hints: [
        "The yellow line was built for Hungary's Millennium — 1000 years after the Magyars turned up in 896. So the year ends in 96.",
        "1 + 8 + 9 + 6 = 24. And there are three lines: M1, M2, M3."
      ],

      answers: ["72", "seventy two", "seventytwo"],

      // Shown after a correct answer, before the next travel clue.
      successMessage:
        "72. Correct. That's the last easy one, so enjoy the feeling."
    },

    /* ------------------------------------------------------------------------
     * STOP 2 — VÖRÖSMARTY TÉR
     * Mechanic: read an inscription → word scramble
     * VERIFY: the Vörösmarty monument (big white marble statue, poet seated,
     *         figures around the base) carries the opening line of the Szózat:
     *         "HAZÁDNAK RENDÜLETLENÜL LÉGY HÍVE, OH MAGYAR".
     *         Check the last word is still legible and not behind a Christmas
     *         market stall / event stage. If the square is fenced off for a
     *         market, the inscription is still readable from the north side.
     * ---------------------------------------------------------------------- */
    {
      id: "vorosmarty",
      // Organiser-only. Never shown to players. Survives an editor export.
      verifyNote: "Check the Vorosmarty monument inscription (HAZADNAK RENDULETLENUL LEGY HIVE, OH MAGYAR) is legible and not hidden behind a market stall or event stage. Readable from the north side if the square is fenced.",
      name: "Vörösmarty tér",
      teaser: "Marble, cake, and a man who wrote one very famous sentence",

      travelClue:
        "Walk northwest until the shops get expensive and the pavement gets wider.\n\n" +
        "You're looking for a square with a poet at the heart of it — carved in white stone, sat down, surrounded by his own countrymen frozen mid-adoration. On one side of the square is a café that has been selling cake to tourists since 1858 and has never once considered lowering its prices.\n\n" +
        "Get to the statue. Walk all the way around its base.",

      arrivalNote: "Yes, the cake is good. No, you don't have time.",

      puzzle:
        "Carved into the monument is the most famous line of Hungarian poetry ever written — a instruction to be unshakeably faithful to your homeland.\n\n" +
        "Read it. Take the VERY LAST WORD of that inscription.\n\n" +
        "To prove you actually read it and didn't Google it, here it is scrambled:\n\n" +
        "R · Y · G · A · M · A\n\n" +
        "Unscramble it. Six letters.",

      hints: [
        "The line begins 'Hazádnak rendületlenül...' — and ends by naming the people it's addressed to.",
        "It's the word for a Hungarian person. Starts with M."
      ],

      answers: ["magyar", "oh magyar"],

      successMessage:
        "MAGYAR. You have now read more Hungarian poetry than Danil has read anything all year."
    },

    /* ------------------------------------------------------------------------
     * STOP 3 — DANUBE PROMENADE / LITTLE PRINCESS STATUE
     * ★ PERSONAL STOP #1 — the roast ★
     * Mechanic: personal trivia (fill in below)
     * VERIFY: the Kiskirálylány (Little Princess) statue is still perched on
     *         the railing on the Pest embankment near Vigadó tér, between the
     *         tram tracks and the water. It's small, bronze, sat on the rail,
     *         wearing a crown that looks like a jester's hat.
     *
     * >>> TO DO: replace the [SQUARE BRACKET] bits with real Danil content. <<<
     *     Good source material for THIS one (the roast): his most infamous
     *     mishap, the story the group tells every single time, the thing he
     *     did on a trip abroad that he still hasn't lived down.
     * ---------------------------------------------------------------------- */
    {
      id: "danil-roast",
      // Organiser-only. Never shown to players. Survives an editor export.
      verifyNote: "Check the Kiskiralylany (Little Princess) statue is still on the embankment railing near Vigado ter, between the tram tracks and the water.",
      name: "The Little Princess",
      teaser: "A small bronze monarch with a better crown than yours",

      travelClue:
        "Head for the water.\n\n" +
        "Walk down to the river on the Pest side and turn so the castle on the hill is over your right shoulder. Somewhere along the railing between the tram tracks and the Danube, a very small girl in a very silly crown has been sitting since 1990, watching the boats and judging everyone who walks past. Tourists queue to touch her knee.\n\n" +
        "Find her. Gather round. She's about to hear something embarrassing.",

      arrivalNote: "Everybody in. Phones out for this one.",

      // ---- THE PUZZLE TEXT — replace the bracketed parts -------------------
      puzzle:
        "Time to establish who actually knows the groom.\n\n" +
        "[INSERT: the setup for the story — where you all were, roughly when, who was there. e.g. \"Summer 2019. That trip to ___. Danil had been awake for approximately 31 hours.\"]\n\n" +
        "[INSERT: the funny/embarrassing incident, told properly, building to the question below.]\n\n" +
        "So — the question:\n\n" +
        "[INSERT: the question with one specific word/name/number as the answer. e.g. \"What did he lose?\" / \"What did he name it?\" / \"How many times did he try?\"]\n\n" +
        "First man to remember it, type it in. If nobody remembers it, that is its own kind of answer and you should all be ashamed.",

      hints: [
        "[INSERT: hint 1 — a nudge. e.g. \"It was blue.\" / \"It rhymes with ___.\"]",
        "[INSERT: hint 2 — basically gives it away. e.g. \"It starts with the letter ___ and he still has the scar.\"]"
      ],

      // Leave as-is and the app accepts any answer + shows a placeholder badge.
      // Replace with e.g. ["passport", "his passport"] when you've filled it in.
      answers: ["[ANSWER: fill in later]"],

      successMessage:
        "[INSERT: the payoff line. e.g. \"Correct. And he's never once apologised for it.\"]"
    },

    /* ------------------------------------------------------------------------
     * STOP 4 — CHAIN BRIDGE LIONS
     * Mechanic: observation / myth-busting riddle
     * VERIFY: you can still get right up to the lions at the Pest bridgehead.
     *         There are 4 in total (2 at each end). The famous legend is that
     *         the sculptor János Marschalkó threw himself in the Danube because
     *         he'd forgotten to give them tongues — they DO have tongues, you
     *         just can't see them from street level. The answer is "tongue",
     *         which works whether or not they manage to spot it.
     * ---------------------------------------------------------------------- */
    {
      id: "lions",
      // Organiser-only. Never shown to players. Survives an editor export.
      verifyNote: "Check you can still get close to the lions at the Pest bridgehead. 4 lions total, 2 at each end. Answer works whether or not they spot the tongue.",
      name: "The Chain Bridge Lions",
      teaser: "Four stone cats with a public relations problem",

      travelClue:
        "Keep the river on your left and walk north along the embankment until you hit the oldest permanent crossing in the city — the one held up by chains, guarded at both ends by a pair of very serious stone cats.\n\n" +
        "Go to the pair on THIS side of the river. Get close enough to look up into a face.",

      arrivalNote: "Do not climb the lion. Danil, this means you.",

      puzzle:
        "Local legend: when this bridge opened, a small boy in the crowd shouted out that the sculptor had forgotten to give the lions something. The sculptor was so humiliated he supposedly threw himself into the Danube that night.\n\n" +
        "(He didn't. He lived another 25 years and was reportedly very annoyed about the whole thing.)\n\n" +
        "Get underneath one, look up into its open mouth, and settle the argument yourselves.\n\n" +
        "WHAT did the boy say was missing?\n\n" +
        "One word. English or Hungarian, we're not fussy.",

      hints: [
        "It's inside the mouth. Or — depending on who you ask — it isn't.",
        "In Hungarian it's NYELV. Which, delightfully, also means 'language'."
      ],

      answers: ["tongue", "tongues", "nyelv", "a tongue", "its tongue"],

      successMessage:
        "TONGUE. And for the record: they've had them the whole time. You just can't see them from down there. Cheer up, sculptor."
    },

    /* ------------------------------------------------------------------------
     * STOP 5 — THE FAT POLICEMAN (Zrínyi utca)
     * ★ PERSONAL STOP #2 — THE DARE ★  (photo/video proof, not a text puzzle)
     * VERIFY: the bronze "Uniformed Policeman" statue (a very round moustached
     *         officer, belly worn golden from being rubbed for luck) stands on
     *         Zrínyi utca, on the pedestrian street running straight at the
     *         Basilica. It has been moved a few metres before — if it's gone,
     *         the fallback dare site is the Basilica steps at stop 6.
     *
     * >>> TO DO: write the actual dare. Keep it shareable — assume his
     *     mother-in-law eventually sees the photo. <<<
     * ---------------------------------------------------------------------- */
    {
      id: "danil-dare",
      // Organiser-only. Never shown to players. Survives an editor export.
      verifyNote: "Check the bronze Fat Policeman statue is still on Zrinyi utca on the pedestrian street facing the Basilica. It has been moved a few metres before. Fallback dare site: the Basilica steps at stop 6.",
      name: "The Fat Policeman",
      teaser: "A law enforcement officer who has clearly never chased anyone",

      travelClue:
        "Cut inland, away from the river, and find the pedestrian street that points like an arrow straight at the enormous domed church you've been able to see all evening.\n\n" +
        "Halfway along it stands a policeman in bronze. He is not built for pursuit. His belly has been rubbed to a shine by every tourist in Europe, because rubbing it is supposed to mean you'll eat well.\n\n" +
        "Take Danil there. He has some work to do.",

      arrivalNote: "Somebody get the camera ready. This one's for the archive.",

      // ---- THE DARE — replace the bracketed parts -------------------------
      // The mechanic: they must PHYSICALLY do the thing and photograph it.
      // The password is announced verbally by whoever is holding the phone —
      // or just leave the default word below, it's written right there in the
      // hint. The honour system is the whole point.
      puzzle:
        "🚨 THIS ONE ISN'T A PUZZLE. THIS ONE IS A TAX. 🚨\n\n" +
        "Danil must, on camera, with witnesses:\n\n" +
        "[INSERT THE DARE: something silly, physical, and photographable. e.g. " +
        "\"stand belly-to-belly with the policeman, one hand on the officer's stomach and one on his own, and deliver a heartfelt 30-second speech to the statue about [INSERT: thing Danil is famously passionate about]\" — " +
        "or \"recreate [INSERT: the specific pose from that one photo everyone has seen]\".]\n\n" +
        "📸 PROOF REQUIRED: at least one photo AND one video. Somebody is putting these in the wedding slideshow, so frame it properly.\n\n" +
        "When it's done — and only when it's done — type the password below to unlock the next clue.\n\n" +
        "The password is the Hungarian word for 'belly'. It's in the hint. This is not a difficult stop; it is a humiliating one.",

      hints: [
        "The Hungarian word for belly is POCAK. Pronounced 'PO-tsok'. Say it while rubbing the statue's.",
        "Seriously, it's POCAK. Type POCAK. The hard part was the speech and you've already done that."
      ],

      // Change this if you'd rather use a codeword from your own dare.
      answers: ["pocak", "poczak", "potsok"],

      successMessage:
        "POCAK. Rubbed, filmed, and permanently on record. Well done everyone except Danil."
    },

    /* ------------------------------------------------------------------------
     * STOP 6 — ST STEPHEN'S BASILICA
     * Mechanic: Caesar cipher, with the shift found on-site
     * VERIFY: the height (96 m) is on the info boards outside and on basically
     *         every plaque and guidebook — 96 because of 896, and because by
     *         old city rule nothing in Budapest may be built taller. If they
     *         can't find a board, hint 1 gives them the number.
     *         The answer word is SZENT ("saint" / "holy") — it's carved above
     *         the entrance and on the tympanum inscription, so they can also
     *         sanity-check it against the building itself.
     * ---------------------------------------------------------------------- */
    {
      id: "basilica",
      // Organiser-only. Never shown to players. Survives an editor export.
      verifyNote: "Check the 96 m height is on an info board outside. Hint 1 gives the number if not. Answer SZENT is carved on the building, so they can sanity-check it.",
      name: "St Stephen's Basilica",
      teaser: "The tallest thing you're legally allowed to look at",

      travelClue:
        "Keep walking the direction the policeman was pointing (he wasn't pointing, but go with it) until the street runs out and the building fills your entire field of vision.\n\n" +
        "Two bell towers. One enormous dome. A square in front of it full of people taking the same photograph.\n\n" +
        "Find an information board — there are several around the square and by the entrance.",

      arrivalNote: "Hats off, phones out, keep the volume down. It's a working church.",

      puzzle:
        "Two numbers matter here.\n\n" +
        "🔢 Find the HEIGHT of this building in metres. It's on the info boards. It's the same height as the Parliament, and by old city rule nothing in Budapest is allowed to be built taller.\n\n" +
        "🔑 Take the SECOND DIGIT of that height. That number is your cipher shift.\n\n" +
        "Now decode this, shifting each letter BACKWARDS through the alphabet by that many places (so if the shift were 3, D → A):\n\n" +
        "        Y  F  K  T  Z\n\n" +
        "Five letters. It's a Hungarian word, and it's carved on the building in front of you — twice, if you look properly.",

      hints: [
        "The building is 96 metres tall (96 → the Magyars arrived in 896). Second digit = 6. So shift every letter back by 6.",
        "Y−6 = S, F−6 = Z... it starts SZ. The word means 'saint', and it's the first word of this church's name in Hungarian."
      ],

      answers: ["szent", "saint", "holy"],

      successMessage:
        "SZENT — 'saint'. Szent István Bazilika. The saint himself is 96 metres of stone and a mummified right hand in a box inside. Budapest does not do things by halves."
    },

    /* ------------------------------------------------------------------------
     * STOP 7 — INTO THE JEWISH QUARTER / ★ PUB CRAWL STOP #1 ★
     * Mechanic: Hungarian word decoder + order-a-drink challenge
     *
     * >>> TO DO: once you've picked BAR #1, put its name + address in
     *     `barName` / `barAddress` below and in the puzzle text. Until then the
     *     clue just sends them to Dohány utca and tells them to pick a bar,
     *     which honestly also works fine. <<<
     *
     * VERIFY: the Dohány Street Synagogue (two onion-domed towers, largest
     *         synagogue in Europe) is unmissable and permanent. The bar is not.
     * ---------------------------------------------------------------------- */
    {
      id: "bar-one",
      // Organiser-only. Never shown to players. Survives an editor export.
      verifyNote: "The Dohany Street Synagogue is permanent and unmissable. The bar is not - confirm it is open on the night and put its name and address in the travel clue.",
      name: "First Round",
      teaser: "District VII. The night changes character here.",

      // ---- EDIT ME ONCE YOU'VE PICKED THE BAR -----------------------------
      barName: "[INSERT: BAR #1 NAME]",
      barAddress: "[INSERT: address — somewhere around Dob utca / Kazinczy utca]",

      travelClue:
        "Head east, away from the river, until the buildings get older, taller and considerably more interesting.\n\n" +
        "You're aiming for the edge of the old Jewish Quarter — look for the enormous synagogue with two onion-domed towers, the biggest in Europe, on the corner of a street named after tobacco.\n\n" +
        "From there, walk into the quarter behind it and find:\n\n" +
        "🍺 [INSERT: BAR #1 NAME], at [INSERT: address].\n" +
        "(Not picked a bar yet? Then pick one now — anything on Dob utca or Kazinczy utca with a courtyard and questionable furniture.)\n\n" +
        "Get inside. Get to the bar.",

      arrivalNote: "First round. Someone's paying and it isn't Danil.",

      puzzle:
        "🍻 BAR CHALLENGE — everyone participates, nobody has to drink:\n\n" +
        "1. Order a round. Beer, wine, soda water, whatever — but at least one person must order in Hungarian, out loud, to an actual bartender.\n" +
        "2. Before anyone drinks: raise glasses, look each other IN THE EYE (this is non-negotiable in Hungary), and say EGÉSZSÉGEDRE.\n" +
        "3. Danil gives a toast. Thirty seconds. No notes.\n\n" +
        "🔤 NOW THE PUZZLE. Here's your survival glossary:\n\n" +
        "        VÍZ = water\n" +
        "        BOR = wine\n" +
        "        KÖSZÖNÖM = thank you\n" +
        "        EGÉSZSÉGEDRE = cheers\n" +
        "        NAGY = big\n" +
        "        ??? = beer\n\n" +
        "One word is missing from that list, and it's the single most useful word in this entire country. It's printed on the taps, on the menu, on the chalkboard and probably on the wall.\n\n" +
        "Find it. Type it. Three letters.",

      hints: [
        "It's on the menu next to every lager on offer. Three letters, one of them has two little dots over it.",
        "It rhymes with 'fur'. S _ R. (Type it without the dots if your keyboard is being difficult — we'll accept it.)"
      ],

      answers: ["sör", "sor", "sör!", "beer"],

      successMessage:
        "SÖR. Beer. You now know enough Hungarian to survive the rest of the night. Everything else is optional."
    },

    /* ------------------------------------------------------------------------
     * STOP 8 — GOZSDU UDVAR / ★ PUB CRAWL STOP #2 ★
     * Mechanic: counting architecture + a stranger-photo challenge
     * VERIFY: Gozsdu udvar is a covered passage of linked courtyards running
     *         between Király utca 13 and Dob utca 16 — usually described as
     *         six buildings joined by SEVEN courtyards. WALK IT AND COUNT IT
     *         YOURSELF before the event and change the answer if your count
     *         differs. (The app accepts 6 and 7 by default for exactly this
     *         reason — tighten it once you've counted.)
     *
     * >>> TO DO: pick BAR #2 inside the passage — there are a dozen. <<<
     * ---------------------------------------------------------------------- */
    {
      id: "gozsdu",
      // Organiser-only. Never shown to players. Survives an editor export.
      verifyNote: "WALK THE PASSAGE AND COUNT THE COURTYARDS YOURSELF. Usually described as six buildings and seven courtyards. The answer accepts both 6 and 7 until you have counted - tighten it after.",
      name: "Gozsdu udvar",
      teaser: "One address in, a different address out",

      barName: "[INSERT: BAR #2 NAME — somewhere inside the passage]",

      travelClue:
        "Two streets north of where you're standing there's a doorway that isn't a doorway.\n\n" +
        "It's a passage — a chain of linked courtyards tunnelling right through the middle of a city block, strung with lights and lined end-to-end with bars and terraces. You go in from one street and you come out on a completely different one.\n\n" +
        "Find the entrance on Király utca (number 13) or Dob utca (number 16). Then walk the whole thing, end to end, without stopping.\n\n" +
        "Yes, without stopping. You'll be back.",

      arrivalNote: "Now you can stop. Second round.",

      puzzle:
        "📸 CHALLENGE 1 — THE STRANGER:\n" +
        "Get a photo of Danil with a complete stranger who is NOT Hungarian. Ask nicely, explain he's getting married, and find out where they're from. Do not be weird about it.\n\n" +
        "🍻 CHALLENGE 2 — THE ROUND:\n" +
        "Order at [INSERT: BAR #2 NAME]. Somebody orders something they can't pronounce. Nobody drinks until Danil has named one thing he's actually looking forward to about being married. One genuine thing. We'll allow exactly one joke first.\n\n" +
        "🔢 NOW THE PUZZLE:\n" +
        "You just walked the length of this passage. It's built through the middle of a block of old apartment buildings, all joined together.\n\n" +
        "How many separate COURTYARDS did you pass through, from the street at one end to the street at the other?\n\n" +
        "Count them properly. Walk it again if you have to — you have drinks now, it's not a punishment.",

      hints: [
        "It's more than five and fewer than nine. The buildings themselves number one fewer than the courtyards.",
        "Six buildings. Seven courtyards. Type the number of courtyards."
      ],

      // 6 accepted too, because counting a courtyard as a courtyard is genuinely
      // ambiguous when you're three drinks in. Tighten after you've walked it.
      answers: ["7", "seven", "het", "hét", "6", "six", "hat"],

      successMessage:
        "Seven courtyards, six buildings, roughly forty bars and one groom with a photo of a stranger from somewhere he can no longer remember. Budapest is working exactly as intended."
    },

    /* ------------------------------------------------------------------------
     * STOP 9 — KAZINCZY UTCA / THE FINAL STOP
     * ★ PERSONAL STOP #3 — the earnest one ★ + ★ PUB CRAWL STOP #3 ★
     * Mechanic: personal, sincere. This is the one that isn't a roast.
     *
     * VERIFY: Kazinczy utca is the spine of the ruin bar district; Szimpla
     *         Kert sits at Kazinczy utca 14 and has been there since 2004. If
     *         you'd rather end somewhere quieter (and after 22:00 you probably
     *         would — Szimpla gets loud enough that reading this off a phone is
     *         genuinely hard), swap the address in the travel clue for your
     *         actual final bar. That's the only edit needed.
     *
     * >>> TO DO: fill this one in LAST and fill it in properly. Categories that
     *     work here: how he met his partner, something he said about her that
     *     stuck with the group, the moment you all knew, a promise he made
     *     years ago that he's actually kept. Land it. <<<
     * ---------------------------------------------------------------------- */
    {
      id: "danil-heart",
      // Organiser-only. Never shown to players. Survives an editor export.
      verifyNote: "Kazinczy utca 14 is Szimpla Kert. After 22:00 it gets loud enough that reading this off a phone is hard - consider ending somewhere quieter and swapping the address in the travel clue.",
      name: "Last Stop",
      teaser: "The one that isn't a joke",

      travelClue:
        "Out of the passage and onto the street the whole district is named after in every guidebook.\n\n" +
        "Number 14. The famous one. The old building that was supposed to be demolished twenty years ago and instead got filled with fairy lights, dead televisions, a bathtub you can sit in and half a Trabant.\n\n" +
        "(Or wherever you've actually decided to end up — you know where. Go there.)\n\n" +
        "Get drinks. Get everyone in one place. Then read the next bit out loud, properly, and put the phone down while you do it.",

      arrivalNote: "Volume down. Phones down. This one's for Danil.",

      // ---- FILL THIS IN LAST AND FILL IT IN WELL --------------------------
      puzzle:
        "Last stop. Nobody's timing this one — well, the app is, but ignore it.\n\n" +
        "[INSERT: the sincere bit. Suggested shape:\n" +
        " • when and how he met [INSERT: partner's name],\n" +
        " • the thing he said about her early on that made you all realise this one was different,\n" +
        " • what's actually changed about him since, said kindly.]\n\n" +
        "And then the last question of the night:\n\n" +
        "[INSERT: the question. Something only the people in this circle could answer. e.g. \"What did he say when he called you the night he decided to ask her?\" / \"Where were they when he knew?\" / \"What's the one word he used?\"]\n\n" +
        "Whoever knows it, type it in. And if it's Danil who has to answer his own question, that's fine too — make him say it out loud first.",

      hints: [
        "[INSERT: hint 1 — a gentle nudge. e.g. \"It was a city. In the rain.\"]",
        "[INSERT: hint 2 — gives it away. e.g. \"It starts with ___ and he's told this story badly at least four times.\"]"
      ],

      answers: ["[ANSWER: fill in later]"],

      successMessage:
        "[INSERT: the closing line. Something warm. e.g. \"That's the one. Good luck, Danil — she's getting a good one.\"]"
    }
  ]
};

/* Export for the little Node test harness in test.js. Ignored by browsers. */
if (typeof module !== "undefined" && module.exports) { module.exports = HUNT; }
