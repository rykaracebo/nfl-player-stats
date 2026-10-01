"""Build the NFL player-game dataset (2009 to latest season) from nflverse.

Source: nflverse-data release "stats_player", files stats_player_week_YYYY.csv.gz
        https://github.com/nflverse/nflverse-data/releases/tag/stats_player   (CC-BY-4.0)

One output row is one player in one game. Writes:
  data/seasons/player_games_YYYY.csv   one file per season (loaded by the dashboard)
  data/teams.csv                       team code -> name/city/conference/division
  data/manifest.json                   seasons, columns and row counts
  data/player_build_log.txt            every dropped or altered row, and why
  data/DATA_DICTIONARY.md              generated from COLUMNS below
  data/DATA_QUALITY.md                 coverage tables and checks, generated from the data

Run from the project root:  .venv/bin/python scripts/build_player_data.py
"""
import json
import os
import urllib.request

import pandas as pd

FIRST_SEASON, LAST_SEASON = 2009, 2025
URL = "https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_{}.csv.gz"
RAW, OUT = "data/raw/player_week", "data/seasons"

UNIT = {"QB": "Offense", "RB": "Offense", "WR": "Offense", "TE": "Offense", "OL": "Offense",
        "DL": "Defense", "LB": "Defense", "DB": "Defense", "SPEC": "Special teams"}

# (output name, source name, type, meaning, allowed values / notes)
KEYS = [
    ("player_id", "player_id", "text", "Stable player ID (GSIS ID from nflverse). The key for a player.", "e.g. 00-0033873"),
    ("player_name", "player_display_name", "text", "Player's display name. Not unique: 92 names belong to more than one player.", "use player_id to tell them apart"),
    ("position", "position", "category", "Listed position of the player.", "QB RB FB WR TE C G OT OL DE DT NT DL LB ILB MLB OLB CB S FS SAF DB K P LS"),
    ("position_group", "position_group", "category", "Position group from nflverse.", "QB RB WR TE OL DL LB DB SPEC"),
    ("unit", "derived", "category", "Offense, Defense or Special teams. QB RB WR TE OL are Offense; DL LB DB are Defense; SPEC (kickers, punters, long snappers) is Special teams.", "Offense, Defense, Special teams"),
    ("season", "season", "integer", "NFL season (year the season starts).", "2009 to 2025"),
    ("week", "week", "integer", "Week number within the season. Playoff weeks continue the count (18 to 21, or 19 to 22 from 2021).", "1 to 22"),
    ("season_type", "season_type", "category", "Regular season or playoffs.", "REG, POST"),
    ("game_id", "game_id", "text", "nflverse game ID (season_week_away_home).", "e.g. 2024_01_KC_BAL"),
    ("team", "team", "category", "Team the player played for in this game.", "32 team codes, see teams.csv"),
    ("opponent_team", "opponent_team", "category", "Opposing team in this game.", "32 team codes"),
]
STATS = [
    ("completions", "Passes completed."), ("attempts", "Passes attempted."),
    ("passing_yards", "Passing yards."), ("passing_tds", "Passing touchdowns."),
    ("passing_interceptions", "Interceptions thrown."), ("sacks_suffered", "Times sacked."),
    ("carries", "Rushing attempts."), ("rushing_yards", "Rushing yards."), ("rushing_tds", "Rushing touchdowns."),
    ("targets", "Times targeted on a pass."), ("receptions", "Passes caught."),
    ("receiving_yards", "Receiving yards."), ("receiving_tds", "Receiving touchdowns."),
    ("def_tackles_solo", "Solo tackles."), ("def_tackle_assists", "Assisted tackles."),
    ("def_tackles_for_loss", "Tackles for loss. Not recorded in 2009 to 2011."),
    ("def_sacks", "Sacks (halves are possible, e.g. 0.5)."), ("def_qb_hits", "Quarterback hits."),
    ("def_interceptions", "Interceptions made."), ("def_pass_defended", "Passes defended."),
    ("def_fumbles_forced", "Fumbles forced."), ("def_tds", "Defensive touchdowns."),
    ("punt_returns", "Punt returns."), ("punt_return_yards", "Punt return yards."),
    ("kickoff_returns", "Kickoff returns."), ("kickoff_return_yards", "Kickoff return yards."),
    ("fg_made", "Field goals made."), ("fg_att", "Field goals attempted."),
    ("pat_made", "Extra points made."), ("pat_att", "Extra points attempted."),
    ("pt_att", "Punts."), ("pt_yards", "Punt yards (gross)."),
    ("penalties", "Penalties committed."), ("fumbles_lost", "Fumbles lost (any type)."),
    ("fantasy_points_ppr", "Fantasy points, full-PPR scoring, as computed by nflverse. Rounded to 2 decimals."),
    # advanced columns (definitions from the nflverse player stats data dictionary)
    ("sack_yards_lost", "Yards lost on sacks suffered. Stored as a negative number."),
    ("passing_air_yards", "Passing air yards, including incomplete passes."),
    ("passing_yards_after_catch", "Yards after the catch on this player's completions (unofficial stat)."),
    ("passing_first_downs", "First downs on pass attempts."),
    ("passing_epa", "Total expected points added on pass attempts and sacks (qb_epa). Rounded to 3 decimals."),
    ("passing_cpoe", "Completion percentage over expected, in percentage points, for that game. Only meaningful for players who threw passes. Rounded to 3 decimals."),
    ("rushing_first_downs", "First downs on rush attempts."),
    ("rushing_epa", "Expected points added on rush attempts, including scrambles and kneel-downs. Rounded to 3 decimals."),
    ("receiving_air_yards", "Receiving air yards on targets, including incompletions."),
    ("receiving_yards_after_catch", "Yards after the catch on this player's receptions (unofficial stat)."),
    ("receiving_first_downs", "First downs on receptions."),
    ("receiving_epa", "Total EPA on plays where this player was targeted. Rounded to 3 decimals."),
    ("target_share", "Player's share of team targets in this game, from 0 to 1. Only meaningful when targets > 0."),
    ("air_yards_share", "Player's share of team air yards in this game, from 0 to 1. Only meaningful when targets > 0."),
    ("wopr", "Weighted opportunity rating: 1.5 x target_share + 0.7 x air_yards_share. Only meaningful when targets > 0."),
    ("fg_made_30_39", "Field goals made from 30 to 39 yards."), ("fg_made_40_49", "Field goals made from 40 to 49 yards."),
    ("fg_made_50_59", "Field goals made from 50 to 59 yards."), ("fg_made_60_", "Field goals made from 60 yards or more (a season with none is a real zero)."),
    ("fg_missed_30_39", "Field goals missed from 30 to 39 yards."), ("fg_missed_40_49", "Field goals missed from 40 to 49 yards."),
    ("fg_missed_50_59", "Field goals missed from 50 to 59 yards."), ("fg_missed_60_", "Field goals missed from 60 yards or more."),
]
SRC = {"fumbles_lost": "fumbles_lost_total"}
STAT_COLS = [s for s, _ in STATS]
COLUMNS = KEYS + [(s, SRC.get(s, s), "number", m, "blank = 0, NA = source has no value (no such play or role, or not recorded)") for s, m in STATS]

