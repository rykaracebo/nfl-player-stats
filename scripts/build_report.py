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
d[NUMERIC] = d[NUMERIC].fillna(0)  # blank = 0; NA = no value in the source, which adds nothing to a sum
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
team_hits = reg.groupby(["season", "player_id", "team"], as_index=False).agg(qb_hits=("def_qb_hits", "sum"), first=("week", "min"))
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


def seg_chart(labels, items, fmt, height=320, kind="hbar", names=None):
    """Bars split into team segments. items: (bar total, [(team, own_value, share), ...]) per bar. names adds the player to the hover."""
    n_seg = max(len(parts) for _, parts in items)
    datasets = []
    for j in range(n_seg):
        data, teams, tips = [], [], []
        for total, parts in items:
            if j < len(parts):
                team, own, share = parts[j]
                data.append(round(float(share * total), 4)); teams.append(team)
                who = names[len(data) - 1] if names else None
                label = f"{who} ({team})" if who else team  # always "Name (TEAM)", never "Name, TEAM"
                text = f"{label}: {own:,.0f}" if fmt == "int" else f"{label}: {own:,.1f}"
                tips.append(text + (f" ({round(share * 100)}% of his workload)" if len(parts) > 1 else ""))
            else:
                data.append(0); teams.append(None); tips.append(None)
        datasets.append({"label": f"Team {j + 1}", "data": data, "barTeams": teams, "tips": tips})
    return {"kind": kind, "stacked": True, "labels": [str(x) for x in labels], "datasets": datasets, "fmt": fmt, "yTitle": "", "height": height}


BLOCKS = {}


def player_blocks(key, col, threshold, unit, height=340):
    """A season-count bar drawn as a stack of blocks, one per player who reached the threshold, colored by his team.
    A player who changed teams that season gets a block split between the teams by each team's share of the stat."""
    df = ps[ps[col] >= threshold]
    tt = reg.groupby(["season", "player_id", "team"], as_index=False).agg(v=(col, "sum"), first=("week", "min"))
    tt = {k: g.sort_values("first") for k, g in tt.groupby(["season", "player_id"])}
    per_season, listing = {}, {}
    for sn in SEASONS:
        blocks = []
        for r in df[df["season"] == sn].sort_values([col, "player_name"], ascending=[False, True]).itertuples():
            g = tt[(sn, r.player_id)]; tot = float(g["v"].sum())
            blocks.append({"name": r.player_name, "value": float(getattr(r, col)),
                           "parts": [(t.team, float(t.v), float(t.v) / tot if tot > 0 else 1 / len(g)) for t in g.itertuples()]})
        per_season[int(sn)] = blocks
        listing[int(sn)] = "; ".join(f"{b['name']} ({'/'.join(p[0] for p in b['parts'])}) {b['value']:,.0f}" for b in blocks)
    BLOCKS[key] = {str(sn): [[b["name"], b["value"]] for b in bl] for sn, bl in per_season.items()}
    n_blocks = max(len(b) for b in per_season.values()); n_parts = max(len(bl["parts"]) for b in per_season.values() for bl in b)
    datasets = []
    for j in range(n_blocks):
        for k in range(n_parts):
            data, teams, tips = [], [], []
            for sn in SEASONS:
                bl = per_season[int(sn)]
                if j < len(bl) and k < len(bl[j]["parts"]):
                    b = bl[j]; team, v, share = b["parts"][k]
                    data.append(round(share, 4)); teams.append(team)
                    tips.append(f"{b['name']} ({team}): {b['value']:,.0f} {unit}" if len(b["parts"]) == 1
                                else f"{b['name']} ({team}): {v:,.0f} of his {b['value']:,.0f} {unit}")
                else:
                    data.append(0); teams.append(None); tips.append(None)
            datasets.append({"label": f"Block {j + 1}.{k + 1}", "data": data, "barTeams": teams, "tips": tips})
    spec = {"kind": "bar", "stacked": True, "labels": [str(x) for x in SEASONS], "datasets": datasets, "fmt": "int", "yTitle": "", "height": height}
    return spec, listing


