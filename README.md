# Danil's Last Stand — a Budapest scavenger hunt

A mobile-browser scavenger hunt for a bachelor party in central Budapest.
Nine stops, real landmarks, a walkable loop that ends in the ruin bar district.
No backend, no database, no build step — five static files you can host free
and share as one link or QR code.

```
index.html     the game
styles.css     the look (dark, big text, outdoor-legible)
app.js         the game engine — you shouldn't need to touch this
content.js     all the clues, puzzles, answers and copy

admin.html     ⭐ THE EDITOR. Open this to change anything. No coding.
admin.css      \ the editor's own styling and logic
admin.js       /

test.js        sanity checks. Run after editing.
```

---

## 1. Try it right now

Just open `index.html` in a browser.

⚠️ One caveat: opening it as a `file://` path works, but some browsers block
`localStorage` on `file://`, so **progress won't save**. To test it properly,
serve it over HTTP:

```bash
cd budapest-hunt && python3 -m http.server 8777
```

Then open <http://localhost:8777>. On your phone, use your Mac's local IP
instead of `localhost` (e.g. `http://192.168.1.42:8777`) with both devices on
the same wifi.

---

## 2. Host it for free

Pick whichever is least annoying. All three take under five minutes.

### Netlify Drop — easiest, no account needed to start

1. Go to <https://app.netlify.com/drop>
2. Drag the whole `budapest-hunt` folder onto the page.
3. You get a URL like `https://random-words-123.netlify.app` immediately.
4. Optional: make an account to claim it and rename it to something you can
   read out loud in a bar.

### GitHub Pages — best if you want to tweak content later

```bash
cd budapest-hunt
git init && git add . && git commit -m "Budapest hunt"
gh repo create danil-hunt --public --source=. --push
```

Then in the repo: **Settings → Pages → Source: Deploy from a branch →
`main` / `(root)` → Save**. Live in ~1 minute at
`https://<your-username>.github.io/danil-hunt/`.

To update content later: edit `content.js`, then `git commit -am "fix stop 4"
&& git push`. It redeploys itself.

### Vercel

```bash
npx vercel --prod
```

Accept the defaults. It detects a static site with no configuration.

---

## 3. Make a QR code

Nobody is typing a URL in a bar. Once it's hosted:

```bash
# macOS, via Homebrew
brew install qrencode
qrencode -o hunt-qr.png -s 12 -m 2 'https://YOUR-URL-HERE'
```

No Homebrew? <https://qr.io> or <https://www.qr-code-generator.com> work fine
for a static URL. Print a few copies, and text the link to the group chat as a
backup — QR codes and drunk camera focus are not a great pairing.

---

## 4. Editing the content — use the editor

Open **`admin.html`** in a browser. That's the whole answer. It's a full editor
for the hunt: no JavaScript, no square brackets, no risk of breaking the game
with a stray comma.

> Serve it over HTTP (`python3 -m http.server 8777`, then
> <http://localhost:8777/admin.html>) rather than opening the file directly —
> the editor autosaves to `localStorage`, which some browsers disable on
> `file://`.

### What you can do in it

| | |
|---|---|
| **Edit any stop** | Name, teaser, travel clue (optional — can be skipped for on-site puzzles), arrival note, puzzle text, hints, accepted answers, success message |
| **Choose a task type** | Text answer, multiple choice, dare, info-only, picker (choose-your-path), or one-try choice — see below |
| **Add / delete / duplicate stops** | `+ Add` in the sidebar, or the `⧉` and `✕` buttons on each row |
| **Reorder** | `↑` `↓` on each stop. Numbering, the progress bar and "Stop N of M" all follow automatically |
| **Add photos** | Travel clue, puzzle, **success screen**, plus the start and finish screens — drag, paste, or pick a file |
| **Buttons & labels** | All 50+ pieces of UI wording, from "SUBMIT" to the scoreboard captions |
| **Theme** | Five colours with a live preview, plus five presets |
| **Scoring & STAG levels** | Per-stop timer (independently toggleable from scoring), bonus/decay points, hint penalties, and the title earned at the end — see below |
| **Photo capture** | An in-app "take a photo" button, on by default for Dare stops — see below |
| **Game settings** | Groom's name, title, duration, how-to-play bullets, hint/skip penalties, all the joke messages, the finish screen |
| **Organiser notes** | A per-stop notes field that players never see. The route-verification notes already live here |
| **Pre-event checklist** | Every stop that's still missing something, plus your notes, in one list |
| **Preview** | Opens the real game running your unsaved draft, with its own separate progress so it can't disturb the live game |

### Task types

Each stop picks one. They change what players actually do, not just the wording.

| Type | What players see | Notes |
|---|---|---|
| **Text answer** | A text box and SUBMIT | The default. Matching is forgiving about case, accents and punctuation |
| **Multiple choice** | The options as big tap-targets | Good when the answer is hard to spell, or for an "odd one out". The editor errors if none of your options matches an accepted answer, so you can't ship an unwinnable stop |
| **Dare / photo** | One confirm button | Can't be failed. No answer, no give-up button, never flagged as "needs an answer". Honour system — the right system for this |
| **Info only** | One continue button | No challenge at all. A story beat, a warning, a waypoint. No "correct!" screen either — the continue button goes straight to the next stop |
| **Picker (choose-your-path)** | Several labelled buttons, each with an optional description, colour and a small shimmer animation | Not a quiz — there's no right answer, just a fork. Tapping one jumps straight to that option's target stop by id. Whichever option(s) weren't tapped are excluded from the rest of that playthrough entirely: never played, not shown in the finish-screen recap, and not counted in the STAG score's possible-points total. The editor requires at least two options, each with a label and a valid target stop, and flags a target that's been renamed/deleted out from under it |
| **One-try choice** | The options as big tap-targets, same as Multiple choice | No retry: the *first* tap is the only one that counts. Get it right and it behaves exactly like Multiple choice (success screen, points). Get it wrong and it's an outright fail — no shake-and-try-again, no hints escape hatch (there's nothing left to escape) — straight to its own failure screen (own emoji, headline, message and photo, all overridable per stop), then on to the next stop like normal. Scores 0 on a fail, same treatment as a skip, and shows as "failed 💀" in the finish-screen recap rather than "skipped" or "solved" |