TEAMS = [  # code, city, name, conference, division  (codes as used by nflverse; Rams are LA)
    ("ARI", "Arizona", "Cardinals", "NFC", "West"), ("ATL", "Atlanta", "Falcons", "NFC", "South"),
    ("BAL", "Baltimore", "Ravens", "AFC", "North"), ("BUF", "Buffalo", "Bills", "AFC", "East"),
    ("CAR", "Carolina", "Panthers", "NFC", "South"), ("CHI", "Chicago", "Bears", "NFC", "North"),
    ("CIN", "Cincinnati", "Bengals", "AFC", "North"), ("CLE", "Cleveland", "Browns", "AFC", "North"),
    ("DAL", "Dallas", "Cowboys", "NFC", "East"), ("DEN", "Denver", "Broncos", "AFC", "West"),
    ("DET", "Detroit", "Lions", "NFC", "North"), ("GB", "Green Bay", "Packers", "NFC", "North"),
    ("HOU", "Houston", "Texans", "AFC", "South"), ("IND", "Indianapolis", "Colts", "AFC", "South"),
    ("JAX", "Jacksonville", "Jaguars", "AFC", "South"), ("KC", "Kansas City", "Chiefs", "AFC", "West"),
    ("LA", "Los Angeles", "Rams", "NFC", "West"), ("LAC", "Los Angeles", "Chargers", "AFC", "West"),
    ("LV", "Las Vegas", "Raiders", "AFC", "West"), ("MIA", "Miami", "Dolphins", "AFC", "East"),
    ("MIN", "Minnesota", "Vikings", "NFC", "North"), ("NE", "New England", "Patriots", "AFC", "East"),
    ("NO", "New Orleans", "Saints", "NFC", "South"), ("NYG", "New York", "Giants", "NFC", "East"),
    ("NYJ", "New York", "Jets", "AFC", "East"), ("PHI", "Philadelphia", "Eagles", "NFC", "East"),
    ("PIT", "Pittsburgh", "Steelers", "AFC", "North"), ("SEA", "Seattle", "Seahawks", "NFC", "West"),
    ("SF", "San Francisco", "49ers", "NFC", "West"), ("TB", "Tampa Bay", "Buccaneers", "NFC", "South"),
    ("TEN", "Tennessee", "Titans", "AFC", "South"), ("WAS", "Washington", "Commanders", "NFC", "East"),
]