def add(theme, title, paras, spec, head, rows):
    if spec.get("stacked") and spec["datasets"] and str(spec["datasets"][0]["label"]).startswith("Block"):
        paras = paras[:-1] + [paras[-1] + " Each block in the chart is one player, colored by his team; hover a block to see who."]
    sections.append({"theme": theme, "title": title, "paras": paras, "chart": spec, "head": head, "rows": rows})


BLK = {key: player_blocks(key, col, thr, unit) for _, _, key, col, thr, unit in [("", "", "pass4000", "passing_yards", 4000, "passing yards"), ("", "", "rush1000", "rushing_yards", 1000, "rushing yards"), ("", "", "carries300", "carries", 300, "carries"), ("", "", "rec100", "receptions", 100, "receptions"), ("", "", "int6", "def_interceptions", 6, "interceptions")]}
R["blocks"] = BLOCKS

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
    BLK["pass4000"][0],
    ["Season", "Players with 4,000+ passing yards", "Who (team) and total"], [[int(s), int(c4000[s]), BLK["pass4000"][1][int(s)]] for s in SEASONS])

hi = ps.sort_values("rushing_yards", ascending=False)
add("The running back roller coaster",
    f"1,000-yard rushers swing widely, from {int(c1000.min())} in some seasons to {int(c1000.max())} in others",
    [f"The number of players who ran for 1,000 yards in a season was {int(c1000[2010])} in 2010, fell to {int(c1000[2015])} in 2015 "
     f"and {int(c1000[2021])} in 2021, then came back to {int(c1000[LAST - 1])} in {LAST - 1} and {int(c1000[LAST])} in {LAST}.",
     f"There is no steady trend to explain it. The count is lowest in {', '.join(str(int(s)) for s in c1000[c1000 == c1000.min()].index)} "
     f"({int(c1000.min())}) and highest in {', '.join(str(int(s)) for s in c1000[c1000 == c1000.max()].index)} ({int(c1000.max())})."],
    BLK["rush1000"][0],
    ["Season", "Players with 1,000+ rushing yards", "Who (team) and total"], [[int(s), int(c1000[s]), BLK["rush1000"][1][int(s)]] for s in SEASONS])

add("The running back roller coaster",
    f"The workhorse back nearly disappeared, then returned: {int(c300[FIRST])} backs had 300+ carries in {FIRST}, {int(c300[2023])} in 2023, {int(c300[2024])} in 2024",
    [f"A 300-carry season was more common early on: {int(c300[FIRST])} players in {FIRST} and {int(c300[2010])} in 2010. From 2013 to 2022 "
     f"the count never passed {int(c300.loc[2013:2022].max())}, and in 2023 it fell to {int(c300[2023])}.",
     f"It came back in 2024 with {int(c300[2024])} players, then {int(c300[LAST])} in {LAST}. The counts are small, so one or two "
     f"bell-cow backs make a visible difference."],
    BLK["carries300"][0],
    ["Season", "Players with 300+ carries", "Who (team) and total"], [[int(s), int(c300[s]), BLK["carries300"][1][int(s)]] for s in SEASONS])

add("Receivers pile up catches",
    f"100-catch seasons climbed from {int(c100rec[2010])} in 2010 to {int(c100rec.max())} at the peak, even though team passing yards were below their {peak_pass} high",
    [f"Only {int(c100rec[2010])} players caught 100 passes in 2010. The count reached {int(c100rec.max())} in "
     f"{', '.join(str(int(s)) for s in c100rec[c100rec == c100rec.max()].index)} and was {int(c100rec[LAST])} in {LAST}.",
     "These are counts of individual players, so a few high-volume receivers can move the number from one season to the next."],
    BLK["rec100"][0],
    ["Season", "Players with 100+ receptions", "Who (team) and total"], [[int(s), int(c100rec[s]), BLK["rec100"][1][int(s)]] for s in SEASONS])

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
    BLK["int6"][0],
    ["Season", "Players with 6+ interceptions", "Who (team) and total"], [[int(s), int(c6int[s]), BLK["int6"][1][int(s)]] for s in SEASONS])

