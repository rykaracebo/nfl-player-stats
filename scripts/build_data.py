"""Download NFL play-by-play (2018-2024) from nflverse and build data/plays.csv.

One row in the output is one offensive pass or run play.
Run from the project root:  .venv/bin/python scripts/build_data.py
"""
import os
import urllib.request

import pandas as pd

SEASONS = range(2018, 2025)
PBP_URL = "https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_{}.csv.gz"
GAMES_URL = "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv"

RAW = "data/raw"
OUT = "data/plays.csv"

PBP_COLS = [
    "game_id", "season", "week", "season_type", "posteam", "defteam", "posteam_type",
    "play_type", "down", "qtr", "ydstogo", "yardline_100", "yards_gained", "epa", "wp",
    "success", "touchdown", "first_down", "score_differential", "shotgun", "no_huddle",
    "complete_pass", "interception", "sack", "fumble_lost", "air_yards",
    "passer_player_name", "rusher_player_name", "receiver_player_name",
]
GAME_COLS = ["game_id", "roof", "surface", "temp", "wind", "div_game"]

log = []


def note(msg):
    print(msg)
    log.append(msg)


def fetch(url, path):
    if not os.path.exists(path):
        print("downloading", url)
        urllib.request.urlretrieve(url, path)
    return path


def main():
    os.makedirs(RAW, exist_ok=True)
    frames = []
    for y in SEASONS:
        p = fetch(PBP_URL.format(y), f"{RAW}/pbp_{y}.csv.gz")
        frames.append(pd.read_csv(p, usecols=PBP_COLS, low_memory=False))
    df = pd.concat(frames, ignore_index=True)
    note(f"Loaded {len(df):,} plays from {len(SEASONS)} seasons")

    # --- drops (each one logged) ---
    n = len(df)
    df = df[df["play_type"].isin(["pass", "run"])]
    note(f"Dropped {n - len(df):,} rows that are not a pass or run (kickoffs, punts, field goals, "
         f"extra points, kneels/spikes, penalties with no play, timeouts)")
    n = len(df)
    df = df[df["posteam"].notna() & df["defteam"].notna()]
    note(f"Dropped {n - len(df):,} pass/run rows with no offense or defense team")
    n = len(df)
    df = df[df["epa"].notna() & df["down"].notna()]
    note(f"Dropped {n - len(df):,} pass/run rows with no EPA or no down (e.g. two-point tries)")

    # --- game context (weather / venue only) ---
    games = pd.read_csv(fetch(GAMES_URL, f"{RAW}/games.csv"), usecols=GAME_COLS)
    df = df.merge(games, on="game_id", how="left")
    df["roof"] = df["roof"].fillna("unknown")
    df["surface"] = df["surface"].fillna("unknown")

    # --- derived categorical columns for filtering ---
    df["down"] = df["down"].astype(int)
    df["home_away"] = df["posteam_type"]
    df["season_type"] = df["season_type"].map({"REG": "Regular season", "POST": "Playoffs"})
    df["dome"] = df["roof"].map(lambda r: "Indoors" if r in ("dome", "closed") else
                                ("Outdoors" if r in ("outdoors", "open") else "Unknown"))
    df["field_zone"] = pd.cut(df["yardline_100"], [0, 20, 50, 80, 100],
                              labels=["Red zone", "Opponent side", "Own side", "Backed up"])
    df["field_zone"] = df["field_zone"].astype(str)
    df["score_state"] = df["score_differential"].apply(
        lambda d: "Tied" if d == 0 else ("Leading" if d > 0 else "Trailing"))
    df["distance"] = pd.cut(df["ydstogo"], [-1, 3, 7, 100],
                            labels=["Short (1-3)", "Medium (4-7)", "Long (8+)"]).astype(str)
    df["player"] = df["passer_player_name"].where(df["play_type"] == "pass", df["rusher_player_name"])
    df["receiver"] = df["receiver_player_name"]
    df["play_type"] = df["play_type"].map({"pass": "Pass", "run": "Run"})
    df["qtr"] = df["qtr"].astype(int).clip(upper=5).map(lambda q: "OT" if q == 5 else f"Q{q}")

    for c in ["success", "touchdown", "first_down", "shotgun", "no_huddle", "complete_pass",
              "interception", "sack", "fumble_lost", "div_game"]:
        df[c] = df[c].fillna(0).astype(int)
    for c in ["yardline_100", "yards_gained", "ydstogo"]:
        df[c] = df[c].fillna(0).astype(int)
    df["epa"] = df["epa"].round(3)
    df["wp"] = df["wp"].round(3)

    keep = ["season", "week", "season_type", "posteam", "defteam", "home_away", "play_type", "down",
            "qtr", "ydstogo", "distance", "yardline_100", "field_zone", "score_state", "dome",
            "yards_gained", "epa", "wp", "success", "touchdown", "first_down",
            "shotgun", "complete_pass", "interception", "sack", "div_game", "player"]
    df = df[keep].sort_values(["season", "week", "posteam"]).reset_index(drop=True)
    df.to_csv(OUT, index=False)

    size = os.path.getsize(OUT) / 1e6
    note(f"Wrote {OUT}: {len(df):,} rows, {len(df.columns)} columns, {size:.1f} MB")
    note(f"Seasons: {df['season'].nunique()} ({df['season'].min()}-{df['season'].max()}), "
         f"teams: {df['posteam'].nunique()}")
    cat = ["season_type", "posteam", "defteam", "home_away", "play_type", "down", "qtr", "distance",
           "field_zone", "score_state", "dome"]
    num = ["yards_gained", "epa", "wp", "yardline_100", "ydstogo"]
    note(f"Categorical filter columns: {len(cat)}; numeric measure columns: {len(num)}")
    with open("data/build_log.txt", "w") as f:
        f.write("\n".join(log) + "\n")


if __name__ == "__main__":
    main()