TEAMS_URL = "https://github.com/nflverse/nflverse-data/releases/download/teams/teams_colors_logos.csv"

log = []


def note(msg):
    print(msg)
    log.append(msg)


def fetch(y):
    os.makedirs(RAW, exist_ok=True)
    path = f"{RAW}/stats_player_week_{y}.csv.gz"
    if not os.path.exists(path):
        print("downloading", y)
        urllib.request.urlretrieve(URL.format(y), path)
    return path


def fmt(series):
    """Blank for 0, integer text for whole numbers, short decimals otherwise, NA for missing."""
    def one(v):
        if pd.isna(v):
            return "NA"
        if v == 0:
            return ""
        return str(int(v)) if float(v).is_integer() else f"{v:.3f}".rstrip("0").rstrip(".")
    return series.map(one)


LOSS_COLS = [("def_sacks", "sacks"), ("def_interceptions", "interceptions"), ("def_tackles_solo", "solo tackles"),
             ("penalties", "penalties"), ("def_qb_hits", "QB hits"), ("passing_yards", "passing yards"),
             ("rushing_yards", "rushing yards"), ("receptions", "receptions")]


def describe_dropped(bad, kept):
    """Log what the rows with no player ID, name or position group are, and how much of each regular-season total they hold.
    Also writes data/dropped_rows.json, which scripts/build_report.py quotes in the report."""
    per_sw = bad.groupby(["season", "week"]).size()
    nonzero = int((bad.select_dtypes("number").drop(columns=["season", "week"]).fillna(0) != 0).any(axis=1).sum())
    short = bad["player_name"]
    info = {"raw_rows": int(len(bad) + len(kept)), "rows": int(len(bad)), "season_weeks": int(len(per_sw)), "max_per_season_week": int(per_sw.max()),
            "reg_rows": int((bad["season_type"] == "REG").sum()), "post_rows": int((bad["season_type"] != "REG").sum()),
            "no_short_name": int(short.isna().sum()), "short_name_team": int((short == "Team").sum()),
            "short_name_other": int((short.notna() & (short != "Team")).sum()),
            "with_team_code": int(bad["team"].notna().sum()), "nonzero_rows": nonzero,
            "seasons_min": int(bad.groupby("season").size().min()), "seasons_max": int(bad.groupby("season").size().max()),
            "reg_effect": {}}
    info["penalty_rows"] = int((bad["penalties"].fillna(0) > 0).sum())
    info["safety_rows"] = int((bad["def_safeties"].fillna(0) > 0).sum())
    br, kr = bad[bad["season_type"] == "REG"], kept[kept["season_type"] == "REG"]
    for col, label in LOSS_COLS:
        b, k = float(br[col].fillna(0).sum()), float(kr[col].fillna(0).sum())
        info["reg_effect"][label] = {"dropped": b, "kept": k}
    note(f"Dropped {info['rows']:,} rows with no player ID, name or position group. There is exactly one such row for each of the "
         f"{info['season_weeks']} season-weeks ({info['seasons_min']} to {info['seasons_max']} per season), each with a team code but no "
         f"player; {nonzero} of them have non-zero stats (mostly penalties and safeties).")
    note("Regular-season totals held in those dropped rows (dropped of dropped + kept): " + "; ".join(
        f"{lab} {v['dropped']:,.0f} of {v['dropped'] + v['kept']:,.0f}" for lab, v in info["reg_effect"].items()))
    return info