add("Defenses: fewer takeaways, more pressure",
    f"Pass rushes get home more often: sacks per pass attempt rose from {pct(sack_rate[FIRST])} in {FIRST} to {pct(sack_rate[LAST])} in {LAST}",
    [f"Dividing sacks by pass attempts, the sack rate was {pct(sack_rate[FIRST], 2)} in {FIRST} and {pct(sack_rate[LAST], 2)} in {LAST}. "
     f"It peaked at {pct(sack_rate.max(), 2)} in {int(sack_rate.idxmax())}.",
     "Sacks are not counted in pass attempts, so this rate is sacks per attempt, not per dropback. Defenses are taking the ball away "
     "less but reaching the quarterback more."],
    chart("line", SEASONS, [("Sacks per pass attempt", sack_rate)], "pct", "Sacks per pass attempt"),
    ["Season", "Sacks", "Pass attempts", "Sacks per pass attempt"],
    [[int(s), dec(by_season.loc[s, "def_sacks"]), num(by_season.loc[s, "attempts"]), pct(sack_rate[s], 2)] for s in SEASONS])

HIT_PARTS = {}
for r in hits.itertuples():
    td = team_hits[(team_hits["season"] == r.season) & (team_hits["player_id"] == r.player_id)].sort_values("first")
    tot = float(td["qb_hits"].sum())
    HIT_PARTS[(r.season, r.player_id)] = (list(td["team"]), [(t.team, float(t.qb_hits), (float(t.qb_hits) / tot if tot > 0 else 1 / len(td))) for t in td.itertuples()])
R["qb_hits_top_parts"] = [[r.player_name, int(r.season), [[t, v] for t, v, _ in HIT_PARTS[(r.season, r.player_id)][1]]] for r in hits.itertuples()]

watt = hits[hits["player_name"] == "J.J. Watt"]
add("Defenses: fewer takeaways, more pressure",
    f"J.J. Watt owns {len(watt)} of the {len(hits)} biggest QB-hit seasons, led by {dec(watt['def_qb_hits'].max(), 0)} in {int(watt.sort_values('def_qb_hits', ascending=False).iloc[0]['season'])}",
    [f"The top 10 single seasons for quarterback hits include {len(watt)} by J.J. Watt, in " +
     ", ".join(f"{int(r.season)} ({int(r.def_qb_hits)})" for r in watt.sort_values("season").itertuples()) +
     f". The record in the data is {int(hits.iloc[0]['def_qb_hits'])}.",
     "The source does not say how consistently QB hits were recorded over time, so treat this as a ranking of recorded hits, "
     "not a full count of pressure."],
    seg_chart([f"{r.player_name} {int(r.season)} ({'/'.join(HIT_PARTS[(r.season, r.player_id)][0])})" for r in hits.itertuples()],
              [(float(r.def_qb_hits), HIT_PARTS[(r.season, r.player_id)][1]) for r in hits.itertuples()], "int", 400),
    ["Player", "Season", "Team", "QB hits"], [[r.player_name, int(r.season), "/".join(HIT_PARTS[(r.season, r.player_id)][0]), int(r.def_qb_hits)] for r in hits.itertuples()])

leaders = pd.DataFrame({"season": SEASONS, "name": [sack_leaders.loc[s, "player_name"] for s in SEASONS],
                        "sacks": [sack_leaders.loc[s, "def_sacks"] for s in SEASONS]})
team_sacks = reg.groupby(["season", "player_id", "team"], as_index=False).agg(sacks=("def_sacks", "sum"), first=("week", "min"))
LEADER_PARTS = {}
for sn in SEASONS:
    pid = sack_leaders.loc[sn, "player_id"]
    td = team_sacks[(team_sacks["season"] == sn) & (team_sacks["player_id"] == pid)].sort_values("first")
    tot = float(td["sacks"].sum())
    LEADER_PARTS[int(sn)] = [(t.team, float(t.sacks), float(t.sacks) / tot if tot > 0 else 1 / len(td)) for t in td.itertuples()]
