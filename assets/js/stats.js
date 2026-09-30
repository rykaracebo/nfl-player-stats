/* Calculation module shared by dashboard.html and scripts/check_numbers.js.
   Works in the browser (window.NFLStats) and in Node (require). No dependencies.

   Data: one CSV per season, one row per player per game. In stat columns a blank cell means 0 and NA means the source
   has no value for that player in that game (no such play or role, or not recorded); NA is stored as NaN and skipped in sums. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.NFLStats = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const CAT_COLS = ["player_id", "position", "position_group", "unit", "season_type", "game_id", "team", "opponent_team"];
  const KEY_COLS = new Set(["player_name", "season", "week"].concat(CAT_COLS));
  const FLOAT64 = new Set(["fantasy_points_ppr", "passing_epa", "passing_cpoe", "rushing_epa", "receiving_epa",
                           "target_share", "air_yards_share", "wopr"]); // decimals; the rest are whole numbers or halves
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
  const DB = ["attempts", "sacks_suffered"]; // dropbacks
  const MEASURES = [
    // Volume
    { id: "games", group: "Totals", label: "Player-games", type: "sum", num: null, fmt: "int" },
    { id: "pass_yds", group: "Totals", label: "Passing yards", type: "sum", num: ["passing_yards"], fmt: "int" },
    { id: "rush_yds", group: "Totals", label: "Rushing yards", type: "sum", num: ["rushing_yards"], fmt: "int" },
    { id: "rec_yds", group: "Totals", label: "Receiving yards", type: "sum", num: ["receiving_yards"], fmt: "int" },
    { id: "receptions", group: "Totals", label: "Receptions", type: "sum", num: ["receptions"], fmt: "int" },
    { id: "tds", group: "Totals", label: "Touchdowns (pass, rush, receive)", type: "sum", num: ["passing_tds", "rushing_tds", "receiving_tds"], fmt: "int" },
    { id: "sacks", group: "Totals", label: "Sacks (defense)", type: "sum", num: ["def_sacks"], fmt: "half" },
    { id: "ints_def", group: "Totals", label: "Interceptions (defense)", type: "sum", num: ["def_interceptions"], fmt: "int" },
    { id: "qb_hits", group: "Totals", label: "QB hits (defense)", type: "sum", num: ["def_qb_hits"], fmt: "int" },
    { id: "pass_def", group: "Totals", label: "Passes defended", type: "sum", num: ["def_pass_defended"], fmt: "int" },
    { id: "tfl", group: "Totals", label: "Tackles for loss (2012 onward)", type: "sum", num: ["def_tackles_for_loss"], fmt: "int",
      desc: "Not recorded in 2009 to 2011, so those seasons add nothing." },
    { id: "fantasy", group: "Totals", label: "Fantasy points (PPR)", type: "sum", num: ["fantasy_points_ppr"], fmt: "int" },
    { id: "pass_epa_total", group: "Totals", label: "Passing EPA (total)", type: "sum", num: ["passing_epa"], fmt: "dec1",
      desc: "Expected points added on pass attempts and sacks." },
    { id: "rush_epa_total", group: "Totals", label: "Rushing EPA (total)", type: "sum", num: ["rushing_epa"], fmt: "dec1",
      desc: "Expected points added on rush attempts, including scrambles." },
    { id: "rec_epa_total", group: "Totals", label: "Receiving EPA (total)", type: "sum", num: ["receiving_epa"], fmt: "dec1",
      desc: "EPA on plays where the player was targeted." },
    // Per player-game
    { id: "fantasy_pg", group: "Per player-game", label: "Fantasy points per player-game", type: "avg", num: ["fantasy_points_ppr"], fmt: "dec2" },
    { id: "pass_yds_pg", group: "Per player-game", label: "Passing yards per player-game", type: "avg", num: ["passing_yards"], fmt: "dec1" },
    { id: "rush_yds_pg", group: "Per player-game", label: "Rushing yards per player-game", type: "avg", num: ["rushing_yards"], fmt: "dec1" },
    { id: "rec_yds_pg", group: "Per player-game", label: "Receiving yards per player-game", type: "avg", num: ["receiving_yards"], fmt: "dec1" },
    { id: "sacks_pg", group: "Per player-game", label: "Sacks per player-game", type: "avg", num: ["def_sacks"], fmt: "dec3" },
    { id: "qb_hits_pg", group: "Per player-game", label: "QB hits per player-game", type: "avg", num: ["def_qb_hits"], fmt: "dec3" },
    // Team rates
    { id: "pass_yds_tg", group: "Per team-game", label: "Passing yards per team-game", type: "perTeamGame", num: ["passing_yards"], fmt: "dec1" },
    { id: "rush_yds_tg", group: "Per team-game", label: "Rushing yards per team-game", type: "perTeamGame", num: ["rushing_yards"], fmt: "dec1" },
    { id: "ints_tg", group: "Per team-game", label: "Interceptions per team-game", type: "perTeamGame", num: ["def_interceptions"], fmt: "dec3" },
    { id: "sacks_tg", group: "Per team-game", label: "Sacks per team-game", type: "perTeamGame", num: ["def_sacks"], fmt: "dec3" },
    { id: "qb_hits_tg", group: "Per team-game", label: "QB hits per team-game", type: "perTeamGame", num: ["def_qb_hits"], fmt: "dec2" },
    { id: "pass_def_tg", group: "Per team-game", label: "Passes defended per team-game", type: "perTeamGame", num: ["def_pass_defended"], fmt: "dec2" },
    { id: "pen_tg", group: "Per team-game", label: "Penalties per team-game", type: "perTeamGame", num: ["penalties"], fmt: "dec2" },
    { id: "team_games", group: "Per team-game", label: "Team-games (count)", type: "teamGames", num: null, fmt: "int",
      desc: "Number of distinct team-games among the rows in view." },
    // Basic rates
    { id: "comp_pct", group: "Rates", label: "Completion percentage", type: "ratio", num: ["completions"], den: ["attempts"], fmt: "pct1", min: 200, desc: "Completions divided by attempts." },
    { id: "ypa", group: "Rates", label: "Yards per pass attempt", type: "ratio", num: ["passing_yards"], den: ["attempts"], fmt: "dec2", min: 200 },
    { id: "int_rate", group: "Rates", label: "Interception rate (per attempt)", type: "ratio", num: ["passing_interceptions"], den: ["attempts"], fmt: "pct1", min: 200 },
    { id: "ypc", group: "Rates", label: "Yards per carry", type: "ratio", num: ["rushing_yards"], den: ["carries"], fmt: "dec2", min: 100 },
    { id: "ypt", group: "Rates", label: "Yards per target", type: "ratio", num: ["receiving_yards"], den: ["targets"], fmt: "dec2", min: 50 },
    { id: "ypr", group: "Rates", label: "Yards per reception", type: "ratio", num: ["receiving_yards"], den: ["receptions"], fmt: "dec2", min: 30 },
    { id: "catch_pct", group: "Rates", label: "Catch rate (per target)", type: "ratio", num: ["receptions"], den: ["targets"], fmt: "pct1", min: 50 },
    { id: "fg_pct", group: "Rates", label: "Field goal percentage", type: "ratio", num: ["fg_made"], den: ["fg_att"], fmt: "pct1", min: 15 },
    { id: "ypp", group: "Rates", label: "Yards per punt (gross)", type: "ratio", num: ["pt_yards"], den: ["pt_att"], fmt: "dec1", min: 30 },
    // Advanced: passing
    { id: "epa_db", group: "Advanced: passing", label: "EPA per dropback", type: "ratio", num: ["passing_epa"], den: DB, fmt: "dec3", min: 200,
      desc: "Passing EPA divided by pass attempts plus sacks. Positive means the passer added expected points." },
    { id: "anya", group: "Advanced: passing", label: "ANY/A (adjusted net yards per attempt)", type: "ratio",
      num: ["passing_yards", { col: "passing_tds", w: 20 }, { col: "passing_interceptions", w: -45 }, "sack_yards_lost"], den: DB, fmt: "dec2", min: 200,
      desc: "(Passing yards + 20 x TDs - 45 x interceptions - sack yards lost) divided by (attempts + sacks)." },
    { id: "cpoe", group: "Advanced: passing", label: "CPOE (completion % over expected)", type: "ratio",
      num: [{ col: "passing_cpoe", by: "attempts" }], den: ["attempts"], fmt: "dec2", min: 200,
      desc: "Each game's CPOE weighted by that game's attempts, in percentage points. Adjusts completion rate for throw difficulty." },
    { id: "air_yds_att", group: "Advanced: passing", label: "Air yards per attempt", type: "ratio", num: ["passing_air_yards"], den: ["attempts"], fmt: "dec2", min: 200,
      desc: "How far downfield a passer throws, on average, counting incomplete passes." },
    { id: "pass_fd_rate", group: "Advanced: passing", label: "Pass first-down rate", type: "ratio", num: ["passing_first_downs"], den: ["attempts"], fmt: "pct1", min: 200 },
    { id: "qb_sack_rate", group: "Advanced: passing", label: "Sack rate (sacks taken per dropback)", type: "ratio", num: ["sacks_suffered"], den: DB, fmt: "pct1", min: 200 },
    { id: "epa_opp_qb", group: "Advanced: value", label: "EPA per opportunity, quarterbacks", type: "ratio",
      num: ["passing_epa", "rushing_epa"], den: ["attempts", "sacks_suffered", "carries"], fmt: "dec3", min: 200,
      desc: "(Passing EPA + rushing EPA) divided by (attempts + sacks + carries). Meant for quarterbacks." },
    { id: "epa_opp_skill", group: "Advanced: value", label: "EPA per opportunity, RB / WR / TE", type: "ratio",
      num: ["rushing_epa", "receiving_epa"], den: ["carries", "targets"], fmt: "dec3", min: 100,
      desc: "(Rushing EPA + receiving EPA) divided by (carries + targets). Meant for running backs, receivers and tight ends." },
    // Advanced: receiving
    { id: "epa_tgt", group: "Advanced: receiving", label: "Receiving EPA per target", type: "ratio", num: ["receiving_epa"], den: ["targets"], fmt: "dec3", min: 50,
      desc: "EPA on targeted plays divided by targets." },
    { id: "racr", group: "Advanced: receiving", label: "RACR (yards per air yard)", type: "ratio", num: ["receiving_yards"], den: ["receiving_air_yards"], fmt: "dec2", min: 300,
      desc: "Receiving yards divided by receiving air yards. Above 1 means a receiver gains more than the ball travels in the air." },
    { id: "air_yds_tgt", group: "Advanced: receiving", label: "Air yards per target (aDOT)", type: "ratio", num: ["receiving_air_yards"], den: ["targets"], fmt: "dec2", min: 50,
      desc: "Average depth of target." },
    { id: "yac_rec", group: "Advanced: receiving", label: "Yards after catch per reception", type: "ratio", num: ["receiving_yards_after_catch"], den: ["receptions"], fmt: "dec2", min: 30 },
    { id: "rec_fd_rate", group: "Advanced: receiving", label: "First downs per reception", type: "ratio", num: ["receiving_first_downs"], den: ["receptions"], fmt: "pct1", min: 30 },
    { id: "target_share", group: "Advanced: receiving", label: "Target share (average per game targeted)", type: "ratio",
      num: ["target_share"], den: [{ col: "targets", gt0: true }], fmt: "pct1", min: 8,
      desc: "Average of the player's share of team targets, over games in which he was targeted." },
    { id: "air_share", group: "Advanced: receiving", label: "Air-yards share (average per game targeted)", type: "ratio",
      num: ["air_yards_share"], den: [{ col: "targets", gt0: true }], fmt: "pct1", min: 8,
      desc: "Average of the player's share of team air yards, over games in which he was targeted." },
    { id: "wopr", group: "Advanced: receiving", label: "WOPR (weighted opportunity rating)", type: "ratio",
      num: ["wopr"], den: [{ col: "targets", gt0: true }], fmt: "dec2", min: 8,
      desc: "1.5 x target share + 0.7 x air-yards share, averaged over games in which he was targeted." },
    // Advanced: rushing
    { id: "epa_carry", group: "Advanced: rushing", label: "Rushing EPA per carry", type: "ratio", num: ["rushing_epa"], den: ["carries"], fmt: "dec3", min: 100,
      desc: "Expected points added per rush attempt. Includes quarterback scrambles." },
    { id: "rush_fd_rate", group: "Advanced: rushing", label: "Rushing first-down rate", type: "ratio", num: ["rushing_first_downs"], den: ["carries"], fmt: "pct1", min: 100 },
    // Advanced: kicking
    { id: "fg_pct_30", group: "Advanced: kicking", label: "Field goal % from 30 to 39 yards", type: "ratio", num: ["fg_made_30_39"], den: ["fg_made_30_39", "fg_missed_30_39"], fmt: "pct1", min: 10 },
    { id: "fg_pct_40", group: "Advanced: kicking", label: "Field goal % from 40 to 49 yards", type: "ratio", num: ["fg_made_40_49"], den: ["fg_made_40_49", "fg_missed_40_49"], fmt: "pct1", min: 10 },
    { id: "fg_pct_50", group: "Advanced: kicking", label: "Field goal % from 50+ yards", type: "ratio",
      num: ["fg_made_50_59", "fg_made_60_"], den: ["fg_made_50_59", "fg_missed_50_59", "fg_made_60_", "fg_missed_60_"], fmt: "pct1", min: 8 },
  ];
  // Team-game rates cannot rank one player's season; these are the player totals they are built from.
  const PLAYER_TOTAL = { pass_yds_tg: "pass_yds", rush_yds_tg: "rush_yds", ints_tg: "ints_def", sacks_tg: "sacks", qb_hits_tg: "qb_hits", pass_def_tg: "pass_def" };
  MEASURES.forEach((m) => { if (PLAYER_TOTAL[m.id]) m.playerMeasure = PLAYER_TOTAL[m.id]; });
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
      case "half": return Number.isInteger(v) ? Math.round(v).toLocaleString("en-US") : v.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });  // whole counts print without .0; half sacks keep .5
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
  // A term is a column name, or {col, w: weight, by: other column to multiply by, gt0: 1 if the column > 0}.
  function compileTerms(terms, chunk) {
    return terms.map((t) => {
      const o = typeof t === "string" ? { col: t } : t;
      return { a: chunk.num[o.col], w: o.w === undefined ? 1 : o.w, b: o.by ? chunk.num[o.by] : null, gt0: !!o.gt0 };
    });
  }
  function evalTerms(terms, i) {
    let sum = 0;
    for (let j = 0; j < terms.length; j++) {
      const t = terms[j];
      let v = t.a[i];
      if (v !== v) continue;
      if (t.gt0) v = v > 0 ? 1 : 0;
      v *= t.w;
      if (t.b) { const b = t.b[i]; if (b !== b) continue; v *= b; }
      sum += v;
    }
    return sum;
  }

  // Returns Map(groupKey -> {rows, num[], den[], tg:Set|null, team, position}) for the given measures.
  function aggregate(store, filters, groupBy, measures, opts) {
    const f = filters || {};
    const trackTeams = !!(opts && opts.byTeam);
    const tables = allowedTables(store, f.cats);
    const needTG = measures.some((m) => m.type === "perTeamGame" || m.type === "teamGames");
    const groups = new Map();
    const nm = measures.length;
    for (const chunk of store.chunks) {
      if (!chunkInRange(chunk, f)) continue;
      const numArrs = measures.map((m) => (m.num ? compileTerms(m.num, chunk) : null));
      const denArrs = measures.map((m) => (m.den ? compileTerms(m.den, chunk) : null));
      for (let i = 0; i < chunk.n; i++) {
        if (!rowPasses(chunk, i, f, tables)) continue;
        let key;
        if (groupBy === "all") key = 0;
        else if (groupBy === "season") key = chunk.season;
        else if (groupBy === "week") key = chunk.week[i];
        else if (groupBy === "player_season") key = chunk.cat.player_id[i] * 64 + (chunk.season - PS_SEASON_BASE);
        else if (groupBy.indexOf("|season") > 0) key = chunk.cat[groupBy.split("|")[0]][i] * 64 + (chunk.season - PS_SEASON_BASE);
        else key = chunk.cat[groupBy][i];
        let g = groups.get(key);
        if (!g) {
          g = { rows: 0, num: new Float64Array(nm), den: new Float64Array(nm), tg: needTG ? new Set() : null,
                team: chunk.cat.team[i], position: chunk.cat.position[i], teams: trackTeams ? new Map() : null };
          groups.set(key, g);
        }
        g.rows++;
        if (needTG) g.tg.add(chunk.cat.game_id[i] * 64 + chunk.cat.team[i]);
        let t = null;
        if (trackTeams) {
          const tc = chunk.cat.team[i];
          t = g.teams.get(tc);
          if (!t) { t = { rows: 0, num: new Float64Array(nm), den: new Float64Array(nm) }; g.teams.set(tc, t); }
          t.rows++;
        }
        for (let k = 0; k < nm; k++) {
          const na = numArrs[k];
          const nv = na === null ? 1 : evalTerms(na, i);
          g.num[k] += nv;
          const da = denArrs[k];
          const dv = da ? evalTerms(da, i) : 0;
          if (da) g.den[k] += dv;
          if (t) { t.num[k] += nv; t.den[k] += dv; }
        }
      }
    }
    return groups;
  }

  // How one group's value splits across the teams a player played for (needs aggregate(..., {byTeam: true})).
  // Each part has the team's own value, and a share used to split the bar: sums split by each team's contribution, rates by each
  // team's share of the denominator (attempts, carries, targets), averages by games. If a sum has a negative part, split by games.
  function teamParts(store, measure, g, k) {
    k = k || 0;
    if (!g.teams) return [];
    const parts = [];
    for (const [tc, t] of g.teams) {
      let own, w;
      if (measure.type === "sum") { own = t.num[k]; w = t.num[k]; }
      else if (measure.type === "ratio") { own = t.den[k] > 0 ? t.num[k] / t.den[k] : NaN; w = t.den[k]; }
      else if (measure.type === "avg") { own = t.rows ? t.num[k] / t.rows : NaN; w = t.rows; }
      else { own = NaN; w = t.rows; }
      parts.push({ team: store.dicts.team.list[tc], value: own, weight: w, rows: t.rows });
    }
    let total = parts.reduce((a, p) => a + p.weight, 0);
    if (parts.some((p) => p.weight < 0) || !(total > 0)) { parts.forEach((p) => (p.weight = p.rows)); total = parts.reduce((a, p) => a + p.weight, 0); }
    parts.forEach((p) => (p.share = total > 0 ? p.weight / total : 1 / parts.length));
    return parts;
  }

  function value(measure, g, k) {
    k = k || 0;
    switch (measure.type) {
      case "sum": return g.num[k];
      case "avg": return g.rows ? g.num[k] / g.rows : NaN;
      case "ratio": return g.den[k] > 0 ? g.num[k] / g.den[k] : NaN;
      case "perTeamGame": return g.tg && g.tg.size ? g.num[k] / g.tg.size : NaN;
      case "teamGames": return g.tg ? g.tg.size : NaN;
      default: return NaN;
    }
  }

  // Like value(), but a ratio whose denominator is below the measure's minimum is NaN (too small a sample to trust).
  function valueMin(measure, g, k) {
    k = k || 0;
    if (measure.type === "ratio" && measure.min && g.den[k] < measure.min) return NaN;
    return value(measure, g, k);
  }

  function decode(store, groupBy, key) {
    if (groupBy === "season" || groupBy === "week") return String(key);
    if (groupBy === "all") return "All";
    return store.dicts[groupBy].list[key];
  }

  // Sorted list of {label, key, values[]} for a categorical/season/week grouping.
  function groupTable(store, filters, groupBy, measures, applyMin) {
    const groups = aggregate(store, filters, groupBy, measures);
    const rows = [];
    const val = applyMin ? valueMin : value;
    for (const [key, g] of groups) {
      rows.push({ key, label: decode(store, groupBy, key), rows: g.rows, values: measures.map((m, k) => val(m, g, k)) });
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

  // Count distinct values of a categorical column among the rows in view (players, teams, ...).
  function countDistinct(store, filters, col) {
    const f = filters || {};
    const tables = allowedTables(store, f.cats);
    const seen = new Uint8Array(store.dicts[col].list.length);
    let count = 0;
    for (const chunk of store.chunks) {
      if (!chunkInRange(chunk, f)) continue;
      for (let i = 0; i < chunk.n; i++) {
        if (!rowPasses(chunk, i, f, tables)) continue;
        const c = chunk.cat[col][i];
        if (!seen[c]) { seen[c] = 1; count++; }
      }
    }
    return count;
  }

  // EPA over replacement (this site's version), regular season, one position group at a time.
  // Opportunities: QB = attempts + sacks + carries; RB/WR/TE = carries + targets.
  // Per season, players are ranked by opportunities (ties: player_id), the first K are "starters", and the rest form the
  // replacement pool. r = pool EPA / pool opportunities. EPAOR = EPA - r x opportunities.
  const REPLACEMENT_K = { QB: 32, RB: 32, WR: 64, TE: 32 };
  const EPAOR_DEF = {
    QB: { epa: ["passing_epa", "rushing_epa"], opp: ["attempts", "sacks_suffered", "carries"] },
    RB: { epa: ["rushing_epa", "receiving_epa"], opp: ["carries", "targets"] },
    WR: { epa: ["rushing_epa", "receiving_epa"], opp: ["carries", "targets"] },
    TE: { epa: ["rushing_epa", "receiving_epa"], opp: ["carries", "targets"] },
  };
  function epaOverReplacement(store, position, seasonMin, seasonMax) {
    const def = EPAOR_DEF[position], K = REPLACEMENT_K[position];
    const ms = [{ type: "sum", num: def.epa }, { type: "sum", num: def.opp }];
    const groups = aggregate(store, { seasonMin, seasonMax, cats: { season_type: ["REG"], position_group: [position] } }, "player_season", ms, { byTeam: true });
    const bySeason = new Map();
    for (const [key, g] of groups) {
      if (!(g.num[1] > 0)) continue;
      const season = (key % 64) + PS_SEASON_BASE, pc = Math.floor(key / 64);
      if (!bySeason.has(season)) bySeason.set(season, []);
      bySeason.get(season).push({ id: store.dicts.player_id.list[pc], name: store.playerNames[pc], season,
        team: store.dicts.team.list[g.team], games: g.rows, epa: g.num[0], opp: g.num[1],
        parts: Array.from(g.teams, ([tc, t]) => ({ team: store.dicts.team.list[tc], epa: t.num[0], opp: t.num[1] })) });
    }
    const out = new Map();
    for (const [season, list] of bySeason) {
      list.sort((a, b) => b.opp - a.opp || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      let pe = 0, po = 0, se = 0, so = 0;
      list.forEach((x, i) => { if (i >= K) { pe += x.epa; po += x.opp; } else { se += x.epa; so += x.opp; } });
      const r = po > 0 ? pe / po : 0;
      list.forEach((x) => {
        x.epaor = x.epa - r * x.opp;
        // each team's own EPAOR adds up to the player's; bars split by share of opportunities
        x.parts.forEach((p) => { p.epaor = p.epa - r * p.opp; p.value = p.epaor; p.share = x.opp > 0 ? p.opp / x.opp : 1 / x.parts.length; });
        x.teams = x.parts.map((p) => p.team);
      });
      out.set(season, { r, starterRate: so > 0 ? se / so : NaN, poolSize: Math.max(0, list.length - K), rows: list });
    }
    return out;
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
    const groups = aggregate(store, filters, "player_season", [measure], { byTeam: true });
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
        parts: teamParts(store, measure, g, 0),
      });
    }
    rows.sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
    const top = rows.slice(0, n);
    top.forEach((r) => (r.teams = r.parts.map((p) => p.team)));
    return top;
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

  return { newStore, addSeason, MEASURES, MEASURE_BY_ID, BREAKDOWNS, MILESTONES, format, aggregate, value, valueMin,
           groupTable, countPlayers, countDistinct, epaOverReplacement, teamParts, REPLACEMENT_K, milestones, topPlayerSeasons, gameLog, playerIndex, decode };
});