### Scoring & STAG levels

A second, independent scoring system on top of the original time-and-penalties
scoreboard (which still works exactly as before — this is additive, not a
replacement). **Always on, with no off switch** — an earlier version had one,
and it turned out to be a way for the per-task timer to quietly go missing on
a stale draft with no obvious sign anything was wrong. Not a risk worth
keeping for a one-shot live event, so it's unconditional now. Excluding one
specific stop is still your call — see "Include in scoring" below — that's a
deliberate choice made once while writing that stop, not something that can
silently drift.

**How it scores a stop:**

- The clock for a stop starts the instant the group taps **WE'RE HERE** —
  never during the walk to get there, and never reset by tapping back to
  re-read the travel clue.
- Solve at or under the **target time** → full points.
- Solve slower → points decay in a straight line down to a **minimum**, over
  a **decay window** you set (e.g. "3 minutes for full marks, decaying to the
  floor by 8 minutes").
- Each **hint revealed** subtracts a flat penalty on top.
- Each **wrong answer** — a mistyped answer or a wrong multiple-choice tap,
  both count the same — subtracts its own flat penalty on top of that.
- **Skipping** a stop always scores 0 — the one outcome worse than just being
  slow.

Every number is a per-stop override of a game-wide default, exactly like the
label system: leave a stop's box blank and it inherits **Scoring & STAG
levels**' setting. A dare that takes longer to film, or a puzzle you know is
brutal, can get its own generous target time without touching anything else.

Not every stop has to count. **Info** stops (pure story beats/waypoints)
are excluded by default since there's nothing to judge; flip "Include in
scoring" on any stop to override either direction — worth doing, for
instance, on stop 9's sincere finale, if racing a clock feels wrong for that
one.

**STAG levels** are the title awarded at the end, picked by percentage of
total possible points earned. Six are shipped (Legendary Stag down to
Roadkill Stag) — add, remove, rename or re-threshold them freely, just keep
one row at 0% so nobody falls through with no title at all.

On the puzzle screen, a live ⏱ clock shows next to each scored stop (turning
amber past target, red past the decay window), a live 🏆 points chip sits
beside it showing exactly what solving *right now* would earn (ticking down
in real time, and dropping the instant a hint is revealed or a wrong answer
is submitted — no need to wait for the solved screen to see a penalty land),
the hint button shows both its time and point cost, the solved screen shows
a points badge, and the finish screen leads with a 🦌 STAG SCORE card before
the regular scoreboard.

**The start screen explains all of this up front**, in its own "🏆 How
scoring works" card below the regular "How this works" one — so the group
knows the points/STAG system exists before they hit the first stop, not just
when they see a mysterious chip appear mid-puzzle. The wording pulls this
hunt's actual target time and total possible points in automatically
(`{target}` / `{totalPoints}`), so it can't quietly drift out of sync with
the real numbers as you tune them. Write your own bullets in **Scoring &
STAG levels → Explain it on the home page**, or clear
`scoringExplainerTitle` in **Buttons & labels** to hide the card entirely.

**Showing the clock and counting toward the score are two separate
switches.** Each stop's "Scoring & timer" section has its own "Show a live
timer" toggle, independent of "Include in scoring" — so you can put a
countdown on an info stop purely for pace with no points attached, or hide
the clock on a stop that still counts, whatever reads better for that
particular moment.

### Photo capture

Any stop can offer an in-app **"📸 Take a photo"** button — on by default for
**Dare** stops, off for everything else, overridable per stop regardless of
type (**Photo capture** section on each stop). Tapping it opens the phone's
actual camera (`capture=environment` — Android Chrome and iOS Safari both
honour this; desktop browsers just fall back to an ordinary file picker).

**What "stored" actually means here, because it's easy to assume more than
is true:**

- **A photo taken in-app does NOT land in the camera roll by itself.** When
  the camera opens *inside the browser* like this, iOS hands the shot
  straight to the web page and then throws it away — only the real Camera
  app writes to Photos. No web API can save to the album silently, so the
  app shows a **"⬇️ Save to my Photos"** button that opens the native share
  sheet, where **Save Image** puts it in the album. It has to be tapped, per
  photo. (On desktop, that button downloads the file instead.)
- A small, downscaled copy (capped at 640px, so a few KB to a couple hundred
  KB) is kept **in that phone's browser only**, so the group can see a "got
  it" preview and a recap grid on the finish screen before the hunt ends.
  The share button hands over the **full-resolution** original where it
  can — after a page reload it can only offer the smaller stored copy, so
  save early rather than at the end.
- **Nothing is uploaded anywhere.** This project is a static site with no
  backend and nowhere to send a file to (see [Architecture](#8-known-limits)
  below) — there is no shared album, no server copy, and no way to see a
  photo from a different device. If the browser's storage is cleared, or a
  different phone continues the game, anything not saved to Photos is gone.

> If keeping the photos matters more than the in-app flow, the most reliable
> option on the night is simply: shoot it in the **normal Camera app** (which
> always saves to the album), then use **"Or choose one from your photos"** to
> attach it to the stop. Belt and braces.

If you want photos genuinely centralised — visible from any device, not just
the one that took them — that needs real infrastructure this project
deliberately doesn't have (a hosted upload endpoint and somewhere to put the
files). The simplest zero-code option: have the group manually add dare
photos to a shared album (Google Photos shared album, Apple Shared Album,
etc.) via their phone's normal share sheet — no app changes needed, just tell
them the link. A wired-up upload button is possible too, but means picking
and paying for a storage provider and giving this project real credentials —
a bigger decision than editing content, so it's intentionally not done here
without asking first.

### Final group selfie

An optional last step, off by default (a hand-written `content.js` from
before this feature existed has no `config.finalSelfie` block, so nothing
changes for it) — turn it on from **Game settings → Final group selfie**.

When it's on, one extra screen appears right after the last stop, before the
results: everyone piles in for a group selfie, using the exact same
capture/fallback/save-to-Photos pipeline as a stop's photo control. It's
deliberately **not** a stop — no timer, no points, not counted in "Stop N of
M" — and the photo is required; there's no skipping past it (mirrors the
per-stop required-photo gate, including the same keyboard-bypass guard).

