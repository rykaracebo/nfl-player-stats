/* Dashboard: loads the season CSVs in the browser, filters them, and draws charts and a table.
   All calculations come from stats.js (the same code scripts/check_numbers.js tests). Every setting lives in one `state` object,
   which is also what "Reset all", the presets and "Copy link to this view" read and write. */
(function () {
  "use strict";
  const S = NFLStats, C = NFLCharts;
  const $ = (id) => document.getElementById(id);
  const FMT = { int: "int", half: "half", dec1: "dec1", dec2: "dec2", dec3: "dec3", pct1: "pct" };
  const SEASON_TYPE_LABEL = { REG: "Regular season", POST: "Playoffs" };
  const CHIPS = {
    season_type: [["REG", "Regular season"], ["POST", "Playoffs"]],
    unit: [["Offense", "Offense"], ["Defense", "Defense"], ["Special teams", "Special teams"]],
    position_group: [["QB", "QB"], ["RB", "RB"], ["WR", "WR"], ["TE", "TE"], ["OL", "OL"], ["DL", "DL"], ["LB", "LB"], ["DB", "DB"], ["SPEC", "K / P / LS"]],
  };
  const EXTRA_MEASURES = ["pass_yds", "rush_yds", "rec_yds", "tds", "sacks", "ints_def"];
  const TEAM_EXTRAS = ["pass_yds_tg", "rush_yds_tg", "sacks_tg", "ints_tg", "qb_hits_tg", "pen_tg"];
  const TEAM_BREAKDOWN = [["team", "Team (its own players' stats)"], ["opponent_team", "Opponent (stats allowed by that team)"], ["unit", "Unit (offense, defense, special teams)"], ["position_group", "Position group"], ["season_type", "Season type"]];
  const PLAYER_TABLE_VIEWS = [["breakdown", "By the breakdown above"], ["season", "By season"], ["players", "Top player-seasons"], ["gamelog", "Player game log"]];
  const TEAM_TABLE_VIEWS = [["breakdown", "By the breakdown above"], ["season", "By season"], ["teamseasons", "Every team-season"]];
  const MENU_ORDER = ["Totals", "Per player-game", "Per team-game", "Rates", "Advanced"];
  const LINE_DASHES = [[], [7, 4], [2, 3], [10, 3, 2, 3], [1, 5]]; // solid, dashed, dotted, dash-dot, sparse dots: grouped lines differ by more than color
  const MAX_CATS = 5; // lines and bars shown per breakdown in the trend and week charts
  // Summary cards next to the selected measure: [label, columns to add up (null = player-games), format]
  const CARD = {
    pass_yds: ["Passing yards", ["passing_yards"], "int"], pass_td: ["Touchdown passes", ["passing_tds"], "int"],
    pass_att: ["Pass attempts", ["attempts"], "int"], pass_int: ["Interceptions thrown", ["passing_interceptions"], "int"],
    rush_yds: ["Rushing yards", ["rushing_yards"], "int"], carries: ["Carries", ["carries"], "int"], rush_td: ["Rushing touchdowns", ["rushing_tds"], "int"],
    rec_yds: ["Receiving yards", ["receiving_yards"], "int"], rec: ["Receptions (catches)", ["receptions"], "int"], targets: ["Targets", ["targets"], "int"],
    rec_td: ["Receiving touchdowns", ["receiving_tds"], "int"], sacks: ["Sacks (defense)", ["def_sacks"], "half"],
    ints: ["Interceptions (defense)", ["def_interceptions"], "int"], hits: ["QB hits (defense)", ["def_qb_hits"], "int"], pd: ["Passes defended", ["def_pass_defended"], "int"],
    fgm: ["Field goals made", ["fg_made"], "int"], fga: ["Field goals attempted", ["fg_att"], "int"], punts: ["Punts", ["pt_att"], "int"],
    tds: ["Touchdown credits (pass, rush, receive)", ["passing_tds", "rushing_tds", "receiving_tds"], "int"], fantasy: ["Fantasy points (PPR)", ["fantasy_points_ppr"], "int"],
    games: ["Player-games", null, "int"],
  };
  const FAMILY_CARDS = {
    passing: ["pass_yds", "pass_td", "pass_att", "pass_int"], rushing: ["rush_yds", "carries", "rush_td", "tds"],
    receiving: ["rec_yds", "rec", "targets", "rec_td"], defense: ["sacks", "ints", "hits", "pd"],
    kicking: ["fgm", "fga", "punts", "games"], general: ["games", "tds", "fantasy", "pass_yds"],
  };
  const TEAM_FAMILY_CARDS = {
    passing: ["pass_yds_tg", "rush_yds_tg"], rushing: ["rush_yds_tg", "pass_yds_tg"], receiving: ["pass_yds_tg", "rush_yds_tg"],
    defense: ["sacks_tg", "ints_tg", "qb_hits_tg"], kicking: ["pass_yds_tg", "rush_yds_tg"], general: ["pass_yds_tg", "rush_yds_tg", "pen_tg"],
  };

  const store = S.newStore();
  let fieldApi = null, fieldMounted = false;
  let players = [], seasonsAll = [], totalRows = 0, ready = false;
  let state;
  let tableSort = null, tableData = null;

  const fresh = () => ({
    view: "players", seasonMin: seasonsAll[0], seasonMax: seasonsAll[seasonsAll.length - 1], weekMin: 1, weekMax: 22,
    chips: { season_type: new Set(["REG"]), unit: new Set(), position_group: new Set() },
    team: "", opp: "", h2h: null, player: null,
    measureId: "pass_yds_tg", breakdownId: "team", tableView: "season", minimum: "qualified",
  });

  // ------------------------------------------------------------------ loading
  async function load() {
    const manifest = await (await fetch("data/manifest.json")).json();
    seasonsAll = Object.keys(manifest.seasons).map(Number).sort((a, b) => a - b);
    try { await NFLTeams.load(); } catch (e) { /* team names and colors are optional */ }
    let done = 0;
    await Promise.all(seasonsAll.map(async (y) => {
      const r = await fetch(manifest.seasons[y].file);
      if (!r.ok) throw new Error("Could not load season " + y);
      S.addSeason(store, await r.text());
      done++;
      $("progress-bar").style.width = Math.round((done / seasonsAll.length) * 100) + "%";
      $("loading-text").textContent = "Loaded " + done + " of " + seasonsAll.length + " seasons";
    }));
    totalRows = store.chunks.reduce((a, c) => a + c.n, 0);
    players = S.playerIndex(store);
  }

  // ------------------------------------------------------------------ announcements (polite live region)
  let announceTimer = null, lastAnnounced = "";
  function announce(msg, now) {
    clearTimeout(announceTimer);
    const go = () => { if (msg === lastAnnounced) return; lastAnnounced = msg; $("announce").textContent = msg; };
    if (now) go(); else announceTimer = setTimeout(go, 600);
  }

  // ------------------------------------------------------------------ controls
  function fillSelect(el, options, value) {
    el.innerHTML = "";
    options.forEach(([v, label]) => { const o = document.createElement("option"); o.value = v; o.textContent = label; el.appendChild(o); });
    el.value = value;
  }
  const measure = () => S.MEASURE_BY_ID[state.measureId];
  const breakdown = () => {
    const b = S.BREAKDOWNS.find((x) => x.id === state.breakdownId) || S.BREAKDOWNS.find((x) => x.id === "team");
    if (state.view !== "teams") return b;
    const t = TEAM_BREAKDOWN.find((x) => x[0] === b.id);
    return t ? { id: b.id, label: t[1] } : b;
  };
  const minOverride = () => (state.minimum === "qualified" ? 0 : +state.minimum);

  function fixForView() {
    if (state.view === "teams") {
      state.player = null;
      const cur = S.MEASURE_BY_ID[state.measureId];
      if (!cur || cur.group === "Per player-game") state.measureId = "pass_yds_tg";
      if (!TEAM_BREAKDOWN.some((x) => x[0] === state.breakdownId)) state.breakdownId = "team";
      if (!TEAM_TABLE_VIEWS.some((x) => x[0] === state.tableView)) state.tableView = "season";
    } else {
      if (!S.MEASURE_BY_ID[state.measureId]) state.measureId = "pass_yds_tg";
      if (!S.BREAKDOWNS.some((x) => x.id === state.breakdownId)) state.breakdownId = "team";
      if (!PLAYER_TABLE_VIEWS.some((x) => x[0] === state.tableView)) state.tableView = "season";
    }
  }

  function fillMeasures() {
    const groups = {};
    S.MEASURES.forEach((m) => { if (state.view === "teams" && m.group === "Per player-game") return; (groups[m.menuGroup] = groups[m.menuGroup] || []).push(m); });
    const ms = $("m-select");
    ms.innerHTML = "";
    MENU_ORDER.filter((g) => groups[g]).forEach((g) => {
      const og = document.createElement("optgroup"); og.label = g;
      groups[g].forEach((m) => { const o = document.createElement("option"); o.value = m.id; o.textContent = m.label; og.appendChild(o); });
      ms.appendChild(og);
    });
    ms.value = state.measureId;
  }
  function fillMinimum() {
    const m = measure(), row = $("min-row");
    row.hidden = m.type !== "ratio";
    if (m.type !== "ratio") return;
    const unit = m.minUnit || "in the denominator";
    fillSelect($("min-select"), [["qualified", "Qualified (" + m.min + " " + unit + ")"]].concat([10, 25, 50, 100].map((n) => [String(n), n + " " + unit])), state.minimum);
    if ($("min-select").value !== state.minimum) { state.minimum = "qualified"; $("min-select").value = "qualified"; }
  }
  function fillBreakdowns() { fillSelect($("b-select"), state.view === "teams" ? TEAM_BREAKDOWN : S.BREAKDOWNS.map((b) => [b.id, b.label]), state.breakdownId); }
  function fillTableViews() { fillSelect($("table-view"), state.view === "teams" ? TEAM_TABLE_VIEWS : PLAYER_TABLE_VIEWS, state.tableView); }

  function buildGlossary() {
    const dl = $("glossary");
    dl.innerHTML = "";
    S.MEASURES.forEach((m) => {
      const dt = document.createElement("dt"), dd = document.createElement("dd");
      dt.textContent = m.label; dd.textContent = m.what + (m.type === "ratio" ? " Needs at least " + m.min + " " + m.minUnit + " to show (the \"Qualified\" minimum)." : "");
      dl.appendChild(dt); dl.appendChild(dd);
    });
  }

  function syncChips() {
    for (const col of Object.keys(CHIPS)) {
      $("chips-" + col).querySelectorAll(".chip").forEach((b) => b.setAttribute("aria-pressed", state.chips[col].has(b.dataset.value) ? "true" : "false"));
    }
  }
  function syncTeamSelect() {
    // a head-to-head (from a preset or link) shows up as its own entry in the Team menu until the visitor picks something else
    const sel = $("f-team");
    [...sel.querySelectorAll("option[data-h2h]")].forEach((o) => o.remove());
    if (state.h2h) {
      const o = document.createElement("option");
      o.value = "__h2h"; o.dataset.h2h = "1"; o.textContent = "Games between " + state.h2h.join(" and ");
      sel.insertBefore(o, sel.options[1]);
      sel.value = "__h2h";
    } else sel.value = state.team;
  }
  // Put every control into the state it says. Used by reset, presets, and loading a link.
  function syncControls() {
    fixForView();
    $("view-players").setAttribute("aria-pressed", state.view === "players" ? "true" : "false");
    $("view-teams").setAttribute("aria-pressed", state.view === "teams" ? "true" : "false");
    $("player-field").hidden = state.view === "teams";
    $("advanced").hidden = state.view === "teams";
    $("f-season-min").value = state.seasonMin; $("f-season-max").value = state.seasonMax;
    $("f-week-min").value = state.weekMin; $("f-week-max").value = state.weekMax;
    $("f-opp").value = state.opp;
    syncTeamSelect();
    $("player-search").value = state.player ? state.player.name : "";
    $("player-results").hidden = true; $("player-search").setAttribute("aria-expanded", "false");
    fillMeasures(); fillMinimum(); fillBreakdowns(); fillTableViews();
    syncChips();
    tableSort = null;
    if (fieldApi) fieldApi.setSelected(state.team || null);
  }

  function buildControls() {
    const seasonOpts = seasonsAll.map((y) => [y, String(y)]);
    fillSelect($("f-season-min"), seasonOpts, state.seasonMin);
    fillSelect($("f-season-max"), seasonOpts, state.seasonMax);
    const weekOpts = Array.from({ length: 22 }, (_, i) => [i + 1, String(i + 1)]);
    fillSelect($("f-week-min"), weekOpts, 1);
    fillSelect($("f-week-max"), weekOpts, 22);
    const teamList = store.dicts.team.list.slice().sort((a, b) => NFLTeams.name(a).localeCompare(NFLTeams.name(b)));
    fillSelect($("f-team"), [["", "All teams"]].concat(teamList.map((t) => [t, NFLTeams.name(t)])), "");
    fillSelect($("f-opp"), [["", "All opponents"]].concat(teamList.map((t) => [t, NFLTeams.name(t)])), "");

    for (const col of Object.keys(CHIPS)) {
      const box = $("chips-" + col);
      box.innerHTML = "";
      CHIPS[col].forEach(([value, label]) => {
        const b = document.createElement("button");
        b.type = "button"; b.className = "chip"; b.textContent = label; b.dataset.value = value;
        b.addEventListener("click", () => {
          const set = state.chips[col];
          set.has(value) ? set.delete(value) : set.add(value);
          syncChips();
          update();
        });
        box.appendChild(b);
      });
    }
    buildGlossary();
    fillSelect($("d-season"), seasonsAll.slice().reverse().map((y) => [y, String(y)]), seasonsAll[seasonsAll.length - 1]);
    fillSelect($("d-pos"), [["QB", "Quarterbacks"], ["RB", "Running backs"], ["WR", "Wide receivers"], ["TE", "Tight ends"]], "QB");
    $("d-season").addEventListener("change", renderDeep);
    $("d-pos").addEventListener("change", renderDeep);
    $("view-players").addEventListener("click", () => setView("players"));
    $("view-teams").addEventListener("click", () => setView("teams"));

    const onFilter = (ev) => {
      state.seasonMin = +$("f-season-min").value; state.seasonMax = +$("f-season-max").value;
      if (state.seasonMin > state.seasonMax) { if (ev && ev.target && ev.target.id === "f-season-max") { state.seasonMin = state.seasonMax; $("f-season-min").value = state.seasonMin; } else { state.seasonMax = state.seasonMin; $("f-season-max").value = state.seasonMax; } }
      state.weekMin = +$("f-week-min").value; state.weekMax = +$("f-week-max").value;
      if (state.weekMin > state.weekMax) { if (ev && ev.target && ev.target.id === "f-week-max") { state.weekMin = state.weekMax; $("f-week-min").value = state.weekMin; } else { state.weekMax = state.weekMin; $("f-week-max").value = state.weekMax; } }
      const t = $("f-team").value;
      if (t !== "__h2h") { if (state.h2h) { state.h2h = null; syncTeamSelect(); } state.team = t; }
      state.opp = $("f-opp").value;
      if (state.h2h && state.opp) { state.h2h = null; state.team = ""; syncTeamSelect(); }
      if (fieldApi) fieldApi.setSelected(state.team || null);
      if (t !== "__h2h" && state.team) avoidSingleTeamSplit();
      update();
    };
    ["f-season-min", "f-season-max", "f-week-min", "f-week-max", "f-team", "f-opp"].forEach((id) => $(id).addEventListener("change", onFilter));
    $("m-select").addEventListener("change", () => { state.measureId = $("m-select").value; autoMeasureId = null; fillMinimum(); update(); });
    $("min-select").addEventListener("change", () => { state.minimum = $("min-select").value; update(); });
    $("b-select").addEventListener("change", () => { state.breakdownId = $("b-select").value; update(); });
    $("table-view").addEventListener("change", () => { state.tableView = $("table-view").value; tableSort = null; renderTable(filters()); writeUrl(); announce("Table: " + $("table-view").selectedOptions[0].textContent.toLowerCase() + ".", true); });
    $("btn-reset").addEventListener("click", resetAll);
    $("btn-link").addEventListener("click", copyLink);
    $("btn-csv").addEventListener("click", downloadCsv);
    $("more-toggle").addEventListener("click", () => toggleMore());
    setupPlayerSearch();
    buildPresets();
    setupFieldPanel();
  }

  function toggleMore(open) {
    const el = $("more-filters"), btn = $("more-toggle");
    const show = open === undefined ? el.hidden : open;
    el.hidden = !show;
    btn.setAttribute("aria-expanded", show ? "true" : "false");
  }

  function setView(v) {
    state.view = v;
    if (v === "teams") state.breakdownId = TEAM_BREAKDOWN.some((x) => x[0] === state.breakdownId) ? state.breakdownId : "team";
    state.tableView = "season";
    syncControls();
    update();
  }

  function resetAll() {
    state = fresh();
    syncControls();
    toggleMore(false);
    $("advanced").open = false;
    $("field-panel").open = false;
    update();
    announce("Everything is back to the starting view.", true);
  }

  // a preset or a click on the field changes the numbers below the fold: bring them into view (the sticky bars are cleared by scroll-padding)
  function showResults() { $("summary").scrollIntoView({ behavior: C.reducedMotion() ? "auto" : "smooth", block: "start" }); }
  // with one team or one player chosen, splitting by "Team" gives a single line: start on a split that shows something
  function avoidSingleTeamSplit() {
    const to = state.team ? "position_group" : state.player ? "position" : null;
    if (to && state.breakdownId === "team") { state.breakdownId = to; $("b-select").value = to; }
  }

  // ------------------------------------------------------------------ presets
  const findPlayer = (name) => players.find((p) => p.name === name) || null;
  let bestQbCache = null;
  function bestQbSeason() {
    if (!bestQbCache) {
      let best = null;
      for (const [season, res] of S.epaOverReplacement(store, "QB", null, null)) for (const r of res.rows) if (!best || r.epaor > best.epaor) best = { season, name: r.name, epaor: r.epaor };
      bestQbCache = best;
    }
    return bestQbCache;
  }
  function buildPresets() {
    const list = [
      { label: "Passing peaked in 2015", make: () => ({ tableView: "season" }) },
      { label: "Patrick Mahomes by season", make: () => { const p = findPlayer("Patrick Mahomes"); return p && { player: p, chips: { season_type: new Set(["REG", "POST"]), unit: new Set(), position_group: new Set() }, measureId: "pass_yds", breakdownId: "season_type", tableView: "season" }; } },
      { label: "Who led the league in sacks in 2021", make: () => ({ seasonMin: 2021, seasonMax: 2021, measureId: "sacks", breakdownId: "position_group", tableView: "players" }) },
      { label: "Best QB seasons by EPA over replacement", make: () => ({ chips: { season_type: new Set(["REG"]), unit: new Set(), position_group: new Set(["QB"]) }, measureId: "epa_opp_qb", breakdownId: "team", tableView: "players" }),
        after: () => { const b = bestQbSeason(); $("advanced").open = true; $("d-pos").value = "QB"; if (b) $("d-season").value = b.season; renderDeep(); $("advanced").scrollIntoView({ behavior: C.reducedMotion() ? "auto" : "smooth", block: "start" }); } },
      { label: "Chiefs vs Bills: their games against each other", make: () => (store.dicts.team.map.has("KC") && store.dicts.team.map.has("BUF") ? { view: "teams", h2h: ["KC", "BUF"], measureId: "pass_yds_tg", breakdownId: "team", tableView: "breakdown" } : null) },
    ];
    const box = $("presets");
    box.innerHTML = "";
    list.forEach((p) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "preset"; b.textContent = p.label;
      b.addEventListener("click", () => {
        const patch = p.make();
        if (!patch) return;
        state = Object.assign(fresh(), patch);
        syncControls();
        toggleMore(activeFilters().more.length > 0);
        update();
        if (p.after) p.after(); else showResults();
        announce("Showing: " + p.label + ". " + describe() + ".", true);
      });
      box.appendChild(b);
    });
  }

  // ------------------------------------------------------------------ football field (collapsed panel, mounted on first open)
  function setupFieldPanel() {
    const panel = $("field-panel");
    panel.addEventListener("toggle", () => { if (panel.open && !fieldMounted) mountField(); });
    if (state.team) panel.open = true;
    if (panel.open) mountField();
  }
  function mountField() {
    fieldMounted = true;
    fetch("data/team_summary.json").then((r) => r.json()).then((summary) => {
      fieldApi = NFLField.mount($("field-root"), {
        teams: NFLTeams.list, summary, selected: state.team || null,
        title: "The league on the field", blurb: "Hover a team to freeze the play and see its numbers. Click a team to filter the whole dashboard to it.",
        measureSelect: false, goText: "Click to filter to this team", goButton: "Filter to this team",
        linkFor: () => "#",
        onSelect: (code) => selectTeam(code),
      });
    }).catch(() => { $("field-panel").hidden = true; });
  }
  function selectTeam(code) {
    state.team = code; state.h2h = null; syncTeamSelect();
    if (fieldApi) fieldApi.setSelected(code);
    avoidSingleTeamSplit();
    $("field-panel").open = false;
    update();
    showResults();
    announce("Filtered to " + NFLTeams.name(code) + ".", true);
  }
  function clearTeam() {
    state.team = ""; state.h2h = null; syncTeamSelect();
    if (fieldApi) fieldApi.setSelected(null);
    update();
  }
  function paintFieldStatus() {
    const name = state.team ? NFLTeams.name(state.team) : state.h2h ? state.h2h.join(" and ") : "";
    $("field-current").textContent = state.team ? name : state.h2h ? "Games between " + name : "All teams";
    const st = $("field-status");
    st.hidden = !state.team;
    if (state.team) {
      st.innerHTML = "";
      st.appendChild(document.createTextNode("✓ The dashboard is filtered to " + name + ". "));
      const b = document.createElement("button"); b.type = "button"; b.className = "btn ghost small"; b.textContent = "Clear team";
      b.addEventListener("click", clearTeam); st.appendChild(b);
    }
  }

  // ------------------------------------------------------------------ player search (combobox)
  function setupPlayerSearch() {
    const input = $("player-search"), list = $("player-results");
    let timer = null, active = -1, items = [];
    const setActive = (i) => {
      active = i;
      [...list.children].forEach((li, k) => { li.setAttribute("aria-selected", k === i ? "true" : "false"); li.classList.toggle("active", k === i); });
      if (i >= 0 && list.children[i]) { input.setAttribute("aria-activedescendant", list.children[i].id); list.children[i].scrollIntoView({ block: "nearest" }); }
      else input.removeAttribute("aria-activedescendant");
    };
    const close = () => { list.hidden = true; input.setAttribute("aria-expanded", "false"); setActive(-1); };
    const render = () => {
      const q = input.value.trim().toLowerCase();
      if (q.length < 2) { close(); return; }
      const hits = players.filter((p) => p.name.toLowerCase().includes(q))
        .sort((a, b) => (b.name.toLowerCase().startsWith(q) - a.name.toLowerCase().startsWith(q)) || b.games - a.games).slice(0, 8);
      list.innerHTML = ""; items = hits;
      if (!hits.length) { const li = document.createElement("li"); li.className = "none"; li.setAttribute("role", "presentation"); li.textContent = "No players found"; list.appendChild(li); }
      hits.forEach((p, k) => {
        const li = document.createElement("li");
        li.id = "player-opt-" + k; li.setAttribute("role", "option"); li.setAttribute("aria-selected", "false");
        li.innerHTML = "<b></b><span></span>";
        li.firstChild.innerHTML = NFLTeams.badge(p.team) + " ";
        li.firstChild.appendChild(document.createTextNode(p.name));
        li.lastChild.textContent = p.position_group + " · " + p.team + " · " + p.first + (p.last !== p.first ? "–" + p.last : "");
        li.addEventListener("mousedown", (e) => { e.preventDefault(); selectPlayer(p); });
        list.appendChild(li);
      });
      list.hidden = false; input.setAttribute("aria-expanded", "true"); setActive(-1);
      announce(hits.length ? hits.length + (hits.length === 1 ? " player found" : " players found") + ". Use the arrow keys to choose." : "No players found.", true);
    };
    input.addEventListener("input", () => {
      if (!input.value.trim() && state.player) { state.player = null; update(); }
      clearTimeout(timer); timer = setTimeout(render, 90);
    });
    input.addEventListener("keydown", (e) => {
      const open = !list.hidden && items.length;
      if (e.key === "ArrowDown") { e.preventDefault(); if (list.hidden) render(); else if (items.length) setActive((active + 1) % items.length); }
      else if (e.key === "ArrowUp") { e.preventDefault(); if (open) setActive((active - 1 + items.length) % items.length); }
      else if (e.key === "Enter") { if (open && active >= 0) { e.preventDefault(); selectPlayer(items[active]); } else if (open && items.length === 1) { e.preventDefault(); selectPlayer(items[0]); } }
      else if (e.key === "Escape") { if (!list.hidden) { e.preventDefault(); close(); } input.focus(); }
      else if (e.key === "Tab") close();
    });
    input.addEventListener("search", () => { if (!input.value && state.player) { state.player = null; update(); } });
    document.addEventListener("click", (e) => { if (!e.target.closest(".search")) close(); });
    input.addEventListener("blur", () => setTimeout(close, 120));
  }

  // the starting measure is a quarterback one; a receiver or a pass rusher needs a measure of their own
  const PLAYER_MEASURE = { RB: "rush_yds", WR: "rec_yds", TE: "rec_yds", DL: "sacks", LB: "sacks", DB: "ints_def", OL: "penalties", SPEC: "games" };
  let autoMeasureId = null; // the measure picked for the last player; it keeps following new players until the visitor picks one
  function selectPlayer(p) {
    state.player = p;
    const want = PLAYER_MEASURE[p.position_group];
    if ((state.measureId === fresh().measureId || state.measureId === autoMeasureId) && want && S.MEASURE_BY_ID[want]) {
      state.measureId = want; autoMeasureId = want; $("m-select").value = want; fillMinimum();
    }
    // a team left over from picking on the field would quietly cut this player's numbers down to that team
    const hadTeam = !!(state.team || state.h2h);
    if (hadTeam) {
      state.team = ""; state.h2h = null; syncTeamSelect(); if (fieldApi) fieldApi.setSelected(null);
      // picking the team moved the split to position group, which is the same one line for a single player
      if (state.breakdownId === "position_group") { state.breakdownId = "position"; $("b-select").value = "position"; }
    }
    $("player-search").value = p.name;
    $("player-results").hidden = true; $("player-search").setAttribute("aria-expanded", "false");
    if (state.tableView === "breakdown") { state.tableView = "season"; $("table-view").value = "season"; tableSort = null; }
    avoidSingleTeamSplit();
    update();
    announce("Showing " + p.name + (hadTeam ? ", all teams." : "."), true);
    $("player-search").focus();
  }

  function filters() {
    const cats = {};
    for (const col of Object.keys(state.chips)) cats[col] = state.chips[col].size ? Array.from(state.chips[col]) : null;
    if (state.h2h) { cats.team = state.h2h.slice(); cats.opponent_team = state.h2h.slice(); }
    else { if (state.team) cats.team = [state.team]; if (state.opp) cats.opponent_team = [state.opp]; }
    if (state.player) cats.player_id = [state.player.id];
    return { seasonMin: state.seasonMin, seasonMax: state.seasonMax, weekMin: state.weekMin, weekMax: state.weekMax, cats };
  }

  // ------------------------------------------------------------------ plain-language summary and filter count
  function activeFilters() {
    const d = fresh(), out = [];
    if (state.seasonMin !== d.seasonMin || state.seasonMax !== d.seasonMax) out.push("seasons");
    const more = [];
    if (state.weekMin !== 1 || state.weekMax !== 22) more.push("weeks");
    if (state.team) out.push("team");
    if (state.h2h) out.push("head-to-head");
    if (state.opp) more.push("opponent");
    const same = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
    if (!same(state.chips.season_type, d.chips.season_type)) more.push("season type");
    if (!same(state.chips.unit, d.chips.unit)) more.push("unit");
    if (!same(state.chips.position_group, d.chips.position_group)) out.push("position group");
    if (state.player) out.push("player");
    return { all: out.concat(more), more };
  }
  function describe() {
    const parts = [];
    parts.push(state.player ? state.player.name + " (" + state.player.position_group + ")" : state.view === "teams" ? "Teams" : "Players");
    parts.push(state.seasonMin === state.seasonMax ? String(state.seasonMin) : state.seasonMin + " to " + state.seasonMax);
    if (state.weekMin !== 1 || state.weekMax !== 22) parts.push("weeks " + state.weekMin + " to " + state.weekMax);
    const st = state.chips.season_type;
    parts.push(st.size === 1 ? (st.has("REG") ? "regular season" : "playoffs only") : "regular season and playoffs");
    const pg = state.chips.position_group, un = state.chips.unit;
    if (!state.player || pg.size || un.size) {
      const pos = pg.size ? [...pg].join(", ") + " only" : "", unit = un.size ? [...un].map((u) => u.toLowerCase()).join(" and ") + " only" : "";
      parts.push(pos && unit ? pos + " and " + unit : pos || unit || "all positions");
    }
    if (state.h2h) parts.push("games between " + state.h2h.map((t) => NFLTeams.name(t)).join(" and "));
    else {
      if (state.team) parts.push(NFLTeams.name(state.team));
      if (state.opp) parts.push("against " + NFLTeams.name(state.opp));
    }
    return parts.join(", ");
  }
  const span = (first, last) => (first === last ? String(first) : first + " to " + last);
  function playerNotice() {
    const p = state.player;
    if (!p || state.h2h || !(state.team || state.opp)) return "";
    const joined = p.teams.map((t) => "the " + NFLTeams.name(t.team) + " (" + span(t.first, t.last) + ")");
    const list = joined.length > 1 ? joined.slice(0, -1).join(", ") + " and " + joined[joined.length - 1] : joined[0];
    if (state.team) {
      const name = "the " + NFLTeams.name(state.team), mine = p.teams.find((t) => t.team === state.team);
      if (!mine) return p.name + " did not play for " + name + " in any season from " + seasonsAll[0] + " to " + seasonsAll[seasonsAll.length - 1] + ". Teams in this data: " + list + ".";
      return p.name + " has no games for " + name + " with these filters. The games with this team were in " + span(mine.first, mine.last) + ", so try widening the seasons, weeks or season type.";
    }
    return p.name + " has no games against the " + NFLTeams.name(state.opp) + " with these filters. Try widening the seasons, weeks or season type.";
  }
  function paintState(rowsText) {
    const a = activeFilters(), sentence = describe();
    $("view-sentence").textContent = "Showing: " + sentence + ".";
    const countText = a.all.length ? a.all.length + (a.all.length === 1 ? " filter active" : " filters active") : "Starting filters";
    $("filter-count").textContent = countText;
    $("more-count").textContent = a.more.length ? "(" + a.more.length + " active)" : "";
    announce(sentence + ". " + countText + ". " + rowsText);
    paintFieldStatus();
  }

  // ------------------------------------------------------------------ link to this view
  const PARAM_CHIPS = { season_type: "type", unit: "unit", position_group: "pos" };
  function writeUrl() {
    if (!ready) return;
    const d = fresh(), q = new URLSearchParams();
    if (state.view !== d.view) q.set("view", state.view);
    if (state.seasonMin !== d.seasonMin) q.set("from", state.seasonMin);
    if (state.seasonMax !== d.seasonMax) q.set("to", state.seasonMax);
    if (state.weekMin !== 1) q.set("wk0", state.weekMin);
    if (state.weekMax !== 22) q.set("wk1", state.weekMax);
    for (const col of Object.keys(PARAM_CHIPS)) {
      const cur = [...state.chips[col]].sort().join(","), def = [...d.chips[col]].sort().join(",");
      if (cur !== def) q.set(PARAM_CHIPS[col], cur || "all");
    }
    if (state.h2h) q.set("h2h", state.h2h.join(","));
    else { if (state.team) q.set("team", state.team); if (state.opp) q.set("opp", state.opp); }
    if (state.player) q.set("player", state.player.id);
    if (state.measureId !== d.measureId) q.set("m", state.measureId);
    if (state.breakdownId !== d.breakdownId) q.set("b", state.breakdownId);
    if (state.tableView !== d.tableView) q.set("table", state.tableView);
    if (state.minimum !== d.minimum) q.set("min", state.minimum);
    const s = q.toString();
    try { history.replaceState(null, "", location.pathname + (s ? "?" + s : "")); } catch (e) { /* file: or sandboxed */ }
  }
  function readUrl() {
    const q = new URLSearchParams(location.search), d = fresh();
    const has = (k) => q.has(k);
    if (q.get("view") === "teams") d.view = "teams";
    const yr = (k) => { const v = +q.get(k); return seasonsAll.includes(v) ? v : null; };
    if (yr("from")) d.seasonMin = yr("from");
    if (yr("to")) d.seasonMax = yr("to");
    if (d.seasonMin > d.seasonMax) d.seasonMax = d.seasonMin;
    const wk = (k, dflt) => { const v = +q.get(k); return Number.isInteger(v) && v >= 1 && v <= 22 ? v : dflt; };
    d.weekMin = wk("wk0", 1); d.weekMax = wk("wk1", 22);
    if (d.weekMin > d.weekMax) d.weekMax = d.weekMin;
    for (const col of Object.keys(PARAM_CHIPS)) if (has(PARAM_CHIPS[col])) {
      const raw = q.get(PARAM_CHIPS[col]);
      const allowed = new Set(CHIPS[col].map((c) => c[0]));
      const keep = raw === "all" ? [] : raw.split(",").filter((v) => allowed.has(v));
      if (raw === "all" || keep.length) d.chips[col] = new Set(keep);
    }
    const known = (t) => store.dicts.team.map.has(t);
    if (has("h2h")) { const t = q.get("h2h").split(","); if (t.length === 2 && t[0] !== t[1] && t.every(known)) d.h2h = t; }
    if (!d.h2h) { if (known(q.get("team"))) d.team = q.get("team"); if (known(q.get("opp"))) d.opp = q.get("opp"); }
    if (has("player")) d.player = players.find((p) => p.id === q.get("player")) || null;
    if (S.MEASURE_BY_ID[q.get("m")]) d.measureId = q.get("m");
    if (has("b")) d.breakdownId = q.get("b");
    if (has("table")) d.tableView = q.get("table");
    if (["10", "25", "50", "100"].includes(q.get("min"))) d.minimum = q.get("min");
    return d;
  }
  function copyLink() {
    writeUrl();
    const btn = $("btn-link"), url = location.href, label = btn.textContent;
    const done = (ok) => { btn.textContent = ok ? "Link copied" : "Copy failed: use the address bar"; announce(ok ? "Link copied to the clipboard." : "Could not copy. The address bar has the link.", true); setTimeout(() => { btn.textContent = label; }, 2200); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(() => done(true), () => done(false));
    else {
      const ta = document.createElement("textarea"); ta.value = url; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      let ok = false; try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
      ta.remove(); done(ok);
    }
  }

  // ------------------------------------------------------------------ helpers
  const isTeamCol = (col) => col === "team" || col === "opponent_team";
  // Team badges for one code or several joined by "/" (a player who changed teams in a season).
  const badges = (str) => String(str).split("/").map((t) => NFLTeams.badge(t)).join(" ");
  const allTeams = (str) => String(str).split("/").every((t) => NFLTeams.byCode[t]);
  // Segmented bars: one dataset per team slot. Each bar's length is its total; each segment is that team's share of it.
  function segmentDatasets(items, fmt) {
    const maxSeg = Math.max.apply(null, [1].concat(items.map((it) => it.parts.length)));
    const ds = [];
    for (let j = 0; j < maxSeg; j++) {
      ds.push({
        label: "Team " + (j + 1),
        data: items.map((it) => (it.parts[j] ? it.parts[j].share * it.total : 0)),
        barTeams: items.map((it) => (it.parts[j] ? it.parts[j].team : null)),
        tips: items.map((it) => {
          const p = it.parts[j];
          if (!p) return null;
          return p.team + ": " + (Number.isNaN(p.value) ? "n/a" : S.format(fmt, p.value)) + (it.parts.length > 1 ? " (" + Math.round(p.share * 100) + "% of this player's workload)" : "");
        }),
      });
    }
    return ds;
  }
  const cardsHtml = (cards) => cards.map(([v, fmt, l]) => "<div class='kpi card'><div class='kpi-value'>" + S.format(fmt, v) + "</div><div class='kpi-label'>" + l + "</div></div>").join("");
  const nn = (v) => (v === undefined || Number.isNaN(v) ? null : v);
  // With a player selected we show every value; otherwise ratios need a minimum sample so tiny groups do not distort charts.
  const val = (m, g, k) => (state.player ? S.value(m, g, k || 0) : S.valueMin(m, g, k || 0, minOverride()));
  const minText = (m) => (m.type === "ratio" ? S.minOf(m, minOverride()) + " " + (m.minUnit || "") : "");
  const minNote = (m) => (m.type === "ratio" && !state.player ? " Groups with fewer than " + minText(m).trim() + " are left out." : "");
  // Color follows the category, not its rank; two shown categories never share a color.
  function seriesColors(col, cats) {
    const all = store.dicts[col].list.slice().sort();
    const used = new Set(), out = {};
    cats.slice().sort((a, b) => all.indexOf(store.dicts[col].list[a]) - all.indexOf(store.dicts[col].list[b])).forEach((c) => {
      let i = all.indexOf(store.dicts[col].list[c]) % 8;
      while (used.has(i)) i = (i + 1) % 8;
      used.add(i); out[c] = "--series-" + (i + 1);
    });
    return cats.map((c) => out[c]);
  }
  const catColors = (b, cats) => (isTeamCol(b.id) ? cats.map((c) => NFLTeams.color(store.dicts[b.id].list[c])) : seriesColors(b.id, cats));
  function catLabel(col, code) {
    const v = store.dicts[col].list[code];
    if (col === "season_type") return SEASON_TYPE_LABEL[v] || v;
    if (col === "position_group" && v === "SPEC") return "K / P / LS";
    return v;
  }
  function showEmpty(n, msg) {
    const canvas = $("c" + n);
    const prev = C.registry.get(canvas);
    if (prev) { prev.chart.destroy(); C.registry.delete(canvas); }
    canvas.parentElement.hidden = !!msg;
    $("e" + n).hidden = !msg;
    $("e" + n).textContent = msg || "";
  }
  function draw(n, spec) { showEmpty(n, null); C.buildChart($("c" + n), spec); }
  // a phone has room for "P. Mahomes", not "Patrick Mahomes", beside the bars
  const shortName = (n) => (window.innerWidth <= 600 ? n.replace(/^([A-Za-z])[a-z]{2,}\s+(?=\S)/, "$1. ") : n);
  // the screen-reader label of each chart follows what it shows (title, then the line under it)
  function labelCharts() {
    for (let n = 1; n <= 4; n++) $("c" + n).setAttribute("aria-label", (($("t" + n).textContent + ". " + $("s" + n).textContent).trim() + " The same numbers are in the table at the bottom of the page.").replace(/\s+/g, " "));
  }
  const NO_ROWS = "No player-games match these filters. Try widening the season range or clearing a filter, a position or a unit.";
  const bLabel = (b) => b.label.split(" (")[0].toLowerCase();
  // an overall line only makes sense next to group lines when the measure is a rate or average (a sum of everything would dwarf them)
  const comparable = (m) => m.type !== "sum" && m.type !== "teamGames";

  // ------------------------------------------------------------------ update
  function summaryCards(f, m, sum, rows, playerCount) {
    const main = [val(m, sum, 0), m.fmt, m.label];
    if (state.view === "teams") {
      const tgm = S.MEASURE_BY_ID.team_games;
      const extras = (TEAM_FAMILY_CARDS[m.family] || TEAM_FAMILY_CARDS.general).filter((id) => id !== m.id).slice(0, 2).map((id) => S.MEASURE_BY_ID[id]);
      const ms = [m, tgm].concat(extras);
      const agg = S.aggregate(store, f, "all", ms).get(0);
      const cards = [[agg ? val(m, agg, 0) : NaN, m.fmt, m.label], [agg ? S.value(tgm, agg, 1) : 0, "int", "Team-games"], [S.countDistinct(store, f, "team"), "int", "Teams"]];
      extras.forEach((x, i) => cards.push([agg ? S.value(x, agg, i + 2) : NaN, x.fmt, x.label]));
      return cards;
    }
    const keys = (FAMILY_CARDS[m.family] || FAMILY_CARDS.general).filter((k) => CARD[k][0] !== m.label).concat(["games"]).filter((k, i, a) => a.indexOf(k) === i && CARD[k][0] !== m.label);
    const ms = [m].concat(keys.map((k) => ({ type: "sum", num: CARD[k][1] })));
    const agg = S.aggregate(store, f, "all", ms).get(0);
    const cards = [[agg ? val(m, agg, 0) : NaN, m.fmt, m.label]];
    const pool = keys.map((k, i) => [agg ? agg.num[i + 1] : 0, CARD[k][2], CARD[k][0]]).concat(state.player ? [[S.aggregate(store, f, "season", [S.MEASURE_BY_ID.games]).size, "int", "Seasons"], [S.countDistinct(store, f, "team"), "int", "Teams"]] : [[playerCount, "int", "Different players"]]);
    for (const c of pool) {
      if (cards.length >= 5) break;
      if (state.player && c[0] === 0) continue; // a stat this player never recorded is just noise
      cards.push(c);
    }
    return cards;
  }

  function update() {
    fixForView();
    const f = filters(), m = measure(), b = breakdown();
    const sum = S.aggregate(store, f, "all", [m, S.MEASURE_BY_ID.games]).get(0);
    const rows = sum ? sum.rows : 0;
    const playerCount = S.countPlayers(store, f);
    const tgAgg = state.view === "teams" ? S.aggregate(store, f, "all", [S.MEASURE_BY_ID.team_games]).get(0) : null;
    const rowsText = state.view === "teams"
      ? (tgAgg ? tgAgg.tg.size : 0).toLocaleString("en-US") + " team-games in view."
      : rows.toLocaleString("en-US") + " player-games in view.";
    $("status").textContent = state.view === "teams"
      ? (tgAgg ? tgAgg.tg.size : 0).toLocaleString("en-US") + " team-games in view (" + rows.toLocaleString("en-US") + " player-games)"
      : rows.toLocaleString("en-US") + " of " + totalRows.toLocaleString("en-US") + " player-games in view";
    $("m-desc").textContent = "What is this? " + m.what;
    paintMinLine(f, m);

    // a player with no games for the chosen team or opponent: say so instead of showing a wall of zeros
    const note = !rows && state.view === "players" ? playerNotice() : "";
    $("player-notice").hidden = !note; $("player-notice").textContent = note;

    // player banner
    const ban = $("player-banner");
    if (state.player) {
      ban.hidden = false;
      ban.innerHTML = "<span></span><button type='button' class='btn ghost small'>Clear player</button>";
      ban.firstChild.innerHTML = NFLTeams.badge(state.player.team) + " ";
      ban.firstChild.appendChild(document.createTextNode(" Showing " + state.player.name + " (" + state.player.position_group + ", last team " + state.player.team +
        ", seasons " + state.player.first + " to " + state.player.last + "). Every number below is for this player and the filters above."));
      ban.lastChild.addEventListener("click", () => { state.player = null; $("player-search").value = ""; update(); });
    } else ban.hidden = true;

    paintState(rowsText);
    writeUrl();

    if (!rows) {
      $("summary").innerHTML = cardsHtml([[0, "int", state.view === "teams" ? "Team-games" : "Player-games"]]);
      const msg = state.team && state.team === state.opp ? "A team cannot play against itself. Pick a different Team or Opponent." : state.view === "teams" ? "No team-games match these filters. Try widening the season range or clearing a filter." : note ? "No games to show. See the note above." : NO_ROWS;
      for (let n = 1; n <= 4; n++) showEmpty(n, msg);
      ["t1", "t2", "t3", "t4"].forEach((id) => ($(id).textContent = m.label)); ["s1", "s2", "s3", "s4"].forEach((id) => ($(id).textContent = ""));
      renderTable(f);
      $("milestones").innerHTML = "";
      labelCharts();
      return;
    }
    $("summary").innerHTML = cardsHtml(summaryCards(f, m, sum, rows, playerCount));
    const cats = pickCats(f, m, b);
    chartTrend(f, m, b, cats);
    chartCategory(f, m, b);
    if (state.view === "teams") chartTeamSeasons(f, m, b); else chartPlayers(f, m, b);
    chartWeek(f, m, b, cats);
    renderTable(f);
    if (state.view === "players") {
      const ms = S.milestones(store, f).total;
      $("milestones").innerHTML = S.MILESTONES.map((x) => "<div class='kpi card'><div class='kpi-value'>" + ms[x.id].toLocaleString("en-US") +
        "</div><div class='kpi-label'>" + x.label + " (player-seasons)</div></div>").join("");
    }
    labelCharts();
  }

  // "Showing N players who meet the minimum": for rate measures only
  function paintMinLine(f, m) {
    const el = $("min-line");
    if (m.type !== "ratio") { el.textContent = ""; return; }
    if (state.player) { el.textContent = "One player is selected, so the minimum is not applied to this player's numbers."; return; }
    const col = state.view === "teams" ? (state.breakdownId === "opponent_team" ? "opponent_team" : "team") : "player_id";
    const n = S.qualifiedPlayers(store, f, m, minOverride(), col);
    const who = col === "player_id" ? (n === 1 ? "player" : "players") : (n === 1 ? "team" : "teams");
    el.textContent = "Showing " + n.toLocaleString("en-US") + " " + who + " who meet the minimum of " + minText(m).trim() +
      (col === "player_id" ? " across the seasons in view. The top-10 chart applies it to each single season." : " in total.");
  }

  // the categories a breakdown draws as lines (trend, week charts): the highest values, at most MAX_CATS
  function pickCats(f, m, b) {
    const g = S.aggregate(store, f, b.id, [m]);
    const arr = [];
    for (const [key, v] of g) {
      const x = val(m, v, 0);
      if (Number.isNaN(x)) continue;
      arr.push([key, x, v.rows]);
    }
    arr.sort((a, c) => c[1] - a[1]);
    const nonzero = arr.filter((e) => e[1] !== 0); // a group with no value at all (for example defensive linemen for passing yards) is not a line worth drawing
    const ranked = nonzero.length ? nonzero : arr;
    return { list: ranked.slice(0, MAX_CATS).map((e) => e[0]), total: ranked.length };
  }
  function splitNote(b, cats) {
    if (cats.total <= 1) return "One " + bLabel(b) + " in view, so there is nothing to split.";
    return "Split by " + bLabel(b) + (cats.total > MAX_CATS ? " (" + "highest " + MAX_CATS + " of " + cats.total + " by value)" : "") + ".";
  }

  function chartTrend(f, m, b, cats) {
    const overall = S.aggregate(store, f, "season", [m]);
    const g = S.aggregate(store, f, b.id + "|season", [m]);
    const byCat = new Map(), seasonSet = new Set();
    for (const [key, v] of g) {
      const cat = Math.floor(key / 64), season = (key % 64) + 2000, x = val(m, v, 0);
      if (Number.isNaN(x)) continue;
      seasonSet.add(season);
      if (!byCat.has(cat)) byCat.set(cat, new Map());
      byCat.get(cat).set(season, x);
    }
    const ovMap = new Map();
    for (const [season, v] of overall) { const x = val(m, v, 0); if (!Number.isNaN(x)) { ovMap.set(season, x); seasonSet.add(season); } }
    const seasons = Array.from(seasonSet).sort((a, c) => a - c);
    $("t1").textContent = m.label + " by season";
    const shown = cats.list.filter((c) => byCat.has(c));
    if (!ovMap.size && !shown.length) { $("s1").textContent = ""; showEmpty(1, "No value can be computed for this measure with these filters."); return; }
    const datasets = [], colors = [];
    const single = cats.total <= 1;
    if (comparable(m) || single || !shown.length) {
      datasets.push({ label: single && shown.length ? catLabel(b.id, shown[0]) : "All rows in view", data: seasons.map((s) => nn(ovMap.get(s))), width: single ? 2.6 : 3.4 });
      colors.push(single && isTeamCol(b.id) && shown.length ? NFLTeams.color(store.dicts[b.id].list[shown[0]]) : "--fg");
    }
    if (!single) {
      shown.forEach((c, i) => datasets.push({ label: catLabel(b.id, c), data: seasons.map((s) => nn(byCat.get(c).get(s))), dash: LINE_DASHES[i % LINE_DASHES.length] }));
      catColors(b, shown).forEach((c) => colors.push(c));
    }
    const oneSeason = seasons.length === 1; // one x value: the dots sit in the middle of the chart
    $("s1").textContent = (oneSeason ? "Only " + seasons[0] + " is selected, so each dot is that season's value; widen the season range to see a trend, or use the week chart for movement within it. " : "") +
      splitNote(b, cats) + (comparable(m) && !single ? " The thick line is all rows in view." : "") + minNote(m);
    draw(1, { kind: "line", labels: seasons, datasets, colors, fmt: FMT[m.fmt], yTitle: m.label });
  }

  function chartCategory(f, m, b) {
    const collect = (bd) => {
      const g = S.aggregate(store, f, bd.id, [m]);
      const items = [];
      for (const [key, v] of g) { const x = val(m, v, 0); if (!Number.isNaN(x)) items.push([catLabel(bd.id, key), x]); }
      items.sort((a, c) => c[1] - a[1]);
      return items;
    };
    let use = b, items = collect(b), note = "";
    if (items.length <= 1) { // one group is nothing to compare: fall back to a split that has several
      const alts = (state.view === "teams" ? ["unit", "position_group", "team", "season_type"] : state.player ? ["opponent_team", "team", "season_type"] : ["position_group", "unit", "team", "season_type"]).filter((id) => id !== b.id);
      for (const id of alts) {
        const alt = S.BREAKDOWNS.find((x) => x.id === id), it = collect(alt);
        if (it.length > 1) { use = alt; items = it; note = "Only one " + bLabel(b) + " in view, so this splits by " + bLabel(alt) + " instead. "; break; }
      }
    }
    const LIMIT = 16;
    const top = items.slice(0, LIMIT);
    if (items.length === 1) { // still one group after trying other splits: nothing to compare, so say so instead of drawing one bar
      $("t2").textContent = m.label + " by " + bLabel(use);
      $("s2").textContent = "";
      showEmpty(2, "Only one " + bLabel(use) + " (" + items[0][0] + ") has a value here, so there is nothing to compare. Try another \"Break down by\"" + (m.type === "ratio" && !state.player ? " or a lower Minimum" : "") + ".");
      return;
    }
    $("t2").textContent = m.label + " by " + bLabel(use);
    $("s2").textContent = note + (items.length > LIMIT ? "Top " + LIMIT + " of " + items.length + " " + bLabel(use) + "s (the table lists all of them)" : items.length + (items.length === 1 ? " group" : " groups")) + "." + minNote(m);
    if (!top.length) { showEmpty(2, "No value can be computed for this measure with these filters."); return; }
    // the trend chart beside it takes the same height, so the two cards fill evenly
    const boxH = Math.max(300, top.length * 26 + 70) + "px";
    $("box2").style.height = boxH; $("c1").parentElement.style.height = boxH;
    draw(2, { kind: "hbar", labels: top.map((x) => x[0]), datasets: [{ label: m.label, data: top.map((x) => x[1]), barColors: isTeamCol(use.id) ? top.map((x) => NFLTeams.color(x[0])) : null }], colors: ["--accent"], fmt: FMT[m.fmt], yTitle: m.label });
  }

  function chartTeamSeasons(f, m, b) {
    const col = b.id === "opponent_team" ? "opponent_team" : "team";
    const g = S.aggregate(store, f, col + "|season", [m]);
    const items = [];
    for (const [key, v] of g) { const x = val(m, v, 0); if (!Number.isNaN(x)) items.push([store.dicts[col].list[Math.floor(key / 64)] + " " + ((key % 64) + 2000), x]); }
    items.sort((a, c) => c[1] - a[1]);
    const top = items.slice(0, 10);
    $("t3").textContent = "Top 10 team-seasons: " + m.label;
    $("s3").textContent = "Ranking team-seasons, so this is not split by " + bLabel(b) + ". Each bar is one team's season" + (col === "opponent_team" ? " (stats allowed by that team's defense)" : "") + "." + minNote(m);
    if (!top.length) { showEmpty(3, "No team-seasons qualify with these filters."); return; }
    draw(3, { kind: "hbar", labels: top.map((x) => x[0]), datasets: [{ label: m.label, data: top.map((x) => x[1]), barColors: top.map((x) => NFLTeams.color(x[0].split(" ")[0])) }], colors: ["--series-1"], fmt: FMT[m.fmt], yTitle: m.label });
  }

  // Team-game rates do not apply to one player's season, so those measures rank the matching player total.
  const playerMeasure = (m) => (m.type === "perTeamGame" ? S.MEASURE_BY_ID[m.playerMeasure] : m);
  const rankMin = () => (state.player ? 1 : minOverride());

  function chartPlayers(f, m0, b) {
    const m = playerMeasure(m0);
    $("t3").textContent = "Top 10 player-seasons: " + m.label;
    const top = S.topPlayerSeasons(store, f, m, 10, rankMin());
    $("s3").textContent = "Ranking players, so this is not split by " + bLabel(b) + ". Each bar is one player's season, colored by team" + (m !== m0 ? " (team-game rates do not apply to players, so this ranks the total)" : "") +
      (m.type === "ratio" && !state.player ? " (minimum " + minText(m).trim() + ")" : "") + ".";
    if (!top.length) { showEmpty(3, "No player-seasons qualify with these filters."); return; }
    draw(3, { kind: "hbar", stacked: true, labels: top.map((x) => shortName(x.name) + " " + x.season + " (" + x.teams.join("/") + ")"),
      datasets: segmentDatasets(top.map((x) => ({ total: x.value, parts: x.parts })), m.fmt), colors: ["--series-1"], fmt: FMT[m.fmt], yTitle: m.label });
  }

  function chartWeek(f, m, b, cats) {
    const overall = S.aggregate(store, f, "week", [m]);
    const g = S.aggregate(store, f, b.id + "|week", [m]);
    const byCat = new Map(), weekSet = new Set(overall.keys());
    for (const [key, v] of g) {
      const cat = Math.floor(key / 64), week = key % 64, x = val(m, v, 0);
      if (Number.isNaN(x)) continue;
      weekSet.add(week);
      if (!byCat.has(cat)) byCat.set(cat, new Map());
      byCat.get(cat).set(week, x);
    }
    const weeks = Array.from(weekSet).sort((a, c) => a - c);
    $("t4").textContent = m.label + " by week of the season";
    const shown = cats.list.filter((c) => byCat.has(c)), single = cats.total <= 1;
    const datasets = [], colors = [];
    if (comparable(m) || single || !shown.length) {
      datasets.push({ label: single && shown.length ? catLabel(b.id, shown[0]) : "All rows in view", data: weeks.map((w) => nn(val(m, overall.get(w), 0))), width: single ? 2.6 : 3.4 });
      colors.push(single && isTeamCol(b.id) && shown.length ? NFLTeams.color(store.dicts[b.id].list[shown[0]]) : "--series-3");
    }
    if (!single) {
      shown.forEach((c) => datasets.push({ label: catLabel(b.id, c), data: weeks.map((w) => nn(byCat.get(c).get(w))) }));
      catColors(b, shown).forEach((c) => colors.push(c));
      if (colors[0] === "--series-3") colors[0] = "--fg";
    }
    const reg = state.chips.season_type.size === 1 && state.chips.season_type.has("REG");
    const lost = !single && cats.list.length > 0 && !shown.length;
    $("s4").textContent = (lost ? "No " + bLabel(b) + " reaches the minimum in a single week here, so only the all-rows line is drawn." : splitNote(b, cats)) + " " + (reg ? "Regular-season weeks." : "Playoff weeks continue the count (18 to 22).") + minNote(m);
    draw(4, { kind: "line", labels: weeks, datasets, colors, fmt: FMT[m.fmt], yTitle: m.label });
  }

  // ------------------------------------------------------------------ deep dive: EPA over replacement
  function renderDeep() {
    const pos = $("d-pos").value, season = +$("d-season").value;
    const res = S.epaOverReplacement(store, pos, season, season).get(season);
    if (!res) { showEmpty(5, "No data for this season and position."); $("d-note").textContent = ""; $("d-table").innerHTML = ""; return; }
    const K = S.REPLACEMENT_K[pos];
    const rows = res.rows.slice().sort((a, b) => b.epaor - a.epaor || a.name.localeCompare(b.name));
    const top = rows.slice(0, 15);
    draw(5, { kind: "hbar", stacked: true, labels: top.map((x) => shortName(x.name) + " (" + x.teams.join("/") + ")"),
      datasets: segmentDatasets(top.map((x) => ({ total: x.epaor, parts: x.parts.map((p) => ({ team: p.team, value: p.epaor, share: p.share })) })), "dec1"),
      colors: ["--series-3"], fmt: "dec1", yTitle: "Expected points over replacement" });
    const opp = pos === "QB" ? "attempts + sacks + carries" : "carries + targets";
    $("d-note").textContent = season + " " + pos + ": " + rows.length + " players with at least one opportunity (" + opp + "). The top " + K +
      " by opportunities are starters (" + S.format("dec3", res.starterRate) + " EPA per opportunity); the other " + res.poolSize +
      " form the replacement pool (" + S.format("dec3", res.r) + "). The pool includes benched and injured players, so it is a low bar. EPAOR = total EPA − replacement rate × opportunities. A player who changed teams shows every team; the bar splits by share of opportunities.";
    const head = ["Rank", "Player", "Team", "Games", "Opportunities", "Total EPA", "EPA per opportunity", "EPA over replacement"];
    const body = rows.slice(0, 25).map((x, i) => [i + 1, x.name, x.teams.join("/"), x.games, S.format("int", x.opp), S.format("dec1", x.epa), S.format("dec3", x.epa / x.opp), S.format("dec1", x.epaor)]);
    const table = document.createElement("table");
    table.className = "data";
    table.innerHTML = "<caption class='sr'>Top 25 " + pos + " players in " + season + " by EPA over replacement</caption><thead><tr>" + head.map((h, i) => "<th scope='col' style='text-align:" + (i === 1 || i === 2 ? "left" : "right") + "'>" + h + "</th>").join("") + "</tr></thead>";
    const tb = document.createElement("tbody");
    body.forEach((r) => { const tr = document.createElement("tr"); r.forEach((c, i) => { const td = document.createElement("td"); if (i === 2 && allTeams(c)) td.innerHTML = badges(c); else td.textContent = c; td.style.textAlign = i === 1 || i === 2 ? "left" : "right"; tr.appendChild(td); }); tb.appendChild(tr); });
    table.appendChild(tb);
    $("d-table").innerHTML = ""; $("d-table").appendChild(table);
  }

  // ------------------------------------------------------------------ table
  function renderTable(f) {
    const m = measure(), b = breakdown(), view = state.view, tableView = state.tableView, mo = state.player ? 1 : minOverride();
    let head = [], rows = [], note = "", title = "";
    if (view === "teams" && tableView === "teamseasons") {
      title = "Every team-season";
      const col = b.id === "opponent_team" ? "opponent_team" : "team";
      const ms = [S.MEASURE_BY_ID.team_games, m].concat(TEAM_EXTRAS.filter((id) => id !== m.id).map((id) => S.MEASURE_BY_ID[id]));
      const g = S.aggregate(store, f, col + "|season", ms);
      head = [{ label: col === "team" ? "Team" : "Opponent", num: false, team: true }, { label: "Season", num: true }].concat(ms.map((x) => ({ label: x.label, num: true, title: x.what })));
      rows = [];
      for (const [key, v] of g) {
        const code = store.dicts[col].list[Math.floor(key / 64)], season = (key % 64) + 2000;
        const vals = ms.map((x, k) => S.valueMin(x, v, k, mo));
        rows.push({ raw: [code, season].concat(vals), cells: [code, season].concat(vals.map((x, k) => S.format(ms[k].fmt, x))) });
      }
      tableSort = tableSort || { col: 3, dir: -1 };
      note = "One row per team per season. The first measure column after team-games is your selected measure. Use the buttons in the headings to sort.";
    } else if (tableView === "breakdown" || tableView === "season") {
      const groupBy = tableView === "season" ? "season" : b.id;
      const extras = view === "teams" ? TEAM_EXTRAS : EXTRA_MEASURES;
      const ms = (view === "teams" ? [S.MEASURE_BY_ID.team_games] : []).concat([m], extras.filter((id) => id !== m.id).map((id) => S.MEASURE_BY_ID[id]));
      const t = S.groupTable(store, f, groupBy, ms, !state.player, mo);
      head = [{ label: tableView === "season" ? "Season" : b.label.split(" (")[0], num: false, team: tableView !== "season" && isTeamCol(b.id) }].concat(view === "teams" ? [] : [{ label: "Player-games", num: true }], ms.map((x) => ({ label: x.label, num: true, title: x.what })));
      rows = t.map((r) => {
        const label = tableView === "season" ? r.label : catLabel(b.id, r.key);
        const lead = view === "teams" ? [] : [r.rows];
        const raw = [tableView === "season" ? +r.label : label].concat(lead, r.values);
        return { raw, cells: [label].concat(lead.map((x) => S.format("int", x)), r.values.map((v, k) => S.format(ms[k].fmt, v))) };
      });
      title = tableView === "season" ? "By season" : "By " + b.label.split(" (")[0].toLowerCase();
      tableSort = tableSort || { col: tableView === "season" ? 0 : 2, dir: tableView === "season" ? 1 : -1 };
      note = "The first measure column is your selected measure. Use the buttons in the headings to sort.";
    } else if (tableView === "players") {
      title = "Top player-seasons";
      const pm = playerMeasure(m);
      head = ["Rank", "Player", "Season", "Team", "Pos", "Games", pm.label].map((l, i) => ({ label: l, num: i !== 1 && i !== 3 && i !== 4, team: i === 3 }));
      head[6].title = pm.what;
      const top = S.topPlayerSeasons(store, f, pm, 50, mo);
      rows = top.map((x, i) => ({ raw: [i + 1, x.name, x.season, x.teams.join("/"), x.position, x.games, x.value], cells: [i + 1, x.name, x.season, x.teams.join("/"), x.position, x.games, S.format(pm.fmt, x.value)] }));
      note = "Top 50 player-seasons for " + pm.label + (pm !== m ? " (team-game rates do not apply to players, so this ranks the total)" : "") +
        (pm.type === "ratio" && !state.player ? " (minimum " + minText(pm).trim() + ")" : "") + ".";
      tableSort = tableSort || { col: 0, dir: 1 };
    } else {
      title = "Player game log";
      const cols = ["passing_yards", "rushing_yards", "receiving_yards", "receptions", "def_sacks", "def_interceptions", "fantasy_points_ppr"];
      const labels = ["Pass yds", "Rush yds", "Rec yds", "Rec", "Sacks", "Int (def)", "Fantasy pts"];
      const limit = state.player ? 600 : 200;
      const gl = S.gameLog(store, f, cols, limit);
      head = ["Season", "Wk", "Type", "Player", "Team", "Opp", "Pos"].map((l, i) => ({ label: l, num: i < 2, team: i === 4 || i === 5, title: { Wk: "Week of the season", Opp: "Opponent", Pos: "Position group" }[l] })).concat(labels.map((l) => ({ label: l, num: true })));
      rows = gl.rows.map((r) => {
        const vals = cols.map((c) => r[c]);
        return { raw: [r.season, r.week, r.season_type, r.name, r.team, r.opponent_team, r.position_group].concat(vals),
                 cells: [r.season, r.week, SEASON_TYPE_LABEL[r.season_type] || r.season_type, r.name, r.team, r.opponent_team, r.position_group].concat(vals.map((v, k) => (Number.isNaN(v) ? "n/a" : cols[k] === "fantasy_points_ppr" ? v.toFixed(1) : (cols[k] === "def_sacks" ? S.format("half", v) : S.format("int", v))))) };
      });
      note = "Showing the first " + rows.length.toLocaleString("en-US") + " of " + gl.total.toLocaleString("en-US") + " player-games" + (gl.total > limit ? ". Sorting and Download CSV cover only these rows. Pick a player or narrow the filters to see the rest." : ".");
      tableSort = tableSort || null;
    }
    $("table-title").textContent = "The numbers behind this view: " + title.toLowerCase();
    $("table-note").textContent = note;
    tableData = { head, rows, title };
    paintTable();
  }

  function paintTable() {
    const { head, rows, title } = tableData;
    const sorted = rows.slice();
    if (tableSort) {
      const { col, dir } = tableSort;
      sorted.sort((a, b) => {
        const x = a.raw[col], y = b.raw[col];
        const nx = typeof x === "number" && !Number.isNaN(x), ny = typeof y === "number" && !Number.isNaN(y);
        if (nx && ny) return (x - y) * dir;
        if (nx) return -1;
        if (ny) return 1;
        return String(x).localeCompare(String(y)) * dir;
      });
    }
    const box = $("table-box");
    if (!sorted.length) { box.innerHTML = "<p class='empty'>No rows to show.</p>"; return; }
    const table = document.createElement("table");
    table.className = "data";
    const cap = document.createElement("caption"); cap.className = "sr"; cap.textContent = "The numbers behind this view: " + String(title).toLowerCase();
    table.appendChild(cap);
    const tr = document.createElement("tr");
    head.forEach((h, i) => {
      const th = document.createElement("th");
      th.scope = "col";
      th.style.textAlign = h.num ? "right" : "left";
      const on = tableSort && tableSort.col === i;
      th.setAttribute("aria-sort", on ? (tableSort.dir > 0 ? "ascending" : "descending") : "none");
      const btn = document.createElement("button");
      btn.type = "button"; btn.className = "sortbtn";
      btn.textContent = h.label;
      if (on) { const arrow = document.createElement("span"); arrow.setAttribute("aria-hidden", "true"); arrow.textContent = tableSort.dir > 0 ? " ▲" : " ▼"; btn.appendChild(arrow); }
      if (h.title) btn.title = h.title;
      btn.addEventListener("click", () => { tableSort = { col: i, dir: tableSort && tableSort.col === i ? -tableSort.dir : (h.num ? -1 : 1) }; paintTable(); announce("Sorted by " + h.label + (tableSort.dir > 0 ? ", ascending." : ", descending."), true); const nb = $("table-box").querySelectorAll("th .sortbtn")[i]; if (nb) nb.focus(); });
      th.appendChild(btn);
      tr.appendChild(th);
    });
    const thead = document.createElement("thead"); thead.appendChild(tr); table.appendChild(thead);
    const tbody = document.createElement("tbody");
    sorted.slice(0, 1000).forEach((r) => {
      const row = document.createElement("tr");
      r.cells.forEach((c, i) => { const td = document.createElement("td"); if (head[i].team && allTeams(c)) td.innerHTML = badges(c); else td.textContent = c; td.style.textAlign = head[i].num ? "right" : "left"; row.appendChild(td); });
      tbody.appendChild(row);
    });
    table.appendChild(tbody);
    box.innerHTML = ""; box.appendChild(table);
  }

  function downloadCsv() {
    if (!tableData) return;
    const esc = (v) => { const s = String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const lines = [tableData.head.map((h) => esc(h.label)).join(",")].concat(tableData.rows.map((r) => r.raw.map((v) => esc(typeof v === "number" && Number.isNaN(v) ? "" : v)).join(",")));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    a.download = "nfl-dashboard-table.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ------------------------------------------------------------------ start
  C.initTheme();
  load().then(() => {
    state = readUrl();
    buildControls();
    syncControls();
    const a = activeFilters();
    if (a.more.length) toggleMore(true);
    $("loading").hidden = true;
    $("app").hidden = false;
    ready = true;
    update();
    renderDeep();
  }).catch((err) => {
    $("loading-text").textContent = "Could not load the data (" + err.message + "). If you opened this file directly, serve the folder with a local web server or use the published site.";
    $("status").textContent = "Load failed";
  });
})();
