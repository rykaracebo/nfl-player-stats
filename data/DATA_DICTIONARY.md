# Data dictionary

Files: `data/seasons/player_games_YYYY.csv`, one per season, one row per player per game. In the stat columns a blank cell means 0 and `NA` means the stat was not recorded that season.

| Column | Type | Source field | Meaning | Allowed values / notes |
|---|---|---|---|---|
| `player_id` | text | `player_id` | Stable player ID (GSIS ID from nflverse). The key for a player. | e.g. 00-0033873 |
| `player_name` | text | `player_display_name` | Player's display name. Not unique: 92 names belong to more than one player. | use player_id to tell them apart |
| `position` | category | `position` | Listed position of the player. | QB RB FB WR TE C G OT OL DE DT NT DL LB ILB MLB OLB CB S FS SAF DB K P LS |
| `position_group` | category | `position_group` | Position group from nflverse. | QB RB WR TE OL DL LB DB SPEC |
| `unit` | category | `derived` | Offense, Defense or Special teams. QB RB WR TE OL are Offense; DL LB DB are Defense; SPEC (kickers, punters, long snappers) is Special teams. | Offense, Defense, Special teams |
| `season` | integer | `season` | NFL season (year the season starts). | 2009 to 2025 |
| `week` | integer | `week` | Week number within the season. Playoff weeks continue the count (18 to 21, or 19 to 22 from 2021). | 1 to 22 |
| `season_type` | category | `season_type` | Regular season or playoffs. | REG, POST |
| `game_id` | text | `game_id` | nflverse game ID (season_week_away_home). | e.g. 2024_01_KC_BAL |
| `team` | category | `team` | Team the player played for in this game. | 32 team codes, see teams.csv |
| `opponent_team` | category | `opponent_team` | Opposing team in this game. | 32 team codes |
| `completions` | number | `completions` | Passes completed. | blank = 0, NA = not recorded that season |
| `attempts` | number | `attempts` | Passes attempted. | blank = 0, NA = not recorded that season |
| `passing_yards` | number | `passing_yards` | Passing yards. | blank = 0, NA = not recorded that season |
| `passing_tds` | number | `passing_tds` | Passing touchdowns. | blank = 0, NA = not recorded that season |
| `passing_interceptions` | number | `passing_interceptions` | Interceptions thrown. | blank = 0, NA = not recorded that season |
| `sacks_suffered` | number | `sacks_suffered` | Times sacked. | blank = 0, NA = not recorded that season |
| `carries` | number | `carries` | Rushing attempts. | blank = 0, NA = not recorded that season |
| `rushing_yards` | number | `rushing_yards` | Rushing yards. | blank = 0, NA = not recorded that season |
| `rushing_tds` | number | `rushing_tds` | Rushing touchdowns. | blank = 0, NA = not recorded that season |
| `targets` | number | `targets` | Times targeted on a pass. | blank = 0, NA = not recorded that season |
| `receptions` | number | `receptions` | Passes caught. | blank = 0, NA = not recorded that season |
| `receiving_yards` | number | `receiving_yards` | Receiving yards. | blank = 0, NA = not recorded that season |
| `receiving_tds` | number | `receiving_tds` | Receiving touchdowns. | blank = 0, NA = not recorded that season |
| `def_tackles_solo` | number | `def_tackles_solo` | Solo tackles. | blank = 0, NA = not recorded that season |
| `def_tackle_assists` | number | `def_tackle_assists` | Assisted tackles. | blank = 0, NA = not recorded that season |
| `def_tackles_for_loss` | number | `def_tackles_for_loss` | Tackles for loss. Not recorded in 2009 to 2011. | blank = 0, NA = not recorded that season |
| `def_sacks` | number | `def_sacks` | Sacks (halves are possible, e.g. 0.5). | blank = 0, NA = not recorded that season |
| `def_qb_hits` | number | `def_qb_hits` | Quarterback hits. | blank = 0, NA = not recorded that season |
| `def_interceptions` | number | `def_interceptions` | Interceptions made. | blank = 0, NA = not recorded that season |
| `def_pass_defended` | number | `def_pass_defended` | Passes defended. | blank = 0, NA = not recorded that season |
| `def_fumbles_forced` | number | `def_fumbles_forced` | Fumbles forced. | blank = 0, NA = not recorded that season |
| `def_tds` | number | `def_tds` | Defensive touchdowns. | blank = 0, NA = not recorded that season |
| `punt_returns` | number | `punt_returns` | Punt returns. | blank = 0, NA = not recorded that season |
| `punt_return_yards` | number | `punt_return_yards` | Punt return yards. | blank = 0, NA = not recorded that season |
| `kickoff_returns` | number | `kickoff_returns` | Kickoff returns. | blank = 0, NA = not recorded that season |
| `kickoff_return_yards` | number | `kickoff_return_yards` | Kickoff return yards. | blank = 0, NA = not recorded that season |
| `fg_made` | number | `fg_made` | Field goals made. | blank = 0, NA = not recorded that season |
| `fg_att` | number | `fg_att` | Field goals attempted. | blank = 0, NA = not recorded that season |
| `pat_made` | number | `pat_made` | Extra points made. | blank = 0, NA = not recorded that season |
| `pat_att` | number | `pat_att` | Extra points attempted. | blank = 0, NA = not recorded that season |
| `pt_att` | number | `pt_att` | Punts. | blank = 0, NA = not recorded that season |
| `pt_yards` | number | `pt_yards` | Punt yards (gross). | blank = 0, NA = not recorded that season |
| `penalties` | number | `penalties` | Penalties committed. | blank = 0, NA = not recorded that season |
| `fumbles_lost` | number | `fumbles_lost_total` | Fumbles lost (any type). | blank = 0, NA = not recorded that season |
| `fantasy_points_ppr` | number | `fantasy_points_ppr` | Fantasy points, full-PPR scoring, as computed by nflverse. Rounded to 2 decimals. | blank = 0, NA = not recorded that season |
| `sack_yards_lost` | number | `sack_yards_lost` | Yards lost on sacks suffered. Stored as a negative number. | blank = 0, NA = not recorded that season |
| `passing_air_yards` | number | `passing_air_yards` | Passing air yards, including incomplete passes. | blank = 0, NA = not recorded that season |
| `passing_yards_after_catch` | number | `passing_yards_after_catch` | Yards after the catch on this player's completions (unofficial stat). | blank = 0, NA = not recorded that season |
| `passing_first_downs` | number | `passing_first_downs` | First downs on pass attempts. | blank = 0, NA = not recorded that season |
| `passing_epa` | number | `passing_epa` | Total expected points added on pass attempts and sacks (qb_epa). Rounded to 3 decimals. | blank = 0, NA = not recorded that season |
| `passing_cpoe` | number | `passing_cpoe` | Completion percentage over expected, in percentage points, for that game. Only meaningful for players who threw passes. Rounded to 3 decimals. | blank = 0, NA = not recorded that season |
| `rushing_first_downs` | number | `rushing_first_downs` | First downs on rush attempts. | blank = 0, NA = not recorded that season |
| `rushing_epa` | number | `rushing_epa` | Expected points added on rush attempts, including scrambles and kneel-downs. Rounded to 3 decimals. | blank = 0, NA = not recorded that season |
| `receiving_air_yards` | number | `receiving_air_yards` | Receiving air yards on targets, including incompletions. | blank = 0, NA = not recorded that season |
| `receiving_yards_after_catch` | number | `receiving_yards_after_catch` | Yards after the catch on this player's receptions (unofficial stat). | blank = 0, NA = not recorded that season |
| `receiving_first_downs` | number | `receiving_first_downs` | First downs on receptions. | blank = 0, NA = not recorded that season |
| `receiving_epa` | number | `receiving_epa` | Total EPA on plays where this player was targeted. Rounded to 3 decimals. | blank = 0, NA = not recorded that season |
| `target_share` | number | `target_share` | Player's share of team targets in this game, from 0 to 1. Only meaningful when targets > 0. | blank = 0, NA = not recorded that season |
| `air_yards_share` | number | `air_yards_share` | Player's share of team air yards in this game, from 0 to 1. Only meaningful when targets > 0. | blank = 0, NA = not recorded that season |
| `wopr` | number | `wopr` | Weighted opportunity rating: 1.5 x target_share + 0.7 x air_yards_share. Only meaningful when targets > 0. | blank = 0, NA = not recorded that season |
| `fg_made_30_39` | number | `fg_made_30_39` | Field goals made from 30 to 39 yards. | blank = 0, NA = not recorded that season |
| `fg_made_40_49` | number | `fg_made_40_49` | Field goals made from 40 to 49 yards. | blank = 0, NA = not recorded that season |
| `fg_made_50_59` | number | `fg_made_50_59` | Field goals made from 50 to 59 yards. | blank = 0, NA = not recorded that season |
| `fg_made_60_` | number | `fg_made_60_` | Field goals made from 60 yards or more (a season with none is a real zero). | blank = 0, NA = not recorded that season |
| `fg_missed_30_39` | number | `fg_missed_30_39` | Field goals missed from 30 to 39 yards. | blank = 0, NA = not recorded that season |
| `fg_missed_40_49` | number | `fg_missed_40_49` | Field goals missed from 40 to 49 yards. | blank = 0, NA = not recorded that season |
| `fg_missed_50_59` | number | `fg_missed_50_59` | Field goals missed from 50 to 59 yards. | blank = 0, NA = not recorded that season |
| `fg_missed_60_` | number | `fg_missed_60_` | Field goals missed from 60 yards or more. | blank = 0, NA = not recorded that season |

`data/teams.csv` has one row per team: `team` (code), `city`, `name`, `conference`, `division`, `full_name`.
