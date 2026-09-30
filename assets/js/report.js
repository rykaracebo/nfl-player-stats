/* Draws every chart on the report page from the spec stored in its canvas, and mounts the team field. */
(function () {
  const drawCharts = () => document.querySelectorAll("canvas[data-chart]").forEach((canvas) => NFLCharts.buildChart(canvas, JSON.parse(canvas.dataset.chart)));
  NFLCharts.initTheme();

  // team colors are needed for the team-colored bars, so load them first (charts still draw if that fails)
  (window.NFLTeams ? NFLTeams.load().then(drawCharts, drawCharts) : Promise.resolve(drawCharts()));

  // "Highlight a team": dims every other team in the block charts (and the team code is printed inside each block)
  const hbar = document.getElementById("highlight-bar");
  if (hbar && window.NFLTeams) {
    NFLTeams.load().then((teams) => {
      const sel = document.getElementById("team-highlight");
      teams.slice().sort((a, b) => a.full_name.localeCompare(b.full_name)).forEach((t) => {
        const o = document.createElement("option"); o.value = t.team; o.textContent = t.full_name + " (" + t.team + ")"; sel.appendChild(o);
      });
      sel.addEventListener("change", () => {
        NFLCharts.setHighlight(sel.value);
        document.getElementById("highlight-live").textContent = sel.value ? "Highlighting " + NFLTeams.name(sel.value) + " in the charts." : "No team highlighted.";
      });
      hbar.hidden = false;
    }, () => {});
  }

  const root = document.getElementById("field-root");
  if (root && window.NFLField) {
    Promise.all([NFLTeams.load(), fetch("data/team_summary.json").then((r) => r.json())]).then(([teams, summary]) => {
      NFLField.mount(root, {
        teams, summary,
        title: "The league on the field",
        blurb: "Every team runs a route and the ball is thrown to a random team. Dot size follows the stat you pick. Hover to freeze the play, click a team to open it on the dashboard.",
        linkFor: (code) => "dashboard.html?view=teams&team=" + code,
        onSelect: (code) => { window.location.href = "dashboard.html?view=teams&team=" + code; },
      });
    }).catch(() => { root.hidden = true; }); // opened from disk or offline: the report still works without the widget
  }
})();
