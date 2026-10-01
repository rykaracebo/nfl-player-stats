"""Builds data/player_numbers.csv: one jersey number per player, for the dashboard's team spotlight.

The weekly player files do not carry jersey numbers, so this takes them from the nflverse players table
(https://github.com/nflverse/nflverse-data/releases/tag/players, CC-BY-4.0), which uses the same player id
(gsis_id) as data/seasons/*.csv. The table lists each player's last known number, so a player who changed
numbers shows the latest one. Only players who appear in our season files are kept; a player with no listed
number is left out and the dashboard simply omits the number.

Run from the project folder:  python scripts/build_player_numbers.py
"""
import csv
import glob
import io
import urllib.request

PLAYERS_URL = "https://github.com/nflverse/nflverse-data/releases/download/players/players.csv"

ours = set()
for path in sorted(glob.glob("data/seasons/player_games_*.csv")):
    with open(path, newline="") as f:
        for row in csv.DictReader(f):
            ours.add(row["player_id"])

with urllib.request.urlopen(PLAYERS_URL, timeout=120) as r:
    text = r.read().decode("utf-8")

rows = []
for row in csv.DictReader(io.StringIO(text)):
    pid, num = row["gsis_id"], (row.get("jersey_number") or "").strip()
    if pid in ours and num.isdigit():
        rows.append((pid, int(num)))
rows.sort()

with open("data/player_numbers.csv", "w", newline="") as f:
    w = csv.writer(f, lineterminator="\n")
    w.writerow(["player_id", "jersey_number"])
    w.writerows(rows)

print(f"{len(ours):,} players in the season files, {len(rows):,} with a jersey number written to data/player_numbers.csv")
