# NFL Player Stats, 2009 to 2025

A two-page data website for my Financial Data Analytics course: a report with findings and charts, and an
interactive dashboard, both built from NFL player game logs. Work in progress; the site pages are still being built.

## Data

- **Source:** [nflverse](https://github.com/nflverse/nflverse-data), release `stats_player`, weekly player stats
  (`stats_player_week_YYYY.csv.gz`).
- **License:** CC-BY-4.0. Credit: the nflverse project and its contributors.
- **Scope:** seasons 2009 to 2025, all position groups (offense, defense, special teams), regular season and playoffs.
- **One row:** one player in one game. 304,515 rows, 46 columns, 8,093 players, 32 teams, 4,630 games.
- **Why 2009:** nflverse has the same files back to 1999, but 2009 is where the course scope starts, and it keeps the
  browser download smaller.

Full column definitions are in [`data/DATA_DICTIONARY.md`](data/DATA_DICTIONARY.md) and coverage, gaps and checks are in
[`data/DATA_QUALITY.md`](data/DATA_QUALITY.md).

## Files

| File | What it does |
|---|---|
| `scripts/build_player_data.py` | Downloads the nflverse files, cleans them, and writes everything under `data/`. Also generates the data dictionary and quality summary. |
| `data/seasons/player_games_YYYY.csv` | The cleaned data, one file per season. Blank stat cell = 0, `NA` = not recorded that season. |
| `data/teams.csv` | Team code, city, name, conference and division. |
| `data/manifest.json` | Seasons, column list and row counts for the files above. |
| `data/player_build_log.txt` | Every row dropped or changed during cleaning, and why. |
| `data/DATA_DICTIONARY.md` | Definition of every column. |
| `data/DATA_QUALITY.md` | Row counts, coverage by season, missing values, known gaps. |
| `CHECKLIST.md` | The assignment requirements and where each one is met. |

Files from an earlier play-by-play attempt (`scripts/build_data.py`, `data/plays.csv`, `data/build_log.txt`) are still in
the repository and will be removed or replaced.

## Rebuilding the data

```
python3 -m venv .venv && .venv/bin/pip install pandas
.venv/bin/python scripts/build_player_data.py
```