On the finish screen this pairs side-by-side with the **earliest** photo
taken anywhere earlier in the hunt (first match in stop order) under a
"🤳 Then & Now" heading — a quick before/after of the night. If no earlier
photo exists to pair with, it just shows the selfie alone. All the wording
(title, prompt, button, captions) lives in **Buttons & labels → Photo
capture**, same as everything else photo-related.

### Customising wording

**Buttons & labels** covers every fixed string in the game. Leave a box empty
and it falls back to the built-in default, which is shown as the greyed-out
placeholder — so you can always see what you're overriding. There's a
reset-everything button at the top.

Some labels take tokens: `{n}` (hint number / current stop), `{total}` (number
of stops), `{min}` (the relevant penalty), `{skipMin}` (skip penalty),
`{pts}`/`{earned}`/`{possible}`/`{percent}` (the points system, see below).
For example `"Leg {n} of {total}"` or `"Peek at hint {n} (costs {min}m)"`.

**Per-stop overrides** live on the stop itself, and beat the game-wide label:
the "we're here" button, the submit/confirm button, the next button, the answer
box label and placeholder, both card headings, the big success emoji, and the
success headline. Handy for making one stop read differently — e.g. `🎯 The
dare` instead of `🧩 The puzzle`.

### The save model — important

The editor **autosaves a draft to your browser** as you type. That draft is
*not* live. To make changes real:

1. Click **⬇ Export content.js** — your browser downloads a new `content.js`.
2. Replace the old `content.js` in this folder with it.
3. Re-upload / redeploy (or `git commit -am "content" && git push` on Pages).

The bar under the toolbar always tells you which state you're in. **Backup
.json** / **Restore .json** are there for keeping snapshots or moving your work
to another machine; **Discard draft** throws away the draft and reloads
whatever's in `content.js`.

⚠️ Exporting **rewrites the whole `content.js`**, so hand-written `//` comments
in it are lost. Put notes in a stop's **Organiser notes** field instead — that's
a real field (`verifyNote`) and it survives every export.

### About the photos

There's no server, so there's nowhere to upload an image to. The editor solves
this by **downscaling each photo in your browser** (max 1400px, JPEG quality
0.72) and embedding it directly in `content.js` as a data URI. A 4 MB phone
photo becomes roughly 100–300 KB.

That means photos make `content.js` bigger, and the whole thing has to download
over 4G before anyone can play. The editor shows a running total in the toolbar
and warns you above ~3 MB. Rule of thumb: a handful of photos is fine, twenty
full-frame ones is not.

Players can tap any photo to view it full-screen — which makes
spot-the-difference and "find this exact detail" puzzles work properly.

Five photo slots exist: **travel clue**, **puzzle**, **success screen** (only
shown when they actually solve it, never when they give up), plus **start** and
**finish** screens in Game settings.

### Editing `content.js` by hand instead

Still perfectly possible — it's plain JavaScript and heavily commented.

### What must be filled in before the event

The editor's **Pre-event checklist** panel lists all of this live. For
reference, five stops ship with `[INSERT: ...]` placeholders:

| Stop | What it is | What you need to write |
|------|-----------|------------------------|
| **3** — The Little Princess | Personal, roast | A funny/embarrassing Danil story + a one-word answer |
| **5** — The Fat Policeman | Personal, **dare** | The silly thing he must do on camera |
| **7** — First Round | Pub crawl | Bar #1's name and address |
| **8** — Gozsdu udvar | Pub crawl | Bar #2's name (inside the passage) |
| **9** — Last Stop | Personal, **sincere** | The earnest one. Write this last, write it properly. |

Stops 3 and 9 also have `"[ANSWER: fill in later]"` in their `answers` list.

**Placeholder stops are playable as-is.** Any answer string starting with
`[ANSWER:` tells the app the stop isn't written yet: it shows an amber warning
banner and accepts *any* non-empty text, so you can walk the whole hunt end to
end before writing a word of personal content. Replace it with real answers and
the banner disappears on its own.

### Changing an answer

```js
answers: ["sör", "sor", "beer"],
```

It's a list — add as many accepted variants as you like. Matching already
ignores capitals, accents (`sör` = `sor`), punctuation and stray whitespace, so
you don't need to list those yourself. It does **not** do fuzzy spelling
matching, deliberately — that causes false positives on short answers like
`72`.

### Tuning the difficulty

At the top of `content.js`, in `config`:

```js
hintPenaltyMinutes: 5,       // time added per hint revealed; set 0 for free hints
skipAfterWrongAnswers: 4,    // wrong answers before the "give up" button appears
skipPenaltyMinutes: 15,      // cost of skipping a stop entirely
```

The "give up" button only appears once the group has revealed **every** hint on
that stop **and** been wrong `skipAfterWrongAnswers` times — so it can't be
stumbled into, but nobody's night ends stuck on a puzzle because a statue moved.

### Adding, removing or reordering stops

Add or delete objects in the `stops` array. The progress counter, "Stop N of M"
labels, progress bar and finish screen all adapt automatically. Just keep each
stop's `id` unique.

### After any edit, run the checks

```bash
node test.js
```

432 checks covering answer normalisation, matching, task types (including the
picker/branching logic and the one-try-choice fail path), label tokens, the timer (including the independent
show/hide toggle), penalty maths, the skip gate, the points/decay curve,
STAG-level thresholds, the home-page scoring explainer, the final-selfie
toggle, photo-capture defaults, embedded-image sanity, and the
structure of every stop in
`content.js`. It also prints which stops still contain unfilled placeholders.
It won't tell you if a riddle is bad — that's what walking the route is for.

---

## 5. Before the night — a real checklist

- [ ] **Walk the route.** Every stop has an **Organiser notes** entry naming the
      exact on-site detail its puzzle depends on (see the editor's Pre-event
      checklist). Statues move, scaffolding goes up, info boards get replaced.
      Check each one — and take the photos you want to embed while you're there.