R["sack_leader_parts"] = {str(k): [[t, v] for t, v, _ in parts] for k, parts in LEADER_PARTS.items()}
watt_led = int((leaders["name"] == "T.J. Watt").sum())
low, high = leaders.loc[leaders["sacks"].idxmin()], leaders.loc[leaders["sacks"].idxmax()]
add("Defenses: fewer takeaways, more pressure",
    f"The sack leader each season ranged from {dec(low['sacks'])} ({low['name']}, {int(low['season'])}) to {dec(high['sacks'])} ({high['name']}, {int(high['season'])})",
    [f"Every season has one clear sack leader, with no ties. The lowest leading total was {dec(low['sacks'])} by {low['name']} in "
     f"{int(low['season'])}. The highest was {dec(high['sacks'])} by {high['name']} in {int(high['season'])}.",
     f"T.J. Watt led the league in {watt_led} of the {len(SEASONS)} seasons. Each bar is colored by the leader's team, and a leader who "
     f"changed teams that season would show a bar split between them. Hover a bar to see who led."],
    seg_chart(SEASONS, [(float(r.sacks), LEADER_PARTS[int(r.season)]) for r in leaders.itertuples()], "dec1", 320, kind="bar", names=list(leaders["name"])),
    ["Season", "Leader", "Team", "Sacks"], [[int(r.season), r.name, "/".join(t for t, _, _ in LEADER_PARTS[int(r.season)]), dec(r.sacks)] for r in leaders.itertuples()])

# ------------------------------------------------------------------ reference values for the advanced dashboard measures
# Computed here with pandas so scripts/check_numbers.js can confirm the dashboard's own code gets the same answers.
g = reg.groupby("season")
adv = {}
dropbacks = g["attempts"].sum() + g["sacks_suffered"].sum()
adv["epa_db"] = series(g["passing_epa"].sum() / dropbacks)
adv["anya"] = series((g["passing_yards"].sum() + 20 * g["passing_tds"].sum() - 45 * g["passing_interceptions"].sum()
                      + g["sack_yards_lost"].sum()) / dropbacks)
reg["_cpoe_w"] = reg["passing_cpoe"] * reg["attempts"]
adv["cpoe"] = series(reg.groupby("season")["_cpoe_w"].sum() / g["attempts"].sum())
adv["racr"] = series(g["receiving_yards"].sum() / g["receiving_air_yards"].sum())
adv["epa_carry"] = series(g["rushing_epa"].sum() / g["carries"].sum())
targeted = reg[reg["targets"] > 0]
adv["target_share"] = series(targeted.groupby("season")["target_share"].mean())
made50 = g["fg_made_50_59"].sum() + g["fg_made_60_"].sum()
adv["fg_pct_50"] = series(made50 / (made50 + g["fg_missed_50_59"].sum() + g["fg_missed_60_"].sum()))
qb = reg.groupby(["season", "player_id", "player_name"], as_index=False).agg(
    pe=("passing_epa", "sum"), a=("attempts", "sum"), s=("sacks_suffered", "sum"))
qb = qb[qb["a"] + qb["s"] >= 200]
qb["v"] = qb["pe"] / (qb["a"] + qb["s"])
adv["top_epa_db"] = [[r.player_name, int(r.season), float(r.v)] for r in qb.sort_values(["v", "player_name"], ascending=[False, True]).head(10).itertuples()]
R["advanced"] = adv

# ------------------------------------------------------------------ EPA over replacement (this site's version)
# Rule (same as assets/js/stats.js): regular season, one position group at a time, rows filtered by position_group.
# Opportunities: QB = attempts + sacks + carries; RB/WR/TE = carries + targets. Per season, rank players by opportunities
# (ties: player_id), the first K are starters, the rest are the replacement pool. r = pool EPA / pool opportunities.
# EPAOR = EPA - r x opportunities.
K_START = {"QB": 32, "RB": 32, "WR": 64, "TE": 32}
EPA_COLS = {"QB": ["passing_epa", "rushing_epa"], "RB": ["rushing_epa", "receiving_epa"],
            "WR": ["rushing_epa", "receiving_epa"], "TE": ["rushing_epa", "receiving_epa"]}
