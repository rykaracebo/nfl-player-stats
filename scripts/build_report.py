"""Compute every number in the report from data/seasons/*.csv, then write index.html and data/report.json.

All report numbers use REGULAR-SEASON rows only (season_type == "REG"). The dashboard starts on the same filter.
Run from the project root:  .venv/bin/python scripts/build_report.py
"""
import glob
import html
import json

import pandas as pd

FILES = sorted(glob.glob("data/seasons/player_games_*.csv"))
d = pd.concat([pd.read_csv(f, low_memory=False) for f in FILES], ignore_index=True)
NUMERIC = list(d.columns[11:])
d[NUMERIC] = d[NUMERIC].fillna(0)  # blank = 0; NA columns (tackles for loss 2009-2011) are not used below
reg = d[d["season_type"] == "REG"].copy()
SEASONS = sorted(reg["season"].unique())
FIRST, LAST = int(SEASONS[0]), int(SEASONS[-1])

# team-game = one team in one game; denominator for the per-team-game rates
team_games = reg[["season", "game_id", "team"]].drop_duplicates().groupby("season").size()
by_season = reg.groupby("season")[["passing_yards", "rushing_yards", "def_interceptions", "def_sacks", "attempts"]].sum()

ps = reg.groupby(["season", "player_id", "player_name"], as_index=False).agg(
    passing_yards=("passing_yards", "sum"), carries=("carries", "sum"), rushing_yards=("rushing_yards", "sum"),
    receptions=("receptions", "sum"), def_interceptions=("def_interceptions", "sum"),
    def_sacks=("def_sacks", "sum"), def_qb_hits=("def_qb_hits", "sum"))

R = {}  # everything printed on the page, saved to report.json for the checker


def num(x):
    return f"{x:,.0f}"


def dec(x, n=1):
    return f"{x:,.{n}f}"


def pct(x, n=1):
    return f"{x * 100:.{n}f}%"


def series(s):
    return {int(k): float(v) for k, v in s.items()}


# ------------------------------------------------------------------ the numbers behind each finding
pass_tg = by_season["passing_yards"] / team_games
rush_tg = by_season["rushing_yards"] / team_games
int_tg = by_season["def_interceptions"] / team_games
sack_rate = by_season["def_sacks"] / by_season["attempts"]


def count_by_season(mask):
    return ps[mask].groupby("season").size().reindex(SEASONS, fill_value=0)


c4000 = count_by_season(ps["passing_yards"] >= 4000)
c1000 = count_by_season(ps["rushing_yards"] >= 1000)
c300 = count_by_season(ps["carries"] >= 300)
c100rec = count_by_season(ps["receptions"] >= 100)
c6int = count_by_season(ps["def_interceptions"] >= 6)

hits = ps.sort_values(["def_qb_hits", "player_name"], ascending=[False, True]).head(10)
lead = ps.sort_values(["season", "def_sacks", "player_name"], ascending=[True, False, True]).groupby("season").head(2)
sack_leaders = ps.loc[ps.groupby("season")["def_sacks"].idxmax()].set_index("season")
ties = {int(s): int((g["def_sacks"] == g["def_sacks"].max()).sum()) for s, g in ps.groupby("season")}
assert all(v == 1 for v in ties.values()), f"sack leader ties: {ties}"

R.update({
    "reg_rows": int(len(reg)), "reg_players": int(reg["player_id"].nunique()), "seasons": len(SEASONS),
    "team_games": series(team_games), "pass_yds_tg": series(pass_tg), "rush_yds_tg": series(rush_tg),
    "ints_tg": series(int_tg), "sack_rate": series(sack_rate),
    "pass4000": series(c4000), "rush1000": series(c1000), "carries300": series(c300),
    "rec100": series(c100rec), "int6": series(c6int),
    "qb_hits_top": [[r.player_name, int(r.season), float(r.def_qb_hits)] for r in hits.itertuples()],
    "sack_leaders": {int(s): [r["player_name"], float(r["def_sacks"])] for s, r in sack_leaders.iterrows()},
})