- [ ] **Count the Gozsdu udvar courtyards yourself** (stop 8). The answer
      currently accepts both 6 and 7 because it's genuinely ambiguous when
      you're three drinks in. Tighten it once you've walked it.
- [ ] **Walk it at the same time of day/week you'll run it.** The back half is
      in the ruin bar district; after ~22:00 it's loud and packed enough that
      reading a puzzle off a phone gets genuinely hard. Consider starting
      earlier than feels necessary.
- [ ] **Pick the two bars** and put their names in stops 7 and 8.
- [ ] **Fill in the three Danil stops** (3, 5, 9).
- [ ] **Test on the actual phone** that'll be used, on 4G, not wifi.
- [ ] Charge a battery pack. The hunt keeps the screen awake where the browser
      allows it, which is good for playing and bad for batteries.

---

## 6. The route

~3.5 km, flat, Districts V → VI → VII.

1. **Deák Ferenc tér** — counting + arithmetic
2. **Vörösmarty tér** — read an inscription, unscramble a word
3. **Little Princess statue** (Danube promenade) — ★ personal: the roast
4. **Chain Bridge lions** — observation riddle
5. **The Fat Policeman** (Zrínyi utca) — ★ personal: the dare, photo proof
6. **St Stephen's Basilica** — Caesar cipher, shift found on-site
7. **Jewish Quarter / bar #1** — Hungarian word decoder + toast
8. **Gozsdu udvar / bar #2** — counting + stranger photo
9. **Kazinczy utca / final bar** — ★ personal: the sincere one, then the finish screen

Each stop uses a different puzzle mechanic on purpose. The drinking challenges
at stops 7–9 are tied to things you can *observe* at the bar, not to actually
drinking — designated drivers and non-drinkers are never blocked from
progressing.

**Deliberately not used:** the Shoes on the Danube Bank memorial and the
monuments on Szabadság tér. Both are a short detour from stop 4 and worth
seeing — neither belongs in a bachelor-party riddle. Please leave it that way.

---

## 7. How the game state works

The app uses four `localStorage` keys, all independent of each other:

| key | what |
|---|---|
| `budapest-hunt-v1` | the real game's progress |
| `budapest-hunt-draft` | the editor's autosaved draft |
| `budapest-hunt-preview` | the draft staged for a Preview run |
| `budapest-hunt-preview-progress` | a Preview run's progress, kept separate so previewing can never disturb the live game |

The game's own state lives in `budapest-hunt-v1`:
current stop, which view they're on, hints revealed, wrong-answer counts,
accepted answers, skipped stops, and the start timestamp.

The timer is **wall-clock** — it's computed from the start timestamp, not
counted up in the page. Closing the tab, locking the phone or killing the
browser doesn't pause it, and reopening the link drops you exactly where you
were with the correct elapsed time. (Tested: verified across full page reloads.)

The `⟲` button in the top-right corner abandons the run and starts over. It's
small, unlabelled and double-confirms on purpose.

To wipe a run manually — e.g. after your own test walk-through, before handing
the phone over on the night — open the hosted page and run this in the browser
console, or just tap `⟲`:

```js
localStorage.removeItem('budapest-hunt-v1')
```

---

## 8. Known limits

- **One phone, one game.** State is per-device. If two people open the link
  they get two independent hunts. That's intentional — one phone passed around
  is the better format anyway.
- **Photos never leave the phone that took them, and don't reach the camera
  roll unprompted.** Players can capture a photo in-app (see
  [Photo capture](#photo-capture) above), but keeping it means tapping
  "Save to my Photos" and choosing Save Image — a browser page can't write
  to the album on its own. A small copy stays in that phone's browser for
  the in-app preview and recap. There's no shared album,
  no server copy, no way to see it from a different device. Actually
  centralising photos needs a real backend, which this project deliberately
  doesn't have (see that section for the zero-code workaround).
- **The editor's draft is per-browser.** It lives in `localStorage`, so it
  doesn't sync between machines and a cleared browser cache takes it with it.
  Export `content.js` (or a `.json` backup) whenever you've done real work.
- **No undo in the editor.** Deleting a stop asks for confirmation and that's
  it. Take a `.json` backup before a big restructure.
- **No GPS check.** Nothing verifies you're actually at the location. Again:
  honour system. It's a bachelor party, not an exam.
- **Recurrence of "not quite" messages** cycles through a fixed list, so on a
  very bad stop the group will see one repeat. Add more strings to
  `config.wrongAnswerMessages` if that bothers you.