OPP_COLS = {"QB": ["attempts", "sacks_suffered", "carries"], "RB": ["carries", "targets"],
            "WR": ["carries", "targets"], "TE": ["carries", "targets"]}


def epaor(pos):
    sub = reg[reg["position_group"] == pos].copy()
    sub["epa"] = sub[EPA_COLS[pos]].sum(axis=1)
    sub["opp"] = sub[OPP_COLS[pos]].sum(axis=1)
    pl = sub.groupby(["season", "player_id"], as_index=False).agg(
        name=("player_name", "first"), epa=("epa", "sum"), opp=("opp", "sum"), yards=("passing_yards", "sum"))
    pl = pl[pl["opp"] > 0]
    tdf = sub.groupby(["season", "player_id", "team"], as_index=False).agg(epa=("epa", "sum"), opp=("opp", "sum"), first=("week", "min"))
    out = {}
    for season, g in pl.groupby("season"):
        g = g.sort_values(["opp", "player_id"], ascending=[False, True]).reset_index(drop=True)
        pool, starters = g.iloc[K_START[pos]:], g.iloc[:K_START[pos]]
        r = pool["epa"].sum() / pool["opp"].sum() if pool["opp"].sum() > 0 else 0.0
        g["epaor"] = g["epa"] - r * g["opp"]
        out[int(season)] = {"r": float(r), "starter": float(starters["epa"].sum() / starters["opp"].sum()), "pool": int(len(pool)), "df": g, "teams": tdf[tdf["season"] == season]}
    return out


EPAOR = {pos: epaor(pos) for pos in K_START}
R["epaor"] = {pos: {str(s): {"r": v["r"], "starter": v["starter"], "pool": v["pool"],
                              "top5": [[r.name, float(r.epaor)] for r in v["df"].sort_values(["epaor", "name"], ascending=[False, True]).head(5).itertuples()]}
                    for s, v in EPAOR[pos].items()} for pos in K_START}

qb_all = pd.concat([v["df"] for v in EPAOR["QB"].values()], ignore_index=True)
qb_all["yards_rank"] = qb_all["yards"].rank(ascending=False, method="min")
top_epaor = qb_all.sort_values(["epaor", "name"], ascending=[False, True]).head(10)
top_yards = qb_all.sort_values(["yards", "name"], ascending=[False, True]).head(10)
key = lambda df: set(zip(df["season"], df["player_id"]))
overlap = len(key(top_epaor) & key(top_yards))
best = top_epaor.iloc[0]
EPA_PARTS = {}
for r in top_epaor.itertuples():
    season = int(r.season); rate = EPAOR["QB"][season]["r"]
    td = EPAOR["QB"][season]["teams"]; td = td[td["player_id"] == r.player_id].sort_values("first")
    tot_opp = float(td["opp"].sum())
    EPA_PARTS[(season, r.player_id)] = (list(td["team"]), [(t.team, float(t.epa - rate * t.opp), float(t.opp) / tot_opp) for t in td.itertuples()])
R["epaor_top10_parts"] = [[r.name, int(r.season), [[t, v] for t, v, _ in EPA_PARTS[(int(r.season), r.player_id)][1]]] for r in top_epaor.itertuples()]
R["epaor_overlap"] = overlap
add("Value over replacement",
    f"By expected points over replacement, {best['name']} in {int(best['season'])} was the best quarterback season, and only {overlap} of the top 10 also top the passing-yards list",
    [f"EPA over replacement (EPAOR) is the expected points a quarterback added beyond what a replacement-level passer would have added "
     f"on the same number of plays. The top season in {FIRST} to {LAST} is {best['name']} in {int(best['season'])} with {dec(best['epaor'])} points, "
     f"ranked {int(best['yards_rank'])} in passing yards.",
     f"Ranking all quarterback seasons by EPAOR and by passing yards, {overlap} of the top 10 seasons appear on both lists. Passing yards "
     f"reward volume; EPAOR also rewards efficiency and counts sacks, interceptions and scrambles. This is this site's own version of a "
     f"value-over-replacement stat, not a full WAR. The replacement rule is in the data section below."],
    seg_chart([f"{r.name} {int(r.season)} ({'/'.join(EPA_PARTS[(int(r.season), r.player_id)][0])})" for r in top_epaor.itertuples()],
              [(float(r.epaor), EPA_PARTS[(int(r.season), r.player_id)][1]) for r in top_epaor.itertuples()], "dec1", 420),
    ["Rank", "Player-season", "Team", "EPAOR", "Total EPA", "Opportunities", "Passing-yards rank"],
    [[i + 1, f"{r.name} {int(r.season)}", "/".join(EPA_PARTS[(int(r.season), r.player_id)][0]), dec(r.epaor), dec(r.epa), num(r.opp), int(r.yards_rank)] for i, r in enumerate(top_epaor.itertuples())])