def write_dropped_info(info, zero_rows):
    """Adds the all-zero rows that were kept, then saves data/dropped_rows.json."""
    info["zero_rows"] = int(len(zero_rows))
    info["zero_reg_rows"] = int((zero_rows["season_type"] == "REG").sum())
    info["zero_players_only"] = int(len(set(zero_rows["player_id"]) - set(zero_rows.attrs["others"])))
    info["zero_by_group"] = {k: int(v) for k, v in zero_rows["position_group"].value_counts().items()}
    with open("data/dropped_rows.json", "w") as f:
        json.dump(info, f, indent=1, sort_keys=True)


def main():
    os.makedirs(OUT, exist_ok=True)
    frames = []
    for y in range(FIRST_SEASON, LAST_SEASON + 1):
        frames.append(pd.read_csv(fetch(y), low_memory=False))
    raw = pd.concat(frames, ignore_index=True)
    note(f"Loaded {len(raw):,} player-game rows from {FIRST_SEASON} to {LAST_SEASON} "
         f"({raw['season'].nunique()} seasons)")

    df = raw.copy()
    n = len(df)
    is_player = df["player_id"].notna() & df["player_display_name"].notna() & df["position_group"].notna()
    dropped_info = describe_dropped(raw[~is_player], raw[is_player])
    df = df[is_player]
    n = len(df)
    df = df[df["opponent_team"].notna()]
    note(f"Dropped {n - len(df):,} rows with no opponent team")
    n = len(df)
    df = df.drop_duplicates(["player_id", "game_id"])
    note(f"Dropped {n - len(df):,} duplicate player-game rows")

    df = df.drop(columns=["player_name"])  # the source's short name ("P.Mahomes"); keep the full display name
    df = df.rename(columns={"player_display_name": "player_name", "fumbles_lost_total": "fumbles_lost"})
    df["unit"] = df["position_group"].map(UNIT)
    unmapped = df["unit"].isna().sum()
    note(f"Rows with a position group outside the known nine: {unmapped}")
    df["fantasy_points_ppr"] = df["fantasy_points_ppr"].round(2)
    for c in ["passing_epa", "passing_cpoe", "rushing_epa", "receiving_epa", "target_share", "air_yards_share", "wopr"]:
        df[c] = df[c].round(3)

    # A stat with no non-zero value anywhere in a season was not tracked that season: mark NA, not 0.
    # Exception: 60+ yard field goals are rare enough that a season with none is a real zero.
    rare = {"fg_made_60_", "fg_missed_60_"}
    for c in [c for c in STAT_COLS if c not in rare]:
        for y, idx in df.groupby("season").groups.items():
            if (df.loc[idx, c].fillna(0) == 0).all():
                df.loc[idx, c] = float("nan")
                note(f"Column {c} has no non-zero value in {y}: written as NA (not recorded that season), not 0")

    note(f"sack_yards_lost: {int((df['sack_yards_lost'] > 0).sum())} rows with a positive value "
         f"(expected 0; the column is stored as a negative number)")
    z = (df[STAT_COLS].fillna(0) == 0).all(axis=1)
    zero_rows = df[z]
    zero_rows.attrs["others"] = list(df.loc[~z, "player_id"].unique())
    write_dropped_info(dropped_info, zero_rows)
    note(f"Kept {int(z.sum()):,} rows whose kept stat columns are all zero (player appears in the source game "
         f"record without a tracked stat here). They are real players with an ID, name and position, so they count as "
         f"appearances; they add nothing to any sum or rate.")

    # teams
    teams = pd.DataFrame(TEAMS, columns=["team", "city", "name", "conference", "division"])
    teams["full_name"] = teams["city"] + " " + teams["name"]
    # colors, logo links and the official conference and division come from the nflverse teams file
    os.makedirs(RAW, exist_ok=True)
    tpath = "data/raw/teams_colors_logos.csv"
    if not os.path.exists(tpath):
        urllib.request.urlretrieve(TEAMS_URL, tpath)
    src = pd.read_csv(tpath).set_index("team_abbr")
    diffs = []
    for i, r in teams.iterrows():
        sr = src.loc[r["team"]]
        if (sr["team_conf"], sr["team_division"].split()[-1]) != (r["conference"], r["division"]):
            diffs.append(f"{r['team']}: typed {r['conference']} {r['division']}, nflverse {sr['team_conf']} {sr['team_division']}")
        teams.loc[i, "conference"] = sr["team_conf"]
        teams.loc[i, "division"] = sr["team_division"].split()[-1]
        teams.loc[i, "full_name"] = sr["team_name"]
        teams.loc[i, "color"] = sr["team_color"]
        teams.loc[i, "color2"] = sr["team_color2"]
        teams.loc[i, "logo"] = sr["team_logo_espn"]
        teams.loc[i, "league_logo"] = sr["team_league_logo"]
    note(f"Conference and division checked against nflverse: {len(diffs)} differences" + (" (" + "; ".join(diffs) + ") - nflverse values used" if diffs else ""))
    known = set(teams["team"])
    bad = (set(df["team"]) | set(df["opponent_team"])) - known
    note(f"Team codes not in teams.csv: {sorted(bad) if bad else 'none'}. The source already uses one code per franchise "
         f"across relocations (Raiders LV, Chargers LAC, Rams LA), so no renaming was needed.")
    teams.to_csv("data/teams.csv", index=False)

    # write per-season files
    keys = [k[0] for k in KEYS]
    out_cols = keys + STAT_COLS
    df = df.sort_values(["season", "week", "game_id", "team", "position_group", "player_name"])
    manifest = {"source": "nflverse-data stats_player (CC-BY-4.0)", "columns": out_cols, "seasons": {}}
    total_bytes = 0
    for y, g in df.groupby("season"):
        w = g[out_cols].copy()
        for c in STAT_COLS:
            w[c] = fmt(w[c])
        path = f"{OUT}/player_games_{y}.csv"
        w.to_csv(path, index=False)
        size = os.path.getsize(path)
        total_bytes += size
        manifest["seasons"][int(y)] = {"file": path, "rows": len(w), "bytes": size}
    manifest["rows"] = len(df)
    with open("data/manifest.json", "w") as f:
        json.dump(manifest, f, indent=1)
    note(f"Wrote {len(df):,} rows, {len(out_cols)} columns, {df['season'].nunique()} files, "
         f"{total_bytes / 1e6:.1f} MB total ({max(v['bytes'] for v in manifest['seasons'].values()) / 1e6:.1f} MB largest season)")
    note(f"Distinct players: {df['player_id'].nunique():,}; teams: {df['team'].nunique()}; "
         f"games: {df['game_id'].nunique():,}")
    with open("data/player_build_log.txt", "w") as f:
        f.write("\n".join(log) + "\n")

    write_dictionary()
    write_quality(df, raw, manifest)


