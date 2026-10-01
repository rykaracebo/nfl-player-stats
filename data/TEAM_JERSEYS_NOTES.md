# Team jersey colors (`data/team_jerseys.csv`)

The dashboard draws a jersey back for each player card (last name over the number). The jersey colors, number colors and outlines, name
color, sleeve stripes and collar come from `data/team_jerseys.csv`, one row per team, describing the team's **current primary
(team-colored, non-white) jersey for the 2025 season**. These are design facts about uniforms, not statistics. They were researched from
uniform pages, with the best source and a confidence level recorded below. The drawn jerseys are simplified illustrations, not photos or
logos, and the NFL and its teams own their uniform designs; they appear only to identify the teams (see the disclaimer in the README).

Where a team's published brand hex is deeper than how the jersey looks on the field, the brand hex is used. If a team has no row in the
file, the dashboard falls back to the team's two colors from `data/teams.csv`.

Columns: `team`, `jersey_hex` (body), `number_hex`, `number_outline_hex` (`none` if no outline), `name_hex`, `sleeve_pattern`
(`stripes`, `cuff-stripes`, `shoulder-stripes`, `other` = a single accent flash, `none`), `sleeve_hex_1..3` (stripe colors from the cuff or
shoulder outward), `collar_hex`.

## AFC