qb_r = pd.Series({s: v["r"] for s, v in EPAOR["QB"].items()})
qb_st = pd.Series({s: v["starter"] for s, v in EPAOR["QB"].items()})
wr_r = pd.Series({s: v["r"] for s, v in EPAOR["WR"].items()})
above = int((qb_st > qb_r).sum())
add("Value over replacement",
    f"The replacement level for quarterbacks is below zero: {dec(qb_r.mean(), 3)} EPA per play on average, against {dec(qb_st.mean(), 3)} for starters",
    [f"Each season, the quarterbacks ranked below the top 32 by plays form the replacement pool. Their EPA per play averaged "
     f"{dec(qb_r.mean(), 3)}, from {dec(qb_r.min(), 3)} ({int(qb_r.idxmin())}) to {dec(qb_r.max(), 3)} ({int(qb_r.idxmax())}). The top 32 averaged "
     f"{dec(qb_st.mean(), 3)}, above the replacement level in {above} of {len(qb_r)} seasons.",
     f"The rate is noisy because the pool is made of players with few plays. For wide receivers, replacement level averaged "
     f"{dec(wr_r.mean(), 3)} EPA per opportunity, well above zero, so the bar differs by position "
     f"and EPAOR scores should only be compared within a position."],
    chart("line", SEASONS, [("Top 32 quarterbacks", qb_st), ("Replacement pool", qb_r)], "dec3", "EPA per play (attempts, sacks, carries)", 340),
    ["Season", "Pool size", "Replacement EPA per play", "Top 32 EPA per play"],
    [[int(s), EPAOR["QB"][s]["pool"], dec(qb_r[s], 3), dec(qb_st[s], 3)] for s in SEASONS])

R["watt_hits_top10"] = int(len(watt))
R["watt_led_sacks"] = watt_led

# ------------------------------------------------------------------ team summary for the field widget (data/team_summary.json)
team_games_by_team = reg[["game_id", "team"]].drop_duplicates().groupby("team").size()
tsum = reg.groupby("team")[["passing_yards", "rushing_yards", "def_sacks", "def_interceptions", "def_qb_hits", "penalties"]].sum()
TEAM_MEASURES = [("pass_yds_tg", "Passing yards per game", 1, "passing_yards"), ("rush_yds_tg", "Rushing yards per game", 1, "rushing_yards"),
                 ("sacks_tg", "Sacks per game (its defense)", 2, "def_sacks"), ("ints_tg", "Interceptions per game (its defense)", 2, "def_interceptions"),
                 ("qb_hits_tg", "QB hits per game (its defense)", 2, "def_qb_hits"), ("pen_tg", "Penalties per game", 2, "penalties")]
team_summary = {
    "scope": f"Regular season {FIRST} to {LAST}, per team-game",
    "measures": [{"id": i, "label": l, "digits": dg} for i, l, dg, _ in TEAM_MEASURES],
    "teams": {t: {"games": int(team_games_by_team[t]), **{i: float(tsum.loc[t, c] / team_games_by_team[t]) for i, _, _, c in TEAM_MEASURES}}
              for t in tsum.index},
}
with open("data/team_summary.json", "w") as f:
    json.dump(team_summary, f, indent=1, sort_keys=True)
