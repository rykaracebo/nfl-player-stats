/* Calculation module shared by dashboard.html and scripts/check_numbers.js.
   Works in the browser (window.NFLStats) and in Node (require). No dependencies.

   Data: one CSV per season, one row per player per game. In stat columns a blank cell means 0 and NA means
   "not recorded that season" (stored as NaN and skipped in sums). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.NFLStats = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const CAT_COLS = ["player_id", "position", "position_group", "unit", "season_type", "game_id", "team", "opponent_team"];
  const KEY_COLS = new Set(["player_name", "season", "week"].concat(CAT_COLS));
  const FLOAT64 = new Set(["fantasy_points_ppr"]); // decimals; the rest are whole numbers or halves
  const PS_SEASON_BASE = 2000; // player-season key = playerCode * 64 + (season - 2000)

  // ------------------------------------------------------------------ store and parsing
  function newStore() {
    const dicts = {};
    CAT_COLS.forEach((c) => (dicts[c] = { list: [], map: new Map() }));
    return { dicts, playerNames: [], chunks: [] };
  }

  function code(store, col, value) {
    const d = store.dicts[col];
    let c = d.map.get(value);
    if (c === undefined) {
      c = d.list.length;
      d.list.push(value);
      d.map.set(value, c);
    }
    return c;
  }

  function splitQuoted(line) {
    const out = [];
    let cur = "", inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"') {
          if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false;
        } else cur += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === ",") { out.push(cur); cur = ""; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  }

  // Parse one season's CSV text and add it to the store. Returns the chunk.
  function addSeason(store, text) {
    const lines = text.split("\n");
    const header = lines[0].replace(/\r$/, "").split(",");
    const col = {};
    header.forEach((h, i) => (col[h] = i));
    const statCols = header.filter((h) => !KEY_COLS.has(h));
    const n = lines.length - 1;
    const cat = {};
    CAT_COLS.forEach((c) => (cat[c] = new Uint16Array(n)));
    const num = {};
    statCols.forEach((c) => (num[c] = FLOAT64.has(c) ? new Float64Array(n) : new Float32Array(n)));
    const week = new Uint8Array(n);
    const catIdx = CAT_COLS.map((c) => col[c]);
    const statIdx = statCols.map((c) => col[c]);
    const nameIdx = col.player_name, seasonIdx = col.season, weekIdx = col.week;
    let r = 0, season = 0;
    for (let li = 1; li < lines.length; li++) {
      let line = lines[li];
      if (!line) continue;
      if (line.charCodeAt(line.length - 1) === 13) line = line.slice(0, -1);
      const f = line.indexOf('"') === -1 ? line.split(",") : splitQuoted(line);
      for (let k = 0; k < CAT_COLS.length; k++) cat[CAT_COLS[k]][r] = code(store, CAT_COLS[k], f[catIdx[k]]);
      const pc = cat.player_id[r];
      if (store.playerNames[pc] === undefined) store.playerNames[pc] = f[nameIdx];
      season = +f[seasonIdx];
      week[r] = +f[weekIdx];
      for (let k = 0; k < statCols.length; k++) {
        const v = f[statIdx[k]];
        num[statCols[k]][r] = v === "" ? 0 : v === "NA" ? NaN : +v;
      }
      r++;
    }
    const chunk = { season, n: r, cat, num, week };
    store.chunks.push(chunk);
    store.chunks.sort((a, b) => a.season - b.season);
    return chunk;
  }

  // ------------------------------------------------------------------ measures
  // value = sum(num) / sum(den) for ratios; sum(num) for sums; sum(num) / rows for per-player-game averages;
  // sum(num) / distinct team-games for per-team-game rates. num/den null means "1 per row".
  const MEASURES = [
    { id: "games", label: "Player-games", type: "sum", num: null, fmt: "int" },
    { id: "pass_yds", label: "Passing yards", type: "sum", num: ["passing_yards"], fmt: "int" },
    { id: "rush_yds", label: "Rushing yards", type: "sum", num: ["rushing_yards"], fmt: "int" },
    { id: "rec_yds", label: "Receiving yards", type: "sum", num: ["receiving_yards"], fmt: "int" },
    { id: "receptions", label: "Receptions", type: "sum", num: ["receptions"], fmt: "int" },
    { id: "tds", label: "Touchdowns (pass, rush, receive)", type: "sum", num: ["passing_tds", "rushing_tds", "receiving_tds"], fmt: "int" },
    { id: "sacks", label: "Sacks (defense)", type: "sum", num: ["def_sacks"], fmt: "dec1" },
    { id: "ints_def", label: "Interceptions (defense)", type: "sum", num: ["def_interceptions"], fmt: "int" },
    { id: "qb_hits", label: "QB hits (defense)", type: "sum", num: ["def_qb_hits"], fmt: "int" },
    { id: "pass_def", label: "Passes defended", type: "sum", num: ["def_pass_defended"], fmt: "int" },
    { id: "fantasy", label: "Fantasy points (PPR)", type: "sum", num: ["fantasy_points_ppr"], fmt: "int" },
    { id: "fantasy_pg", label: "Fantasy points per player-game", type: "avg", num: ["fantasy_points_ppr"], fmt: "dec2" },
    { id: "pass_yds_pg", label: "Passing yards per player-game", type: "avg", num: ["passing_yards"], fmt: "dec1" },
    { id: "rush_yds_pg", label: "Rushing yards per player-game", type: "avg", num: ["rushing_yards"], fmt: "dec1" },
    { id: "rec_yds_pg", label: "Receiving yards per player-game", type: "avg", num: ["receiving_yards"], fmt: "dec1" },
    { id: "pass_yds_tg", label: "Passing yards per team-game", type: "perTeamGame", num: ["passing_yards"], fmt: "dec1" },
    { id: "rush_yds_tg", label: "Rushing yards per team-game", type: "perTeamGame", num: ["rushing_yards"], fmt: "dec1" },
    { id: "ints_tg", label: "Interceptions per team-game", type: "perTeamGame", num: ["def_interceptions"], fmt: "dec3" },
    { id: "sacks_tg", label: "Sacks per team-game", type: "perTeamGame", num: ["def_sacks"], fmt: "dec3" },
    { id: "comp_pct", label: "Completion percentage", type: "ratio", num: ["completions"], den: ["attempts"], fmt: "pct1", min: 200 },
    { id: "ypa", label: "Yards per pass attempt", type: "ratio", num: ["passing_yards"], den: ["attempts"], fmt: "dec2", min: 200 },
    { id: "int_rate", label: "Interception rate (per attempt)", type: "ratio", num: ["passing_interceptions"], den: ["attempts"], fmt: "pct1", min: 200 },
    { id: "ypc", label: "Yards per carry", type: "ratio", num: ["rushing_yards"], den: ["carries"], fmt: "dec2", min: 100 },
    { id: "ypr", label: "Yards per reception", type: "ratio", num: ["receiving_yards"], den: ["receptions"], fmt: "dec2", min: 30 },
    { id: "catch_pct", label: "Catch rate (per target)", type: "ratio", num: ["receptions"], den: ["targets"], fmt: "pct1", min: 50 },
    { id: "fg_pct", label: "Field goal percentage", type: "ratio", num: ["fg_made"], den: ["fg_att"], fmt: "pct1", min: 15 },
  ];
  const MEASURE_BY_ID = {};
  MEASURES.forEach((m) => (MEASURE_BY_ID[m.id] = m));

  const BREAKDOWNS = [
    { id: "position_group", label: "Position group" },
    { id: "position", label: "Position" },
    { id: "team", label: "Team" },
    { id: "opponent_team", label: "Opponent" },
    { id: "unit", label: "Unit (offense, defense, special teams)" },
    { id: "season_type", label: "Season type" },
  ];

  function format(fmt, v) {
    if (v === null || v === undefined || Number.isNaN(v)) return "n/a";
    switch (fmt) {
      case "int": return Math.round(v).toLocaleString("en-US");
      case "dec1": return v.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
      case "dec2": return v.toFixed(2);
      case "dec3": return v.toFixed(3);
      case "pct1": return (v * 100).toFixed(1) + "%";
      default: return String(v);
    }
  }

  // ------------------------------------------------------------------ filtering
  // filters: {seasonMin, seasonMax, weekMin, weekMax, cats: {colName: [allowed strings] | null}}
  function allowedTables(store, cats) {
    const tables = [];
    for (const colName of Object.keys(cats || {})) {
      const allowed = cats[colName];
      if (!allowed) continue;
      const size = store.dicts[colName].list.length;
      const t = new Uint8Array(size);
      for (const v of allowed) {
        const c = store.dicts[colName].map.get(v);
        if (c !== undefined) t[c] = 1;
      }
      tables.push({ colName, t });
    }
    return tables;
  }

  function chunkInRange(chunk, f) {
    return (f.seasonMin == null || chunk.season >= f.seasonMin) && (f.seasonMax == null || chunk.season <= f.seasonMax);
  }

  function rowPasses(chunk, i, f, tables) {
    const w = chunk.week[i];
    if (f.weekMin != null && w < f.weekMin) return false;
    if (f.weekMax != null && w > f.weekMax) return false;
    for (let k = 0; k < tables.length; k++) if (!tables[k].t[chunk.cat[tables[k].colName][i]]) return false;
    return true;
  }

  // ------------------------------------------------------------------ aggregation
  // Returns Map(groupKey -> {rows, num[], den[], tg:Set|null, team, position}) for the given measures.
  function aggregate(store, filters, groupBy, measures) {
    const f = filters || {};
    const tables = allowedTables(store, f.cats);
    const needTG = measures.some((m) => m.type === "perTeamGame");
    const groups = new Map();
    const nm = measures.length;
    for (const chunk of store.chunks) {
      if (!chunkInRange(chunk, f)) continue;
      const numArrs = measures.map((m) => (m.num ? m.num.map((c) => chunk.num[c]) : null));
      const denArrs = measures.map((m) => (m.den ? m.den.map((c) => chunk.num[c]) : null));
      for (let i = 0; i < chunk.n; i++) {
        if (!rowPasses(chunk, i, f, tables)) continue;
        let key;
        if (groupBy === "all") key = 0;
        else if (groupBy === "season") key = chunk.season;
        else if (groupBy === "week") key = chunk.week[i];
        else if (groupBy === "player_season") key = chunk.cat.player_id[i] * 64 + (chunk.season - PS_SEASON_BASE);
        else key = chunk.cat[groupBy][i];
        let g = groups.get(key);
        if (!g) {
          g = { rows: 0, num: new Float64Array(nm), den: new Float64Array(nm), tg: needTG ? new Set() : null,
                team: chunk.cat.team[i], position: chunk.cat.position[i] };
          groups.set(key, g);
        }
        g.rows++;
        if (needTG) g.tg.add(chunk.cat.game_id[i] * 64 + chunk.cat.team[i]);
        for (let k = 0; k < nm; k++) {
          const na = numArrs[k];
          if (na === null) g.num[k] += 1;
          else for (let j = 0; j < na.length; j++) { const v = na[j][i]; if (v === v) g.num[k] += v; }
          const da = denArrs[k];
          if (da) for (let j = 0; j < da.length; j++) { const v = da[j][i]; if (v === v) g.den[k] += v; }
        }
      }
    }
    return groups;
  }

  function value(measure, g, k) {
    k = k || 0;
    switch (measure.type) {
      case "sum": return g.num[k];
      case "avg": return g.rows ? g.num[k] / g.rows : NaN;
      case "ratio": return g.den[k] > 0 ? g.num[k] / g.den[k] : NaN;
      case "perTeamGame": return g.tg && g.tg.size ? g.num[k] / g.tg.size : NaN;
      default: return NaN;
    }
  }

  function decode(store, groupBy, key) {
    if (groupBy === "season" || groupBy === "week") return String(key);
    if (groupBy === "all") return "All";
    return store.dicts[groupBy].list[key];
  }

  // Sorted list of {label, key, values[]} for a categorical/season/week grouping.
  function groupTable(store, filters, groupBy, measures) {
    const groups = aggregate(store, filters, groupBy, measures);
    const rows = [];
    for (const [key, g] of groups) {
      rows.push({ key, label: decode(store, groupBy, key), rows: g.rows, values: measures.map((m, k) => value(m, g, k)) });
    }
    return rows;
  }

  function countPlayers(store, filters) {
    const f = filters || {};
    const tables = allowedTables(store, f.cats);
    const seen = new Uint8Array(store.dicts.player_id.list.length);
    let count = 0;
    for (const chunk of store.chunks) {
      if (!chunkInRange(chunk, f)) continue;
      for (let i = 0; i < chunk.n; i++) {
        if (!rowPasses(chunk, i, f, tables)) continue;
        const p = chunk.cat.player_id[i];
        if (!seen[p]) { seen[p] = 1; count++; }
      }
    }
    return count;
  }

  // Player-season milestone counts (thresholds apply to each player's filtered totals in a season).
  const MILESTONES = [
    { id: "pass4000", label: "4,000-yard passers", col: "passing_yards", min: 4000 },
    { id: "rush1000", label: "1,000-yard rushers", col: "rushing_yards", min: 1000 },
    { id: "carries300", label: "300-carry backs", col: "carries", min: 300 },
    { id: "rec100", label: "100-catch receivers", col: "receptions", min: 100 },
    { id: "int6", label: "Players with 6+ interceptions", col: "def_interceptions", min: 6 },
  ];
  function milestones(store, filters) {
    const ms = MILESTONES.map((m) => ({ type: "sum", num: [m.col] }));
    const groups = aggregate(store, filters, "player_season", ms);
    const bySeason = new Map();
    for (const [key, g] of groups) {
      const season = (key % 64) + PS_SEASON_BASE;
      let row = bySeason.get(season);
      if (!row) { row = {}; MILESTONES.forEach((m) => (row[m.id] = 0)); bySeason.set(season, row); }
      MILESTONES.forEach((m, k) => { if (g.num[k] >= m.min) row[m.id]++; });
    }
    const total = {};
    MILESTONES.forEach((m) => (total[m.id] = 0));
    for (const row of bySeason.values()) MILESTONES.forEach((m) => (total[m.id] += row[m.id]));
    return { bySeason, total };
  }

  // Top player-seasons for a measure (each player's season is one row; ratios need the measure's minimum).
  function topPlayerSeasons(store, filters, measure, n) {
    const groups = aggregate(store, filters, "player_season", [measure]);
    const rows = [];
    for (const [key, g] of groups) {
      if (measure.type === "ratio" && measure.min && g.den[0] < measure.min) continue;
      const v = value(measure, g, 0);
      if (Number.isNaN(v)) continue;
      const pc = Math.floor(key / 64);
      rows.push({
        playerCode: pc, playerId: store.dicts.player_id.list[pc], name: store.playerNames[pc],
        season: (key % 64) + PS_SEASON_BASE, team: store.dicts.team.list[g.team],
        position: store.dicts.position.list[g.position], games: g.rows, value: v,
      });
    }
    rows.sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
    return rows.slice(0, n);
  }

  // Player game log, in season/week order.
  function gameLog(store, filters, statCols, limit) {
    const f = filters || {};
    const tables = allowedTables(store, f.cats);
    const out = [];
    let total = 0;
    for (const chunk of store.chunks) {
      if (!chunkInRange(chunk, f)) continue;
      for (let i = 0; i < chunk.n; i++) {
        if (!rowPasses(chunk, i, f, tables)) continue;
        total++;
        if (out.length < limit) {
          const row = {
            season: chunk.season, week: chunk.week[i],
            name: store.playerNames[chunk.cat.player_id[i]],
            season_type: store.dicts.season_type.list[chunk.cat.season_type[i]],
            position_group: store.dicts.position_group.list[chunk.cat.position_group[i]],
            team: store.dicts.team.list[chunk.cat.team[i]],
            opponent_team: store.dicts.opponent_team.list[chunk.cat.opponent_team[i]],
          };
          for (const c of statCols) row[c] = chunk.num[c][i];
          out.push(row);
        }
      }
    }
    return { rows: out, total };
  }

  // Player list for the search box: id, name, position group and team from the player's last row.
  function playerIndex(store) {
    const info = new Map();
    for (const chunk of store.chunks) {
      for (let i = 0; i < chunk.n; i++) {
        const p = chunk.cat.player_id[i];
        let e = info.get(p);
        if (!e) { e = { id: store.dicts.player_id.list[p], name: store.playerNames[p], first: chunk.season, last: chunk.season, pg: 0, team: 0, games: 0 }; info.set(p, e); }
        e.last = chunk.season;
        e.pg = chunk.cat.position_group[i];
        e.team = chunk.cat.team[i];
        e.games++;
      }
    }
    const list = [];
    for (const e of info.values()) {
      list.push({ id: e.id, name: e.name, position_group: store.dicts.position_group.list[e.pg],
                  team: store.dicts.team.list[e.team], first: e.first, last: e.last, games: e.games });
    }
    list.sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }

  return { newStore, addSeason, MEASURES, MEASURE_BY_ID, BREAKDOWNS, MILESTONES, format, aggregate, value,
           groupTable, countPlayers, milestones, topPlayerSeasons, gameLog, playerIndex, decode };
});
