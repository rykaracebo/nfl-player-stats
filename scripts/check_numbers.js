#!/usr/bin/env node
/* Recomputes the report's numbers with the dashboard's own calculation code (assets/js/stats.js) and compares them
   with data/report.json, which scripts/build_report.py computed independently with pandas.
   Run from the project root:  node scripts/check_numbers.js
   Exits with code 1 if any number disagrees. */
const fs = require("fs");
const path = require("path");
const S = require("../assets/js/stats.js");

const root = path.join(__dirname, "..");
const report = JSON.parse(fs.readFileSync(path.join(root, "data/report.json"), "utf8"));
const manifest = JSON.parse(fs.readFileSync(path.join(root, "data/manifest.json"), "utf8"));

const store = S.newStore();
for (const y of Object.keys(manifest.seasons).map(Number).sort((a, b) => a - b)) {
  S.addSeason(store, fs.readFileSync(path.join(root, manifest.seasons[y].file), "utf8"));
}

let checks = 0, failures = 0;
function close(a, b) { return Math.abs(a - b) <= 1e-9 + 1e-6 * Math.max(Math.abs(a), Math.abs(b)); }
function check(label, got, want) {
  checks++;
  const ok = typeof want === "number" ? close(got, want) : got === want;
  if (!ok) { failures++; console.log("MISMATCH " + label + ": dashboard code " + got + ", report " + want); }
}

// The dashboard's starting view: regular season, every season, every player.
const REG = { cats: { season_type: ["REG"] } };
const M = S.MEASURE_BY_ID;

// row counts
const manifestRows = Object.values(manifest.seasons).reduce((a, s) => a + s.rows, 0);
check("rows loaded vs manifest", store.chunks.reduce((a, c) => a + c.n, 0), manifestRows);
const all = S.aggregate(store, REG, "all", [M.games]).get(0);
check("regular-season player-games", all.rows, report.reg_rows);
check("regular-season players", S.countPlayers(store, REG), report.reg_players);

// per-season rates (report findings 1, 6)
function bySeason(measure) {
  const out = {};
  for (const [key, g] of S.aggregate(store, REG, "season", [measure])) out[key] = { value: S.value(measure, g, 0), tg: g.tg ? g.tg.size : null };
  return out;
}
const passTG = bySeason(M.pass_yds_tg), rushTG = bySeason(M.rush_yds_tg), intTG = bySeason(M.ints_tg);
for (const s of Object.keys(report.pass_yds_tg)) {
  check("team-games " + s, passTG[s].tg, report.team_games[s]);
  check("pass yards per team-game " + s, passTG[s].value, report.pass_yds_tg[s]);
  check("rush yards per team-game " + s, rushTG[s].value, report.rush_yds_tg[s]);
  check("interceptions per team-game " + s, intTG[s].value, report.ints_tg[s]);
}

// sack rate (finding 8): sacks per pass attempt, league-wide
const sackRate = { type: "ratio", num: ["def_sacks"], den: ["attempts"] };
for (const [key, g] of S.aggregate(store, REG, "season", [sackRate])) check("sack rate " + key, S.value(sackRate, g, 0), report.sack_rate[key]);

// milestone counts (findings 2 to 5, 7)
const ms = S.milestones(store, REG).bySeason;
const map = { pass4000: "pass4000", rush1000: "rush1000", carries300: "carries300", rec100: "rec100", int6: "int6" };
for (const s of Object.keys(report.pass4000)) {
  for (const id of Object.keys(map)) check(id + " " + s, (ms.get(+s) || {})[id] || 0, report[map[id]][s]);
}

// QB hits top 10 player-seasons (finding 9) and sack leaders by season (finding 10)
const hits = S.topPlayerSeasons(store, REG, M.qb_hits, 10);
report.qb_hits_top.forEach(([name, season, v], i) => {
  check("qb hits rank " + (i + 1) + " value", hits[i].value, v);
  check("qb hits rank " + (i + 1) + " season", hits[i].season, season);
  check("qb hits rank " + (i + 1) + " player", hits[i].name, name);
});
for (const s of Object.keys(report.sack_leaders)) {
  const top = S.topPlayerSeasons(store, { seasonMin: +s, seasonMax: +s, cats: { season_type: ["REG"] } }, M.sacks, 1)[0];
  check("sack leader " + s + " name", top.name, report.sack_leaders[s][0]);
  check("sack leader " + s + " sacks", top.value, report.sack_leaders[s][1]);
}

// advanced measures: dashboard code vs pandas, league-wide by season
for (const id of ["epa_db", "anya", "cpoe", "racr", "epa_carry", "target_share", "fg_pct_50"]) {
  for (const [key, g] of S.aggregate(store, REG, "season", [M[id]])) check(id + " " + key, S.value(M[id], g, 0), report.advanced[id][key]);
}
const topEpa = S.topPlayerSeasons(store, REG, M.epa_db, 10);
report.advanced.top_epa_db.forEach(([name, season, v], i) => {
  check("top EPA per dropback rank " + (i + 1) + " player", topEpa[i].name, name);
  check("top EPA per dropback rank " + (i + 1) + " season", topEpa[i].season, season);
  check("top EPA per dropback rank " + (i + 1) + " value", topEpa[i].value, v);
});

// EPA over replacement: dashboard code vs pandas, every position and season (replacement rate, starter rate, pool size, top 5)
for (const pos of Object.keys(report.epaor)) {
  const js = S.epaOverReplacement(store, pos, null, null);
  for (const [season, ref] of Object.entries(report.epaor[pos])) {
    const got = js.get(+season);
    check("EPAOR " + pos + " " + season + " replacement rate", got.r, ref.r);
    check("EPAOR " + pos + " " + season + " starter rate", got.starterRate, ref.starter);
    check("EPAOR " + pos + " " + season + " pool size", got.poolSize, ref.pool);
    const top = got.rows.slice().sort((a, b) => b.epaor - a.epaor || a.name.localeCompare(b.name)).slice(0, 5);
    ref.top5.forEach(([name, v], i) => {
      check("EPAOR " + pos + " " + season + " top " + (i + 1) + " player", top[i].name, name);
      check("EPAOR " + pos + " " + season + " top " + (i + 1) + " value", top[i].epaor, v);
    });
  }
}

// team-level views use the same code: team-games and per-team-game rates summed over teams must equal the league totals
const perTeam = S.aggregate(store, REG, "team", [M.pass_yds_tg, M.team_games]);
let tgSum = 0;
for (const [, g] of perTeam) tgSum += g.tg.size;
check("team-games summed over teams equals league team-games", tgSum, Object.values(report.team_games).reduce((a, b) => a + b, 0));

console.log(checks + " checks, " + failures + " mismatches");
process.exit(failures ? 1 : 0);