R["team_summary"] = team_summary["teams"]

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
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 52 32'%3E%3Cellipse cx='26' cy='16' rx='25' ry='15' fill='%238a3f12'/%3E%3Cpath d='M16 16H36M20 11.5V20.5M26 11.5V20.5M32 11.5V20.5' stroke='white' stroke-width='3' stroke-linecap='round'/%3E%3C/svg%3E">
<script>try{{var t=localStorage.getItem('theme');if(t)document.documentElement.dataset.theme=t;}}catch(e){{}}</script>
</head>
<body>
<div class="ambient" aria-hidden="true"></div>
<div class="grain" aria-hidden="true"></div>
<nav class="nav">
  <a class="brand" href="index.html"><svg class="brand-ball" viewBox="0 0 52 32" aria-hidden="true"><ellipse cx="26" cy="16" rx="25" ry="15" fill="#8a3f12" stroke="#4d1e06" stroke-width="2"/><g stroke="#fff" stroke-width="2.6" stroke-linecap="round" fill="none"><path d="M8 8Q6 16 8 24M44 8Q46 16 44 24"/><path d="M16 16H36M20 11.5V20.5M26 11.5V20.5M32 11.5V20.5"/></g></svg>NFL <em>Player Stats</em></a>
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
  attempt rose. A last pair of findings uses a value-over-replacement stat built for this site. The dashboard lets you filter the same data, switch between player and team views, and chase advanced stats like EPA per dropback and CPOE.</p>
  <a class="btn" href="dashboard.html">Open the dashboard &rarr;</a>
</header>

<section class="fieldcard card" id="field-root" aria-label="Team explorer"></section>

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
      <p>Tackles for loss are not recorded in 2009 to 2011 and are marked NA (not zero) there. More generally, NA means the source has no value for that player in that game (for example, no pass attempts means no passing EPA); sums skip NA. Player names are not unique,
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
        <li><strong>EPA over replacement (EPAOR, this site's version):</strong> regular season only, one position group at a time
        (quarterbacks, running backs, wide receivers, tight ends). Opportunities are attempts + sacks + carries for quarterbacks and
        carries + targets for the others. Each season players are ranked by opportunities (ties by player ID); the top 32 quarterbacks,
        32 running backs, 64 wide receivers and 32 tight ends are the starters and everyone below them is the replacement pool.
        The replacement rate r is the pool's total EPA divided by the pool's opportunities, and EPAOR = a player's EPA - r x opportunities.
        The cutoffs are a judgment call, not nflWAR's. Scores are in expected points, not wins, and are only comparable within a position.
        A pass's EPA appears under both the passer and the receiver, so EPA must not be added across players.</li>
      </ul>
      <p><strong>Limits.</strong> Stats are only as good as the source; tackles depend on stat-crew scoring and are not used here.
      Metrics that need play-by-play, Next Gen Stats or Pro Football Reference data (EPA allowed, pressure rate, time to throw,
      missed tackles) are not in this dataset. Reasons for the trends, such as rule changes, are outside the data and are not tested here.</p>
      <p>Every number on this page is computed by <code>scripts/build_report.py</code> from <code>data/seasons/</code>, and
      <code>scripts/check_numbers.js</code> recomputes them with the dashboard's own code.</p>
    </div>
  </section>
</main>

<footer class="footer">Data: <a href="https://github.com/nflverse/nflverse-data">nflverse</a> (CC-BY-4.0) &middot; Plain HTML, CSS and JavaScript &middot; <a href="dashboard.html">Dashboard</a><br>This is an unofficial, non-commercial student project. The NFL name and shield and the team names and logos belong to the NFL and its teams. They appear here only to identify the league and teams, are loaded from links in the nflverse teams file, and are not stored in this repository.</footer>
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"></script>
<script src="assets/js/charts.js"></script>
<script src="assets/js/teams.js"></script>
<script src="assets/js/field.js"></script>
<script src="assets/js/report.js"></script>
</body>
</html>
"""
with open("index.html", "w") as f:
    f.write(page)
print(f"Wrote index.html ({len(sections)} findings) and data/report.json")
for s in sections:
    print("-", s["title"])
