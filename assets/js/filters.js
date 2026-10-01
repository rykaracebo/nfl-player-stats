/* A draggable season range under the dashboard's "Seasons" dropdowns. The two dropdowns stay the real, keyboard-friendly controls; the
   slider is a pointer and touch shortcut that sets them and fires their normal change event, so the dashboard behaves exactly as if
   the dropdowns had been used. It stays in step when a preset, a link or Reset all changes the dropdowns. */
(function () {
  "use strict";
  var minSel = document.getElementById("f-season-min"), maxSel = document.getElementById("f-season-max"), slot = document.getElementById("season-slot");
  if (!minSel || !maxSel || !slot) return;
  var rMin, rMax, fill, built = false;

  function build() {
    if (built || !minSel.options.length) return;
    var vals = Array.prototype.map.call(minSel.options, function (o) { return +o.value; }), first = Math.min.apply(null, vals), last = Math.max.apply(null, vals);
    if (!(last > first)) return;
    slot.innerHTML = '<div class="range-track" aria-hidden="true"><div class="range-fill"></div><input type="range" tabindex="-1"><input type="range" tabindex="-1"></div>';
    var inputs = slot.querySelectorAll("input");
    fill = slot.querySelector(".range-fill"); rMin = inputs[0]; rMax = inputs[1];
    [rMin, rMax].forEach(function (r) { r.min = first; r.max = last; r.step = 1; });
    rMin.addEventListener("input", function () {
      if (+rMin.value > +rMax.value) rMin.value = rMax.value;
      minSel.value = rMin.value; paint();
    });
    rMax.addEventListener("input", function () {
      if (+rMax.value < +rMin.value) rMax.value = rMin.value;
      maxSel.value = rMax.value; paint();
    });
    rMin.addEventListener("change", function () { minSel.dispatchEvent(new Event("change", { bubbles: true })); });
    rMax.addEventListener("change", function () { maxSel.dispatchEvent(new Event("change", { bubbles: true })); });
    built = true;
    sync();
  }

  function paint() {
    var a = +rMin.min, b = +rMin.max;
    fill.style.setProperty("--l", ((rMin.value - a) / (b - a)) * 100 + "%");
    fill.style.setProperty("--r", (100 - ((rMax.value - a) / (b - a)) * 100) + "%");
    // when both handles sit at the far end, the "from" handle must be the one on top so it can still be dragged back
    var nearEnd = +rMin.value > a + (b - a) / 2;
    rMin.style.zIndex = nearEnd ? 3 : 2; rMax.style.zIndex = nearEnd ? 2 : 3;
  }

  function sync() {
    if (!built) { build(); return; }
    rMin.value = minSel.value; rMax.value = maxSel.value; paint();
  }

  minSel.addEventListener("change", sync);
  maxSel.addEventListener("change", sync);
  document.addEventListener("nfl:update", sync);   // presets, links and Reset all set the dropdowns without a change event
  new MutationObserver(build).observe(minSel, { childList: true });   // the dropdowns are filled once the data has loaded
  build();
})();
