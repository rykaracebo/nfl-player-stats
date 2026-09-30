# Assignment checklist

Source: `FDA Data Website Project.pdf`. **Due: October 2, 2026** (per the student; the PDF says it is posted on
Blackboard). No late submissions.

Status: done / partly / not done.

## Data
| # | Requirement | Where | Status |
|---|---|---|---|
| 1 | Panel data: time column and group column | `data/seasons/*.csv`: season and week; player and team | done |
| 2 | At least 5 periods | 17 seasons, 2009 to 2025 | done |
| 3 | At least 10 groups | 32 teams, 8,093 players | done |
| 4 | 50,000+ rows, 8+ columns, 2+ categorical, 2+ numeric | 304,515 rows, 69 columns | done |
| 5 | Not the HMDA data | nflverse player stats | done |

## Report page (`index.html`)
| # | Requirement | Where | Status |
|---|---|---|---|
| 6 | Title, name, one-paragraph summary | top of `index.html` | done |
| 7 | 4+ headline numbers with labels | headline block (6 numbers) | done |
| 8 | 8+ sections: finding heading, 1-2 paragraphs with numbers, a chart | findings 01 to 12 | done |
| 9 | Closing data section: source, what a row is, dropped rows, how every rate is computed | "About the data" at the bottom of `index.html` | done |

## Dashboard page (`dashboard.html`)
| # | Requirement | Where | Status |
|---|---|---|---|
| 10 | Loads data and calculates in the browser | `assets/js/dashboard.js` fetches the CSVs; `assets/js/stats.js` calculates | done, verified in Chrome |
| 11 | Filters for 4+ variables incl. time and group | season range, position group, player (always visible); week range, team, opponent, season type, unit (under "More filters") | done, verified in Chrome |
| 12 | 4+ summary numbers that change with filters | 4 to 5 summary cards (the first is the selected measure) plus 5 milestone counts under Advanced | done, verified in Chrome |
| 13 | 4+ charts with a measure switch and a breakdown switch | 4 charts, measure select and breakdown select | done, verified in Chrome |
| 14 | Table of the numbers behind the view | table panel, 4 views, CSV download | done, verified in Chrome |
| 15 | Reset-filters button | "Reset all" in the bar under the filters (sticks to the top while scrolling); restores filters, player, team, measure, breakdown, table view, Players/Teams and the field's selection | done, verified in Chrome |

## Site and repository
| # | Requirement | Where | Status |
|---|---|---|---|
| 16 | Shared nav bar, fonts and colors | `assets/css/style.css`, same nav on both pages; football theme with team colors and logos, and an interactive team play board (`assets/js/field.js`) | done |
| 17 | Own folder under home folder, not inside `~/fda-python` | `~/fda_website_project` | done |
| 18 | Public repo, GitHub Pages from `main` | repo: https://github.com/rykaracebo/nfl-player-stats, site: https://rykaracebo.github.io/nfl-player-stats/ | done, live site verified (both pages, data loading, charts, filters, reset) |
| 19 | README listing every file and the data source | `README.md` | done |
| 20 | Data files, scripts and site files in the repo | `data/`, `scripts/`, `assets/`, both pages | done |
| 21 | Commit history showing the work as it was done | small commits per step (over 40 commits) | done |

## Grading
| Component | Points | Plan |
|---|---|---|
| Report: findings, summaries, charts | 25 | items 6 to 9 |
| Report: numbers correct and reproducible | 20 | numbers computed by a script from the CSVs |
| Dashboard: filters, switches, charts work | 25 | items 10 to 15, tested in a browser |
| Dashboard: numbers agree with report and data | 10 | automated check against the report numbers |
| Design and personalization | 10 | item 16 |
| Repository: README, files, commit history | 10 | items 18 to 21 |

## Submission
One `.txt` or `.md` file with four lines: name, student ID, repository URL, live site URL. Not yet written; the
student ID is the student's to fill in.
