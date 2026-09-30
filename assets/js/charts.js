/* Shared chart helpers and theme toggle, used by the report and the dashboard. */
(function () {
  const FORMATS = {
    epa: (v) => (v >= 0 ? "+" : "") + v.toFixed(3),
    pct: (v) => (v * 100).toFixed(1) + "%",
    num: (v) => Math.round(v).toLocaleString("en-US"),
    int: (v) => Math.round(v).toLocaleString("en-US"),
    dec1: (v) => v.toFixed(1),
    half: (v) => (Number.isInteger(v) ? Math.round(v).toLocaleString("en-US") : v.toFixed(1)),
    dec2: (v) => v.toFixed(2),
    dec3: (v) => v.toFixed(3),
    yds: (v) => v.toFixed(1),
  };

  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const teamFill = (team) => (!team ? "rgba(0,0,0,0)" : NFLTeams.color(team));

  // Prints the team code inside every block or bar segment that is big enough for it, so colour is never the only clue.
  const teamLabels = {
    id: "teamLabels",
    afterDatasetsDraw(chart) {
      const ctx = chart.ctx;
      ctx.save();
      ctx.font = "600 9.5px 'Geist Mono', monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      chart.data.datasets.forEach((ds, di) => {
        if (!ds.barTeams || !chart.isDatasetVisible(di)) return;
        chart.getDatasetMeta(di).data.forEach((bar, i) => {
          const team = ds.barTeams[i];
          if (!team || !(ds.data[i] > 0)) return;
          const p = bar.getProps(["x", "y", "base", "width", "height"], true);
          const horizontal = chart.options.indexAxis === "y";
          const len = horizontal ? Math.abs(p.x - p.base) : Math.abs(p.y - p.base), thick = horizontal ? p.height : p.width;
          const w = ctx.measureText(team).width;
          if (horizontal ? len < w + 10 || thick < 12 : thick < w + 4 || len < 12) return;
          const cx = horizontal ? (p.x + p.base) / 2 : p.x, cy = horizontal ? p.y : (p.y + p.base) / 2;
          ctx.fillStyle = NFLTeams.inkOn(NFLTeams.color(team));
          ctx.fillText(team, cx, cy + 0.5);
        });
      });
      ctx.restore();
    },
  };
  // Shades the column of the x value in spec.mark (the one season the visitor picked, drawn among all seasons for context).
  const seasonMark = {
    id: "seasonMark",
    beforeDatasetsDraw(chart) {
      const idx = chart.config.options.plugins.seasonMark && chart.config.options.plugins.seasonMark.index;
      if (idx == null || idx < 0) return;
      const x = chart.scales.x, area = chart.chartArea, n = chart.data.labels.length;
      const step = n > 1 ? (x.getPixelForValue(1) - x.getPixelForValue(0)) : area.width;
      const c = x.getPixelForValue(idx), left = Math.max(area.left, c - step / 2), right = Math.min(area.right, c + step / 2);
      const ctx = chart.ctx; ctx.save(); ctx.fillStyle = cssVar("--fg") + "1f"; ctx.fillRect(left, area.top, right - left, area.bottom - area.top); ctx.restore();
    },
  };
  const reducedMotion = () => !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
  const registry = new Map(); // canvas -> {chart, spec}

  function palette(count) {
    if (count === 1) return [cssVar("--accent")];
    const out = [];
    for (let i = 1; i <= Math.min(count, 8); i++) out.push(cssVar("--series-" + i));
    return out;
  }

  // spec: {kind: "bar"|"hbar"|"line", labels, datasets:[{label,data}], fmt, yTitle}
  function buildChart(canvas, spec) {
    const prev = registry.get(canvas);
    if (prev) prev.chart.destroy();
    const fmt = FORMATS[spec.fmt] || FORMATS.num;
    // spec.colors may hold CSS variable names ("--series-2") so they follow the light/dark theme
    const resolve = (c) => (c && c.indexOf("--") === 0 ? cssVar(c) : c);
    const colors = (spec.colors || palette(spec.datasets.length)).map(resolve);
    const isLine = spec.kind === "line";
    const horizontal = spec.kind === "hbar";
    const dim = cssVar("--dim");
    const grid = cssVar("--grid");
    const stacked = !!spec.stacked; // segmented bars: each dataset is one team's slice of every bar
    const multi = spec.datasets.length > 1 && !stacked;
    const surface = cssVar("--surface");
    const teamOutline = cssVar("--fg") + "55"; // a thin outline so a block still shows against a look-alike neighbour or the card
    // year and week axes get fewer labels so they never crowd; named categories keep every label
    const yearish = spec.labels.length > 0 && spec.labels.every((l) => /^(19|20)\d\d$/.test(String(l)));
    const numericAxis = spec.labels.length > 0 && spec.labels.every((l) => /^\d+$/.test(String(l)));
    const thin = !horizontal && (yearish || numericAxis);

    const datasets = spec.datasets.map((ds, i) => ({
      label: ds.label,
      names: ds.names || null,
      data: ds.data,
      borderColor: ds.barTeams ? teamOutline : stacked ? surface : colors[i % colors.length],
      tips: ds.tips || null,
      barTeams: ds.barTeams || null,
      backgroundColor: ds.barTeams && window.NFLTeams ? (c) => teamFill(ds.barTeams[c.dataIndex])
        : ds.barColors ? ds.barColors.map(resolve) : colors[i % colors.length],
      borderWidth: ds.width || (isLine ? (multi ? 1.8 : 2.4) : ds.barTeams ? 1 : stacked ? 1.5 : 0),
      borderDash: ds.dash || [],
      // one label = one point per line, so the dots must show; a marked x value (the season picked on the dashboard) gets a big dot
      pointRadius: isLine ? (spec.mark != null ? spec.labels.map((_, k) => (k === spec.mark ? 6 : multi ? 0 : 2)) : spec.labels.length === 1 ? 6 : multi ? 0 : 3) : 0,
      pointHoverRadius: isLine ? 8 : 0,
      pointBackgroundColor: colors[i % colors.length],
      pointBorderColor: surface,
      pointBorderWidth: 2,
      tension: 0,
      borderRadius: isLine ? 0 : stacked && !horizontal ? 2 : 3,
      borderSkipped: false,
      maxBarThickness: horizontal ? 16 : stacked ? 60 : 44,
      categoryPercentage: stacked && !horizontal ? 0.94 : 0.78,
      barPercentage: stacked && !horizontal ? 0.94 : 0.86,
    }));

    // no rotated axis titles: the chart heading already names the measure
    const valueAxis = {
      stacked,
      grid: { color: grid, drawTicks: false },
      border: { display: false },
      ticks: { color: dim, font: { family: "Geist Mono", size: 11 }, callback: (v) => fmt(v), maxTicksLimit: 6, padding: 8 },
      beginAtZero: !isLine,
    };
    const labelAxis = {
      stacked,
      grid: { display: false },
      border: { color: grid },
      ticks: { color: dim, font: { size: 12 }, autoSkip: horizontal ? false : thin, maxTicksLimit: yearish ? 9 : 12, maxRotation: 0, padding: 6 },
    };

    const chart = new Chart(canvas, {
      plugins: [teamLabels, seasonMark],
      type: isLine ? "line" : "bar",
      data: { labels: spec.labels, datasets },
      options: {
        indexAxis: horizontal ? "y" : "x",
        responsive: true,
        maintainAspectRatio: false,
        animation: reducedMotion() ? false : { duration: 350 },
        layout: { padding: { top: 6, right: 10, bottom: 2, left: 2 } },
        interaction: { mode: isLine ? "index" : "nearest", intersect: !isLine && false, axis: horizontal ? "y" : "x" },
        scales: horizontal ? { x: valueAxis, y: labelAxis } : { x: labelAxis, y: valueAxis },
        plugins: {
          seasonMark: { index: spec.mark == null ? null : spec.mark },
          legend: {
            display: multi,
            position: "top",
            align: "start",
            labels: { color: dim, boxWidth: 8, boxHeight: 8, usePointStyle: true, padding: 14, font: { size: 12 } },
          },
          tooltip: {
            backgroundColor: cssVar("--surface2"),
            titleColor: cssVar("--fg"),
            bodyColor: cssVar("--fg"),
            borderColor: cssVar("--line"),
            borderWidth: 1,
            padding: 10,
            filter: (item) => !item.dataset.tips || !!item.dataset.tips[item.dataIndex],
            callbacks: {
              label: (c) => {
                if (c.dataset.tips) return " " + c.dataset.tips[c.dataIndex];
                const who = c.dataset.names ? c.dataset.names[c.dataIndex] + " - " : "";
                return " " + who + c.dataset.label + ": " + fmt(horizontal ? c.parsed.x : c.parsed.y);
              },
            },
          },
        },
      },
    });
    registry.set(canvas, { chart, spec });
    return chart;
  }

  function rebuildAll() {
    for (const [canvas, { spec }] of registry) buildChart(canvas, spec);
  }

  function initTheme(onChange) {
    const btn = document.getElementById("theme-toggle");
    if (!btn) return;
    btn.addEventListener("click", () => {
      const light = document.documentElement.dataset.theme === "light";
      const next = light ? "dark" : "light";
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem("theme", next); } catch (e) { /* storage unavailable */ }
      rebuildAll();
      if (onChange) onChange();
    });
  }

  window.NFLCharts = { reducedMotion, FORMATS, buildChart, initTheme, palette, cssVar, registry };
})();