peak_pass = int(pass_tg.idxmax())
assert peak_pass == 2015 and pass_tg.idxmin() == LAST, "passing narrative (peak 2015, low in latest season) no longer holds"
assert c4000.idxmax() == 2016
assert int_tg.idxmax() == FIRST and int_tg.idxmin() == LAST
assert sack_rate[LAST] > sack_rate[FIRST]

# ------------------------------------------------------------------ sections
sections = []


def chart(kind, labels, datasets, fmt, y_title, height=320):
    ds = []
    for item in datasets:
        label, vals = item[0], item[1]
        e = {"label": label, "data": [round(float(v), 4) for v in vals]}
        if len(item) > 2:
            e["names"] = list(item[2])
        ds.append(e)
    return {"kind": kind, "labels": [str(x) for x in labels], "datasets": ds, "fmt": fmt, "yTitle": y_title, "height": height}


def add(theme, title, paras, spec, head, rows):
    sections.append({"theme": theme, "title": title, "paras": paras, "chart": spec, "head": head, "rows": rows})


min_rush, max_rush = rush_tg.min(), rush_tg.max()
add("Passing peaked, then slid",
    f"Passing peaked in {peak_pass} at {dec(pass_tg[peak_pass])} yards per team-game and has slid to {dec(pass_tg[LAST])} in {LAST}, while rushing stayed flat",
    [f"Adding up every player's passing yards and dividing by team-games, offenses averaged {dec(pass_tg[FIRST])} passing yards in "
     f"{FIRST}, climbed to {dec(pass_tg[peak_pass])} in {peak_pass}, and fell to {dec(pass_tg[LAST])} in {LAST}, the lowest of the "
     f"{len(SEASONS)} seasons. That is {pct(1 - pass_tg[LAST] / pass_tg[peak_pass])} below the peak.",
     f"Rushing barely moved. Rushing yards per team-game stayed between {dec(min_rush)} and {dec(max_rush)} every season, "
     f"and finished {LAST} at {dec(rush_tg[LAST])}. The slide is a passing story, not a running one."],
    chart("line", SEASONS, [("Passing yards per team-game", pass_tg), ("Rushing yards per team-game", rush_tg)], "yds", "Yards per team-game", 340),
    ["Season", "Team-games", "Passing yards per team-game", "Rushing yards per team-game"],
    [[int(s), num(team_games[s]), dec(pass_tg[s]), dec(rush_tg[s])] for s in SEASONS])

add("Passing peaked, then slid",
    f"Fewer quarterbacks reach 4,000 yards: {int(c4000[2016])} did in 2016, only {int(c4000[LAST])} in {LAST}",
    [f"A 4,000-yard passing season used to be common. In 2016, {int(c4000[2016])} quarterbacks got there, the most of any season. "
     + (f"It was {int(c4000[LAST])} in both {LAST - 1} and {LAST}." if c4000[LAST - 1] == c4000[LAST]
      else f"It was {int(c4000[LAST - 1])} in {LAST - 1} and {int(c4000[LAST])} in {LAST}."),
     "This counts each player's regular-season total for one season. Seasons were 16 games through 2020 and 17 from 2021, so "
     "counts from 2021 on have a little extra room to reach the threshold."],
    chart("bar", SEASONS, [("Players with 4,000+ passing yards", c4000)], "int", "Players"),
    ["Season", "Players with 4,000+ passing yards"], [[int(s), int(c4000[s])] for s in SEASONS])

hi = ps.sort_values("rushing_yards", ascending=False)
add("The running back roller coaster",
    f"1,000-yard rushers swing widely, from {int(c1000.min())} in some seasons to {int(c1000.max())} in others",
    [f"The number of players who ran for 1,000 yards in a season was {int(c1000[2010])} in 2010, fell to {int(c1000[2015])} in 2015 "
     f"and {int(c1000[2021])} in 2021, then came back to {int(c1000[LAST - 1])} in {LAST - 1} and {int(c1000[LAST])} in {LAST}.",
     f"There is no steady trend to explain it. The count is lowest in {', '.join(str(int(s)) for s in c1000[c1000 == c1000.min()].index)} "
     f"({int(c1000.min())}) and highest in {', '.join(str(int(s)) for s in c1000[c1000 == c1000.max()].index)} ({int(c1000.max())})."],
    chart("bar", SEASONS, [("Players with 1,000+ rushing yards", c1000)], "int", "Players"),
    ["Season", "Players with 1,000+ rushing yards"], [[int(s), int(c1000[s])] for s in SEASONS])

