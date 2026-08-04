/* ============================================================================
 * admin.js — the hunt editor.
 *
 * Loads content.js, lets you edit everything in a form, keeps an autosaved
 * draft in this browser's localStorage, and exports a fresh content.js when
 * you're done. Nothing leaves your machine; there's no server involved.
 *
 * Images are downscaled in the browser and embedded as data URIs, because a
 * static site has nowhere to upload a file to.
 * ========================================================================== */

(function () {
  "use strict";

  var DRAFT_KEY   = "budapest-hunt-draft";
  var PREVIEW_KEY = "budapest-hunt-preview";

  // Images bigger than this (after downscaling) get flagged in the UI.
  var IMAGE_WARN_BYTES = 500 * 1024;
  // Whole-file size at which 4G load time starts to hurt.
  var TOTAL_WARN_BYTES = 3 * 1024 * 1024;
  // Downscale target. 1400px is plenty for a phone screen, even zoomed.
  var IMAGE_MAX_DIM = 1400;
  var IMAGE_QUALITY = 0.72;

  var $ = function (id) { return document.getElementById(id); };
  var clone = function (o) { return JSON.parse(JSON.stringify(o)); };

  /* ==========================================================================
   * TINY DOM HELPER
   * ======================================================================== */

  function el(tag, attrs) {
    var node = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k === "html") node.innerHTML = v;
      else if (k.slice(0, 2) === "on") node.addEventListener(k.slice(2), v);
      else if (k === "value") node.value = v;
      else if (v === true) node.setAttribute(k, "");
      else node.setAttribute(k, v);
    });
    for (var i = 2; i < arguments.length; i++) {
      var kid = arguments[i];
      if (kid == null || kid === false) continue;
      if (Array.isArray(kid)) kid.forEach(function (k) { if (k) node.appendChild(k); });
      else node.appendChild(typeof kid === "string" ? document.createTextNode(kid) : kid);
    }
    return node;
  }

  /* ==========================================================================
   * DRAFT STATE
   * ======================================================================== */

  var draft = loadDraft();
  var selection = { type: "stop", index: 0 };
  var hasStoredDraft = false;

  function loadDraft() {
    try {
      var raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && parsed.config && Array.isArray(parsed.stops)) {
          hasStoredDraft = true;
          return parsed;
        }
      }
    } catch (e) { /* fall through to content.js */ }
    return clone(HUNT);
  }

  function saveDraft() {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
      hasStoredDraft = true;
    } catch (e) {
      // Almost certainly the ~5MB localStorage quota, blown by embedded images.
      setSaveBar("⚠️ Couldn't autosave — too many/large images for this browser's " +
                 "storage limit. Export content.js NOW so you don't lose work.", true);
      return false;
    }
    return true;
  }

  /** Called after any edit: persist, then refresh everything except the form. */
  function touch() {
    if (saveDraft()) {
      setSaveBar("Draft autosaved to this browser · export content.js to make it live", true);
    }
    renderSidebar();
    renderStats();
    refreshProblems();
  }

  /**
   * Repaint just the warnings box at the top of a stop's form. Safe to call on
   * every keystroke — it never touches the inputs, so focus and cursor position
   * survive.
   */
  function refreshProblems() {
    var box = $("stopProblems");
    if (!box || selection.type !== "stop") return;
    var stop = draft.stops[selection.index];
    if (!stop) return;

    box.innerHTML = "";
    var problems = stopProblems(stop, selection.index);
    if (!problems.length) return;

    var worst = problems.some(function (p) { return p.level === "red"; }) ? "red" : "amber";
    box.appendChild(el("div", { class: "warnbox " + worst },
      el("strong", { text: worst === "red" ? "Needs fixing:" : "Still to do:" }),
      el("ul", {}, problems.map(function (p) { return el("li", { text: p.text }); }))
    ));
  }

  function setSaveBar(text, dirty) {
    var bar = $("saveBar");
    bar.textContent = text;
    bar.className = "savebar" + (dirty ? " dirty" : "");
  }

  function toast(msg) {
    var t = $("toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(t._timer);
    t._timer = setTimeout(function () { t.hidden = true; }, 2600);
  }

  /* ==========================================================================
   * VALIDATION
   * ======================================================================== */

  function byteSize(str) {
    // data: URIs are base64 — close enough for a size readout.
    return Math.round((str || "").length * 0.75);
  }

  function imageBytes(image) {
    var src = image && image.src;
    if (!src || src.indexOf("data:") !== 0) return 0;
    return byteSize(src);
  }

  function totalBytes() {
    return JSON.stringify(draft).length;
  }

  function isPlaceholder(stop) {
    return HuntLogic.isPlaceholderStop(stop);
  }

  function hasInsertMarkers(stop) {
    return /\[INSERT:/i.test(JSON.stringify(stop));
  }

  /** Returns an array of {level, text} problems for one stop. */
  function stopProblems(stop, index) {
    var out = [];
    var type = HuntLogic.stopType(stop);
    var needsAnswer = HuntLogic.typeNeedsAnswer(type);

    if (!stop.name || !stop.name.trim()) out.push({ level: "red", text: "No name." });
    if (!stop.id || !stop.id.trim()) out.push({ level: "red", text: "No id." });
    var dupes = draft.stops.filter(function (s, i) { return i !== index && s.id === stop.id; });
    if (dupes.length) out.push({ level: "red", text: 'Duplicate id "' + stop.id + '" — ids must be unique.' });
    if (!HuntLogic.hasTravelClue(stop)) {
      // On-site puzzle — no walk, no clue to write.
    } else if (!stop.travelClue || stop.travelClue.trim().length < 10) {
      out.push({ level: "red", text: "Travel clue is empty or very short." });
    }
    if (!stop.puzzle || stop.puzzle.trim().length < 10) out.push({ level: "red", text: "Puzzle text is empty or very short." });

    if (needsAnswer) {
      if (isPlaceholder(stop)) {
        out.push({ level: "amber", text: "No real answer yet — this stop accepts anything typed into it." });
      }
      // Rows that are entirely blank are just unfilled — the player never sees
      // them and export drops them, so they're not worth shouting about. But a
      // row with only punctuation ("???", "--") looks filled in and isn't:
      // nothing a player can type will ever match it.
      (stop.answers || []).forEach(function (a) {
        var raw = String(a);
        if (raw.trim() && !HuntLogic.normalize(raw)) {
          out.push({ level: "red", text: 'The answer "' + raw + '" is only punctuation. ' +
            'Answers are matched on letters and numbers, so nothing a player types can ever match it — ' +
            'give it a word or a number, or delete the row.' });
        }
      });
    }

    if (type === "choice") {
      var choices = (stop.choices || []).filter(function (c) { return String(c).trim(); });
      if (choices.length < 2) {
        out.push({ level: "red", text: "Multiple choice needs at least two options." });
      }
      // The correct answer has to actually be one of the buttons, or the stop
      // is unwinnable — the classic way to break a choice question.
      if (choices.length && !isPlaceholder(stop)) {
        var reachable = choices.some(function (c) { return HuntLogic.checkAnswer(stop, c).ok; });
        if (!reachable) {
          out.push({ level: "red", text: "None of the options match an accepted answer — this stop can't be solved." });
        }
      }
    }

    if (hasInsertMarkers(stop)) out.push({ level: "amber", text: "Still contains [INSERT: ...] text." });
    if (needsAnswer && !(stop.hints || []).length) {
      out.push({ level: "amber", text: "No hints — the group has no way out if they get stuck." });
    }

    ["travelImage", "puzzleImage", "successImage"].forEach(function (k) {
      var b = imageBytes(stop[k]);
      if (b > IMAGE_WARN_BYTES) {
        out.push({ level: "amber", text: k + " is " + fmtBytes(b) + " — heavy on 4G. Consider a smaller photo." });
      }
    });

    if (HuntLogic.isScoredStop(stop)) {
      var scoring = HuntLogic.resolveScoring(draft.config, stop);
      if (scoring.targetSeconds <= 0) out.push({ level: "red", text: "Target time must be greater than 0 seconds." });
      if (scoring.basePoints <= 0) out.push({ level: "red", text: "Max points must be greater than 0." });
      if (scoring.minPoints < 0) out.push({ level: "red", text: "Minimum points can't be negative." });
      if (scoring.minPoints > scoring.basePoints) {
        out.push({ level: "red", text: "Minimum points (" + scoring.minPoints + ") is higher than max points (" +
          scoring.basePoints + ") — this stop would score MORE the slower it's solved." });
      }
      if (scoring.decayWindowSeconds < 0) out.push({ level: "red", text: "Decay window can't be negative." });
      if (scoring.hintPointPenalty < 0) out.push({ level: "amber", text: "A negative hint penalty would give points back for using a hint." });
    }
    return out;
  }

  function fmtBytes(b) {
    if (b < 1024) return b + " B";
    if (b < 1024 * 1024) return Math.round(b / 1024) + " KB";
    return (b / 1024 / 1024).toFixed(1) + " MB";
  }

  /* ==========================================================================
   * SIDEBAR
   * ======================================================================== */

  function renderStats() {
    var stops = draft.stops.length;
    var todo = draft.stops.filter(function (s) { return isPlaceholder(s) || hasInsertMarkers(s); }).length;
    var imgs = draft.stops.reduce(function (n, s) {
      return n + (s.travelImage ? 1 : 0) + (s.puzzleImage ? 1 : 0) + (s.successImage ? 1 : 0);
    }, 0) + (draft.config.startImage ? 1 : 0) + (draft.config.finishImage ? 1 : 0);
    var size = totalBytes();
    $("topStats").textContent =
      stops + " stops · " + imgs + " photos · " + fmtBytes(size) +
      (todo ? " · " + todo + " need content" : " · all filled in");
  }

  function renderSidebar() {
    var list = $("stopList");
    list.innerHTML = "";

    draft.stops.forEach(function (stop, i) {
      var problems = stopProblems(stop, i);
      var red = problems.filter(function (p) { return p.level === "red"; }).length;
      var amber = problems.filter(function (p) { return p.level === "amber"; }).length;

      var flags = [];
      var TYPE_ICON = { text: "", choice: "🔘", dare: "🎯", info: "ℹ️" };
      var icon = TYPE_ICON[HuntLogic.stopType(stop)];
      if (icon) flags.push(icon);
      if (stop.travelImage || stop.puzzleImage || stop.successImage) flags.push("🖼");
      if (HuntLogic.wantsPhotoCapture(stop)) flags.push("📷");
      if (red) flags.push('<span class="warn">' + red + " error" + (red > 1 ? "s" : "") + "</span>");
      else if (amber) flags.push('<span class="warn">' + amber + " to do</span>");
      else flags.push("ready");

      var item = el("li", {
        class: "stop-item" + (selection.type === "stop" && selection.index === i ? " active" : ""),
        onclick: function (e) {
          if (e.target.closest(".stop-tool")) return;
          select({ type: "stop", index: i });
        }
      },
        el("div", { class: "stop-idx", text: String(i + 1) }),
        el("div", { class: "stop-label" },
          el("div", { class: "stop-name", text: stop.name || "(untitled)" }),
          el("div", { class: "stop-flags", html: flags.join(" · ") })
        ),
        el("div", { class: "stop-tools" },
          el("button", {
            class: "stop-tool", title: "Move up", text: "↑",
            onclick: function () { moveStop(i, -1); }
          }),
          el("button", {
            class: "stop-tool", title: "Move down", text: "↓",
            onclick: function () { moveStop(i, 1); }
          }),
          el("button", {
            class: "stop-tool", title: "Duplicate", text: "⧉",
            onclick: function () { duplicateStop(i); }
          }),
          el("button", {
            class: "stop-tool danger", title: "Delete", text: "✕",
            onclick: function () { deleteStop(i); }
          })
        )
      );
      list.appendChild(item);
    });

    [["navSettings", "settings"], ["navLabels", "labels"], ["navTheme", "theme"],
     ["navScoring", "scoring"], ["navChecklist", "checklist"]].forEach(function (p) {
      $(p[0]).className = "side-nav" + (selection.type === p[1] ? " active" : "");
    });
  }

  /* ==========================================================================
   * STOP OPERATIONS
   * ======================================================================== */

  function slugify(name) {
    return (name || "stop")
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
      .slice(0, 40) || "stop";
  }

  function uniqueId(base, ignoreIndex) {
    var id = base, n = 2;
    var taken = function (candidate) {
      return draft.stops.some(function (s, i) { return i !== ignoreIndex && s.id === candidate; });
    };
    while (taken(id)) { id = base + "-" + n; n++; }
    return id;
  }

  function moveStop(i, dir) {
    var j = i + dir;
    if (j < 0 || j >= draft.stops.length) return;
    var tmp = draft.stops[i];
    draft.stops[i] = draft.stops[j];
    draft.stops[j] = tmp;
    if (selection.type === "stop" && selection.index === i) selection.index = j;
    else if (selection.type === "stop" && selection.index === j) selection.index = i;
    touch();
    renderEditor();
  }

  function duplicateStop(i) {
    var copy = clone(draft.stops[i]);
    copy.name = (copy.name || "Stop") + " (copy)";
    copy.id = uniqueId(slugify(copy.name));
    draft.stops.splice(i + 1, 0, copy);
    touch();                       // structural change — persist it immediately
    select({ type: "stop", index: i + 1 });
  }

  function deleteStop(i) {
    var name = draft.stops[i].name || "this stop";
    if (!confirm('Delete "' + name + '"?\n\nThis can\'t be undone (but your last export still has it).')) return;
    draft.stops.splice(i, 1);
    if (!draft.stops.length) {
      draft.stops.push(blankStop());
    }
    touch();
    var next = Math.min(i, draft.stops.length - 1);
    select({ type: "stop", index: next });
  }

  function blankStop() {
    return {
      id: uniqueId("new-stop"),
      verifyNote: "",
      name: "New stop",
      teaser: "",
      travelClue: "",
      arrivalNote: "",
      puzzle: "",
      hints: [""],
      answers: [],
      successMessage: ""
    };
  }

  function addStop() {
    draft.stops.push(blankStop());
    touch();
    select({ type: "stop", index: draft.stops.length - 1 });
  }

  function select(sel) {
    selection = sel;
    renderSidebar();
    renderEditor();
    window.scrollTo(0, 0);
  }

  /* ==========================================================================
   * FIELD BUILDERS
   * ======================================================================== */

  function field(labelText, control, helpText) {
    return el("div", { class: "field" },
      el("label", { text: labelText }),
      control,
      helpText ? el("p", { class: "help", text: helpText }) : null
    );
  }

  function textInput(value, onInput, placeholder) {
    return el("input", {
      type: "text", value: value || "", placeholder: placeholder || "",
      oninput: function () { onInput(this.value); }
    });
  }

  function textArea(value, onInput, opts) {
    opts = opts || {};
    return el("textarea", {
      class: opts.tall ? "tall" : "",
      placeholder: opts.placeholder || "",
      value: value || "",
      oninput: function () { onInput(this.value); }
    });
  }

  function numberInput(value, onInput, min) {
    return el("input", {
      type: "number", value: String(value == null ? 0 : value), min: String(min == null ? 0 : min),
      oninput: function () { onInput(this.value === "" ? 0 : Number(this.value)); }
    });
  }

  /**
   * A number field that can be genuinely blank — used for per-stop scoring
   * overrides, where blank means "inherit the game-wide default" (shown as
   * the placeholder) rather than "zero".
   */
  function optionalNumberInput(value, onInput, placeholderValue) {
    return el("input", {
      type: "number",
      value: value == null ? "" : String(value),
      placeholder: placeholderValue == null ? "" : String(placeholderValue),
      oninput: function () {
        onInput(this.value === "" ? undefined : Number(this.value));
      }
    });
  }

  function selectInput(value, options, onChange) {
    var sel = el("select", {
      onchange: function () { onChange(this.value); }
    });
    options.forEach(function (opt) {
      sel.appendChild(el("option", { value: opt.value, text: opt.label }));
    });
    sel.value = value;
    return sel;
  }

  function colorInput(value, onInput) {
    var swatch = el("input", {
      type: "color", value: value || "#000000",
      oninput: function () { hex.value = this.value; onInput(this.value); }
    });
    var hex = el("input", {
      type: "text", value: value || "", placeholder: "#12100e",
      oninput: function () {
        if (/^#[0-9a-f]{6}$/i.test(this.value)) { swatch.value = this.value; onInput(this.value); }
      }
    });
    return el("div", { class: "color-row" }, swatch, hex);
  }

  /**
   * An editable list of strings (hints, answers, how-to-play lines, …).
   * Re-renders itself in place when rows are added or removed.
   */
  function listField(labelText, getArr, setArr, helpText, opts) {
    opts = opts || {};
    var wrap = el("div", { class: "field" });

    function paint() {
      wrap.innerHTML = "";
      wrap.appendChild(el("label", { text: labelText }));

      var rows = el("div", { class: "list-rows" });
      var arr = getArr();

      arr.forEach(function (val, i) {
        var control = opts.multiline
          ? textArea(val, function (v) { arr[i] = v; setArr(arr); touch(); },
                     { placeholder: opts.placeholder })
          : textInput(val, function (v) { arr[i] = v; setArr(arr); touch(); },
                      opts.placeholder);
        rows.appendChild(el("div", { class: "list-row" },
          control,
          el("button", {
            class: "row-del", text: "✕", title: "Remove",
            onclick: function () { arr.splice(i, 1); setArr(arr); touch(); paint(); }
          })
        ));
      });

      if (!arr.length) {
        rows.appendChild(el("p", { class: "help", text: opts.emptyText || "None yet." }));
      }

      wrap.appendChild(rows);
      wrap.appendChild(el("button", {
        class: "list-add", text: opts.addLabel || "+ Add",
        onclick: function () { arr.push(""); setArr(arr); touch(); paint(); }
      }));
      if (helpText) wrap.appendChild(el("p", { class: "help", text: helpText }));
    }

    paint();
    return wrap;
  }

  /* ---- image field --------------------------------------------------------- */

  /**
   * Downscale + re-encode in the browser. Phone photos are 3–5 MB; embedding
   * one raw would make the whole game unloadable on 4G.
   */
  function processImage(file) {
    return new Promise(function (resolve, reject) {
      if (!file || !/^image\//.test(file.type)) {
        reject(new Error("That isn't an image file."));
        return;
      }
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error("Couldn't read that file.")); };
      reader.onload = function () {
        var img = new Image();
        img.onerror = function () {
          reject(new Error("Couldn't decode that image. If it's a HEIC photo from an " +
                           "iPhone, export it as JPEG first."));
        };
        img.onload = function () {
          var w = img.naturalWidth, h = img.naturalHeight;
          var scale = Math.min(1, IMAGE_MAX_DIM / Math.max(w, h));
          w = Math.max(1, Math.round(w * scale));
          h = Math.max(1, Math.round(h * scale));
          var canvas = el("canvas");
          canvas.width = w; canvas.height = h;
          var ctx = canvas.getContext("2d");
          ctx.fillStyle = "#000";
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL("image/jpeg", IMAGE_QUALITY));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function imageField(labelText, getImg, setImg, helpText) {
    var wrap = el("div", { class: "field" });

    function apply(file) {
      processImage(file).then(function (dataUri) {
        var current = getImg() || {};
        setImg({ src: dataUri, caption: current.caption || "" });
        touch();
        paint();
        toast("Photo added (" + fmtBytes(byteSize(dataUri)) + ")");
      }).catch(function (err) { alert(err.message); });
    }

    function paint() {
      wrap.innerHTML = "";
      wrap.appendChild(el("label", { text: labelText }));

      var img = getImg();
      var box = el("div", { class: "imgfield" });

      // drag & drop
      box.addEventListener("dragover", function (e) { e.preventDefault(); box.classList.add("dragover"); });
      box.addEventListener("dragleave", function () { box.classList.remove("dragover"); });
      box.addEventListener("drop", function (e) {
        e.preventDefault();
        box.classList.remove("dragover");
        if (e.dataTransfer.files && e.dataTransfer.files[0]) apply(e.dataTransfer.files[0]);
      });

      var picker = el("input", {
        type: "file", accept: "image/*", hidden: true,
        onchange: function () { if (this.files[0]) apply(this.files[0]); this.value = ""; }
      });

      if (img && img.src) {
        var bytes = imageBytes(img);
        box.appendChild(el("div", { class: "imgfield-preview" },
          el("img", { src: img.src, alt: "" }),
          el("div", { class: "imgfield-meta" },
            el("p", {
              class: "imgfield-size" + (bytes > IMAGE_WARN_BYTES ? " big" : ""),
              text: bytes ? fmtBytes(bytes) + " embedded in the page"
                          : "Linked file (not embedded): " + img.src
            }),
            textInput(img.caption, function (v) {
              var cur = getImg() || {}; cur.caption = v; setImg(cur); touch();
            }, "Optional caption shown under the photo"),
            el("div", { class: "imgbtns" },
              el("button", { class: "imgbtn", text: "Replace", onclick: function () { picker.click(); } }),
              el("button", {
                class: "imgbtn danger", text: "Remove",
                onclick: function () { setImg(null); touch(); paint(); }
              })
            )
          )
        ));
      } else {
        box.appendChild(el("div", { class: "imgfield-empty" },
          el("p", { text: "Drop a photo here, paste one, or…", style: "margin:0 0 10px" }),
          el("button", { class: "imgbtn", text: "Choose a photo", onclick: function () { picker.click(); } })
        ));
      }

      box.appendChild(picker);
      wrap.appendChild(box);
      wrap.appendChild(el("p", {
        class: "help",
        text: helpText || ("Resized to max " + IMAGE_MAX_DIM + "px and embedded directly in the " +
              "page — no image hosting needed. Players can tap it to view full screen.")
      }));

      // paste-to-add, while this field is on screen
      box.addEventListener("paste", function (e) {
        var items = (e.clipboardData || {}).items || [];
        for (var i = 0; i < items.length; i++) {
          if (items[i].type.indexOf("image") === 0) { apply(items[i].getAsFile()); e.preventDefault(); return; }
        }
      });
      box.setAttribute("tabindex", "0");
    }

    paint();
    return wrap;
  }

  /* ==========================================================================
   * EDITOR PANELS
   * ======================================================================== */

  function renderEditor() {
    var main = $("editor");
    main.innerHTML = "";
    if (selection.type === "settings") return renderSettings(main);
    if (selection.type === "labels") return renderLabels(main);
    if (selection.type === "theme") return renderTheme(main);
    if (selection.type === "scoring") return renderScoring(main);
    if (selection.type === "checklist") return renderChecklist(main);
    renderStop(main, selection.index);
  }

  /* ---- one stop ------------------------------------------------------------ */

  function renderStop(main, index) {
    var stop = draft.stops[index];
    if (!stop) { selection = { type: "stop", index: 0 }; return renderEditor(); }

    var set = function (key) {
      return function (v) { stop[key] = v; touch(); };
    };

    main.appendChild(el("h2", { class: "panel-title", text: "Stop " + (index + 1) + " — " + (stop.name || "untitled") }));
    main.appendChild(el("p", { class: "panel-sub", text: "Players see this as stop " + (index + 1) + " of " + draft.stops.length + "." }));

    // Problems live in their own container so they can be repainted on every
    // keystroke (via refreshProblems) without rebuilding the form and stealing
    // focus out of whatever field is being typed into.
    main.appendChild(el("div", { id: "stopProblems" }));
    refreshProblems();

    // ---- identity
    var fsId = el("fieldset", { class: "fieldset" },
      el("h3", { text: "Identity" }),
      el("div", { class: "row2" },
        field("Name", textInput(stop.name, function (v) {
          stop.name = v; touch();
          // keep the heading in sync without losing focus
          main.querySelector(".panel-title").textContent = "Stop " + (index + 1) + " — " + (v || "untitled");
        }), "Organiser-facing, and shown as the heading on the puzzle screen."),
        field("id", textInput(stop.id, function (v) { stop.id = v.trim(); touch(); }),
              "Used to save progress. Must be unique. Avoid changing it mid-event.")
      ),
      field("Teaser", textInput(stop.teaser, set("teaser")),
            "The big heading above the travel clue. Keep it vague — it shouldn't give the location away.")
    );
    main.appendChild(fsId);

    // ---- task type
    var TYPE_INFO = {
      text:   "Players type an answer into a box. The classic.",
      choice: "Players tap one of several options. Good when the answer is hard to spell, or for an \"odd one out\".",
      dare:   "Nothing to answer — one button confirms they did the thing. Can't be failed, so no hints penalty trap and no give-up button.",
      info:   "No challenge at all. A story beat, a warning, or a waypoint. One button continues."
    };
    main.appendChild(el("fieldset", { class: "fieldset" },
      el("h3", { text: "Task type" }),
      field("Type", selectInput(HuntLogic.stopType(stop), [
        { value: "text",   label: "Text answer — type it in" },
        { value: "choice", label: "Multiple choice — tap an option" },
        { value: "dare",   label: "Dare / photo — tap to confirm done" },
        { value: "info",   label: "Info only — no challenge" }
      ], function (v) {
        stop.type = v;
        if (v === "choice" && !stop.choices) stop.choices = ["", "", ""];
        touch();
        renderEditor();     // the rest of the form changes shape
      }), TYPE_INFO[HuntLogic.stopType(stop)])
    ));

    // ---- photo capture (independent of type, though "dare" defaults it on)
    var photoOn = HuntLogic.wantsPhotoCapture(stop);
    var fsPhoto = el("fieldset", { class: "fieldset" },
      el("h3", { text: "Photo capture" }),
      field("Let players take a photo on this stop", selectInput(String(photoOn), [
        { value: "true",  label: "Yes — show a \"take a photo\" button" },
        { value: "false", label: "No" }
      ], function (v) {
        stop.photoCapture = (v === "true");
        touch();
        renderEditor();
      }), "On by default for Dare stops, off for everything else — but works on any type. " +
          "The photo saves to the player's camera roll automatically (that's just how phone " +
          "cameras work) and a small copy is kept in their browser to show a \"got it\" " +
          "preview and a recap at the finish screen. Nothing is uploaded anywhere — there's " +
          "no server in this project to upload it to.")
    );
    if (photoOn) {
      var required = HuntLogic.isPhotoRequired(stop);
      fsPhoto.appendChild(field("Require the photo to continue",
        selectInput(String(required), [
          { value: "true",  label: "Yes — can't move on without one" },
          { value: "false", label: "No — the photo is optional" }
        ], function (v) {
          if (v === "true") delete stop.photoRequired; else stop.photoRequired = false;
          touch();
          renderEditor();
        }),
        required
          ? "The proceed button stays greyed out until a photo is attached — on every task type, and it can't be bypassed with the keyboard either."
          : "Players can finish this stop without taking a photo."));
      fsPhoto.appendChild(field("\"Take a photo\" button text",
        textInput(stop.takePhotoButton, function (v) { stop.takePhotoButton = v; touch(); }),
        "Leave blank for the game-wide default."));
      fsPhoto.appendChild(field("Label above the photo control",
        textInput(stop.photoCaptureLabel, function (v) { stop.photoCaptureLabel = v; touch(); }),
        "Default \"📸 Photo proof\"."));
    }
    main.appendChild(fsPhoto);

    // ---- scoring & timer
    main.appendChild(renderStopScoring(stop));

    // ---- travel clue
    var travels = HuntLogic.hasTravelClue(stop);
    var fsTravel = el("fieldset", { class: "fieldset" },
      el("h3", { text: "1. Travel clue" }),
      field("Does this stop need a travel clue?", selectInput(String(travels), [
        { value: "true",  label: "Yes — the group has to walk/find somewhere first" },
        { value: "false", label: "No — solved right where they already are (skip this screen)" }
      ], function (v) {
        stop.skipTravel = (v === "false");
        touch();
        renderEditor();
      }), travels
        ? "The cryptic directions that get them walking. Blank lines become paragraph breaks."
        : "The group goes straight from the previous stop's finish screen into this puzzle — no clue, no \"We're here\" button.")
    );
    if (travels) {
      fsTravel.appendChild(field("Clue text", textArea(stop.travelClue, set("travelClue"), { tall: true })));
      fsTravel.appendChild(imageField("Photo (optional)", function () { return stop.travelImage; },
                 function (v) { stop.travelImage = v; }));
      fsTravel.appendChild(field("\"We're here\" button text", textInput(stop.arrivedButton, set("arrivedButton"),
            draft.config.labels && draft.config.labels.arrivedButton || "WE'RE HERE →"),
            "Leave blank to use the game-wide default."));
    }
    fsTravel.appendChild(field("Arrival note", textInput(stop.arrivalNote, set("arrivalNote")),
            "Small italic line at the top of the puzzle screen. Optional flavour, e.g. \"Phones out for this one.\""));
    main.appendChild(fsTravel);

    // ---- puzzle
    main.appendChild(el("fieldset", { class: "fieldset" },
      el("h3", { text: "2. On-site puzzle" }),
      el("p", { class: "fs-note", text: "What they do once they're standing there." }),
      field("Puzzle text", textArea(stop.puzzle, set("puzzle"), { tall: true })),
      imageField("Photo (optional)", function () { return stop.puzzleImage; },
                 function (v) { stop.puzzleImage = v; },
                 "Great for spot-the-difference, \"find this detail\", or showing exactly which statue you mean."),
      el("div", { class: "row2" },
        field("Clue card heading", textInput(stop.travelEyebrow, set("travelEyebrow")),
              "Default \"🧭 Travel clue\"."),
        field("Puzzle card heading", textInput(stop.puzzleEyebrow, set("puzzleEyebrow")),
              "Default \"🧩 The puzzle\". Try \"🍻 Bar challenge\" or \"🎯 The dare\".")
      )
    ));

    // ---- hints
    main.appendChild(el("fieldset", { class: "fieldset" },
      el("h3", { text: "3. Hints" }),
      el("p", { class: "fs-note", text: "Revealed one at a time, each costing " + (draft.config.hintPenaltyMinutes || 0) + " minutes. Convention: hint 1 nudges, the last one basically gives it away." }),
      listField("Hints", function () { return stop.hints || (stop.hints = []); },
                function (a) { stop.hints = a; },
                null,
                { multiline: true, addLabel: "+ Add hint", emptyText: "No hints — the group has no way out if they get stuck." })
    ));

    // ---- answers (shape depends on the task type)
    var type = HuntLogic.stopType(stop);
    var answersBox = el("fieldset", { class: "fieldset" });

    if (type === "text" || type === "choice") {
      var placeholderNote = isPlaceholder(stop)
        ? "⚠️ No real answers yet, so this stop accepts anything and shows an amber banner in the game. Add one below to make it a real puzzle."
        : "Matching already ignores capitals, accents (sör = sor), punctuation and extra spaces — you don't need to list those variants.";

      answersBox.appendChild(el("h3", { text: "4. Accepted answers" }));
      answersBox.appendChild(el("p", { class: "fs-note", text: placeholderNote }));

      if (type === "choice") {
        answersBox.appendChild(listField("Options shown as buttons",
          function () { return stop.choices || (stop.choices = []); },
          function (a) { stop.choices = a; },
          "Displayed in this order. Put the correct one in the Answers list below too.",
          { addLabel: "+ Add option", placeholder: "e.g. The lion has no tongue" }));
      }

      answersBox.appendChild(listField("Answers",
        function () { return stop.answers || (stop.answers = []); },
        function (a) { stop.answers = a; },
        type === "choice"
          ? "Must match one of the options above (matching is forgiving about case and accents)."
          : "Any one of these unlocks the next clue.",
        { addLabel: "+ Add accepted answer", placeholder: "e.g. tongue",
          emptyText: "No answers — this stop will accept anything." }));

      answersBox.appendChild(field(
        type === "choice" ? "\"Pick one\" label" : "Answer box label",
        textInput(stop.answerLabel, set("answerLabel")), "Optional override."));

      if (type === "text") {
        answersBox.appendChild(field("Answer box placeholder",
          textInput(stop.answerPlaceholder, set("answerPlaceholder"))));
        answersBox.appendChild(field("Submit button text",
          textInput(stop.submitButton, set("submitButton")), "Leave blank for the game-wide default."));
      }
    } else {
      answersBox.appendChild(el("h3", { text: "4. Confirmation" }));
      answersBox.appendChild(el("p", { class: "fs-note", text:
        type === "dare"
          ? "A dare can't be got wrong — one button says they did it. Honour system, which is the right system for a bachelor party."
          : "Info stops have nothing to solve. One button moves the group on." }));
      answersBox.appendChild(field("Button text", textInput(stop.confirmButton, set("confirmButton")),
        "Leave blank for the game-wide default (" +
        (type === "dare" ? "\"✅ DONE — WE HAVE PROOF\"" : "\"CONTINUE →\"") + ")."));
    }

    main.appendChild(answersBox);

    // ---- success screen
    main.appendChild(el("fieldset", { class: "fieldset" },
      el("h3", { text: "5. Success screen" }),
      el("p", { class: "fs-note", text: "What they see straight after getting it right." }),
      field("Success message", textArea(stop.successMessage, set("successMessage"))),
      imageField("Success photo (optional)", function () { return stop.successImage; },
                 function (v) { stop.successImage = v; },
                 "A reward image — an old photo of the groom, a meme, the answer revealed. Only shown when they actually solve it, never when they skip."),
      el("div", { class: "row2" },
        field("Big emoji", textInput(stop.solvedTick, set("solvedTick")),
              "Default ✅. Try 🍺 or 🏆."),
        field("Headline override", textInput(stop.solvedTitle, set("solvedTitle")),
              "Blank = a random one of the game-wide \"correct!\" messages.")
      ),
      field("\"Next\" button text", textInput(stop.nextButton, set("nextButton")),
            "Leave blank for the game-wide default.")
    ));

    // ---- organiser notes
    main.appendChild(el("fieldset", { class: "fieldset" },
      el("h3", { text: "Organiser notes" }),
      el("p", { class: "fs-note", text: "Never shown to players. Use it for what to double-check when you walk the route, the bar's address, whatever." }),
      field("Notes", textArea(stop.verifyNote, set("verifyNote")))
    ));

    // ---- danger zone
    main.appendChild(el("fieldset", { class: "fieldset" },
      el("h3", { text: "This stop" }),
      el("div", { class: "imgbtns" },
        el("button", { class: "imgbtn", text: "⧉ Duplicate", onclick: function () { duplicateStop(index); } }),
        el("button", { class: "imgbtn", text: "↑ Move up", onclick: function () { moveStop(index, -1); } }),
        el("button", { class: "imgbtn", text: "↓ Move down", onclick: function () { moveStop(index, 1); } }),
        el("button", { class: "imgbtn danger", text: "✕ Delete stop", onclick: function () { deleteStop(index); } })
      )
    ));
  }

  /**
   * The scoring + timer fieldset for one stop. Every number here is optional
   * — a blank box inherits the game-wide default, shown as its placeholder,
   * exactly like the label overrides elsewhere in the app.
   */
  function renderStopScoring(stop) {
    var g = draft.config.scoring || {};
    var scoredNow = HuntLogic.isScoredStop(stop);
    var timerNow = HuntLogic.shouldShowTimer(stop);

    var fs = el("fieldset", { class: "fieldset" },
      el("h3", { text: "Scoring & timer" }),

      // Deliberately independent of each other and of task type: a stop can
      // show a clock purely for pace with no points attached (nice on an
      // info stop or a dare), or count toward the score with no visible
      // clock ticking at all. Neither setting cares what type the stop is.
      field("Show a live timer on this task", selectInput(String(timerNow), [
        { value: "true",  label: "Yes — show the ⏱ clock on the puzzle screen" },
        { value: "false", label: "No — no clock for this one" }
      ], function (v) {
        stop.showTimer = (v === "true");
        touch();
        renderEditor();
      }), "The clock, if shown, starts the moment the group reaches this puzzle screen — never during the walk to get here."),

      field("Include in scoring", selectInput(String(scoredNow), [
        { value: "true",  label: "Yes — award points for this stop" },
        { value: "false", label: "No — exclude from the STAG score entirely" }
      ], function (v) {
        stop.scored = (v === "true");
        touch();
        renderEditor();
      }), scoredNow
        ? "Counts toward the total possible score."
        : "Excluded from the score — the timer above can still show if you've turned it on, it just won't affect any points.")
    );

    if (scoredNow) {
      fs.appendChild(el("div", { class: "row2" },
        field("Target time (seconds)",
          optionalNumberInput(stop.targetSeconds, function (v) {
            if (v === undefined) delete stop.targetSeconds; else stop.targetSeconds = v;
            touch();
          }, g.targetSeconds),
          "Solve at or under this for full points. 180 = 3 minutes."),
        field("Max points",
          optionalNumberInput(stop.basePoints, function (v) {
            if (v === undefined) delete stop.basePoints; else stop.basePoints = v;
            touch();
          }, g.basePoints),
          "Awarded for solving within the target time.")
      ));
      fs.appendChild(el("div", { class: "row2" },
        field("Minimum points",
          optionalNumberInput(stop.minPoints, function (v) {
            if (v === undefined) delete stop.minPoints; else stop.minPoints = v;
            touch();
          }, g.minPoints),
          "The floor — what they still get even if it takes forever. A skip always earns 0, never this."),
        field("Decay window (seconds)",
          optionalNumberInput(stop.decayWindowSeconds, function (v) {
            if (v === undefined) delete stop.decayWindowSeconds; else stop.decayWindowSeconds = v;
            touch();
          }, g.decayWindowSeconds),
          "How many seconds past the target it takes to hit the floor. Points decay in a straight line across this window.")
      ));
      fs.appendChild(field("Points lost per hint",
        optionalNumberInput(stop.hintPointPenalty, function (v) {
          if (v === undefined) delete stop.hintPointPenalty; else stop.hintPointPenalty = v;
          touch();
        }, g.hintPointPenalty),
        "Subtracted once per hint revealed, on top of whatever the time decay already took."));
    }

    return fs;
  }

  /* ---- global settings ----------------------------------------------------- */

  function renderSettings(main) {
    var c = draft.config;
    var set = function (key) { return function (v) { c[key] = v; touch(); }; };

    main.appendChild(el("h2", { class: "panel-title", text: "Game settings" }));
    main.appendChild(el("p", { class: "panel-sub", text: "Everything that isn't tied to a single stop." }));

    main.appendChild(el("fieldset", { class: "fieldset" },
      el("h3", { text: "Start screen" }),
      el("div", { class: "row2" },
        field("Groom's name", textInput(c.groomName, set("groomName"))),
        field("Title", textInput(c.title, set("title")), "The big headline.")
      ),
      field("Subtitle", textInput(c.subtitle, set("subtitle"))),
      el("div", { class: "row2" },
        field("Estimated duration", textInput(c.estimatedDuration, set("estimatedDuration"))),
        field("Estimated distance", textInput(c.estimatedDistance, set("estimatedDistance")))
      ),
      field("Start button label", textInput(c.startButtonLabel, set("startButtonLabel"))),
      imageField("Start screen photo (optional)", function () { return c.startImage; },
                 function (v) { c.startImage = v; },
                 "Sits under the title. A group photo, or the groom looking unprepared."),
      listField("How to play", function () { return c.howToPlay || (c.howToPlay = []); },
                function (a) { c.howToPlay = a; },
                "One bullet point per line.",
                { multiline: true, addLabel: "+ Add bullet" })
    ));

    main.appendChild(el("fieldset", { class: "fieldset" },
      el("h3", { text: "Difficulty & penalties" }),
      el("div", { class: "row2" },
        field("Minutes added per hint", numberInput(c.hintPenaltyMinutes, set("hintPenaltyMinutes")),
              "Set to 0 for free hints."),
        field("Minutes added per skipped stop", numberInput(c.skipPenaltyMinutes, set("skipPenaltyMinutes")))
      ),
      field("Wrong answers before \"give up\" appears",
            numberInput(c.skipAfterWrongAnswers, set("skipAfterWrongAnswers"), 1),
            "The give-up button only shows once every hint on that stop is revealed AND they've been wrong this many times. Set it very high to effectively disable skipping.")
    ));

    main.appendChild(el("fieldset", { class: "fieldset" },
      el("h3", { text: "Messages" }),
      el("p", { class: "fs-note", text: "Cycled through in order, then repeated from the top." }),
      listField("On a wrong answer", function () { return c.wrongAnswerMessages || (c.wrongAnswerMessages = []); },
                function (a) { c.wrongAnswerMessages = a; }, null,
                { multiline: true, addLabel: "+ Add message" }),
      listField("On a correct answer", function () { return c.correctAnswerMessages || (c.correctAnswerMessages = []); },
                function (a) { c.correctAnswerMessages = a; }, null,
                { multiline: true, addLabel: "+ Add message" })
    ));

    main.appendChild(el("fieldset", { class: "fieldset" },
      el("h3", { text: "Finish screen" }),
      field("Title", textInput(c.finishTitle, set("finishTitle"))),
      listField("Closing blurb", function () { return c.finishBlurb || (c.finishBlurb = []); },
                function (a) { c.finishBlurb = a; }, "One paragraph per line.",
                { multiline: true, addLabel: "+ Add paragraph" }),
      field("Final photo prompt", textArea(c.finalPhotoPrompt, set("finalPhotoPrompt"))),
      field("Final toast", textArea(c.finalToast, set("finalToast"))),
      imageField("Finish screen photo (optional)", function () { return c.finishImage; },
                 function (v) { c.finishImage = v; })
    ));

    main.appendChild(el("fieldset", { class: "fieldset" },
      el("h3", { text: "Final group selfie" }),
      el("p", { class: "fs-note", text:
        "A one-off screen after the last stop, before the results: everyone piles in for a group selfie. " +
        "It isn't a stop — no timer, no points, not counted in \"Stop N of M\". The photo can't be skipped " +
        "past, and it pairs side-by-side with the earliest photo taken elsewhere in the hunt on the finish " +
        "screen. All the wording for it lives in Buttons & labels → Photo capture." }),
      field("Selfie step", selectInput(String(HuntLogic.isFinalSelfieEnabled(draft.config)), [
        { value: "true",  label: "On — ask for a group selfie before showing results" },
        { value: "false", label: "Off" }
      ], function (v) {
        if (!draft.config.finalSelfie) draft.config.finalSelfie = {};
        draft.config.finalSelfie.enabled = (v === "true");
        touch();
        renderEditor();
      }))
    ));
  }

  /* ---- buttons & labels ---------------------------------------------------- */

  // Grouped for the UI. Every key here exists in app.js's DEFAULT_LABELS.
  var LABEL_GROUPS = [
    { title: "Buttons", note: "The things players actually tap.", keys: [
      ["arrivedButton",  "\"We're here\" (travel screen)"],
      ["submitButton",   "Submit an answer"],
      ["dareButton",     "Confirm a dare is done"],
      ["infoButton",     "Continue past an info stop"],
      ["nextButton",     "Next clue"],
      ["finishButton",   "Finish (on the last stop)"],
      ["backToClue",     "Re-read the travel clue"],
      ["resetButton",    "Reset the hunt"]
    ]},
    { title: "Hints & skipping", note: "{n} becomes the hint number, {min} the penalty in minutes, {pts} the point cost.", keys: [
      ["hintButton",           "Reveal a hint (time penalty only)"],
      ["hintButtonFree",       "Reveal a hint (hints free, unscored)"],
      ["hintButtonScored",     "Reveal a hint (time + point penalty)"],
      ["hintButtonFreeScored", "Reveal a hint (hints free, but scored)"],
      ["hintButtonLocked", "A later hint, before it's unlocked"],
      ["hintLockedTitle",  "Tooltip on a locked hint"],
      ["hintZoneLabel",    "\"HINTS\" heading above the hint buttons"],
      ["hintTag",        "Label above a revealed hint"],
      ["skipButton",     "Give up on a stop"],
      ["taskTimerTarget", "Target-time readout next to the per-stop clock"],
      ["taskPoints",      "Live points preview ({points}, {possible})"]
    ]},
    { title: "Answer area", note: "", keys: [
      ["answerLabel",       "Label above the answer box"],
      ["answerPlaceholder", "Greyed-out text inside the box"],
      ["choiceLabel",       "Label above multiple-choice options"],
      ["emptyAnswer",       "Nag when they submit nothing"],
      ["placeholderBadge",  "Banner on a stop with no real answer yet"]
    ]},
    { title: "Card headings", note: "", keys: [
      ["travelEyebrow", "Above the travel clue"],
      ["puzzleEyebrow", "Above the puzzle"],
      ["howToTitle",    "\"How this works\" heading"],
      ["scoringExplainerTitle", "\"How scoring works\" heading (clear this to hide that whole card)"]
    ]},
    { title: "Progress & timing", note: "{n} = current stop, {total} = number of stops.", keys: [
      ["hudProgress",  "Progress counter"],
      ["hudFinished",  "Progress counter once finished"],
      ["hintCostNote", "Penalty explainer on the start screen ({min}, {skipMin})"],
      ["hintCostNoteFree", "…when hints are free"]
    ]},
    { title: "Success screen", note: "", keys: [
      ["solvedTick",     "Big emoji"],
      ["skippedTitle",   "Headline when they gave up"],
      ["skippedMessage", "Message when they gave up"],
      ["solvedPoints",        "Points earned ({earned}, {possible})"],
      ["solvedPointsSkipped", "Points shown after a skip ({possible})"]
    ]},
    { title: "Photo capture", note: "Shown on any stop with photo capture turned on (see that stop's own \"Photo capture\" section).", keys: [
      ["photoCaptureLabel",  "Heading above the photo control"],
      ["takePhotoButton",    "\"Take a photo\" button"],
      ["retakePhotoButton",  "\"Retake\" button"],
      ["savePhotoButton",    "\"Save to my Photos\" button (opens the share sheet)"],
      ["photoRequiredNote",  "Shown while the proceed button is locked awaiting a photo"],
      ["pickPhotoButton",    "Link to attach an existing photo instead"],
      ["photoCaptureNote",   "Small print explaining where the photo goes"],
      ["photoRecapTitle",    "\"Photos from tonight\" heading on the finish screen"],
      ["photoRecapNote",     "Small print under that recap grid"],
      ["finalSelfieTitle",   "Heading on the final group-selfie screen"],
      ["finalSelfiePrompt",  "Instructions on the final group-selfie screen"],
      ["finalSelfiePhotoLabel", "Label above the selfie photo control"],
      ["finalSelfieButton", "Button once the selfie is attached"],
      ["thenNowTitle",       "\"Then & Now\" heading on the finish screen"],
      ["thenNowFirstLabel",  "Caption under the earlier photo ({name})"],
      ["thenNowSelfieLabel", "Caption under the final selfie"]
    ]},
    { title: "Start & finish screens", note: "", keys: [
      ["startKicker",    "Small line above the title (hidden unless you set one)"],
      ["startFootnote",  "Small print under the start button"],
      ["travelFootnote", "Small print under \"we're here\""],
      ["finishKicker",   "Small line above \"hunt complete\""],
      ["recapSummary",   "The collapsible route recap heading"],
      ["recapSolved",    "Suffix on a solved stop in the recap"],
      ["recapSkipped",   "Suffix on a skipped stop in the recap"],
      ["recapPoints",    "Points suffix on a scored stop in the recap ({earned}, {possible})"],
      ["noPenalty",      "Shown when they took no penalties"],
      ["stagKicker",     "\"STAG SCORE\" heading on the finish screen"],
      ["stagPoints",     "Points readout on the STAG card ({earned}, {possible}, {percent})"]
    ]},
    { title: "Scoreboard captions", note: "", keys: [
      ["scoreFinalLabel",   "Final time"],
      ["scoreRawLabel",     "On the clock"],
      ["scorePenaltyLabel", "Penalties"],
      ["scoreStopsLabel",   "Stops solved"],
      ["scoreHintsLabel",   "Hints burned"],
      ["scoreWrongLabel",   "Wrong guesses"],
      ["scoreSkippedLabel", "Stops skipped"],
      ["factGroom",         "Start screen: \"Groom\""],
      ["factStops",         "Start screen: \"Stops\""],
      ["factDuration",      "Start screen: \"Time\""],
      ["factDistance",      "Start screen: \"Walking\""]
    ]}
  ];

  function renderLabels(main) {
    var defaults = HuntLogic.DEFAULT_LABELS;
    if (!draft.config.labels) draft.config.labels = {};
    var labels = draft.config.labels;

    main.appendChild(el("h2", { class: "panel-title", text: "Buttons & labels" }));
    main.appendChild(el("p", { class: "panel-sub", text:
      "Every visible word in the game that isn't clue or puzzle text. Leave a box empty to use the built-in default shown as its greyed-out placeholder." }));

    main.appendChild(el("div", { class: "warnbox info" },
      el("strong", { text: "Tokens" }),
      el("ul", {},
        el("li", { text: "{n} — hint number, or current stop number" }),
        el("li", { text: "{total} — total number of stops" }),
        el("li", { text: "{min} — the relevant penalty in minutes" }),
        el("li", { text: "{skipMin} — the skip penalty in minutes" })
      )
    ));

    main.appendChild(el("div", { class: "imgbtns", style: "margin-bottom:18px" },
      el("button", {
        class: "imgbtn danger", text: "↺ Reset every label to default",
        onclick: function () {
          if (!confirm("Clear all label overrides and go back to the built-in wording?")) return;
          draft.config.labels = {};
          touch();
          renderEditor();
        }
      })
    ));

    LABEL_GROUPS.forEach(function (group) {
      var fs = el("fieldset", { class: "fieldset" }, el("h3", { text: group.title }));
      if (group.note) fs.appendChild(el("p", { class: "fs-note", text: group.note }));
      group.keys.forEach(function (pair) {
        var key = pair[0], desc = pair[1];
        fs.appendChild(field(desc,
          textInput(labels[key] == null ? "" : labels[key], function (v) {
            if (v === "") delete labels[key];      // empty = fall back to default
            else labels[key] = v;
            touch();
          }, defaults[key])));
      });
      main.appendChild(fs);
    });
  }

  /* ---- theme --------------------------------------------------------------- */

  var THEME_FIELDS = [
    ["accent",     "Accent", "Buttons, the timer, headings.", "#f0b323"],
    ["accentDark", "Accent shadow", "The 3D edge under primary buttons. A darker version of the accent.", "#b8851a"],
    ["background", "Background", "", "#12100e"],
    ["card",       "Cards", "Panels and boxes sitting on the background.", "#1d1a17"],
    ["text",       "Text", "", "#f6f1e8"]
  ];

  var THEME_PRESETS = {
    "Budapest gold (default)": { accent: "#f0b323", accentDark: "#b8851a", background: "#12100e", card: "#1d1a17", text: "#f6f1e8" },
    "Neon night":              { accent: "#ff2e88", accentDark: "#b01e5f", background: "#0d0b14", card: "#1a1626", text: "#f4f0ff" },
    "Ruin bar green":          { accent: "#5ddb8a", accentDark: "#3d9c60", background: "#0c1410", card: "#16241b", text: "#eefaf1" },
    "Danube blue":             { accent: "#4da8ff", accentDark: "#2f70b0", background: "#0b1119", card: "#151f2c", text: "#eaf2fb" },
    "Paper (light)":           { accent: "#b8651a", accentDark: "#8a4a12", background: "#f6f1e8", card: "#ffffff", text: "#1b1713" }
  };

  function renderTheme(main) {
    if (!draft.config.theme) draft.config.theme = {};
    var theme = draft.config.theme;

    main.appendChild(el("h2", { class: "panel-title", text: "Theme" }));
    main.appendChild(el("p", { class: "panel-sub", text: "Recolour the game. Preview to see it for real." }));

    var presets = el("fieldset", { class: "fieldset" },
      el("h3", { text: "Presets" }),
      el("p", { class: "fs-note", text: "A starting point — tweak any colour afterwards." }));
    var row = el("div", { class: "imgbtns" });
    Object.keys(THEME_PRESETS).forEach(function (name) {
      row.appendChild(el("button", {
        class: "imgbtn", text: name,
        onclick: function () {
          draft.config.theme = clone(THEME_PRESETS[name]);
          touch();
          renderEditor();
        }
      }));
    });
    presets.appendChild(row);
    main.appendChild(presets);

    var fs = el("fieldset", { class: "fieldset" }, el("h3", { text: "Colours" }));
    THEME_FIELDS.forEach(function (f) {
      var key = f[0];
      fs.appendChild(field(f[1], colorInput(theme[key] || f[3], function (v) {
        theme[key] = v; touch(); paintSwatch();
      }), f[2]));
    });
    main.appendChild(fs);

    // Live mini-preview so you can judge contrast without leaving the page.
    var swatch = el("div", { class: "theme-preview" });
    function paintSwatch() {
      var t = draft.config.theme;
      swatch.innerHTML = "";
      swatch.style.background = t.background || "#12100e";
      swatch.style.color = t.text || "#f6f1e8";
      var card = el("div", { class: "theme-preview-card" },
        el("div", { class: "theme-preview-eyebrow", text: "🧭 TRAVEL CLUE" }),
        el("p", { text: "Start where everything in this city crosses.", style: "margin:0" }));
      card.style.background = t.card || "#1d1a17";
      card.querySelector(".theme-preview-eyebrow").style.color = t.accent || "#f0b323";
      var btn = el("div", { class: "theme-preview-btn", text: "WE'RE HERE →" });
      btn.style.background = t.accent || "#f0b323";
      btn.style.boxShadow = "0 3px 0 " + (t.accentDark || "#b8851a");
      swatch.appendChild(card);
      swatch.appendChild(btn);
    }
    paintSwatch();
    main.appendChild(el("fieldset", { class: "fieldset" },
      el("h3", { text: "Preview" }), swatch));
  }

  /* ---- scoring & STAG levels ------------------------------------------------ */

  function renderScoring(main) {
    if (!draft.config.scoring) draft.config.scoring = {};
    var s = draft.config.scoring;

    main.appendChild(el("h2", { class: "panel-title", text: "Scoring & STAG levels" }));
    main.appendChild(el("p", { class: "panel-sub", text:
      "A per-stop timer and a points total, on top of the plain time-and-penalties scoreboard on the finish screen. The clock for a stop only ever runs during the on-site puzzle — never while they're walking to get there." }));

    main.appendChild(el("div", { class: "warnbox info" },
      "🦌 Always on for every hunt — there's deliberately no off switch. " +
      "(There used to be one; it turned out to be a way for the timer to go " +
      "quietly missing on a stale draft, which isn't a risk worth keeping for " +
      "a one-shot live event.) You can still exclude an individual stop from " +
      "scoring below, on that stop's own \"Scoring\" section."
    ));

    main.appendChild(el("fieldset", { class: "fieldset" },
      el("h3", { text: "Game-wide defaults" }),
      el("p", { class: "fs-note", text: "Every stop uses these unless it has its own override (set on the stop itself, under \"Scoring\")." }),
      el("div", { class: "row2" },
        field("Target time (seconds)", numberInput(s.targetSeconds == null ? 180 : s.targetSeconds,
          function (v) { s.targetSeconds = v; touch(); }), "180 = 3 minutes."),
        field("Max points", numberInput(s.basePoints == null ? 100 : s.basePoints,
          function (v) { s.basePoints = v; touch(); }))
      ),
      el("div", { class: "row2" },
        field("Minimum points", numberInput(s.minPoints == null ? 10 : s.minPoints,
          function (v) { s.minPoints = v; touch(); }), "The floor for a slow-but-solved stop. A skip always earns 0."),
        field("Decay window (seconds)", numberInput(s.decayWindowSeconds == null ? 300 : s.decayWindowSeconds,
          function (v) { s.decayWindowSeconds = v; touch(); }), "Seconds past the target before points bottom out.")
      ),
      field("Points lost per hint", numberInput(s.hintPointPenalty == null ? 20 : s.hintPointPenalty,
        function (v) { s.hintPointPenalty = v; touch(); }))
    ));

    var possible = HuntLogic.totalPossiblePoints(draft.stops, draft.config);
    var scoredCount = draft.stops.filter(HuntLogic.isScoredStop).length;
    main.appendChild(el("div", { class: "warnbox info" },
      "Total possible right now: " + possible + " pts across " + scoredCount + " of " +
      draft.stops.length + " stops. (" + (draft.stops.length - scoredCount) +
      " excluded — info stops by default, or anything you've switched off individually.)"
    ));

    main.appendChild(el("fieldset", { class: "fieldset" },
      el("h3", { text: "Explain it on the home page" }),
      el("p", { class: "fs-note", text:
        "Shown in its own card on the start screen, separate from \"How this works\" above. " +
        "{target} and {totalPoints} fill in automatically from this hunt's own numbers. " +
        "Clear the title in Buttons & labels (scoringExplainerTitle) to hide the whole card instead." }),
      listField("Bullets", function () { return draft.config.scoringExplainer || (draft.config.scoringExplainer = []); },
                function (a) { draft.config.scoringExplainer = a; },
                "Leave empty to use the built-in explanation.",
                { multiline: true, addLabel: "+ Add bullet" })
    ));

    main.appendChild(renderStagLevelsField());
  }

  /**
   * The repeatable STAG-levels editor: a percentage threshold, a name (emoji
   * included), and a blurb, one row per tier. Order in the UI doesn't matter —
   * stagLevelFor() always sorts by minPercent before matching.
   */
  function renderStagLevelsField() {
    var fs = el("fieldset", { class: "fieldset" }, el("h3", { text: "STAG levels" }));
    fs.appendChild(el("p", { class: "fs-note", text:
      "The title awarded at the end, picked by the highest threshold their percentage still clears. Keep one row at 0% — that's the catch-all for anyone below every other tier." }));

    var rows = el("div", { class: "list-rows" });

    function paint() {
      rows.innerHTML = "";
      if (!Array.isArray(draft.config.stagLevels) || !draft.config.stagLevels.length) {
        draft.config.stagLevels = clone(HuntLogic.DEFAULT_STAG_LEVELS);
      }
      var levels = draft.config.stagLevels;

      var existingWarn = fs.querySelector(".warnbox");
      if (existingWarn) existingWarn.parentNode.removeChild(existingWarn);
      var hasZero = levels.some(function (l) { return Number(l.minPercent) === 0; });
      if (!hasZero) {
        fs.insertBefore(el("div", { class: "warnbox amber" },
          "No level has a 0% threshold — anyone scoring below your lowest tier won't get a title at all."
        ), rows);
      }

      levels.forEach(function (level, i) {
        var pctInput = el("input", {
          type: "number", value: String(level.minPercent == null ? 0 : level.minPercent),
          min: "0", max: "100", style: "width:80px",
          oninput: function () { level.minPercent = this.value === "" ? 0 : Number(this.value); touch(); }
        });
        var nameInput = el("input", {
          type: "text", value: level.name || "", placeholder: "🦌 Level name",
          oninput: function () { level.name = this.value; touch(); }
        });
        var blurbInput = el("input", {
          type: "text", value: level.blurb || "", placeholder: "One-line description shown under the title",
          oninput: function () { level.blurb = this.value; touch(); }
        });
        var row = el("div", { class: "list-row stag-level-row" },
          el("div", { class: "stag-level-pct" }, pctInput, el("span", { text: "%" })),
          el("div", { class: "stag-level-text" }, nameInput, blurbInput),
          el("button", {
            class: "row-del", text: "✕", title: "Remove this level",
            onclick: function () { levels.splice(i, 1); touch(); paint(); }
          })
        );
        rows.appendChild(row);
      });
    }
    paint();
    fs.appendChild(rows);

    fs.appendChild(el("button", {
      class: "list-add", text: "+ Add a level",
      onclick: function () {
        draft.config.stagLevels.push({ minPercent: 50, name: "🦌 New level", blurb: "" });
        touch();
        paint();
      }
    }));

    fs.appendChild(el("button", {
      class: "imgbtn danger", text: "↺ Reset to the default 6 levels", style: "margin-top:12px",
      onclick: function () {
        if (!confirm("Replace all STAG levels with the built-in defaults?")) return;
        draft.config.stagLevels = clone(HuntLogic.DEFAULT_STAG_LEVELS);
        touch();
        paint();
      }
    }));

    return fs;
  }

  /* ---- pre-event checklist ------------------------------------------------- */

  function renderChecklist(main) {
    main.appendChild(el("h2", { class: "panel-title", text: "Pre-event checklist" }));
    main.appendChild(el("p", { class: "panel-sub", text: "Everything the editor can tell you is still outstanding, plus your own notes per stop." }));

    var size = totalBytes();
    if (size > TOTAL_WARN_BYTES) {
      main.appendChild(el("div", { class: "warnbox amber" },
        "⚠️ The whole game is now " + fmtBytes(size) + ". That's a slow load on 4G. " +
        "Consider removing or shrinking some photos."));
    } else {
      main.appendChild(el("div", { class: "warnbox info" },
        "Total size: " + fmtBytes(size) + " — fine for mobile data."));
    }

    var anyOutstanding = false;

    draft.stops.forEach(function (stop, i) {
      var problems = stopProblems(stop, i);
      if (problems.length) anyOutstanding = true;
      main.appendChild(el("div", { class: "check-item" },
        el("h4", { text: (i + 1) + ". " + (stop.name || "(untitled)") }),
        problems.length
          ? el("p", { class: "todo", text: problems.map(function (p) { return p.text; }).join("  ·  ") })
          : el("p", { text: "✅ Complete." }),
        stop.verifyNote ? el("p", { text: "🔍 " + stop.verifyNote }) : null,
        el("div", { class: "imgbtns" },
          el("button", {
            class: "imgbtn", text: "Edit this stop →",
            onclick: function () { select({ type: "stop", index: i }); }
          }))
      ));
    });

    if (!anyOutstanding) {
      main.insertBefore(
        el("div", { class: "warnbox info", text: "🎉 Every stop has a name, a clue, a puzzle, hints and a real answer." }),
        main.children[2]
      );
    }

    main.appendChild(el("div", { class: "warnbox amber" },
      el("strong", { text: "The editor can't check these for you:" }),
      el("ul", {},
        el("li", { text: "Walk the route and confirm every on-site detail still exists." }),
        el("li", { text: "Confirm both bars are open on the night and the addresses are right." }),
        el("li", { text: "Test on the actual phone you'll use, on mobile data, not wifi." }),
        el("li", { text: "Export content.js and re-upload it — the draft in this browser is not live." })
      )
    ));
  }

  /* ==========================================================================
   * EXPORT / IMPORT / PREVIEW
   * ======================================================================== */

  /** Strip empty optional fields so the exported file stays readable. */
  function cleanForExport(data) {
    var out = clone(data);
    out.stops = out.stops.map(function (stop) {
      Object.keys(stop).forEach(function (k) {
        var v = stop[k];
        if (v == null) delete stop[k];
        else if (typeof v === "string" && !v.trim()) delete stop[k];
        else if (Array.isArray(v) && !v.length) delete stop[k];
      });
      // Drop blank rows inside lists.
      ["hints", "answers"].forEach(function (k) {
        if (Array.isArray(stop[k])) {
          stop[k] = stop[k].filter(function (s) { return String(s).trim(); });
          if (!stop[k].length) delete stop[k];
        }
      });
      return stop;
    });
    return out;
  }

  function download(filename, text, mime) {
    var blob = new Blob([text], { type: mime || "text/plain;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = el("a", { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function exportContentJs() {
    var data = cleanForExport(draft);
    var header =
      "/* ============================================================================\n" +
      " * content.js — generated by the Hunt Editor (admin.html) on " +
          new Date().toISOString().slice(0, 16).replace("T", " ") + ".\n" +
      " *\n" +
      " * You can keep editing this file by hand — it's plain JavaScript — but the\n" +
      " * easiest route is to open admin.html, make changes there, and export again.\n" +
      " *\n" +
      " * NOTE: exporting replaces this whole file, so any comments you add by hand\n" +
      " * will be lost on the next export. Put notes in a stop's `verifyNote` field\n" +
      " * instead — that's a real field and it survives.\n" +
      " *\n" +
      " * Photos are embedded as base64 data URIs, which is why some lines are very\n" +
      " * long. That's intentional: it keeps the game a self-contained static site\n" +
      " * with no image hosting.\n" +
      " * ========================================================================== */\n\n";

    var body = "const HUNT = " + JSON.stringify(data, null, 2) + ";\n\n" +
      "/* Export for the Node test harness in test.js. Ignored by browsers. */\n" +
      "if (typeof module !== \"undefined\" && module.exports) { module.exports = HUNT; }\n";

    download("content.js", header + body, "text/javascript;charset=utf-8");
    setSaveBar("Exported content.js — replace the old file with it, then reload the game.", false);
    toast("content.js downloaded");
  }

  function exportJson() {
    download("hunt-backup-" + new Date().toISOString().slice(0, 10) + ".json",
             JSON.stringify(cleanForExport(draft), null, 2),
             "application/json");
    toast("Backup downloaded");
  }

  function importJson(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var parsed;
      try { parsed = JSON.parse(reader.result); }
      catch (e) { alert("That isn't valid JSON."); return; }
      if (!parsed || !parsed.config || !Array.isArray(parsed.stops) || !parsed.stops.length) {
        alert("That JSON doesn't look like a hunt backup — it needs a `config` object and a non-empty `stops` array.");
        return;
      }
      if (!confirm("Replace the current draft with this backup?\n\n" +
                   parsed.stops.length + " stops. Your current draft will be lost.")) return;
      draft = parsed;
      select({ type: "stop", index: 0 });
      touch();
      toast("Backup restored");
    };
    reader.readAsText(file);
  }

  function preview() {
    try {
      localStorage.setItem(PREVIEW_KEY, JSON.stringify(cleanForExport(draft)));
      localStorage.removeItem("budapest-hunt-preview-progress");
    } catch (e) {
      alert("Couldn't stage the preview — the draft is too large for this browser's storage.");
      return;
    }

    // A named target (not "_blank") means repeated clicks reuse the SAME
    // tab instead of piling up a new one each time — otherwise it's easy to
    // switch back to an already-open preview tab that loaded its data once
    // and never refreshed, and wonder why your latest edits aren't showing.
    var win = window.open("index.html?preview=1", "huntPreview");
    if (!win) {
      alert("The preview tab was blocked by your browser's pop-up blocker. " +
            "Allow pop-ups for this page and try again.");
      return;
    }
    // If that tab was already open at this same URL, window.open alone may
    // just focus it without re-running the page's script — so force an
    // actual reload, which is the only way it picks up the freshly staged
    // draft from localStorage.
    try { win.location.reload(); } catch (e) { /* fine — first open already has fresh data */ }
    win.focus();
  }

  function discardDraft() {
    if (!confirm("Discard your draft and reload the last exported content.js?\n\n" +
                 "Anything you haven't exported will be lost.")) return;
    try { localStorage.removeItem(DRAFT_KEY); } catch (e) {}
    location.reload();
  }

  /* ==========================================================================
   * BOOT
   * ======================================================================== */

  $("btnExportJs").addEventListener("click", exportContentJs);
  $("btnExportJson").addEventListener("click", exportJson);
  $("btnImport").addEventListener("click", function () { $("importFile").click(); });
  $("importFile").addEventListener("change", function () {
    if (this.files[0]) importJson(this.files[0]);
    this.value = "";
  });
  $("btnPreview").addEventListener("click", preview);
  $("btnDiscard").addEventListener("click", discardDraft);
  $("btnAddStop").addEventListener("click", addStop);
  $("navSettings").addEventListener("click", function () { select({ type: "settings" }); });
  $("navLabels").addEventListener("click", function () { select({ type: "labels" }); });
  $("navTheme").addEventListener("click", function () { select({ type: "theme" }); });
  $("navScoring").addEventListener("click", function () { select({ type: "scoring" }); });
  $("navChecklist").addEventListener("click", function () { select({ type: "checklist" }); });

  // Warn on close only if there's an unexported draft.
  window.addEventListener("beforeunload", function (e) {
    if (!hasStoredDraft) return;
    e.preventDefault();
    e.returnValue = "";
  });

  setSaveBar(hasStoredDraft
    ? "Editing an unsaved draft from this browser · export content.js to make it live"
    : "Loaded from content.js · edits autosave here as a draft", hasStoredDraft);

  renderSidebar();
  renderStats();
  renderEditor();

})();
