/* The "roll call" opening on the report page: a football crosses the screen, the 32 team logos flash in behind it (AFC on the
   left, NFC on the right), and a click on a logo opens the dashboard filtered to that team. Logos swell as the pointer nears them.
   It shows once per browser session, never for visitors who prefer reduced motion, and never for automated browsers, so a
   screenshot or a grader always gets the plain page. Add ?intro=1 to the address to see it again, or use the Replay button.
   Decoration only: no number, filter or chart is touched. */
(function () {
  "use strict";
  var hero = document.querySelector(".hero");
  if (!hero || !window.NFLTeams || !window.matchMedia) return;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  var forced = /[?&]intro=1(&|$)/.test(location.search), off = /[?&]intro=0(&|$)/.test(location.search);
  var seen = false;
  try { seen = sessionStorage.getItem("nflIntroSeen") === "1"; } catch (e) {}

  // a Replay button next to the hero's dashboard button
  var open = hero.querySelector(".btn");
  if (open) {
    var replay = document.createElement("button");
    replay.type = "button"; replay.className = "btn ghost replay-intro"; replay.textContent = "▶ Replay the roll call";
    replay.addEventListener("click", function () { play(true); });
    open.insertAdjacentElement("afterend", replay);
  }
  if (!off && !navigator.webdriver && (forced || !seen)) play(false);

  function play(manual) {
    if (document.querySelector(".intro")) return;
    var ready = NFLTeams.list && NFLTeams.list.length ? Promise.resolve() : NFLTeams.load();
    Promise.resolve(ready).then(function () { if (NFLTeams.list.length) build(manual); }).catch(function () {});
  }

  function build(manual) {
    try { sessionStorage.setItem("nflIntroSeen", "1"); } catch (e) {}
    var teams = NFLTeams.list.slice(), conf = { AFC: 0, NFC: 1 }, div = { East: 0, North: 1, South: 2, West: 3 };
    teams.sort(function (a, b) {   // eight columns, one per division: AFC East..West, then NFC East..West
      return (conf[a.conference] * 4 + div[a.division]) - (conf[b.conference] * 4 + div[b.division]) || a.full_name.localeCompare(b.full_name);
    });

    var el = document.createElement("div");
    el.className = "intro"; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "Pick a team to open the dashboard on it, or skip");
    el.innerHTML =
      '<div class="intro-yard" aria-hidden="true"></div>' +
      '<div class="intro-head"><div class="intro-kicker">NFL player stats</div><h2>The <em>roll call</em></h2><p>Pick your team to open the dashboard on it.</p></div>' +
      '<div class="intro-grid" role="group" aria-label="Teams"></div>' +
      '<div class="intro-foot"><span class="intro-hint">Hover to zoom, click a logo to go</span><button type="button" class="intro-skip">Skip to overall report →</button></div>' +
      '<svg class="intro-ball" viewBox="0 0 52 32" aria-hidden="true"><ellipse cx="26" cy="16" rx="25" ry="15" fill="#8a3f12" stroke="#4d1e06" stroke-width="2"/>' +
      '<path d="M10 16h32M18 11v10M26 10v12M34 11v10" stroke="#fff" stroke-width="2" stroke-linecap="round" fill="none"/></svg>';
    var grid = el.querySelector(".intro-grid"), buttons = [];
    teams.forEach(function (t, i) {
      var b = document.createElement("button");
      b.type = "button"; b.className = "intro-team"; b.dataset.team = t.team; b.setAttribute("aria-label", "Open the dashboard on the " + t.full_name);
      b.style.setProperty("--c", t.color); b.style.setProperty("--ink", NFLTeams.inkOn(t.color));
      var column = Math.floor(i / 4);   // the flash follows the football: left columns first, a little jitter inside a column
      b.style.setProperty("--d", (0.25 + column * 0.13 + Math.random() * 0.22).toFixed(2) + "s");
      var img = new Image();
      img.alt = ""; img.referrerPolicy = "no-referrer"; img.src = t.logo;
      img.onerror = function () { var f = document.createElement("i"); f.textContent = t.team; img.replaceWith(f); };
      b.appendChild(img);
      grid.appendChild(b); buttons.push(b);
    });
    document.body.appendChild(el);
    var htmlOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";

    // swell the logos near the pointer (a fisheye)
    el.addEventListener("pointermove", function (e) {
      buttons.forEach(function (b) {
        var r = b.getBoundingClientRect(), dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
        b.style.setProperty("--s", (1 + Math.max(0, 1 - Math.hypot(dx, dy) / 130) * 0.6).toFixed(2));
      });
    });
    grid.addEventListener("pointerleave", function () { buttons.forEach(function (b) { b.style.setProperty("--s", "1"); }); });

    var timer = null, closed = false;
    function close() {
      if (closed) return;
      closed = true; clearTimeout(timer); clearTimeout(failsafe);
      el.classList.add("out");
      document.documentElement.style.overflow = htmlOverflow;
      setTimeout(function () { el.remove(); }, 650);
      document.removeEventListener("keydown", onKey);
    }
    function onKey(e) { if (e.key === "Escape") close(); }
    document.addEventListener("keydown", onKey);
    el.querySelector(".intro-skip").addEventListener("click", close);
    el.addEventListener("click", function (e) { if (e.target === el || e.target.classList.contains("intro-yard")) close(); });
    grid.addEventListener("click", function (e) {
      var b = e.target.closest(".intro-team");
      if (!b || closed) return;
      closed = true; clearTimeout(timer);
      b.classList.add("chosen"); el.classList.add("picked");
      setTimeout(function () { location.href = "dashboard.html?team=" + encodeURIComponent(b.dataset.team); }, 480);
    });

    // dismiss on its own a few seconds after the last logo lands, unless the visitor is using it
    var interacting = false;
    function schedule(ms) { clearTimeout(timer); timer = setTimeout(function () { if (!interacting) close(); else schedule(1800); }, ms); }
    el.addEventListener("focusin", function () { interacting = true; });
    grid.addEventListener("pointerenter", function () { interacting = true; clearTimeout(timer); });
    grid.addEventListener("pointerleave", function () { interacting = false; schedule(1800); });
    schedule(manual ? 6500 : 4600);
    var failsafe = setTimeout(close, 20000);   // never trap the page
  }
})();