add("The running back roller coaster",
    f"The workhorse back nearly disappeared, then returned: {int(c300[FIRST])} backs had 300+ carries in {FIRST}, {int(c300[2023])} in 2023, {int(c300[2024])} in 2024",
    [f"A 300-carry season was more common early on: {int(c300[FIRST])} players in {FIRST} and {int(c300[2010])} in 2010. From 2013 to 2022 "
     f"the count never passed {int(c300.loc[2013:2022].max())}, and in 2023 it fell to {int(c300[2023])}.",
     f"It came back in 2024 with {int(c300[2024])} players, then {int(c300[LAST])} in {LAST}. The counts are small, so one or two "
     f"bell-cow backs make a visible difference."],
    chart("bar", SEASONS, [("Players with 300+ carries", c300)], "int", "Players"),
    ["Season", "Players with 300+ carries"], [[int(s), int(c300[s])] for s in SEASONS])

add("Receivers pile up catches",
    f"100-catch seasons climbed from {int(c100rec[2010])} in 2010 to {int(c100rec.max())} at the peak, even though team passing yards were below their {peak_pass} high",
    [f"Only {int(c100rec[2010])} players caught 100 passes in 2010. The count reached {int(c100rec.max())} in "
     f"{', '.join(str(int(s)) for s in c100rec[c100rec == c100rec.max()].index)} and was {int(c100rec[LAST])} in {LAST}.",
     "These are counts of individual players, so a few high-volume receivers can move the number from one season to the next."],
    chart("bar", SEASONS, [("Players with 100+ receptions", c100rec)], "int", "Players"),
    ["Season", "Players with 100+ receptions"], [[int(s), int(c100rec[s])] for s in SEASONS])

add("Defenses: fewer takeaways, more pressure",
    f"Interceptions are disappearing: {dec(int_tg[FIRST], 2)} per team-game in {FIRST}, {dec(int_tg[LAST], 2)} in {LAST}",
    [f"Defenses came up with {dec(int_tg[FIRST], 3)} interceptions per team-game in {FIRST}. By {LAST} that had fallen to "
     f"{dec(int_tg[LAST], 3)}, a drop of {pct(1 - int_tg[LAST] / int_tg[FIRST], 0)}.",
     "The decline is gradual, with no single-season cliff. The data cannot say why it happened."],
    chart("line", SEASONS, [("Interceptions per team-game", int_tg)], "dec3", "Interceptions per team-game"),
    ["Season", "Interceptions", "Interceptions per team-game"],
    [[int(s), num(by_season.loc[s, "def_interceptions"]), dec(int_tg[s], 3)] for s in SEASONS])

add("Defenses: fewer takeaways, more pressure",
    f"Players with 6+ interceptions almost vanished: {int(c6int[FIRST])} in {FIRST}, {int(c6int[LAST])} in {LAST}",
    [f"In {FIRST}, {int(c6int[FIRST])} defenders had six or more interceptions. By 2013 it was {int(c6int[2013])}, and in {LAST} only "
     f"{int(c6int[LAST])} player did it.",
     f"The season high in the data is {int(ps['def_interceptions'].max())} interceptions, by "
     f"{ps.sort_values(['def_interceptions', 'player_name'], ascending=[False, True]).iloc[0]['player_name']} in "
     f"{int(ps.sort_values(['def_interceptions', 'player_name'], ascending=[False, True]).iloc[0]['season'])}."],
    chart("bar", SEASONS, [("Players with 6+ interceptions", c6int)], "int", "Players"),
    ["Season", "Players with 6+ interceptions"], [[int(s), int(c6int[s])] for s in SEASONS])

