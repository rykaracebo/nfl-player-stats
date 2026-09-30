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
    // Totals
    { id: "games", group: "Totals", type: "sum", num: null, fmt: "int" },
    { id: "pass_yds", group: "Totals", type: "sum", num: ["passing_yards"], fmt: "int" },
    { id: "rush_yds", group: "Totals", type: "sum", num: ["rushing_yards"], fmt: "int" },
    { id: "rec_yds", group: "Totals", type: "sum", num: ["receiving_yards"], fmt: "int" },
    { id: "receptions", group: "Totals", type: "sum", num: ["receptions"], fmt: "int" },
    { id: "tds", group: "Totals", type: "sum", num: ["passing_tds", "rushing_tds", "receiving_tds"], fmt: "int" },
    { id: "sacks", group: "Totals", type: "sum", num: ["def_sacks"], fmt: "half" },
    { id: "ints_def", group: "Totals", type: "sum", num: ["def_interceptions"], fmt: "int" },
    { id: "qb_hits", group: "Totals", type: "sum", num: ["def_qb_hits"], fmt: "int" },
    { id: "pass_def", group: "Totals", type: "sum", num: ["def_pass_defended"], fmt: "int" },
    { id: "penalties", group: "Totals", type: "sum", num: ["penalties"], fmt: "int" },
    { id: "tfl", group: "Totals", type: "sum", num: ["def_tackles_for_loss"], fmt: "int" },
    { id: "fantasy", group: "Totals", type: "sum", num: ["fantasy_points_ppr"], fmt: "int" },
    { id: "pass_epa_total", group: "Totals", type: "sum", num: ["passing_epa"], fmt: "dec1" },
    { id: "rush_epa_total", group: "Totals", type: "sum", num: ["rushing_epa"], fmt: "dec1" },
    { id: "rec_epa_total", group: "Totals", type: "sum", num: ["receiving_epa"], fmt: "dec1" },
    // Per player-game
    { id: "fantasy_pg", group: "Per player-game", type: "avg", num: ["fantasy_points_ppr"], fmt: "dec2" },
    { id: "pass_yds_pg", group: "Per player-game", type: "avg", num: ["passing_yards"], fmt: "dec1" },
    { id: "rush_yds_pg", group: "Per player-game", type: "avg", num: ["rushing_yards"], fmt: "dec1" },
    { id: "rec_yds_pg", group: "Per player-game", type: "avg", num: ["receiving_yards"], fmt: "dec1" },
    { id: "sacks_pg", group: "Per player-game", type: "avg", num: ["def_sacks"], fmt: "dec3" },
    { id: "qb_hits_pg", group: "Per player-game", type: "avg", num: ["def_qb_hits"], fmt: "dec3" },
    // Per team-game
    { id: "pass_yds_tg", group: "Per team-game", type: "perTeamGame", num: ["passing_yards"], fmt: "dec1" },
    { id: "rush_yds_tg", group: "Per team-game", type: "perTeamGame", num: ["rushing_yards"], fmt: "dec1" },
    { id: "ints_tg", group: "Per team-game", type: "perTeamGame", num: ["def_interceptions"], fmt: "dec3" },
    { id: "sacks_tg", group: "Per team-game", type: "perTeamGame", num: ["def_sacks"], fmt: "dec3" },
    { id: "qb_hits_tg", group: "Per team-game", type: "perTeamGame", num: ["def_qb_hits"], fmt: "dec2" },
    { id: "pass_def_tg", group: "Per team-game", type: "perTeamGame", num: ["def_pass_defended"], fmt: "dec2" },
    { id: "pen_tg", group: "Per team-game", type: "perTeamGame", num: ["penalties"], fmt: "dec2" },
    { id: "team_games", group: "Per team-game", type: "teamGames", num: null, fmt: "int" },
    // Rates (basic)
    { id: "comp_pct", group: "Rates", type: "ratio", num: ["completions"], den: ["attempts"], fmt: "pct1", min: 200 },
    { id: "ypa", group: "Rates", type: "ratio", num: ["passing_yards"], den: ["attempts"], fmt: "dec2", min: 200 },
    { id: "int_rate", group: "Rates", type: "ratio", num: ["passing_interceptions"], den: ["attempts"], fmt: "pct1", min: 200 },
    { id: "ypc", group: "Rates", type: "ratio", num: ["rushing_yards"], den: ["carries"], fmt: "dec2", min: 100 },
    { id: "ypt", group: "Rates", type: "ratio", num: ["receiving_yards"], den: ["targets"], fmt: "dec2", min: 50 },
    { id: "ypr", group: "Rates", type: "ratio", num: ["receiving_yards"], den: ["receptions"], fmt: "dec2", min: 30 },
    { id: "catch_pct", group: "Rates", type: "ratio", num: ["receptions"], den: ["targets"], fmt: "pct1", min: 50 },
    { id: "fg_pct", group: "Rates", type: "ratio", num: ["fg_made"], den: ["fg_att"], fmt: "pct1", min: 15 },
    { id: "ypp", group: "Rates", type: "ratio", num: ["pt_yards"], den: ["pt_att"], fmt: "dec1", min: 30 },
    // Advanced: passing
    { id: "epa_db", group: "Advanced: passing", type: "ratio", num: ["passing_epa"], den: DB, fmt: "dec3", min: 200 },
    { id: "anya", group: "Advanced: passing", type: "ratio",
      num: ["passing_yards", { col: "passing_tds", w: 20 }, { col: "passing_interceptions", w: -45 }, "sack_yards_lost"], den: DB, fmt: "dec2", min: 200 },
    { id: "cpoe", group: "Advanced: passing", type: "ratio", num: [{ col: "passing_cpoe", by: "attempts" }], den: ["attempts"], fmt: "dec2", min: 200 },
    { id: "air_yds_att", group: "Advanced: passing", type: "ratio", num: ["passing_air_yards"], den: ["attempts"], fmt: "dec2", min: 200 },
    { id: "pass_fd_rate", group: "Advanced: passing", type: "ratio", num: ["passing_first_downs"], den: ["attempts"], fmt: "pct1", min: 200 },
    { id: "qb_sack_rate", group: "Advanced: passing", type: "ratio", num: ["sacks_suffered"], den: DB, fmt: "pct1", min: 200 },
    { id: "epa_opp_qb", group: "Advanced: value", type: "ratio", num: ["passing_epa", "rushing_epa"], den: ["attempts", "sacks_suffered", "carries"], fmt: "dec3", min: 200 },
    { id: "epa_opp_skill", group: "Advanced: value", type: "ratio", num: ["rushing_epa", "receiving_epa"], den: ["carries", "targets"], fmt: "dec3", min: 100 },
    // Advanced: receiving
    { id: "epa_tgt", group: "Advanced: receiving", type: "ratio", num: ["receiving_epa"], den: ["targets"], fmt: "dec3", min: 50 },
    { id: "racr", group: "Advanced: receiving", type: "ratio", num: ["receiving_yards"], den: ["receiving_air_yards"], fmt: "dec2", min: 300 },
    { id: "air_yds_tgt", group: "Advanced: receiving", type: "ratio", num: ["receiving_air_yards"], den: ["targets"], fmt: "dec2", min: 50 },
    { id: "yac_rec", group: "Advanced: receiving", type: "ratio", num: ["receiving_yards_after_catch"], den: ["receptions"], fmt: "dec2", min: 30 },
    { id: "rec_fd_rate", group: "Advanced: receiving", type: "ratio", num: ["receiving_first_downs"], den: ["receptions"], fmt: "pct1", min: 30 },
    { id: "target_share", group: "Advanced: receiving", type: "ratio", num: ["target_share"], den: [{ col: "targets", gt0: true }], fmt: "pct1", min: 8 },
    { id: "air_share", group: "Advanced: receiving", type: "ratio", num: ["air_yards_share"], den: [{ col: "targets", gt0: true }], fmt: "pct1", min: 8 },
    { id: "wopr", group: "Advanced: receiving", type: "ratio", num: ["wopr"], den: [{ col: "targets", gt0: true }], fmt: "dec2", min: 8 },
    // Advanced: rushing
    { id: "epa_carry", group: "Advanced: rushing", type: "ratio", num: ["rushing_epa"], den: ["carries"], fmt: "dec3", min: 100 },
    { id: "rush_fd_rate", group: "Advanced: rushing", type: "ratio", num: ["rushing_first_downs"], den: ["carries"], fmt: "pct1", min: 100 },
    // Advanced: kicking
    { id: "fg_pct_30", group: "Advanced: kicking", type: "ratio", num: ["fg_made_30_39"], den: ["fg_made_30_39", "fg_missed_30_39"], fmt: "pct1", min: 10 },
    { id: "fg_pct_40", group: "Advanced: kicking", type: "ratio", num: ["fg_made_40_49"], den: ["fg_made_40_49", "fg_missed_40_49"], fmt: "pct1", min: 10 },
    { id: "fg_pct_50", group: "Advanced: kicking", type: "ratio",
      num: ["fg_made_50_59", "fg_made_60_"], den: ["fg_made_50_59", "fg_missed_50_59", "fg_made_60_", "fg_missed_60_"], fmt: "pct1", min: 8 },
  ];

  // ONE definitions object for every measure. The dashboard's dropdown, the table headers, the "what is this?" line and the glossary
  // all read it. l = plain-words label (with the abbreviation), w = what it is (one sentence), u = what the "Minimum" counts for a rate,
  // f = family (decides which summary cards appear next to it).
  const DEFS = {
    games: { l: "Player-games", f: "general", w: "One row per player per game, counted. A player who plays 16 games adds 16." },
    pass_yds: { l: "Passing yards", f: "passing", w: "Yards gained on completed passes, credited to the passer. A 300-yard game adds 300." },
    rush_yds: { l: "Rushing yards", f: "rushing", w: "Yards gained on running plays, including quarterback runs. A 100-yard game adds 100." },
    rec_yds: { l: "Receiving yards", f: "receiving", w: "Yards gained on catches, credited to the receiver." },
    receptions: { l: "Receptions (catches)", f: "receiving", w: "Passes caught. A receiver with 8 catches in a game adds 8." },
    penalties: { l: "Penalties", f: "general", w: "Penalties charged to players, counted. About 5% of the source's penalties are not tied to a player and are missing here." },
    tds: { l: "Touchdown credits (pass, rush, receive)", f: "general", w: "Touchdown passes, rushing touchdowns and receiving touchdowns added together. A touchdown pass counts for the passer and again for the receiver." },
    sacks: { l: "Sacks (defense)", f: "defense", w: "Times a defender took down the quarterback behind the line. A shared sack counts as half (0.5)." },
    ints_def: { l: "Interceptions (defense)", f: "defense", w: "Passes a defender caught. Same plays as interceptions thrown, seen from the defense." },
    qb_hits: { l: "QB hits (defense)", f: "defense", w: "Times a defender hit the quarterback on a pass play. A sack is a hit but a hit is not always a sack." },
    pass_def: { l: "Passes defended", f: "defense", w: "Passes a defender got a hand on to stop a catch." },
    tfl: { l: "Tackles for loss (2012 onward)", f: "defense", w: "Tackles that stopped the ball carrier behind the line. Not recorded in 2009 to 2011, so those seasons add nothing." },
    fantasy: { l: "Fantasy points (PPR)", f: "general", w: "Fantasy football points with a point per catch (full PPR), as computed by nflverse." },
    pass_epa_total: { l: "Points added by passing (passing EPA, total)", f: "passing", w: "EPA (expected points added) says how many points a play was worth versus the average play. This adds it over pass attempts and sacks; above 0 is good." },
    rush_epa_total: { l: "Points added by rushing (rushing EPA, total)", f: "rushing", w: "EPA added up over rush attempts, including scrambles. Above 0 means the runs were worth more than the average play." },
    rec_epa_total: { l: "Points added when targeted (receiving EPA, total)", f: "receiving", w: "EPA on plays where the player was the target. The same pass's EPA also appears under the passer." },
    fantasy_pg: { l: "Fantasy points per game", f: "general", w: "Fantasy points (PPR) divided by player-games in view." },
    pass_yds_pg: { l: "Passing yards per game", f: "passing", w: "Passing yards divided by the player-games in view. Every row counts, including players who did not pass." },
    rush_yds_pg: { l: "Rushing yards per game", f: "rushing", w: "Rushing yards divided by the player-games in view." },
    rec_yds_pg: { l: "Receiving yards per game", f: "receiving", w: "Receiving yards divided by the player-games in view." },
    sacks_pg: { l: "Sacks per game", f: "defense", w: "Sacks divided by the player-games in view." },
    qb_hits_pg: { l: "QB hits per game", f: "defense", w: "QB hits divided by the player-games in view." },
    pass_yds_tg: { l: "Passing yards per team-game", f: "passing", w: "Every player's passing yards added up, divided by team-games (one team in one game). This is the report's headline measure." },
    rush_yds_tg: { l: "Rushing yards per team-game", f: "rushing", w: "Every player's rushing yards added up, divided by team-games." },
    ints_tg: { l: "Interceptions per team-game", f: "defense", w: "Defensive interceptions divided by team-games. A team-game is one team in one game." },
    sacks_tg: { l: "Sacks per team-game", f: "defense", w: "Sacks divided by team-games." },
    qb_hits_tg: { l: "QB hits per team-game", f: "defense", w: "QB hits divided by team-games." },
    pass_def_tg: { l: "Passes defended per team-game", f: "defense", w: "Passes defended divided by team-games." },
    pen_tg: { l: "Penalties per team-game", f: "general", w: "Penalties charged to players divided by team-games. About 5% of the source's penalties are not tied to a player and are missing here." },
    team_games: { l: "Team-games (count)", f: "general", w: "Number of distinct team-games (one team in one game) among the rows in view." },
    comp_pct: { l: "Completion percentage", f: "passing", u: "pass attempts", w: "Completions divided by attempts. A passer who completes 20 of 30 is at 66.7%." },
    ypa: { l: "Yards per pass attempt", f: "passing", u: "pass attempts", w: "Passing yards divided by pass attempts." },
    int_rate: { l: "Interception rate (per attempt)", f: "passing", u: "pass attempts", w: "Interceptions thrown divided by pass attempts. Lower is better for the passer." },
    ypc: { l: "Yards per carry", f: "rushing", u: "carries", w: "Rushing yards divided by carries." },
    ypt: { l: "Yards per target", f: "receiving", u: "targets", w: "Receiving yards divided by times targeted, catch or not." },
    ypr: { l: "Yards per reception", f: "receiving", u: "receptions", w: "Receiving yards divided by catches." },
    catch_pct: { l: "Catch rate (per target)", f: "receiving", u: "targets", w: "Receptions divided by targets: how often a pass thrown to the player is caught." },
    fg_pct: { l: "Field goal percentage", f: "kicking", u: "field goal attempts", w: "Field goals made divided by attempted." },
    ypp: { l: "Yards per punt (gross)", f: "kicking", u: "punts", w: "Punt yards divided by punts, before any return." },
    epa_db: { l: "Points added per pass play (EPA per dropback)", f: "passing", u: "dropbacks", w: "Passing EPA divided by dropbacks (pass attempts plus sacks). Above 0 means the passer added expected points on average." },
    anya: { l: "Adjusted yards per pass play (ANY/A)", f: "passing", u: "dropbacks", w: "Passing yards plus 20 per touchdown, minus 45 per interception, minus sack yards, divided by dropbacks. Rewards touchdowns, punishes interceptions and sacks." },
    cpoe: { l: "Completions over expected (CPOE)", f: "passing", u: "pass attempts", w: "How much more or less often a passer completes passes than nflverse's model expects for those throws, in percentage points. +3 means three points better than expected." },
    air_yds_att: { l: "Air yards per attempt", f: "passing", u: "pass attempts", w: "How far downfield the average pass travels in the air, counting incompletions." },
    pass_fd_rate: { l: "Pass first-down rate", f: "passing", u: "pass attempts", w: "Share of pass attempts that gain a first down." },
    qb_sack_rate: { l: "Sack rate (sacks taken per dropback)", f: "passing", u: "dropbacks", w: "Times sacked divided by dropbacks. Lower is better for the quarterback." },
    epa_opp_qb: { l: "Points added per play, quarterbacks (EPA per opportunity)", f: "passing", u: "plays (attempts + sacks + carries)", w: "Passing EPA plus rushing EPA divided by attempts + sacks + carries. Meant for quarterbacks." },
    epa_opp_skill: { l: "Points added per play, RB / WR / TE (EPA per opportunity)", f: "receiving", u: "plays (carries + targets)", w: "Rushing EPA plus receiving EPA divided by carries + targets. Meant for running backs, receivers and tight ends." },
    epa_tgt: { l: "Points added per target (receiving EPA per target)", f: "receiving", u: "targets", w: "EPA on targeted plays divided by targets." },
    racr: { l: "Yards gained per air yard (RACR)", f: "receiving", u: "receiving air yards", w: "Receiving yards divided by the yards the ball traveled in the air to the receiver. Above 1 means the receiver gains more than the ball travels in the air." },
    air_yds_tgt: { l: "Average depth of target (air yards per target)", f: "receiving", u: "targets", w: "How far downfield the average pass to this player travels in the air." },
    yac_rec: { l: "Yards after catch per reception", f: "receiving", u: "receptions", w: "Yards gained after the catch divided by receptions (an unofficial stat)." },
    rec_fd_rate: { l: "First downs per reception", f: "receiving", u: "receptions", w: "Share of catches that gain a first down." },
    target_share: { l: "Share of team targets (target share)", f: "receiving", u: "games targeted", w: "The player's share of the player's team's pass targets, averaged over games in which the player was targeted." },
    air_share: { l: "Share of team air yards (air-yards share)", f: "receiving", u: "games targeted", w: "The player's share of the player's team's air yards, averaged over games in which the player was targeted." },
    wopr: { l: "Receiver opportunity score (WOPR)", f: "receiving", u: "games targeted", w: "1.5 x target share + 0.7 x air-yards share, averaged over games in which the player was targeted." },
    epa_carry: { l: "Points added per carry (rushing EPA per carry)", f: "rushing", u: "carries", w: "Rushing EPA divided by carries. Includes quarterback scrambles." },
    rush_fd_rate: { l: "Rushing first-down rate", f: "rushing", u: "carries", w: "Share of carries that gain a first down." },
    fg_pct_30: { l: "Field goal % from 30 to 39 yards", f: "kicking", u: "attempts from 30 to 39", w: "Made divided by attempted from 30 to 39 yards." },
    fg_pct_40: { l: "Field goal % from 40 to 49 yards", f: "kicking", u: "attempts from 40 to 49", w: "Made divided by attempted from 40 to 49 yards." },
    fg_pct_50: { l: "Field goal % from 50+ yards", f: "kicking", u: "attempts from 50+", w: "Made divided by attempted from 50 yards or more." },
  };
  MEASURES.forEach((m) => {
    const d = DEFS[m.id];
    if (!d) throw new Error("measure without a definition: " + m.id);
    m.label = d.l; m.what = d.w; m.family = d.f; m.minUnit = d.u || "";
    m.advanced = m.group.indexOf("Advanced") === 0;
    m.menuGroup = m.advanced ? "Advanced" : m.group;
  });
  // Team-game rates cannot rank one player's season; these are the player totals they are built from.
  const PLAYER_TOTAL = { pass_yds_tg: "pass_yds", rush_yds_tg: "rush_yds", ints_tg: "ints_def", sacks_tg: "sacks", qb_hits_tg: "qb_hits", pass_def_tg: "pass_def", pen_tg: "penalties" };
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
        else if (groupBy.indexOf("|week") > 0) key = chunk.cat[groupBy.split("|")[0]][i] * 64 + chunk.week[i];
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
  // minOverride replaces the measure's own minimum ("Qualified") when given.
  function minOf(measure, minOverride) { return minOverride > 0 ? minOverride : measure.min; }
  function valueMin(measure, g, k, minOverride) {
    k = k || 0;
    const mn = minOf(measure, minOverride);
    if (measure.type === "ratio" && mn && g.den[k] < mn) return NaN;
    return value(measure, g, k);
  }

  function decode(store, groupBy, key) {
    if (groupBy === "season" || groupBy === "week") return String(key);
    if (groupBy === "all") return "All";
    return store.dicts[groupBy].list[key];
  }

  // Sorted list of {label, key, values[]} for a categorical/season/week grouping.
  function groupTable(store, filters, groupBy, measures, applyMin, minOverride) {
    const groups = aggregate(store, filters, groupBy, measures);
    const rows = [];
    const val = applyMin ? valueMin : value;
    for (const [key, g] of groups) {
      rows.push({ key, label: decode(store, groupBy, key), rows: g.rows, values: measures.map((m, k) => val(m, g, k, minOverride)) });
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

  // How many players' totals over the rows in view reach the minimum for a rate measure (the "Showing N players who meet the minimum" line).
  function qualifiedPlayers(store, filters, measure, minOverride, col) {
    const mn = minOf(measure, minOverride);
    const groups = aggregate(store, filters, col || "player_id", [measure]);
    let n = 0;
    for (const g of groups.values()) if (g.den[0] >= mn) n++;
    return n;
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
  function topPlayerSeasons(store, filters, measure, n, minOverride) {
    const groups = aggregate(store, filters, "player_season", [measure], { byTeam: true });
    const rows = [];
    for (const [key, g] of groups) {
      if (measure.type === "ratio" && minOf(measure, minOverride) && g.den[0] < minOf(measure, minOverride)) continue;
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

  // Player list for the search box: id, name, position group and team from the player's last row, plus every team the player appeared for and when.
  function playerIndex(store) {
    const info = new Map();
    for (const chunk of store.chunks) {
      for (let i = 0; i < chunk.n; i++) {
        const p = chunk.cat.player_id[i];
        let e = info.get(p);
        if (!e) { e = { id: store.dicts.player_id.list[p], name: store.playerNames[p], first: chunk.season, last: chunk.season, pg: 0, team: 0, games: 0, teams: new Map() }; info.set(p, e); }
        e.last = chunk.season;
        e.pg = chunk.cat.position_group[i];
        e.team = chunk.cat.team[i];
        e.games++;
        const span = e.teams.get(e.team);
        if (!span) e.teams.set(e.team, [chunk.season, chunk.season]); else span[1] = chunk.season;
      }
    }
    const list = [];
    for (const e of info.values()) {
      list.push({ id: e.id, name: e.name, position_group: store.dicts.position_group.list[e.pg],
                  team: store.dicts.team.list[e.team], first: e.first, last: e.last, games: e.games,
                  teams: [...e.teams].map(([t, sp]) => ({ team: store.dicts.team.list[t], first: sp[0], last: sp[1] })).sort((x, y) => x.first - y.first) });
    }
    list.sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }

  return { newStore, addSeason, MEASURES, MEASURE_BY_ID, DEFS, BREAKDOWNS, minOf, qualifiedPlayers, MILESTONES, format, aggregate, value, valueMin,
           groupTable, countPlayers, countDistinct, epaOverReplacement, teamParts, REPLACEMENT_K, milestones, topPlayerSeasons, gameLog, playerIndex, decode };
});