def write_dictionary():
    lines = ["# Data dictionary", "",
             "Files: `data/seasons/player_games_YYYY.csv`, one per season, one row per player per game. "
             "In the stat columns a blank cell means 0. `NA` means the source has no value for that player in that game: usually the player had no such play or role (for example, passing EPA is `NA` for players with no pass attempts), and for tackles for loss in 2009 to 2011 the stat was not recorded at all. Sums treat `NA` as nothing to add.", "",
             "| Column | Type | Source field | Meaning | Allowed values / notes |", "|---|---|---|---|---|"]
    for name, src, typ, meaning, allowed in COLUMNS:
        lines.append(f"| `{name}` | {typ} | `{src}` | {meaning} | {allowed} |")
    lines += ["", "`data/teams.csv` has one row per team: `team` (code), `city`, `name`, `conference`, `division`, `full_name`, `color` and `color2` (team colors), `logo` (link to the team logo image) and `league_logo` (link to the league logo image); both are loaded by the site at view time and are not stored here."]
    lines += ["", "`data/player_numbers.csv` has one row per player who appears in the season files and has a listed jersey number: `player_id` (the same id as the season files) and `jersey_number` (the last number the nflverse players table lists for that player; a player who changed numbers shows the latest). It is used only by the dashboard's team spotlight. Built by `scripts/build_player_numbers.py`."]
    with open("data/DATA_DICTIONARY.md", "w") as f:
        f.write("\n".join(lines) + "\n")


def md_table(df):
    cols = list(df.columns)
    out = ["| " + " | ".join(str(c) for c in cols) + " |", "|" + "---|" * len(cols)]
    for _, r in df.iterrows():
        out.append("| " + " | ".join(str(v) for v in r) + " |")
    return "\n".join(out)


