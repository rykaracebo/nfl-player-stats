/* Dashboard: loads the season CSVs in the browser, filters them, and draws charts and a table.
   All calculations come from stats.js (the same code scripts/check_numbers.js tests). */
(function () {
  "use strict";
  const S = NFLStats, C = NFLCharts;
  const $ = (id) => document.getElementById(id);
  const FMT = { int: "int", dec1: "dec1", dec2: "dec2", dec3: "dec3", pct1: "pct" };
  const SEASON_TYPE_LABEL = { REG: "Regular season", POST: "Playoffs" };
  const CHIPS = {
    season_type: [["REG", "Regular season"], ["POST", "Playoffs"]],
    unit: [["Offense", "Offense"], ["Defense", "Defense"], ["Special teams", "Special teams"]],
    position_group: [["QB", "QB"], ["RB", "RB"], ["WR", "WR"], ["TE", "TE"], ["OL", "OL"], ["DL", "DL"], ["LB", "LB"], ["DB", "DB"], ["SPEC", "K / P / LS"]],
  };
  const EXTRA_MEASURES = ["pass_yds", "rush_yds", "rec_yds", "tds", "sacks", "ints_def"];

  const store = S.newStore();
  let teamNames = {};
  let players = [];
  let seasonsAll = [];
  let totalRows = 0;
  let state;
  let measureId = "pass_yds_tg";
  let breakdownId = "season_type";
  let tableView = "breakdown";
  let tableSort = null;
  let tableData = null;

  const fresh = () => ({
    seasonMin: seasonsAll[0], seasonMax: seasonsAll[seasonsAll.length - 1], weekMin: 1, weekMax: 22,
    chips: { season_type: new Set(["REG"]), unit: new Set(), position_group: new Set() },
    team: "", opp: "", player: null,
  });

  // ------------------------------------------------------------------ loading
  async function load() {
    const manifest = await (await fetch("data/manifest.json")).json();
    seasonsAll = Object.keys(manifest.seasons).map(Number).sort((a, b) => a - b);
    try {
      const t = await (await fetch("data/teams.csv")).text();
      t.trim().split("\n").slice(1).forEach((line) => { const f = line.split(","); teamNames[f[0]] = f[5]; });
    } catch (e) { /* team names are optional */ }
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

  // ------------------------------------------------------------------ controls
  function fillSelect(el, options, value) {
    el.innerHTML = "";
    options.forEach(([v, label]) => { const o = document.createElement("option"); o.value = v; o.textContent = label; el.appendChild(o); });
    el.value = value;
  }

  function buildControls() {
    state = fresh();
    const seasonOpts = seasonsAll.map((y) => [y, String(y)]);
    fillSelect($("f-season-min"), seasonOpts, state.seasonMin);
    fillSelect($("f-season-max"), seasonOpts, state.seasonMax);
    const weekOpts = Array.from({ length: 22 }, (_, i) => [i + 1, String(i + 1)]);
    fillSelect($("f-week-min"), weekOpts, 1);
    fillSelect($("f-week-max"), weekOpts, 22);
    const teamList = store.dicts.team.list.slice().sort((a, b) => (teamNames[a] || a).localeCompare(teamNames[b] || b));
    const teamOpts = [["", "All teams"]].concat(teamList.map((t) => [t, teamNames[t] || t]));
    fillSelect($("f-team"), teamOpts, "");
    fillSelect($("f-opp"), [["", "All opponents"]].concat(teamList.map((t) => [t, teamNames[t] || t])), "");

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

    const groups = {};
    S.MEASURES.forEach((m) => (groups[m.group] = groups[m.group] || []).push(m));
    const ms = $("m-select");
    ms.innerHTML = "";
    Object.keys(groups).forEach((g) => {
      const og = document.createElement("optgroup"); og.label = g;
      groups[g].forEach((m) => { const o = document.createElement("option"); o.value = m.id; o.textContent = m.label; og.appendChild(o); });
      ms.appendChild(og);
    });
    ms.value = measureId;
    fillSelect($("b-select"), S.BREAKDOWNS.map((b) => [b.id, b.label]), breakdownId);
    fillSelect($("table-view"), [["breakdown", "By the breakdown above"], ["season", "By season"], ["players", "Top player-seasons"], ["gamelog", "Player game log"]], tableView);

    const onFilter = () => {
      state.seasonMin = +$("f-season-min").value; state.seasonMax = +$("f-season-max").value;
      if (state.seasonMin > state.seasonMax) { state.seasonMax = state.seasonMin; $("f-season-max").value = state.seasonMax; }
      state.weekMin = +$("f-week-min").value; state.weekMax = +$("f-week-max").value;
      if (state.weekMin > state.weekMax) { state.weekMax = state.weekMin; $("f-week-max").value = state.weekMax; }
      state.team = $("f-team").value; state.opp = $("f-opp").value;
      update();
    };
    ["f-season-min", "f-season-max", "f-week-min", "f-week-max", "f-team", "f-opp"].forEach((id) => $(id).addEventListener("change", onFilter));
    $("f-season-min").addEventListener("change", () => { if (+$("f-season-min").value > +$("f-season-max").value) $("f-season-max").value = $("f-season-min").value; });
    $("m-select").addEventListener("change", () => { measureId = $("m-select").value; update(); });
    $("b-select").addEventListener("change", () => { breakdownId = $("b-select").value; update(); });
    $("table-view").addEventListener("change", () => { tableView = $("table-view").value; tableSort = null; renderTable(filters()); });
    $("btn-reset").addEventListener("click", resetFilters);
    $("btn-csv").addEventListener("click", downloadCsv);
    setupPlayerSearch();
    syncChips();
  }

  function syncChips() {
    for (const col of Object.keys(CHIPS)) {
      $("chips-" + col).querySelectorAll(".chip").forEach((b) => b.setAttribute("aria-pressed", state.chips[col].has(b.dataset.value) ? "true" : "false"));
    }
  }

  function resetFilters() {
    state = fresh();
    $("f-season-min").value = state.seasonMin; $("f-season-max").value = state.seasonMax;
    $("f-week-min").value = 1; $("f-week-max").value = 22;
    $("f-team").value = ""; $("f-opp").value = "";
    $("player-search").value = "";
    $("player-results").hidden = true;
    syncChips();
    update();
  }

  function setupPlayerSearch() {
    const input = $("player-search"), list = $("player-results");
    let timer = null;
    const render = () => {
      const q = input.value.trim().toLowerCase();
      if (q.length < 2) { list.hidden = true; return; }
      const hits = players.filter((p) => p.name.toLowerCase().includes(q))
        .sort((a, b) => (b.name.toLowerCase().startsWith(q) - a.name.toLowerCase().startsWith(q)) || b.games - a.games).slice(0, 8);
      list.innerHTML = "";
      if (!hits.length) { const li = document.createElement("li"); li.className = "none"; li.textContent = "No players found"; list.appendChild(li); }
      hits.forEach((p) => {
        const li = document.createElement("li");
        li.setAttribute("role", "option"); li.tabIndex = 0;
        li.innerHTML = "<b></b><span></span>";
        li.firstChild.textContent = p.name;
        li.lastChild.textContent = p.position_group + " · " + p.team + " · " + p.first + (p.last !== p.first ? "–" + p.last : "");
        const pick = () => selectPlayer(p);
        li.addEventListener("click", pick);
        li.addEventListener("keydown", (e) => { if (e.key === "Enter") pick(); });
        list.appendChild(li);
      });
      list.hidden = false;
    };
    input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(render, 90); });
    input.addEventListener("keydown", (e) => { if (e.key === "Escape") list.hidden = true; });
    document.addEventListener("click", (e) => { if (!e.target.closest(".search")) list.hidden = true; });
  }

  function selectPlayer(p) {
    state.player = p;
    $("player-search").value = p.name;
    $("player-results").hidden = true;
    if (tableView === "breakdown") { tableView = "season"; $("table-view").value = "season"; tableSort = null; }
    update();
  }

  function filters() {
    const cats = {};
    for (const col of Object.keys(state.chips)) cats[col] = state.chips[col].size ? Array.from(state.chips[col]) : null;
    if (state.team) cats.team = [state.team];
    if (state.opp) cats.opponent_team = [state.opp];
    if (state.player) cats.player_id = [state.player.id];
    return { seasonMin: state.seasonMin, seasonMax: state.seasonMax, weekMin: state.weekMin, weekMax: state.weekMax, cats };
  }

  // ------------------------------------------------------------------ helpers
  const measure = () => S.MEASURE_BY_ID[measureId];
  const breakdown = () => S.BREAKDOWNS.find((b) => b.id === breakdownId);
  const nn = (v) => (v === undefined || Number.isNaN(v) ? null : v);
  // With a player selected we show every value; otherwise ratios need a minimum sample so tiny groups do not distort charts.
  const val = (m, g) => (state.player ? S.value(m, g, 0) : S.valueMin(m, g, 0));
  const minNote = (m) => (m.type === "ratio" && m.min && !state.player ? " Values with fewer than " + m.min + " in the denominator are hidden." : "");
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
  function catLabel(col, code) {
    const v = store.dicts[col].list[code];
    if (col === "season_type") return SEASON_TYPE_LABEL[v] || v;
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
  const NO_ROWS = "No player-games match these filters. Try widening the season range or clearing a filter.";

  // ------------------------------------------------------------------ update
  function update() {
    const f = filters(), m = measure(), b = breakdown();
    const sum = S.aggregate(store, f, "all", ["games", "pass_yds", "rush_yds", "rec_yds", "tds", "sacks", "ints_def"].map((id) => S.MEASURE_BY_ID[id])).get(0);
    const rows = sum ? sum.rows : 0;
    const playerCount = S.countPlayers(store, f);
    $("status").textContent = rows.toLocaleString("en-US") + " of " + totalRows.toLocaleString("en-US") + " player-games in view";
    $("m-desc").textContent = m.desc || defaultDesc(m);

    // player banner
    const ban = $("player-banner");
    if (state.player) {
      ban.hidden = false;
      ban.innerHTML = "<span></span><button type='button' class='btn ghost small'>Clear player</button>";
      ban.firstChild.textContent = "Showing " + state.player.name + " (" + state.player.position_group + ", last team " + state.player.team +
        ", seasons " + state.player.first + " to " + state.player.last + "). Every number below is for this player and the filters above.";
      ban.lastChild.addEventListener("click", () => { state.player = null; $("player-search").value = ""; update(); });
    } else ban.hidden = true;

    // summary cards
    const cards = [
      [rows, "int", "Player-games"], [playerCount, "int", "Different players"],
      [sum ? sum.num[1] : 0, "int", "Passing yards"], [sum ? sum.num[2] : 0, "int", "Rushing yards"], [sum ? sum.num[3] : 0, "int", "Receiving yards"],
      [sum ? sum.num[4] : 0, "int", "Touchdowns (pass, rush, receive)"], [sum ? sum.num[5] : 0, "dec1", "Sacks"], [sum ? sum.num[6] : 0, "int", "Interceptions (defense)"],
    ];
    $("summary").innerHTML = cards.map(([v, fmt, l]) => "<div class='kpi card'><div class='kpi-value'>" + S.format(fmt, v) + "</div><div class='kpi-label'>" + l + "</div></div>").join("");
    const ms = S.milestones(store, f).total;
    $("milestones").innerHTML = S.MILESTONES.map((x) => "<div class='kpi card'><div class='kpi-value'>" + ms[x.id].toLocaleString("en-US") +
      "</div><div class='kpi-label'>" + x.label + " (player-seasons)</div></div>").join("");

    if (!rows) { for (let n = 1; n <= 4; n++) showEmpty(n, NO_ROWS); $("t1").textContent = $("t2").textContent = $("t3").textContent = $("t4").textContent = m.label; ["s1", "s2", "s3", "s4"].forEach((id) => ($(id).textContent = "")); renderTable(f); return; }

    chartTrend(f, m, b); chartCategory(f, m, b); chartPlayers(f, m); chartWeek(f, m);
    renderTable(f);
  }

  function defaultDesc(m) {
    if (m.type === "sum") return "Sum of the stat across the player-games in view.";
    if (m.type === "avg") return "Sum of the stat divided by the number of player-games in view.";
    if (m.type === "perTeamGame") return "Sum of the stat divided by the number of team-games among the rows in view.";
    return "Sum of the numerator divided by the sum of the denominator.";
  }

  function chartTrend(f, m, b) {
    const g = S.aggregate(store, f, b.id + "|season", [m]);
    const catRows = new Map(), byCat = new Map(), seasonSet = new Set();
    for (const [key, v] of g) {
      const cat = Math.floor(key / 64), season = (key % 64) + 2000;
      const x = val(m, v);
      if (Number.isNaN(x)) continue; // too small a sample (or undefined): leave the point out
      seasonSet.add(season);
      catRows.set(cat, (catRows.get(cat) || 0) + v.rows);
      if (!byCat.has(cat)) byCat.set(cat, new Map());
      byCat.get(cat).set(season, x);
    }
    const cats = Array.from(catRows.entries()).sort((a, c) => c[1] - a[1]).slice(0, 6).map((e) => e[0]);
    const seasons = Array.from(seasonSet).sort((a, c) => a - c);
    $("t1").textContent = m.label + " by season";
    if (!cats.length) { $("s1").textContent = ""; showEmpty(1, "No value can be computed for this measure with these filters."); return; }
    $("s1").textContent = b.label + (catRows.size > 6 ? " (top 6 of " + catRows.size + " by player-games)." : ".") + minNote(m);
    draw(1, {
      kind: "line", labels: seasons,
      datasets: cats.map((c) => ({ label: catLabel(b.id, c), data: seasons.map((s) => nn(byCat.get(c).get(s))) })),
      colors: cats.length === 1 ? ["--accent"] : seriesColors(b.id, cats), fmt: FMT[m.fmt], yTitle: m.label,
    });
  }

  function chartCategory(f, m, b) {
    const g = S.aggregate(store, f, b.id, [m]);
    const items = [];
    for (const [key, v] of g) { const x = val(m, v); if (!Number.isNaN(x)) items.push([catLabel(b.id, key), x]); }
    items.sort((a, c) => c[1] - a[1]);
    const top = items.slice(0, 15);
    $("t2").textContent = m.label + " by " + b.label.split(" (")[0].toLowerCase();
    $("s2").textContent = (items.length > 15 ? "Top 15 of " + items.length : items.length + (items.length === 1 ? " group" : " groups")) + "." + minNote(m);
    if (!top.length) { showEmpty(2, "No value can be computed for this measure with these filters."); return; }
    $("box2").style.height = Math.max(300, top.length * 26 + 70) + "px";
    draw(2, { kind: "hbar", labels: top.map((x) => x[0]), datasets: [{ label: m.label, data: top.map((x) => x[1]) }], colors: ["--accent"], fmt: FMT[m.fmt], yTitle: m.label });
  }

  // Team-game rates do not apply to one player's season, so those measures rank the matching player total.
  const playerMeasure = (m) => (m.type === "perTeamGame" ? S.MEASURE_BY_ID[m.playerMeasure] : m);

  function chartPlayers(f, m0) {
    const m = playerMeasure(m0);
    $("t3").textContent = "Top 10 player-seasons: " + m.label;
    const top = S.topPlayerSeasons(store, f, m, 10);
    $("s3").textContent = "Each bar is one player's season" + (m !== m0 ? " (team-game rates do not apply to players, so this ranks the total)" : "") +
      (m.type === "ratio" && m.min ? " (minimum " + m.min + " in the denominator)" : "");
    if (!top.length) { showEmpty(3, "No player-seasons qualify with these filters."); return; }
    draw(3, { kind: "hbar", labels: top.map((x) => x.name + " " + x.season + " (" + x.team + ")"), datasets: [{ label: m.label, data: top.map((x) => x.value) }], colors: ["--series-1"], fmt: FMT[m.fmt], yTitle: m.label });
  }

  function chartWeek(f, m) {
    const g = S.aggregate(store, f, "week", [m]);
    const weeks = Array.from(g.keys()).sort((a, c) => a - c);
    $("t4").textContent = m.label + " by week of the season";
    $("s4").textContent = (state.chips.season_type.size === 1 && state.chips.season_type.has("REG") ? "Regular season weeks." : "Playoff weeks continue the count (18 to 22).") + minNote(m);
    draw(4, { kind: "line", labels: weeks, datasets: [{ label: m.label, data: weeks.map((w) => nn(val(m, g.get(w)))) }], colors: ["--series-3"], fmt: FMT[m.fmt], yTitle: m.label });
  }

  // ------------------------------------------------------------------ table
  function renderTable(f) {
    const m = measure(), b = breakdown();
    let head = [], rows = [], note = "", title = "";
    if (tableView === "breakdown" || tableView === "season") {
      const groupBy = tableView === "season" ? "season" : b.id;
      const ms = [m].concat(EXTRA_MEASURES.filter((id) => id !== m.id).map((id) => S.MEASURE_BY_ID[id]));
      const t = S.groupTable(store, f, groupBy, ms, !state.player);
      head = [{ label: tableView === "season" ? "Season" : b.label.split(" (")[0], num: false }, { label: "Player-games", num: true }].concat(ms.map((x) => ({ label: x.label, num: true })));
      rows = t.map((r) => {
        const label = tableView === "season" ? r.label : catLabel(b.id, r.key);
        const raw = [tableView === "season" ? +r.label : label, r.rows].concat(r.values);
        return { raw, cells: [label, S.format("int", r.rows)].concat(r.values.map((v, k) => S.format(ms[k].fmt, v))) };
      });
      title = tableView === "season" ? "By season" : "By " + b.label.split(" (")[0].toLowerCase();
      tableSort = tableSort || { col: tableView === "season" ? 0 : 2, dir: tableView === "season" ? 1 : -1 };
      note = "The first measure column is your selected measure. Click a heading to sort.";
    } else if (tableView === "players") {
      title = "Top player-seasons";
      head = ["Rank", "Player", "Season", "Team", "Pos", "Games", m.label].map((l, i) => ({ label: l, num: i !== 1 && i !== 3 && i !== 4 }));
      {
        const pm = playerMeasure(m);
        head[6] = { label: pm.label, num: true };
        const top = S.topPlayerSeasons(store, f, pm, 50);
        rows = top.map((x, i) => ({ raw: [i + 1, x.name, x.season, x.team, x.position, x.games, x.value], cells: [i + 1, x.name, x.season, x.team, x.position, x.games, S.format(pm.fmt, x.value)] }));
        note = "Top 50 player-seasons for " + pm.label + (pm !== m ? " (team-game rates do not apply to players, so this ranks the total)" : "") +
          (pm.type === "ratio" && pm.min ? " (minimum " + pm.min + " in the denominator)" : "") + ".";
      }
      tableSort = tableSort || { col: 0, dir: 1 };
    } else {
      title = "Player game log";
      const cols = ["passing_yards", "rushing_yards", "receiving_yards", "receptions", "def_sacks", "def_interceptions", "fantasy_points_ppr"];
      const labels = ["Pass yds", "Rush yds", "Rec yds", "Rec", "Sacks", "Int (def)", "Fantasy pts"];
      const limit = state.player ? 600 : 200;
      const gl = S.gameLog(store, f, cols, limit);
      head = ["Season", "Wk", "Type", "Player", "Team", "Opp", "Pos"].map((l, i) => ({ label: l, num: i < 2 })).concat(labels.map((l) => ({ label: l, num: true })));
      rows = gl.rows.map((r) => {
        const vals = cols.map((c) => r[c]);
        return { raw: [r.season, r.week, r.season_type, r.name, r.team, r.opponent_team, r.position_group].concat(vals),
                 cells: [r.season, r.week, r.season_type, r.name, r.team, r.opponent_team, r.position_group].concat(vals.map((v, k) => (Number.isNaN(v) ? "n/a" : cols[k] === "fantasy_points_ppr" ? v.toFixed(1) : (cols[k] === "def_sacks" ? S.format("dec1", v) : S.format("int", v))))) };
      });
      note = "Showing the first " + rows.length.toLocaleString("en-US") + " of " + gl.total.toLocaleString("en-US") + " player-games" + (gl.total > limit ? ". Pick a player or narrow the filters to see the rest." : ".");
      tableSort = tableSort || null;
    }
    $("table-title").textContent = "The numbers behind this view: " + title.toLowerCase();
    $("table-note").textContent = note;
    tableData = { head, rows };
    paintTable();
  }

  function paintTable() {
    const { head, rows } = tableData;
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
    const tr = document.createElement("tr");
    head.forEach((h, i) => {
      const th = document.createElement("th");
      th.className = "sortable"; th.textContent = h.label + (tableSort && tableSort.col === i ? (tableSort.dir > 0 ? " ▲" : " ▼") : "");
      th.style.textAlign = h.num ? "right" : "left"; th.tabIndex = 0;
      const go = () => { tableSort = { col: i, dir: tableSort && tableSort.col === i ? -tableSort.dir : (h.num ? -1 : 1) }; paintTable(); };
      th.addEventListener("click", go); th.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
      tr.appendChild(th);
    });
    const thead = document.createElement("thead"); thead.appendChild(tr); table.appendChild(thead);
    const tbody = document.createElement("tbody");
    sorted.slice(0, 1000).forEach((r) => {
      const row = document.createElement("tr");
      r.cells.forEach((c, i) => { const td = document.createElement("td"); td.textContent = c; if (!head[i].num) td.style.textAlign = "left"; row.appendChild(td); });
      tbody.appendChild(row);
    });
    table.appendChild(tbody);
    box.innerHTML = ""; box.appendChild(table);
  }

  function downloadCsv() {
    if (!tableData) return;
    const esc = (v) => { const s = String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const lines = [tableData.head.map((h) => esc(h.label)).join(",")].concat(tableData.rows.map((r) => r.raw.map(esc).join(",")));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    a.download = "nfl-dashboard-table.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // ------------------------------------------------------------------ start
  C.initTheme();
  load().then(() => {
    buildControls();
    $("loading").hidden = true;
    $("app").hidden = false;
    update();
  }).catch((err) => {
    $("loading-text").textContent = "Could not load the data (" + err.message + "). If you opened this file directly, serve the folder with a local web server or use the published site.";
    $("status").textContent = "Load failed";
  });
})();
