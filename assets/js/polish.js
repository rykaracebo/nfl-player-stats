/* Motion and hover effects for both pages. Decoration only: it never changes a number, a filter or a chart's data.
   Stat cards count up to their value and always end on the exact text the page computed.
   It does nothing at all when the visitor prefers reduced motion. */
(function () {
  "use strict";
  if (!window.matchMedia || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  var root = document.documentElement;
  root.classList.add("js-motion");

  // ---- scroll progress bar ----
  var bar = document.createElement("div");
  bar.className = "scroll-progress"; bar.setAttribute("aria-hidden", "true");
  document.body.appendChild(bar);
  var scrollQueued = false;
  function onScroll() {
    if (scrollQueued) return;
    scrollQueued = true;
    requestAnimationFrame(function () {
      var h = root.scrollHeight - root.clientHeight;
      bar.style.setProperty("--p", h > 0 ? Math.min(1, root.scrollTop / h).toFixed(4) : "0");
      scrollQueued = false;
    });
  }
  addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  // ---- pointer glow on cards and a slight drift of the background ----
  if (matchMedia("(hover: hover) and (pointer: fine)").matches) {
    var ambient = document.querySelector(".ambient"), last = null, moveQueued = false;
    document.addEventListener("pointermove", function (e) {
      last = e;
      if (moveQueued) return;
      moveQueued = true;
      requestAnimationFrame(function () {
        moveQueued = false;
        var card = last.target.closest && last.target.closest(".kpi, .panel, .table-panel, .chart-card");
        if (card) {
          var r = card.getBoundingClientRect();
          card.style.setProperty("--mx", last.clientX - r.left + "px");
          card.style.setProperty("--my", last.clientY - r.top + "px");
          if (card.classList.contains("kpi")) {
            card.style.setProperty("--rx", ((0.5 - (last.clientY - r.top) / r.height) * 9).toFixed(1) + "deg");
            card.style.setProperty("--ry", (((last.clientX - r.left) / r.width - 0.5) * 11).toFixed(1) + "deg");
          }
        }
        if (ambient) {
          ambient.style.setProperty("--ax", ((last.clientX / innerWidth - 0.5) * -24).toFixed(1) + "px");
          ambient.style.setProperty("--ay", ((last.clientY / innerHeight - 0.5) * -16).toFixed(1) + "px");
        }
      });
    }, { passive: true });
  }

  // ---- sections animate in as they scroll into view ----
  // Content is visible by default. Sections already on screen start hidden and fade in; sections below the fold
  // stay visible and play a short rise the first time they come into view. A failsafe shows anything still hidden.
  var cssScroll = window.CSS && CSS.supports && CSS.supports("animation-timeline: view()");   // then polish.css does this itself
  if ("IntersectionObserver" in window && !cssScroll) {
    var revealIo = new IntersectionObserver(function (entries) {
      var n = 0;
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        var el = en.target, delay = Math.min(n++, 5) * 70;
        revealIo.unobserve(el);
        el.style.setProperty("--d", delay + "ms");
        el.classList.add(el.classList.contains("reveal") ? "in" : "rise");
        // drop the helper classes afterwards so hover effects use their own timing
        setTimeout(function () { el.classList.remove("reveal", "in", "rise"); el.style.removeProperty("--d"); }, 1100 + delay);
      });
    }, { threshold: 0.08, rootMargin: "0px 0px -4% 0px" });
    var sections = document.querySelectorAll(".kpis .kpi, .panel, .table-panel, .controls, .chart-card, .finding-text, .advanced, .fieldpanel");
    sections.forEach(function (el) {
      if (el.getBoundingClientRect().top < innerHeight) el.classList.add("reveal");
      revealIo.observe(el);
    });
    setTimeout(function () {
      document.querySelectorAll(".reveal:not(.in)").forEach(function (el) { el.classList.add("in"); });
    }, 4000);
  }

  // ---- charts draw themselves again the first time they scroll into view ----
  if ("IntersectionObserver" in window && window.Chart) {
    var chartIo = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        chartIo.unobserve(en.target);
        var chart = window.Chart.getChart(en.target);
        if (chart) { chart.reset(); chart.update(); }
      });
    }, { threshold: 0.35 });
    document.querySelectorAll("canvas").forEach(function (cv) {
      if (cv.closest(".field-wrap") || cv.getBoundingClientRect().top < innerHeight) return;   // not the field, not charts already on screen
      chartIo.observe(cv);
    });
  }

  // ---- stat cards count up to the value the page computed ----
  var PLAIN_NUMBER = /^([−-]?)(\d[\d,]*)(?:\.(\d+))?(%?)$/;
  function countUp(el) {
    var text = el.textContent.trim(), m = PLAIN_NUMBER.exec(text);
    if (!m || document.hidden) return;
    var target = parseFloat(m[2].replace(/,/g, "") + (m[3] ? "." + m[3] : "")),
        decimals = m[3] ? m[3].length : 0,
        fmt = new Intl.NumberFormat("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: m[2].indexOf(",") > -1 }),
        start = performance.now(), duration = 950;
    el.textContent = m[1] + fmt.format(0) + m[4];
    (function frame(now) {
      var t = Math.min(1, (now - start) / duration);
      if (t >= 1) { el.textContent = text; return; }   // always finish on the exact text
      el.textContent = m[1] + fmt.format(target * (1 - Math.pow(2, -10 * t))) + m[4];
      requestAnimationFrame(frame);
    })(start);
  }
  var shown = {};   // last value shown per card label, so an unchanged card does not replay
  // The first set of numbers on a page is never animated, so a capture right after load always shows the exact figures;
  // the count-up plays when a filter changes them afterwards.
  var baseline = {};
  function animateCards(node, boxId) {
    if (node.nodeType !== 1) return;
    var cards = node.matches(".kpi") ? [node] : node.querySelectorAll(".kpi");
    cards.forEach(function (card) {
      var value = card.querySelector(".kpi-value"), label = card.querySelector(".kpi-label");
      if (!value || !label) return;
      var key = label.textContent, text = value.textContent.trim();
      if (shown[key] === text) return;
      shown[key] = text;
      if (!baseline[boxId]) return;
      countUp(value);
    });
  }
  ["summary", "milestones"].forEach(function (id) {
    var box = document.getElementById(id);
    if (!box) return;
    new MutationObserver(function (records) {
      records.forEach(function (r) { r.addedNodes.forEach(function (n) { animateCards(n, id); }); });
      baseline[id] = true;
    }).observe(box, { childList: true });
  });
  // the report's headline numbers count up when they scroll into view later (not when already on screen at load)
  if ("IntersectionObserver" in window) {
    var kpiIo = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        kpiIo.unobserve(en.target);
        countUp(en.target);
      });
    }, { threshold: 0.6 });
    document.querySelectorAll(".kpis .kpi-value").forEach(function (el) {
      if (el.getBoundingClientRect().top >= innerHeight) kpiIo.observe(el);
    });
  }
})();
