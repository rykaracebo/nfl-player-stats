/* Shared chart helpers and theme toggle, used by the report and the dashboard. */
(function () {
  const FORMATS = {
    epa: (v) => (v >= 0 ? "+" : "") + v.toFixed(3),
    pct: (v) => (v * 100).toFixed(1) + "%",
    num: (v) => Math.round(v).toLocaleString("en-US"),
    int: (v) => Math.round(v).toLocaleString("en-US"),
    dec1: (v) => v.toFixed(1),
    dec2: (v) => v.toFixed(2),
    dec3: (v) => v.toFixed(3),
    yds: (v) => v.toFixed(1),
  };

  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
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
    const colors = spec.colors || palette(spec.datasets.length);
    const isLine = spec.kind === "line";
    const horizontal = spec.kind === "hbar";
    const dim = cssVar("--dim");
    const grid = cssVar("--grid");
    const multi = spec.datasets.length > 1;
    const surface = cssVar("--surface");

    const datasets = spec.datasets.map((ds, i) => ({
      label: ds.label,
      names: ds.names || null,
      data: ds.data,
      borderColor: colors[i % colors.length],
      backgroundColor: colors[i % colors.length],
      borderWidth: isLine ? 2 : 0,
      pointRadius: isLine ? 4 : 0,
      pointHoverRadius: isLine ? 6 : 0,
      pointBackgroundColor: colors[i % colors.length],
      pointBorderColor: surface,
      pointBorderWidth: 2,
      tension: 0.25,
      borderRadius: isLine ? 0 : 4,
      borderSkipped: false,
      maxBarThickness: horizontal ? 18 : 64,
      categoryPercentage: 0.8,
      barPercentage: 0.9,
    }));

    const valueAxis = {
      title: { display: !!spec.yTitle, text: spec.yTitle, color: dim, font: { size: 11 } },
      grid: { color: grid },
      border: { display: false },
      ticks: { color: dim, font: { family: "Geist Mono", size: 11 }, callback: (v) => fmt(v) },
      beginAtZero: !isLine,
    };
    const labelAxis = {
      grid: { display: false },
      border: { color: grid },
      ticks: { color: dim, font: { size: 11 }, autoSkip: false, maxRotation: 0 },
    };

    const chart = new Chart(canvas, {
      type: isLine ? "line" : "bar",
      data: { labels: spec.labels, datasets },
      options: {
        indexAxis: horizontal ? "y" : "x",
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 350 },
        interaction: { mode: isLine ? "index" : "nearest", intersect: !isLine && false, axis: horizontal ? "y" : "x" },
        scales: horizontal ? { x: valueAxis, y: labelAxis } : { x: labelAxis, y: valueAxis },
        plugins: {
          legend: {
            display: multi,
            position: "bottom",
            labels: { color: dim, boxWidth: 10, boxHeight: 10, usePointStyle: true, font: { size: 12 } },
          },
          tooltip: {
            backgroundColor: cssVar("--surface2"),
            titleColor: cssVar("--fg"),
            bodyColor: cssVar("--fg"),
            borderColor: cssVar("--line"),
            borderWidth: 1,
            padding: 10,
            callbacks: {
              label: (c) => {
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

  window.NFLCharts = { FORMATS, buildChart, initTheme, palette, cssVar, registry };
})();
