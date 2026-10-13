/* History Quiz Moderator — turn-by-turn moderation for History Bee and History Bowl. */
(function () {
  "use strict";

  const D = window.QDATA;
  const app = document.getElementById("app");
  const topActions = document.getElementById("top-actions");

  const LS_SETTINGS = "hqm.settings.v1";
  const LS_SEEN = "hqm.seen.v1";
  const LS_GAME = "hqm.game.v1";

  // ---------- data indexes ----------
  const T = new Map(D.tossups.map((t) => [t.id, t]));
  const Q3 = new Map(D.q3.map((c) => [c.id, c]));
  const CAT_NAME = Object.fromEntries(D.categories.map((c) => [c.id, c.name]));

  // ---------- storage helpers ----------
  function load(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch (e) {
      return fallback;
    }
  }
  function save(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch (e) { /* storage full or blocked: the app still works for this session */ }
  }
  let seen = new Set(load(LS_SEEN, []));
  function markSeen(id) {
    if (!seen.has(id)) {
      seen.add(id);
      save(LS_SEEN, [...seen]);
    }
  }

  const DEFAULTS = {
    format: "bee",
    level: "ems",
    cats: D.categories.map((c) => c.id),
    difficulty: "all",
    avoidSeen: true,
    hideAnswer: false,
    bee: { count: 30, players: ["Player 1", "Player 2", "Player 3", "Player 4"] },
    bowl: { teams: ["Team A", "Team B"], q1: 8, q2: 8, q4: 8, q3secs: 60 },
  };
  let settings = Object.assign({}, DEFAULTS, load(LS_SETTINGS, {}));
  settings.bee = Object.assign({}, DEFAULTS.bee, settings.bee);
  settings.bowl = Object.assign({}, DEFAULTS.bowl, settings.bowl);

  let game = load(LS_GAME, null);
  let undoStack = [];
  let timer = null;

  // ---------- pools ----------
  // Bee pool = bee tossups + bowl first-quarter tossups; bowl Q1 pool = the same mix.
  const SLOT_KINDS = { bee: ["bee", "q1"], q1: ["q1", "bee"], q2: ["q2"], q4: ["q4", "extra"], tie: ["q4", "extra"] };

  function packetOk(p) {
    const pk = D.packets[p];
    if (settings.level !== "both" && pk.level !== settings.level) return false;
    if (settings.difficulty === "regular" && pk.hard) return false;
    if (settings.difficulty === "hard" && !pk.hard) return false;
    return true;
  }
  function catOk(c) {
    return c.some((x) => settings.cats.includes(x));
  }
  function tossupPool(slot) {
    const kinds = SLOT_KINDS[slot];
    return D.tossups.filter((t) =>
      kinds.includes(t.k) && packetOk(t.p) && catOk(t.c) &&
      (slot !== "q2" || t.bq) && (slot !== "q4" || /\(\*\)|\(\+\)/.test(t.q)) &&
      !(settings.avoidSeen && seen.has(t.id)));
  }
  function q3Pool() {
    return D.q3.filter((c) => c.items.length >= 6 && packetOk(c.p) && catOk(c.c) &&
      !(settings.avoidSeen && seen.has(c.id)));
  }

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  // Draw n items, rotating through the selected categories so the round is mixed.
  function draw(pool, n, exclude) {
    exclude = exclude || new Set();
    const buckets = {};
    for (const it of shuffle(pool.slice())) {
      if (exclude.has(it.id)) continue;
      const key = it.c.find((x) => settings.cats.includes(x)) || it.c[0];
      (buckets[key] = buckets[key] || []).push(it);
    }
    const keys = shuffle(Object.keys(buckets));
    const out = [];
    while (out.length < n && keys.some((k) => buckets[k].length)) {
      for (const k of keys) {
        if (out.length >= n) break;
        const it = buckets[k].pop();
        if (it) out.push(it.id);
      }
    }
    return out;
  }

  // ---------- formatting ----------
  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }
  function fmtQ(s) {
    return esc(s)
      .replace(/\[\[([^\]]+)\]\]/g, '<span class="pron">[$1]</span>')
      .replace(/\(\+\)/g, '<span class="mark" title="Power mark: 30 points before here">(+)</span>')
      .replace(/\(\*\)/g, '<span class="mark" title="20 points before here">(*)</span>');
  }
  function fmtA(s) {
    const t = esc(s).replace(/\[\[([^\]]+)\]\]/g, '<span class="pron">[$1]</span>');
    const i = t.search(/ \(|\[| \[|; /);
    if (i > 0) return '<span class="main">' + t.slice(0, i) + "</span>" + t.slice(i);
    return '<span class="main">' + t + "</span>";
  }
  function answerBlock(a, label) {
    const hidden = settings.hideAnswer ? " hidden-ans" : "";
    return `<div class="answer${hidden}" data-action="reveal"><span class="lbl">${label || "ANSWER"}</span>${fmtA(a)}</div>`;
  }
  function metaLine(t) {
    const pk = D.packets[t.p];
    const src = { bee: "History Bee", q1: "Bowl Q1", q2: "Bowl Q2", q3: "Bowl Q3", q4: "Bowl Q4", extra: "Bowl extra" }[t.k || "q3"];
    const lvl = pk.level === "ems" ? "Elem/Middle" : "Varsity/JV";
    const tags = (t.c || []).map((c) => `<span class="tag">${esc(CAT_NAME[c] || c)}</span>`).join("");
    return `<div class="meta">${tags} ${src} · ${lvl} · ${esc(pk.label)}</div>`;
  }

  // ---------- persistence / undo ----------
  function persist() {
    save(LS_GAME, game);
  }
  function snapshot() {
    undoStack.push(JSON.stringify(game));
    if (undoStack.length > 80) undoStack.shift();
  }
  function undo() {
    if (!undoStack.length) return;
    game = JSON.parse(undoStack.pop());
    stopTimer();
    persist();
    render();
  }

  // =====================================================================
  // SETUP
  // =====================================================================
  function counts() {
    const c = {};
    const kinds = settings.format === "bee" ? SLOT_KINDS.bee : ["q1", "q2", "q4", "bee", "extra"];
    for (const t of D.tossups) {
      if (!kinds.includes(t.k) || !packetOk(t.p)) continue;
      if (settings.avoidSeen && seen.has(t.id)) continue;
      for (const x of t.c) c[x] = (c[x] || 0) + 1;
    }
    return c;
  }

  function renderSetup() {
    topActions.innerHTML = game ? `<button class="btn" data-action="resume">Resume current game</button>` : "";
    const s = settings;
    const cc = counts();
    const choice = (key, val, title, sub) =>
      `<button class="choice ${s[key] === val ? "on" : ""}" data-action="set" data-key="${key}" data-val="${val}"><strong>${title}</strong><span>${sub}</span></button>`;

    let poolInfo;
    if (s.format === "bee") {
      const n = tossupPool("bee").length;
      poolInfo = `<b>${n.toLocaleString()}</b> tossups available (History Bee questions + Bowl first-quarter tossups).` +
        (n < s.bee.count ? ` <span class="warn">Fewer than the ${s.bee.count} requested.</span>` : "");
    } else {
      const a = tossupPool("q1").length, b = tossupPool("q2").length, c = q3Pool().length, d = tossupPool("q4").length;
      poolInfo = `Available — Q1: <b>${a.toLocaleString()}</b> tossups (incl. Bee questions) · Q2: <b>${b.toLocaleString()}</b> tossup+bonus · Q3: <b>${c.toLocaleString()}</b> category sets · Q4: <b>${d.toLocaleString()}</b> pyramidal tossups.` +
        (a < s.bowl.q1 || b < s.bowl.q2 || c < 3 || d < s.bowl.q4 ? ` <span class="warn">Not enough for a full game — widen categories or level.</span>` : "");
    }

    const names = s.format === "bee" ? s.bee.players : s.bowl.teams;
    const nameRows = names.map((n, i) => `
      <div class="row"><input type="text" value="${esc(n)}" data-action="name" data-i="${i}" aria-label="Name ${i + 1}">
      ${s.format === "bee" && names.length > 1 ? `<button class="btn ghost" data-action="del-name" data-i="${i}" aria-label="Remove">✕</button>` : ""}</div>`).join("");

    app.innerHTML = `
      <div class="panel">
        <h2>1 · Format</h2>
        <div class="choice-grid">
          ${choice("format", "bee", "History Bee", "Individual buzzer competition, pyramidal tossups, 1 point each")}
          ${choice("format", "bowl", "History Bowl", "Two teams, four quarters: tossups, tossup + bonus, lightning categories, pyramidal 30/20/10")}
        </div>
      </div>
      <div class="panel">
        <h2>2 · Level</h2>
        <div class="choice-grid">
          ${choice("level", "ems", "Elementary & Middle School", "EMS packets")}
          ${choice("level", "varsity", "Varsity & JV", "High-school packets")}
          ${choice("level", "both", "Both", "Mix all levels")}
        </div>
        <div class="row" style="margin-top:12px">
          <div class="field"><label for="diff">Rounds to draw from</label>
            <select id="diff" data-action="diff">
              <option value="all" ${s.difficulty === "all" ? "selected" : ""}>All rounds</option>
              <option value="regular" ${s.difficulty === "regular" ? "selected" : ""}>Preliminary rounds only (easier)</option>
              <option value="hard" ${s.difficulty === "hard" ? "selected" : ""}>Playoffs, semifinals &amp; finals only (harder)</option>
            </select></div>
        </div>
      </div>
      <div class="panel">
        <div class="row"><h2 style="margin:0">3 · Categories</h2><span class="spacer"></span>
          <button class="btn ghost small" data-action="cats-all">Select all</button>
          <button class="btn ghost small" data-action="cats-none">Clear</button></div>
        <p class="help">Questions are tagged automatically from their text, so a question can sit in more than one category.</p>
        <div class="chips">
          ${D.categories.map((c) => `<button class="chip ${s.cats.includes(c.id) ? "on" : ""}" data-action="cat" data-id="${c.id}">${esc(c.name)} <span class="n">${(cc[c.id] || 0).toLocaleString()}</span></button>`).join("")}
        </div>
      </div>
      <div class="panel">
        <h2>4 · ${s.format === "bee" ? "Players" : "Teams"}</h2>
        <div class="names">${nameRows}</div>
        ${s.format === "bee" ? `<div class="row" style="margin-top:8px"><button class="btn" data-action="add-name">+ Add player</button></div>` : ""}
        <div class="row" style="margin-top:14px">
          ${s.format === "bee"
            ? `<div class="field"><label for="bee-count">Number of questions</label><input id="bee-count" type="number" min="1" max="200" value="${s.bee.count}" data-action="num" data-path="bee.count"></div>`
            : `<div class="field"><label>Q1 tossups</label><input type="number" min="1" max="20" value="${s.bowl.q1}" data-action="num" data-path="bowl.q1"></div>
               <div class="field"><label>Q2 tossup+bonus</label><input type="number" min="1" max="20" value="${s.bowl.q2}" data-action="num" data-path="bowl.q2"></div>
               <div class="field"><label>Q4 pyramidal tossups</label><input type="number" min="1" max="20" value="${s.bowl.q4}" data-action="num" data-path="bowl.q4"></div>
               <div class="field"><label>Q3 seconds per team</label><input type="number" min="10" max="300" value="${s.bowl.q3secs}" data-action="num" data-path="bowl.q3secs"></div>`}
        </div>
      </div>
      <div class="panel">
        <h2>5 · Options</h2>
        <label class="row"><input type="checkbox" data-action="toggle" data-key="avoidSeen" ${s.avoidSeen ? "checked" : ""}> Skip questions already used in earlier games on this device <span class="muted small">(${seen.size.toLocaleString()} used)</span>
          <button class="btn ghost small" data-action="reset-seen">Reset used list</button></label>
        <label class="row" style="margin-top:6px"><input type="checkbox" data-action="toggle" data-key="hideAnswer" ${s.hideAnswer ? "checked" : ""}> Blur answers until clicked (for screen-sharing)</label>
      </div>
      <div class="panel row">
        <div class="pool-summary">${poolInfo}</div><span class="spacer"></span>
        <button class="btn primary big" data-action="start" ${s.cats.length ? "" : "disabled"}>Start ${s.format === "bee" ? "Bee" : "Bowl"} →</button>
      </div>`;
  }

  function setPath(path, val) {
    const [a, b] = path.split(".");
    settings[a][b] = val;
  }

  // =====================================================================
  // GAME CREATION
  // =====================================================================
  function startGame() {
    const s = settings;
    if (s.format === "bee") {
      const ids = draw(tossupPool("bee"), s.bee.count);
      if (!ids.length) return alert("No questions match these settings.");
      game = {
        format: "bee",
        players: s.bee.players.filter((n) => n.trim()).map((n) => ({ name: n.trim(), score: 0 })),
        queue: ids, idx: 0, results: {}, locked: [],
      };
    } else {
      const q1 = draw(tossupPool("q1"), s.bowl.q1);
      const q2 = draw(tossupPool("q2"), s.bowl.q2, new Set(q1));
      const q4 = draw(tossupPool("q4"), s.bowl.q4, new Set([...q1, ...q2]));
      const sets = draw(q3Pool(), 3);
      if (!q1.length || !q2.length || !q4.length || sets.length < 2)
        return alert("Not enough questions match these settings for a bowl game. Try more categories or a wider level.");
      game = {
        format: "bowl",
        teams: s.bowl.teams.map((n, i) => ({ name: n.trim() || `Team ${"AB"[i]}`, score: 0 })),
        quarters: { 1: q1, 2: q2, 4: q4 },
        quarter: 1, idx: 0, phase: "intro", locked: [], results: {},
        q3: { sets, taken: {}, order: [], turn: 0, item: 0, marks: {}, remaining: s.bowl.q3secs },
        tie: [],
      };
    }
    undoStack = [];
    persist();
    render();
  }

  function currentId() {
    if (game.format === "bee") return game.queue[game.idx];
    if (game.phase === "tiebreak") return game.tie[game.tie.length - 1];
    return (game.quarters[game.quarter] || [])[game.idx];
  }

  function replaceCurrent() {
    snapshot();
    const id = currentId();
    let slot, list;
    if (game.format === "bee") { slot = "bee"; list = game.queue; }
    else if (game.phase === "tiebreak") { slot = "tie"; list = game.tie; }
    else { slot = "q" + game.quarter; list = game.quarters[game.quarter]; }
    const used = new Set(game.format === "bee" ? game.queue : [...game.quarters[1], ...game.quarters[2], ...game.quarters[4], ...game.tie]);
    const next = draw(tossupPool(slot), 1, used)[0];
    if (!next) { undoStack.pop(); return alert("No more unused questions match these settings."); }
    list[list.indexOf(id)] = next;
    game.locked = [];
    persist();
    render();
  }

  // =====================================================================
  // BEE
  // =====================================================================
  function renderBee() {
    const g = game;
    if (g.idx >= g.queue.length) return renderFinal(g.players, "Bee complete");
    const t = T.get(g.queue[g.idx]);
    markSeen(t.id);
    const res = g.results[g.idx];
    const winner = res && res.by != null ? g.players[res.by] : null;
    app.innerHTML = `
      ${scoreboard(g.players)}
      <div class="progress">
        <span class="stage">Question ${g.idx + 1} of ${g.queue.length}</span>
        <span class="spacer"></span>
        ${metaLine(t)}
      </div>
      <div class="qcard">
        <div class="qtext">${fmtQ(t.q)}</div>
        ${answerBlock(t.a)}
      </div>
      <div class="controls">
        <h3>Who buzzed?</h3>
        <div class="player-grid">
          ${g.players.map((p, i) => `
            <div class="player ${g.locked.includes(i) ? "locked" : ""} ${res && res.by === i ? "won" : ""}">
              <span class="who" title="${esc(p.name)}">${esc(p.name)}</span>
              <button class="btn good" data-action="bee-right" data-i="${i}" ${res || g.locked.includes(i) ? "disabled" : ""} title="Correct">✓</button>
              <button class="btn bad" data-action="bee-wrong" data-i="${i}" ${res || g.locked.includes(i) ? "disabled" : ""} title="Incorrect — locked out">✗</button>
            </div>`).join("")}
        </div>
        <p class="status">${winner ? `<b>${esc(winner.name)}</b> answered correctly (+1).` :
          g.locked.length ? `Locked out: ${g.locked.map((i) => esc(g.players[i].name)).join(", ")}. Keep reading for the others.` :
          "Read the question; mark the first player to answer."}</p>
      </div>
      <div class="nav">
        <button class="btn" data-action="prev" ${g.idx === 0 ? "disabled" : ""}>← Previous</button>
        <button class="btn" data-action="replace" title="Swap this question for another">Replace question<span class="kbd">R</span></button>
        <button class="btn" data-action="undo" ${undoStack.length ? "" : "disabled"}>Undo<span class="kbd">U</span></button>
        <span class="spacer"></span>
        <button class="btn ghost" data-action="end">End game</button>
        <button class="btn primary big" data-action="next">${res ? "Next question" : "No answer — next"} →<span class="kbd">→</span></button>
      </div>`;
  }

  // =====================================================================
  // BOWL
  // =====================================================================
  const QUARTER_INFO = {
    1: ["First Quarter", "Tossups worth 10 points. A team that answers incorrectly is locked out; the other team may answer after the question is finished."],
    2: ["Second Quarter", "Tossups worth 10 points. A team that answers correctly earns a 10-point bonus question."],
    3: ["Third Quarter", "Lightning rounds. The trailing team chooses a category first; each team answers its 8 questions for 10 points each within the time limit."],
    4: ["Fourth Quarter", "Pyramidal tossups: 30 points before (+), 20 before (*), 10 after."],
  };

  function renderBowl() {
    const g = game;
    if (g.phase === "done") return renderFinal(g.teams, "Final score");
    if (g.phase === "intro") return renderBowlIntro();
    if (g.quarter === 3) return renderQ3();
    const list = g.phase === "tiebreak" ? g.tie : g.quarters[g.quarter];
    const t = T.get(currentId());
    markSeen(t.id);
    const res = g.results[resKey()] || {};
    const q4 = g.quarter === 4 || g.phase === "tiebreak";
    const label = g.phase === "tiebreak" ? "Tiebreaker" : QUARTER_INFO[g.quarter][0];

    let bonusHtml = "";
    if (g.quarter === 2 && res.by != null && t.bq) {
      bonusHtml = `
        <div class="qcard bonus-card">
          <div class="who">Bonus for ${esc(g.teams[res.by].name)}</div>
          <div class="qtext">${fmtQ(t.bq)}</div>
          ${answerBlock(t.ba, "BONUS ANSWER")}
          <div class="row" style="margin-top:12px">
            <button class="btn good" data-action="bonus" data-ok="1" ${res.bonus != null ? "disabled" : ""}>Bonus correct (+10)</button>
            <button class="btn bad" data-action="bonus" data-ok="0" ${res.bonus != null ? "disabled" : ""}>Bonus missed</button>
            ${res.bonus != null ? `<span class="muted">${res.bonus ? "Bonus earned." : "Bonus missed."}</span>` : ""}
          </div>
        </div>`;
    }

    const teamRow = (team, i) => {
      const off = res.by != null || g.locked.includes(i);
      const right = q4
        ? `<button class="btn good" data-action="bowl-right" data-i="${i}" data-pts="30" ${off ? "disabled" : ""}>Before (+) · 30</button>
           <button class="btn good" data-action="bowl-right" data-i="${i}" data-pts="20" ${off ? "disabled" : ""}>Before (*) · 20</button>
           <button class="btn good" data-action="bowl-right" data-i="${i}" data-pts="10" ${off ? "disabled" : ""}>After (*) · 10</button>`
        : `<button class="btn good" data-action="bowl-right" data-i="${i}" data-pts="10" ${off ? "disabled" : ""}>Correct · 10</button>`;
      return `<div class="team-row"><span class="who">${esc(team.name)}</span>${right}
        <button class="btn bad" data-action="bowl-wrong" data-i="${i}" ${off ? "disabled" : ""}>Incorrect</button>
        ${g.locked.includes(i) ? `<span class="muted small">locked out</span>` : ""}</div>`;
    };

    const atEnd = g.idx >= list.length - 1;
    const status = res.by != null ? `<b>${esc(g.teams[res.by].name)}</b> scored ${res.pts}.` :
      g.locked.length === 2 ? "Both teams missed — dead tossup." :
      g.locked.length ? `${esc(g.teams[g.locked[0]].name)} is locked out; finish reading for the other team.` : "";

    app.innerHTML = `
      ${scoreboard(g.teams)}
      <div class="progress">
        <span class="stage">${label} · ${g.phase === "tiebreak" ? `#${g.tie.length}` : `Question ${g.idx + 1} of ${list.length}`}</span>
        <span class="spacer"></span>${metaLine(t)}
      </div>
      <div class="qcard">
        <div class="qtext">${fmtQ(t.q)}</div>
        ${answerBlock(t.a)}
      </div>
      ${bonusHtml}
      <div class="controls">
        ${g.teams.map(teamRow).join("")}
        <p class="status">${status}</p>
      </div>
      <div class="nav">
        <button class="btn" data-action="prev" ${g.idx === 0 || g.phase === "tiebreak" ? "disabled" : ""}>← Previous</button>
        <button class="btn" data-action="replace">Replace question<span class="kbd">R</span></button>
        <button class="btn" data-action="undo" ${undoStack.length ? "" : "disabled"}>Undo<span class="kbd">U</span></button>
        <span class="spacer"></span>
        <button class="btn ghost" data-action="end">End game</button>
        <button class="btn primary big" data-action="next">${atEnd && g.phase !== "tiebreak" ? `End of ${label.toLowerCase()}` : "Next question"} →<span class="kbd">→</span></button>
      </div>`;
  }

  function renderBowlIntro() {
    const g = game;
    const [title, desc] = QUARTER_INFO[g.quarter];
    app.innerHTML = `
      ${scoreboard(g.teams)}
      <div class="panel interstitial">
        <div class="big">${title}</div>
        <p class="muted" style="max-width:640px;margin:0 auto 20px">${desc}</p>
        <button class="btn primary big" data-action="begin-quarter">Begin ${title.toLowerCase()} →</button>
      </div>`;
  }

  function resKey() {
    return game.phase === "tiebreak" ? "t" + game.tie.length : game.quarter + "-" + game.idx;
  }

  // ---------- Q3 lightning ----------
  function q3Picker() {
    const g = game;
    // trailing team picks first; tie goes to the first team
    const first = g.teams[1].score < g.teams[0].score ? 1 : 0;
    return g.q3.order.length === 0 ? first : 1 - g.q3.order[0].team;
  }

  function renderQ3() {
    const g = game, q = g.q3;
    q.sets.forEach((id) => markSeen(id));
    if (g.phase === "q3pick") {
      const picker = q3Picker();
      app.innerHTML = `
        ${scoreboard(g.teams)}
        <div class="progress"><span class="stage">Third Quarter · Category choice</span></div>
        <div class="panel">
          <p><b>${esc(g.teams[picker].name)}</b> ${q.order.length ? "takes one of the remaining categories." : "is trailing (or tied) and chooses first."}</p>
          <div class="cats3">
            ${q.sets.map((id) => {
              const c = Q3.get(id);
              const takenBy = q.taken[id];
              return `<div class="cat3 ${takenBy != null ? "taken" : ""}">
                <div class="t">${esc(c.title)}</div>
                <div class="meta" style="margin-bottom:10px">${(c.c || []).map((x) => `<span class="tag">${esc(CAT_NAME[x])}</span>`).join("")}</div>
                ${takenBy != null ? `<span class="muted">Played by ${esc(g.teams[takenBy].name)}</span>`
                  : `<button class="btn primary" data-action="q3-pick" data-id="${id}">${esc(g.teams[picker].name)} chooses this</button>`}
              </div>`;
            }).join("")}
          </div>
        </div>
        <div class="nav"><button class="btn" data-action="undo" ${undoStack.length ? "" : "disabled"}>Undo</button>
          <span class="spacer"></span><button class="btn ghost" data-action="skip-q3">Skip to fourth quarter</button></div>`;
      return;
    }
    // q3run
    const cur = q.order[q.order.length - 1];
    const c = Q3.get(cur.set);
    const i = q.item;
    const done = i >= c.items.length || q.remaining <= 0;
    const it = c.items[Math.min(i, c.items.length - 1)];
    const marks = q.marks[cur.set] || [];
    app.innerHTML = `
      ${scoreboard(g.teams)}
      <div class="progress">
        <span class="stage">Third Quarter · ${esc(g.teams[cur.team].name)} · ${esc(c.title)}</span>
        <span class="spacer"></span>
        <span class="timer ${q.remaining <= 10 ? "low" : ""}" id="timer">${q.remaining}s</span>
        <button class="btn" data-action="timer">${timer ? "Pause" : q.remaining === settings.bowl.q3secs ? "Start timer" : "Resume"}</button>
      </div>
      ${done ? `<div class="panel interstitial"><div class="big">${q.remaining <= 0 ? "Time!" : "Category complete"}</div>
          <p>${esc(g.teams[cur.team].name)} answered ${marks.filter(Boolean).length} of ${c.items.length} (${marks.filter(Boolean).length * 10} points).</p>
          <button class="btn primary big" data-action="q3-finish">${q.order.length < 2 ? "Next team picks →" : "On to the fourth quarter →"}</button></div>`
      : `<div class="qcard">
          ${c.lead ? `<div class="muted" style="margin-bottom:6px">${esc(c.lead)}</div>` : ""}
          <div class="stage" style="margin-bottom:6px">${i + 1} of ${c.items.length}</div>
          <div class="qtext lightning">${fmtQ(it.q)}</div>
          ${answerBlock(it.a)}
        </div>
        <div class="controls row">
          <button class="btn good big" data-action="q3-mark" data-ok="1">Correct · 10<span class="kbd">C</span></button>
          <button class="btn bad big" data-action="q3-mark" data-ok="0">Incorrect / pass<span class="kbd">X</span></button>
        </div>`}
      <div class="panel">
        <h3>${esc(c.title)} — read list</h3>
        <ul class="lightning-list">${c.items.map((x, k) => `<li><span>${k + 1}.</span><span>${esc(x.a.split(/ \(|\[/)[0])}</span><span class="r">${marks[k] == null ? "" : marks[k] ? "✓" : "✗"}</span></li>`).join("")}</ul>
      </div>
      <div class="nav"><button class="btn" data-action="undo" ${undoStack.length ? "" : "disabled"}>Undo<span class="kbd">U</span></button>
        <span class="spacer"></span><button class="btn ghost" data-action="end">End game</button></div>`;
  }

  function startTimer() {
    if (timer) return;
    timer = setInterval(() => {
      game.q3.remaining -= 1;
      persist();
      const el = document.getElementById("timer");
      if (game.q3.remaining <= 0) {
        stopTimer();
        render();
        return;
      }
      if (el) {
        el.textContent = game.q3.remaining + "s";
        el.classList.toggle("low", game.q3.remaining <= 10);
      }
    }, 1000);
  }
  function stopTimer() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  // ---------- shared views ----------
  function scoreboard(list) {
    const top = Math.max(...list.map((p) => p.score));
    const locked = game.locked || [];
    return `<div class="scoreboard">${list.map((p, i) => `
      <div class="score ${top > 0 && p.score === top ? "leader" : ""} ${locked.includes(i) ? "locked" : ""}">
        <span class="name" title="${esc(p.name)}">${esc(p.name)}</span>
        <span class="pts">${p.score}</span>
        <span class="adj"><button data-action="adj" data-i="${i}" data-d="1" title="Add point(s)">▲</button>
        <button data-action="adj" data-i="${i}" data-d="-1" title="Remove point(s)">▼</button></span>
      </div>`).join("")}</div>`;
  }

  function renderFinal(list, title) {
    stopTimer();
    const ranked = list.map((p, i) => ({ ...p, i })).sort((a, b) => b.score - a.score);
    const tied = game.format === "bowl" && ranked.length > 1 && ranked[0].score === ranked[1].score;
    app.innerHTML = `
      <div class="panel interstitial">
        <div class="big">${title}</div>
        ${tied ? `<p class="warn">Scores are tied.</p><button class="btn primary" data-action="tiebreak">Read a tiebreaker question</button>` :
          `<p class="muted">Winner: <b>${esc(ranked[0].name)}</b></p>`}
        <table class="final-table">
          ${ranked.map((p, k) => `<tr><td>${k + 1}</td><td>${esc(p.name)}</td><td class="num">${p.score}</td></tr>`).join("")}
        </table>
        <div class="row" style="justify-content:center">
          ${game.format === "bowl" && game.phase === "done" ? `<button class="btn" data-action="undo" ${undoStack.length ? "" : "disabled"}>Undo</button>` : ""}
          <button class="btn primary big" data-action="new">New game</button>
        </div>
      </div>`;
  }

  // =====================================================================
  // RENDER + EVENTS
  // =====================================================================
  function render() {
    if (!game) {
      renderSetup();
      return;
    }
    topActions.innerHTML = `<button class="btn" data-action="new">New game</button>`;
    if (game.format === "bee") renderBee();
    else renderBowl();
    window.scrollTo({ top: 0 });
  }

  function advanceBowl() {
    const g = game;
    g.locked = [];
    if (g.phase === "tiebreak") {
      const r = g.results[resKey()];
      if (r && r.by != null) { g.phase = "done"; return; }
      addTiebreaker();
      return;
    }
    const list = g.quarters[g.quarter];
    if (g.idx < list.length - 1) { g.idx++; return; }
    // next quarter
    g.quarter = g.quarter === 2 ? 3 : g.quarter + 1;
    g.idx = 0;
    if (g.quarter > 4) { g.phase = "done"; return; }
    g.phase = "intro";
  }

  function addTiebreaker() {
    const used = new Set([...game.quarters[1], ...game.quarters[2], ...game.quarters[4], ...game.tie]);
    const id = draw(tossupPool("tie"), 1, used)[0];
    if (!id) return alert("No more tiebreaker questions match these settings.");
    game.tie.push(id);
    game.phase = "tiebreak";
  }

  function act(action, el) {
    const g = game;
    const i = el && el.dataset.i != null ? +el.dataset.i : null;
    switch (action) {
      // ----- setup -----
      case "set": settings[el.dataset.key] = el.dataset.val; break;
      case "cat": {
        const id = el.dataset.id;
        settings.cats = settings.cats.includes(id) ? settings.cats.filter((x) => x !== id) : [...settings.cats, id];
        break;
      }
      case "cats-all": settings.cats = D.categories.map((c) => c.id); break;
      case "cats-none": settings.cats = []; break;
      case "add-name": settings.bee.players.push(`Player ${settings.bee.players.length + 1}`); break;
      case "del-name": settings.bee.players.splice(i, 1); break;
      case "reset-seen":
        if (!confirm(`Forget the ${seen.size} questions marked as used on this device?`)) return;
        seen = new Set(); save(LS_SEEN, []); break;
      case "start":
        save(LS_SETTINGS, settings);
        if (game && !confirm("Discard the game in progress and start a new one?")) return;
        startGame();
        return;
      case "resume": render(); return;
      case "new":
        stopTimer();
        if (game && game.phase !== "done" && !(game.format === "bee" && game.idx >= game.queue.length) &&
            !confirm("Leave this game? It will be discarded.")) return;
        game = null; undoStack = []; save(LS_GAME, null);
        break;

      // ----- shared play -----
      case "reveal": el.classList.remove("hidden-ans"); return;
      case "undo": undo(); return;
      case "replace": replaceCurrent(); return;
      case "end":
        if (!confirm("End the game now and show final scores?")) return;
        snapshot(); stopTimer();
        if (g.format === "bee") g.idx = g.queue.length; else g.phase = "done";
        break;
      case "adj": {
        snapshot();
        const list = g.format === "bee" ? g.players : g.teams;
        list[i].score += (+el.dataset.d) * (g.format === "bee" ? 1 : 5);
        break;
      }
      case "prev":
        snapshot(); g.idx = Math.max(0, g.idx - 1); g.locked = []; break;
      case "next":
        snapshot();
        if (g.format === "bee") { g.idx++; g.locked = []; }
        else advanceBowl();
        break;

      // ----- bee -----
      case "bee-right":
        snapshot(); g.players[i].score += 1; g.results[g.idx] = { by: i }; break;
      case "bee-wrong":
        snapshot(); g.locked.push(i); break;

      // ----- bowl -----
      case "begin-quarter":
        snapshot();
        g.phase = g.quarter === 3 ? "q3pick" : "play";
        break;
      case "bowl-right": {
        snapshot();
        const pts = +el.dataset.pts;
        g.teams[i].score += pts;
        g.results[resKey()] = { by: i, pts };
        break;
      }
      case "bowl-wrong": snapshot(); g.locked.push(i); break;
      case "bonus": {
        snapshot();
        const r = g.results[resKey()];
        r.bonus = el.dataset.ok === "1";
        if (r.bonus) g.teams[r.by].score += 10;
        break;
      }
      case "q3-pick": {
        snapshot();
        const team = q3Picker();
        g.q3.taken[el.dataset.id] = team;
        g.q3.order.push({ team, set: el.dataset.id });
        g.q3.item = 0;
        g.q3.remaining = settings.bowl.q3secs;
        g.q3.marks[el.dataset.id] = [];
        g.phase = "q3run";
        break;
      }
      case "q3-mark": {
        snapshot();
        const cur = g.q3.order[g.q3.order.length - 1];
        const ok = el.dataset.ok === "1";
        g.q3.marks[cur.set][g.q3.item] = ok;
        if (ok) g.teams[cur.team].score += 10;
        g.q3.item++;
        if (g.q3.item >= Q3.get(cur.set).items.length) stopTimer();
        break;
      }
      case "timer":
        if (timer) stopTimer(); else startTimer();
        break;
      case "q3-finish":
        snapshot(); stopTimer();
        if (g.q3.order.length < 2) g.phase = "q3pick";
        else { g.quarter = 4; g.idx = 0; g.phase = "intro"; }
        break;
      case "skip-q3":
        snapshot(); stopTimer(); g.quarter = 4; g.idx = 0; g.phase = "intro"; break;
      case "tiebreak":
        snapshot(); addTiebreaker(); break;
      default: return;
    }
    if (!game) save(LS_SETTINGS, settings);
    persist();
    render();
  }

  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-action]");
    if (!el || el.disabled) return;
    const a = el.dataset.action;
    if (a === "name" || a === "num" || a === "diff" || a === "toggle") return;
    act(a, el);
  });

  document.addEventListener("change", (e) => {
    const el = e.target;
    const a = el.dataset && el.dataset.action;
    if (!a) return;
    if (a === "name") {
      const list = settings.format === "bee" ? settings.bee.players : settings.bowl.teams;
      list[+el.dataset.i] = el.value;
      save(LS_SETTINGS, settings);
      return;
    }
    if (a === "num") setPath(el.dataset.path, Math.max(1, parseInt(el.value, 10) || 1));
    else if (a === "diff") settings.difficulty = el.value;
    else if (a === "toggle") settings[el.dataset.key] = el.checked;
    else return;
    save(LS_SETTINGS, settings);
    renderSetup();
  });

  document.addEventListener("keydown", (e) => {
    if (!game || e.target.matches("input, select, textarea") || e.metaKey || e.ctrlKey || e.altKey) return;
    const click = (sel) => {
      const b = app.querySelector(sel);
      if (b && !b.disabled) { b.click(); e.preventDefault(); }
    };
    switch (e.key) {
      case "ArrowRight": case "n": case "N": click('[data-action="next"], [data-action="begin-quarter"], [data-action="q3-finish"]'); break;
      case "ArrowLeft": click('[data-action="prev"]'); break;
      case "r": case "R": click('[data-action="replace"]'); break;
      case "u": case "U": click('[data-action="undo"]'); break;
      case "c": case "C": click('[data-action="q3-mark"][data-ok="1"]'); break;
      case "x": case "X": click('[data-action="q3-mark"][data-ok="0"]'); break;
      case " ": if (game.phase === "q3run") click('[data-action="timer"]'); break;
    }
  });

  render();
})();