add("Defenses: fewer takeaways, more pressure",
    f"Pass rushes get home more often: sacks per pass attempt rose from {pct(sack_rate[FIRST])} in {FIRST} to {pct(sack_rate[LAST])} in {LAST}",
    [f"Dividing sacks by pass attempts, the sack rate was {pct(sack_rate[FIRST], 2)} in {FIRST} and {pct(sack_rate[LAST], 2)} in {LAST}. "
     f"It peaked at {pct(sack_rate.max(), 2)} in {int(sack_rate.idxmax())}.",
     "Sacks are not counted in pass attempts, so this rate is sacks per attempt, not per dropback. Defenses are taking the ball away "
     "less but reaching the quarterback more."],
    chart("line", SEASONS, [("Sacks per pass attempt", sack_rate)], "pct", "Sacks per pass attempt"),
    ["Season", "Sacks", "Pass attempts", "Sacks per pass attempt"],
    [[int(s), dec(by_season.loc[s, "def_sacks"]), num(by_season.loc[s, "attempts"]), pct(sack_rate[s], 2)] for s in SEASONS])

watt = hits[hits["player_name"] == "J.J. Watt"]
add("Defenses: fewer takeaways, more pressure",
    f"J.J. Watt owns {len(watt)} of the {len(hits)} biggest QB-hit seasons, led by {dec(watt['def_qb_hits'].max(), 0)} in {int(watt.sort_values('def_qb_hits', ascending=False).iloc[0]['season'])}",
    [f"The top 10 single seasons for quarterback hits include {len(watt)} by J.J. Watt, in " +
     ", ".join(f"{int(r.season)} ({int(r.def_qb_hits)})" for r in watt.sort_values("season").itertuples()) +
     f". The record in the data is {int(hits.iloc[0]['def_qb_hits'])}.",
     "The source does not say how consistently QB hits were recorded over time, so treat this as a ranking of recorded hits, "
     "not a full count of pressure."],
    chart("hbar", [f"{r.player_name} {int(r.season)}" for r in hits.itertuples()], [("QB hits", hits["def_qb_hits"])], "int", "QB hits in the season", 400),
    ["Player", "Season", "QB hits"], [[r.player_name, int(r.season), int(r.def_qb_hits)] for r in hits.itertuples()])

leaders = pd.DataFrame({"season": SEASONS, "name": [sack_leaders.loc[s, "player_name"] for s in SEASONS],
                        "sacks": [sack_leaders.loc[s, "def_sacks"] for s in SEASONS]})
watt_led = int((leaders["name"] == "T.J. Watt").sum())
low, high = leaders.loc[leaders["sacks"].idxmin()], leaders.loc[leaders["sacks"].idxmax()]
add("Defenses: fewer takeaways, more pressure",
    f"The sack leader each season ranged from {dec(low['sacks'])} ({low['name']}, {int(low['season'])}) to {dec(high['sacks'])} ({high['name']}, {int(high['season'])})",
    [f"Every season has one clear sack leader, with no ties. The lowest leading total was {dec(low['sacks'])} by {low['name']} in "
     f"{int(low['season'])}. The highest was {dec(high['sacks'])} by {high['name']} in {int(high['season'])}.",
     f"T.J. Watt led the league in {watt_led} of the {len(SEASONS)} seasons. Hover a bar to see who led that season."],
    chart("bar", SEASONS, [("Sacks by the leader", leaders["sacks"], leaders["name"])], "dec1", "Sacks by that season's leader"),
    ["Season", "Leader", "Sacks"], [[int(r.season), r.name, dec(r.sacks)] for r in leaders.itertuples()])

R["watt_hits_top10"] = int(len(watt))
R["watt_led_sacks"] = watt_led

# ------------------------------------------------------------------ write report.json
with open("data/report.json", "w") as f:
    json.dump(R, f, indent=1, sort_keys=True)


# ------------------------------------------------------------------ HTML
def esc(x):
    return html.escape(str(x))


def table_html(head, rows):
    th = "".join(f"<th>{esc(h)}</th>" for h in head)
    body = "".join("<tr>" + "".join(f"<td>{esc(c)}</td>" for c in r) + "</tr>" for r in rows)
    return f'<div class="tablewrap"><table class="data"><thead><tr>{th}</tr></thead><tbody>{body}</tbody></table></div>'


