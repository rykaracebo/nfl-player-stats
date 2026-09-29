/* Draws every chart on the report page from the spec stored in its canvas. */
(function () {
  document.querySelectorAll("canvas[data-chart]").forEach((canvas) => {
    const spec = JSON.parse(canvas.dataset.chart);
    NFLCharts.buildChart(canvas, spec);
  });
  NFLCharts.initTheme();
})();
