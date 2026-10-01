"""Builds data/player_numbers.csv: the jersey number each player wore with each team in each season, for the dashboard's jersey avatars.

The weekly player files do not carry jersey numbers, so this takes them from the nflverse season rosters
(https://github.com/nflverse/nflverse-data/releases/tag/rosters, one roster_<season>.csv per season, CC-BY-4.0). The rosters use the same
player id (gsis_id) as data/seasons/*.csv. A row is kept only for a player, team and season that appear in our season files, so the
number shown on a card is the one the player wore with that team in the season the card is about. Consecutive seasons with the same number
are merged into one row (first_season, last_season). A player-team-season with no listed number (or the placeholder 0) is left out,
and the dashboard then shows a "#" instead of a number.

Run from the project folder:  python scripts/build_player_numbers.py   (needs internet)
"""
import csv
import glob
import io
import urllib.request

ROSTER_URL = "https://github.com/nflverse/nflverse-data/releases/download/rosters/roster_{}.csv"
# older rosters use the team codes of their time; the season files use one code per franchise
CODES = {"ARZ": "ARI", "BLT": "BAL", "CLV": "CLE", "HST": "HOU", "OAK": "LV", "SD": "LAC", "SL": "LA", "STL": "LA", "LAR": "LA", "JAC": "JAX"}

ours = set()   # (player_id, team, season) seen in the season files
seasons = []
for path in sorted(glob.glob("data/seasons/player_games_*.csv")):
    with open(path, newline="") as f:
        for row in csv.DictReader(f):
            ours.add((row["player_id"], row["team"], int(row["season"])))
            seasons.append(int(row["season"]))
seasons = sorted(set(seasons))

numbers = {}   # (player_id, team, season) -> number
for season in seasons:
    with urllib.request.urlopen(ROSTER_URL.format(season), timeout=180) as r:
        text = r.read().decode("utf-8")
    for row in csv.DictReader(io.StringIO(text)):
        key = (row["gsis_id"], CODES.get(row["team"], row["team"]), season)
        num = (row.get("jersey_number") or "").strip()
        if key in ours and num.isdigit() and int(num) > 0 and key not in numbers:
            numbers[key] = int(num)

# merge consecutive seasons with the same number into one row
by_player_team = {}
for (pid, team, season), n in numbers.items():
    by_player_team.setdefault((pid, team), []).append((season, n))
rows = []
for (pid, team), items in sorted(by_player_team.items()):
    items.sort()
    first = last = items[0][0]
    current = items[0][1]
    for season, n in items[1:]:
        if n == current and season == last + 1:
            last = season
        else:
            rows.append((pid, team, first, last, current))
            first = last = season
            current = n
    rows.append((pid, team, first, last, current))

with open("data/player_numbers.csv", "w", newline="") as f:
    w = csv.writer(f, lineterminator="\n")
    w.writerow(["player_id", "team", "first_season", "last_season", "jersey_number"])
    w.writerows(rows)

print(f"{len(ours):,} player-team-seasons in the season files, {len(numbers):,} with a jersey number, written as {len(rows):,} rows")