sec_html = []
for i, s in enumerate(sections, 1):
    spec = json.dumps(s["chart"], separators=(",", ":"))
    paras = "".join(f"<p>{esc(p)}</p>" for p in s["paras"])
    sec_html.append(f"""
  <section class="finding" id="f{i}">
    <div class="finding-text">
      <span class="eyebrow">Finding {i:02d} &middot; {esc(s['theme'])}</span>
      <h2>{esc(s['title'])}</h2>
      {paras}
    </div>
    <figure class="card chart-card">
      <div class="chart-box" style="height:{s['chart']['height']}px"><canvas data-chart='{esc(spec)}' role="img" aria-label="{esc(s['title'])}"></canvas></div>
      <details class="numbers"><summary>View the numbers</summary>{table_html(s['head'], s['rows'])}</details>
    </figure>
  </section>""")

kpis = [
    (num(R["reg_rows"]), "Regular-season player-games analyzed"),
    (num(R["reg_players"]), "Different players"),
    (f"{dec(pass_tg[peak_pass])}", f"Peak passing yards per team-game ({peak_pass})"),
    (f"{dec(pass_tg[LAST])}", f"Passing yards per team-game in {LAST}"),
    (f"{int(c1000.min())} to {int(c1000.max())}", "Range of 1,000-yard rushers per season"),
    (f"-{pct(1 - int_tg[LAST] / int_tg[FIRST], 0)}", f"Interceptions per team-game, {FIRST} to {LAST}"),
]
kpi_html = "".join(f'<div class="kpi card"><div class="kpi-value">{esc(v)}</div><div class="kpi-label">{esc(l)}</div></div>' for v, l in kpis)

log_lines = [l for l in open("data/player_build_log.txt").read().strip().splitlines() if l.startswith(("Dropped", "Loaded", "Kept", "Column"))]
log_html = "".join(f"<li>{esc(l)}</li>" for l in log_lines)

page = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>NFL Player Stats Report, {FIRST} to {LAST}</title>
<meta name="description" content="What {num(R['reg_rows'])} NFL player-games say about passing, rushing, receiving and defense from {FIRST} to {LAST}.">
<link rel="stylesheet" href="assets/css/style.css">
<script>try{{var t=localStorage.getItem('theme');if(t)document.documentElement.dataset.theme=t;}}catch(e){{}}</script>
</head>
<body>
<div class="ambient" aria-hidden="true"></div>
<div class="grain" aria-hidden="true"></div>
<nav class="nav">
  <a class="brand" href="index.html"><span class="brand-dot"></span>NFL <em>Player Stats</em></a>
  <div class="nav-links">
    <a href="index.html" aria-current="page">Report</a>
    <a href="dashboard.html">Dashboard</a>
    <button class="theme-toggle" id="theme-toggle" aria-label="Toggle light and dark theme">&#9681;</button>
  </div>
</nav>

<header class="hero">
  <span class="eyebrow">Financial Data Analytics &middot; Data Website Project</span>
  <h1>NFL player stats, {FIRST} to {LAST}: passing <em>peaked</em>, defenses changed</h1>
  <p class="byline">By Rykar Acebo</p>
  <p class="lede">This report covers {num(R['reg_rows'])} regular-season player-games from the {FIRST} through {LAST} NFL seasons, taken from
  the nflverse weekly player stats. It looks at seasons and games rather than careers, so the start of the data never cuts a
  player off. Passing yards per team-game peaked in {peak_pass} at {dec(pass_tg[peak_pass])} and fell to {dec(pass_tg[LAST])} by
  {LAST}, while rushing stayed flat. Defenses tell the matching story: interceptions per team-game fell {pct(1 - int_tg[LAST] / int_tg[FIRST], 0)} while sacks per pass
  attempt rose. The dashboard lets you filter the same data, chase advanced stats like EPA per dropback and CPOE, and look up any player.</p>
  <a class="btn" href="dashboard.html">Open the dashboard &rarr;</a>
</header>