def write_quality(df, raw, manifest):
    seasons = df.groupby(["season", "unit"]).agg(rows=("player_id", "size"), players=("player_id", "nunique"),
                                                games=("game_id", "nunique")).reset_index()
    wide = seasons.pivot(index="season", columns="unit", values="rows")
    per_season = df.groupby("season").agg(rows=("player_id", "size"), players=("player_id", "nunique"),
                                          games=("game_id", "nunique"), teams=("team", "nunique")).join(wide)
    reg_games = df[df.season_type == "REG"].groupby("season")["game_id"].nunique().rename("reg_games")
    post_games = df[df.season_type == "POST"].groupby("season")["game_id"].nunique().rename("post_games")
    per_season = per_season.join(reg_games).join(post_games).reset_index()

    probes = [("passing_yards", "QB"), ("rushing_yards", "RB"), ("receiving_yards", "WR"), ("targets", "WR"),
              ("def_tackles_solo", "DB"), ("def_tackles_for_loss", "LB"), ("def_sacks", "DL"), ("def_qb_hits", "DL"),
              ("def_pass_defended", "DB"), ("fg_att", "SPEC"), ("pt_att", "SPEC"), ("punt_returns", None)]
    cov = []
    for y, g in df.groupby("season"):
        row = {"season": y}
        for c, pg in probes:
            sub = g if pg is None else g[g.position_group == pg]
            v = sub[c]
            row[f"{c}" + (f" ({pg})" if pg else " (all)")] = "NA" if v.isna().all() else f"{(v.fillna(0) > 0).mean() * 100:.0f}%"
        cov.append(row)
    cov = pd.DataFrame(cov)

    miss = df[["player_id", "player_name", "position", "position_group", "team", "opponent_team", "game_id"]].isna().sum()
    multi = int((df.groupby("player_name")["player_id"].nunique() > 1).sum())
    lines = [
        "# Data quality summary", "",
        "Source: nflverse `stats_player` weekly player stats (CC-BY-4.0). Scope: seasons "
        f"{FIRST_SEASON} to {LAST_SEASON}, all position groups, regular season and playoffs. "
        "This file is generated by `scripts/build_player_data.py`.", "",
        "## Size", "",
        f"- {len(raw):,} rows in the source files, {len(df):,} rows kept, {len(manifest['columns'])} columns.",
        f"- {df['player_id'].nunique():,} distinct players, {df['team'].nunique()} teams, {df['game_id'].nunique():,} games.",
        f"- Duplicate player-game rows after cleaning: {int(df.duplicated(['player_id', 'game_id']).sum())}.",
        f"- Player names shared by more than one player ID: {multi}. Use `player_id` as the key.", "",
        "## Rows and games by season", "", md_table(per_season), "",
        "Regular seasons have 256 games through 2020 and 272 from 2021 (17 games per team from 2021, previously 16); "
        "2022 has 271 regular-season games in the source (one fewer than a full schedule). Postseason has 11 games "
        "through 2019 and 13 from 2020.", "",
        "## Coverage of key stats by season", "",
        "Each cell is the share of rows in that position group with a value above zero. `NA` means the stat has no value "
        "at all that season, so it was not recorded. Shares are not expected to be 100%, since most players do not record "
        "most stats in most games.", "", md_table(cov), "",
        "## Missing values in key columns after cleaning", "", md_table(miss.reset_index().rename(columns={"index": "column", 0: "missing"})), "",
        "## Known gaps and limitations", "",
        "- Tackles for loss are not recorded in 2009 to 2011 (written as NA).",
        "- Stats are only as complete as the source. Tackles and assists in particular depend on stat-crew scoring.",
        "- Rows include players with a source game record but no tracked stat in the kept columns; these are counted as appearances.",
        "- Returns (punt and kickoff) belong to whichever position the returner is listed at, so the Special teams unit "
        "(kickers, punters, long snappers) does not contain most return stats.",
        "- Offensive line rows carry few stats (mostly penalties), so OL views are thin.",
        "- The latest season may be updated by nflverse after this build; rerun the script to refresh.",
    ]
    with open("data/DATA_QUALITY.md", "w") as f:
        f.write("\n".join(lines) + "\n")


if __name__ == "__main__":
    main()