| Team | Notes | Source | Confidence |
|---|---|---|---|
| BAL | 2025 purple jersey: white numbers with gold outline; black band at the sleeve end. Redesigned for 2026. | [Gridiron Uniform Database](https://www.gridiron-uniforms.com/GUD/controller/controller.php?action=teams-season&team_id=BAL&year=2025) | medium |
| BUF | Royal blue; white numbers outlined in red; white-red-white sleeve stripes. | [Gridiron Uniform Database](https://www.gridiron-uniforms.com/GUD/controller/controller.php?action=teams-season&team_id=BUF&year=2025) | high |
| CIN | Black; white numbers with a thin orange outline; orange tiger-stripe flashes on the shoulders. | [Gridiron Uniform Database](https://www.gridiron-uniforms.com/GUD/controller/controller.php?action=teams-season&team_id=CIN&year=2025) | high |
| CLE | Seal brown; plain white numbers; white-orange-white sleeve stripes. | [Gridiron Uniform Database](https://www.gridiron-uniforms.com/GUD/controller/controller.php?action=teams-season&team_id=CLE&year=2025) | high |
| DEN | Orange; white numbers outlined in navy; navy and white shoulder panels; navy collar. | [Gridiron Uniform Database](https://www.gridiron-uniforms.com/GUD/controller/controller.php?action=teams-season&team_id=DEN&year=2025) | medium |
| HOU | Deep steel blue; white numbers outlined in red; red name; red collar trim. Sources disagree on the exact blue and red. | [Gridiron Uniform Database](https://www.gridiron-uniforms.com/GUD/controller/controller.php?action=teams-season&team_id=HOU&year=2025) | medium |
| IND | Speed blue; plain white numbers; two white stripes on each shoulder. | [Colts brand page](https://www.colts.com/team/brand/) | medium |
| JAX | Teal; plain white numbers; black sleeve-end band and black collar. | [Gridiron Uniform Database](https://www.gridiron-uniforms.com/GUD/controller/controller.php?action=teams-season&team_id=JAX&year=2025) | medium |
| KC | Red; white numbers outlined in gold; white-gold-white sleeve stripes. | [Gridiron Uniform Database](https://www.gridiron-uniforms.com/GUD/controller/controller.php?action=teams-season&team_id=KC&year=2025) | high |
| LV | Black; plain silver numbers and name; no sleeve stripes. | [Gridiron Uniform Database](https://www.gridiron-uniforms.com/GUD/controller/controller.php?action=teams-season&team_id=LV&year=2025) | high |
| LAC | Powder blue; white numbers outlined in gold; a gold lightning bolt on each shoulder. | [Gridiron Uniform Database](https://www.gridiron-uniforms.com/GUD/controller/controller.php?action=teams-season&team_id=LAC&year=2025) | high |
| MIA | Aqua; white numbers outlined in orange; no sleeve stripes. | [Gridiron Uniform Database](https://www.gridiron-uniforms.com/GUD/controller/controller.php?action=teams-season&team_id=MIA&year=2025) | high |
| NE | Navy; white numbers outlined in red; red-white-red shoulder stripes. | [Gridiron Uniform Database](https://www.gridiron-uniforms.com/GUD/controller/controller.php?action=teams-season&team_id=NE&year=2025) | high |
| NYJ | Legacy green; plain white numbers; two white sleeve stripes and a white collar. | [Gridiron Uniform Database](https://www.gridiron-uniforms.com/GUD/controller/controller.php?action=teams-season&team_id=NYJ&year=2025) | medium |
| PIT | Black; white numbers; gold name; gold sleeve bands at the cuff. | [Gridiron Uniform Database](https://www.gridiron-uniforms.com/GUD/controller/controller.php?action=teams-season&team_id=PIT&year=2025) | high |
| TEN | Light Titans blue; navy numbers with a white outline; gray shoulder yokes. The team announced new uniforms in 2026. | [Wikipedia: Tennessee Titans](https://en.wikipedia.org/wiki/Tennessee_Titans) | medium |

## NFC

| Team | Notes | Source | Confidence |
|---|---|---|---|
| ARI | Cardinal red; white numbers with a thin silver outline; plain sleeves. | [Cardinals uniform article](https://www.azcardinals.com/news/longform/new-uniforms-for-the-arizona-cardinals-2023) | medium |
| ATL | The 2020 to 2025 black jersey; white numbers with a red edge; no sleeve stripes. Atlanta moved to a red home jersey in 2026. | [SportsLogos](https://news.sportslogos.net/2026/04/02/atlanta-falcons-officially-unveil-new-uniforms-for-2026-season/football/) | high |
| CAR | Black primary; white numbers outlined in Panther blue; looping blue shoulder panels edged in silver-gray. | [Panthers shop listing](https://shop.panthers.com/mens-nike-black-carolina-panthers-custom-game-jersey/p-16022946683896+z-9564-1099069485) | high |
| CHI | Navy; white numbers outlined in orange; three orange sleeve stripes. | [NFL Shop listing](https://europe2.nflshop.com/en/chicago-bears/chicago-bears-nike-home-game-jersey-navy-custom-mens/t-14596847+p-126708267739+z-7-1964922156) | high |
| DAL | The navy jersey is the colored primary (Dallas normally wears white at home); white numbers with a thin silver outline; silver sleeve stripe. Sources differ slightly on the navy. | [NFL Shop listing](https://www.nflshop.com/dallas-cowboys/mens-dallas-cowboys-nike-navy-custom-game-jersey/t-36489195+p-6975208546392+z-9-3678010615) | high |
| DET | 2024 redesign: Honolulu blue; white numbers outlined in silver; two wide silver sleeve stripes. | [NFL.com](https://www.nfl.com/news/new-look-lions-reigning-nfc-north-champions-unveil-fresh-uniforms-including-all-back-alternates) | high |
| GB | Dark green; plain white numbers; gold-white-gold bands at the cuff. | [Kitbag listing](https://www.kitbag.com/en/nfl/green-bay-packers/green-bay-packers-nike-home-game-jersey-green-custom-mens/o-1383+t-58040209+p-349097703523+z-9-2743720796) | high |
| LA | 2020 to 2025 design: royal blue; yellow-to-white gradient numbers (drawn here as yellow); horn shapes over the shoulders. The Rams announced a refresh for 2026. | [NFL.com](https://www.nfl.com/news/rams-unveil-new-uniforms-ahead-of-2020-season) | high |
| MIN | Purple; plain white numbers; white and gold stripes at the cuff. | [Star Tribune](https://www.startribune.com/vikescentric-up-close-with-vikings-new-uniforms/204769591) | high |
| NO | Black home jersey; old-gold numbers outlined in white; plain sleeves. | [NFL Shop listing](https://europe2.nflshop.com/en/new-orleans-saints/new-orleans-saints-nike-home-game-jersey-black-custom-mens/t-47154775+p-56902071851405+z-9-238901283) | high |
| NYG | Dark blue; plain white numbers; no sleeve stripes. The jersey looks a brighter royal blue than the brand color. | [NFL Shop listing](https://europe.nflshop.com/en/new-york-giants/new-york-giants-nike-game-home-jersey-royal-blue-custom-mens/t-79729002+p-7834194769591+z-8-328600377) | high |
| PHI | Midnight green; white numbers with a heavy black outline; black cuffs and collar. | [NFL Shop listing](https://www.nflshop.com/philadelphia-eagles/mens-philadelphia-eagles-nike-midnight-green-team-custom-game-jersey/t-36829348+p-799914543681823+z-9-170953827) | high |
| SF | Scarlet; plain white numbers; three white sleeve stripes. | [SportsLogos](https://news.sportslogos.net/2022/04/25/san-francisco-49ers-unveil-classic-update-to-home-road-jerseys-helmet/football/) | high |
| SEA | College navy; wolf-gray numbers outlined in action green; gray shoulder yoke with green caps. | [NFL Shop listing](https://europe.nflshop.com/en/seattle-seahawks/seattle-seahawks-nike-game-jersey-college-navy-custom-mens/t-36822653+p-01348693152179+z-9-165941946) | high |
| TB | Red; white numbers with a heavy black outline (the real jersey also has a thin orange inner line, not drawn); black cuffs and collar. | [NFL Shop listing](https://www.nflshop.com/tampa-bay-buccaneers/jerseys/mens-nike-tampa-bay-buccaneers-red-custom-game-jersey/t-47150590+d-6771888946+f-7986839+z-8-682799477) | high |
| WAS | 2022 to 2025 burgundy home jersey; gold numbers outlined in white; gold-white-gold bands at the cuff. New jerseys arrived in 2026. | [Commanders](https://www.commanders.com/news/4-things-to-know-about-the-washington-commanders-new-uniforms) | high |

The 2025 designs are used because 2025 is the last season in the data. Several teams announced new uniforms for 2026 (Atlanta, Baltimore, Los Angeles Rams,
Tennessee, Washington), so those rows will look dated once the new designs are in use.