<main>
  <section class="kpis" aria-label="Headline numbers">{kpi_html}</section>
  {''.join(sec_html)}

  <section class="finding data-section" id="data">
    <div class="finding-text wide">
      <span class="eyebrow">About the data</span>
      <h2>Where the numbers come from and how they are computed</h2>
      <p><strong>Source.</strong> The <a href="https://github.com/nflverse/nflverse-data/releases/tag/stats_player">nflverse-data
      <code>stats_player</code> release</a>: weekly player stats, one file per season, licensed CC-BY-4.0. Credit to the nflverse
      project and its contributors. Definitions of the advanced columns come from the nflverse player stats data dictionary.</p>
      <p><strong>What one row is.</strong> One row is one player in one game. The cleaned data has {num(len(d))} rows and
      {len(d.columns)} columns for {len(SEASONS)} seasons ({FIRST} to {LAST}), {d['player_id'].nunique():,} players and
      {d['team'].nunique()} teams. The time column is season (and week) and the group columns are player and team. This report and
      the dashboard's starting view use regular-season rows only, which is {num(R['reg_rows'])} of them; playoffs can be added
      with the dashboard's season-type filter.</p>
      <p><strong>Rows dropped and other cleaning.</strong></p>
      <ul>{log_html}</ul>
      <p>Tackles for loss are not recorded in 2009 to 2011 and are left blank (not zero) there. Player names are not unique,
      so players are identified by <code>player_id</code>. Full details are in <code>data/DATA_QUALITY.md</code> and
      <code>data/DATA_DICTIONARY.md</code>.</p>
      <p><strong>How every number is computed.</strong></p>
      <ul>
        <li><strong>Team-game:</strong> one team in one game. Per-team-game rates add up every player's stat for the season and
        divide by the number of regular-season team-games (32 teams, 16 games each through 2020, 17 from 2021, with one fewer game
        in 2022).</li>
        <li><strong>Player-season counts</strong> (4,000-yard passers, 1,000-yard rushers, 300-carry backs, 100-catch receivers,
        players with 6+ interceptions): each player's regular-season total for one season is compared to the threshold, and players
        who met it are counted once. A player who changed teams has one total across teams.</li>
        <li><strong>Interceptions per team-game</strong> is defensive interceptions divided by team-games.</li>
        <li><strong>Sacks per pass attempt</strong> is defensive sacks (halves count) divided by pass attempts. Sacks are not part of
        attempts.</li>
        <li><strong>QB hits and sack leaders</strong> are single-season player totals. Ranking ties are broken by player name.
        No two players tied for the sack lead in any season.</li>
        <li><strong>Advanced stats on the dashboard:</strong> EPA per dropback is passing EPA divided by attempts plus sacks. ANY/A is
        (passing yards + 20 x touchdowns - 45 x interceptions + sack yards lost) divided by (attempts + sacks), with sack yards
        stored as negatives. CPOE is each game's CPOE weighted by that game's attempts. RACR is receiving yards divided by receiving
        air yards. Target share, air-yards share and WOPR are averages over games in which the player was targeted. Each dashboard
        measure states its definition under the chart.</li>
      </ul>
      <p><strong>Limits.</strong> Stats are only as good as the source; tackles depend on stat-crew scoring and are not used here.
      Metrics that need play-by-play, Next Gen Stats or Pro Football Reference data (EPA allowed, pressure rate, time to throw,
      missed tackles) are not in this dataset. Reasons for the trends, such as rule changes, are outside the data and are not tested here.</p>
      <p>Every number on this page is computed by <code>scripts/build_report.py</code> from <code>data/seasons/</code>, and
      <code>scripts/check_numbers.js</code> recomputes them with the dashboard's own code.</p>
    </div>
  </section>
</main>

<footer class="footer">Data: <a href="https://github.com/nflverse/nflverse-data">nflverse</a> (CC-BY-4.0) &middot; Plain HTML, CSS and JavaScript &middot; <a href="dashboard.html">Dashboard</a></footer>
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"></script>
<script src="assets/js/charts.js"></script>
<script src="assets/js/report.js"></script>
</body>
</html>
"""
with open("index.html", "w") as f:
    f.write(page)
print(f"Wrote index.html ({len(sections)} findings) and data/report.json")
for s in sections:
    print("-", s["title"])
