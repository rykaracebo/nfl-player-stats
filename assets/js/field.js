/* The Play Board: a top-down football field where the 32 teams run routes.
   AFC teams line up on the left and drive right, NFC teams line up on the right and drive left. Every few seconds the ball is
   thrown to a random team, and a pop-up shows who caught it. Hover a team to freeze the play and see its numbers, click to open
   it, filter by conference, size the dots by a stat, or pause. Needs NFLTeams (teams.js) loaded first. */
(function () {
  "use strict";
  const TAU = Math.PI * 2;
  const fmt = (m, v) => (m.digits === 0 ? Math.round(v).toLocaleString("en-US") : v.toFixed(m.digits));
  const ease = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
  const clamp01 = (u) => Math.max(0, Math.min(1, u));

  // Route tree: [forward yards, sideways yards]. Sideways sign is flipped per team for variety.
  const ROUTES = {
    go: [[0, 0], [38, 0]],
    slant: [[0, 0], [5, 0], [16, 11]],
    out: [[0, 0], [14, 0], [14, 12]],
    dig: [[0, 0], [15, 0], [15, -13]],
    post: [[0, 0], [13, 0], [30, -13]],
    corner: [[0, 0], [13, 0], [30, 13]],
    curl: [[0, 0], [16, 0], [12, 3]],
    comeback: [[0, 0], [20, 0], [14, 6]],
    hitch: [[0, 0], [9, 0], [6, 0]],
    flat: [[0, 0], [4, 15]],
    wheel: [[0, 0], [6, 12], [34, 12]],
    fade: [[0, 0], [34, 6]],
    drag: [[0, 0], [3, 0], [7, -22]],
  };
  const ROUTE_NAMES = Object.keys(ROUTES);

  const CYCLE = 7.2, RUN_START = 0.5, RUN_DUR = 3.4, THROW_AT = 2.0, CATCH_AT = 3.2, HOLD_UNTIL = 5.7, RESET_DUR = 1.0;

  function mount(container, opts) {
    const teams = opts.teams, summary = opts.summary, measures = summary.measures;
    const sized = opts.measureSelect !== false; // the dashboard has its own Measure picker, so its field has no second one and equal-size dots
    let measureId = measures[0].id, conf = "All", flash = null, flashRaf = 0;
    let paused = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    let hover = null, selected = opts.selected || null, mode = "random", playing = false;   // random: the ball goes to a random team on its own; pick: you choose the play
    let clock = paused ? 4.2 : 0, last = performance.now(), target = null, tipKey = null;

    // ---------------------------------------------------------------- markup
    container.innerHTML =
      "<div class='field-head'><div><h2></h2><p></p></div><div class='field-tools'>" +
      "<div class='seg' role='group' aria-label='Conference'></div>" +
      (sized ? "<label class='sr' for='field-measure'>Dot size shows</label><select id='field-measure'></select>" : "") +
      "<button type='button' class='btn ghost small' id='field-pause'></button></div></div>" +
      "<div class='field-modes'><div class='seg' id='field-mode' role='group' aria-label='What happens on the field'></div><p class='field-modehint'></p></div>" +
      "<div class='field-pick' hidden><label>Throw to<select id='pick-team'></select></label><label>Routes<select id='pick-route'></select></label><button type='button' class='btn small' id='pick-run'>Run the play</button></div>" +
      "<div class='field-wrap'><canvas role='img'></canvas><div class='field-tip' role='tooltip' hidden></div></div>" +
      "<p class='field-caption'></p>" +
      "<details class='teamlist'><summary>All 32 teams as a list</summary><ul></ul></details>";
    container.querySelector("h2").textContent = opts.title || "The league on the field";
    container.querySelector("p").textContent = opts.blurb || "";
    const canvas = container.querySelector("canvas"), tip = container.querySelector(".field-tip");
    const caption = container.querySelector(".field-caption"), wrap = container.querySelector(".field-wrap");
    const ctx = canvas.getContext("2d");
    canvas.setAttribute("aria-label", "A football field where the 32 NFL teams run routes and the ball is thrown to a random team. AFC teams run right, NFC teams run left. Use the team list below the field for keyboard access.");
    caption.id = "field-caption-" + Math.random().toString(36).slice(2, 8); canvas.setAttribute("aria-describedby", caption.id); // the caption is the written description of what the board shows

    const seg = container.querySelector(".seg");
    ["All", "AFC", "NFC"].forEach((c) => {
      const b = document.createElement("button");
      b.type = "button"; b.textContent = c; b.setAttribute("aria-pressed", c === conf ? "true" : "false");
      b.addEventListener("click", () => { conf = c; seg.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x.textContent === c ? "true" : "false")); if (target && conf !== "All" && target.conference !== conf) target = null; redrawIfPaused(); });
      seg.appendChild(b);
    });
    const sel = container.querySelector("#field-measure");
    if (sel) {
      measures.forEach((m) => { const o = document.createElement("option"); o.value = m.id; o.textContent = "Dot size: " + m.label; sel.appendChild(o); });
      sel.addEventListener("change", () => { measureId = sel.value; tipKey = null; redrawIfPaused(); });
    }
    // ---- what happens on the field: random plays, pick a play, or play a whole game
    const modeSeg = container.querySelector("#field-mode"), modeHint = container.querySelector(".field-modehint"), pickBox = container.querySelector(".field-pick");
    const pickTeam = container.querySelector("#pick-team"), pickRoute = container.querySelector("#pick-route");
    const HINTS = { classic: "The original field: the ball goes to a random team every few seconds, and each team runs the same route every play.", random: "The ball goes to a random team every few seconds, and every team runs a new route each play.", pick: "You choose who gets the ball and which routes everyone runs. Pick a team and press Run, or just click a helmet.", game: "" };
    const pt0 = document.createElement("option"); pt0.value = ""; pt0.textContent = "A random team"; pickTeam.appendChild(pt0);
    teams.slice().sort((x, y) => x.full_name.localeCompare(y.full_name)).forEach((t) => { const o = document.createElement("option"); o.value = t.team; o.textContent = t.full_name; pickTeam.appendChild(o); });
    [["mixed", "Mixed: every team different"], ["deep", "Deep shots"], ["quick", "Quick passes"], ["cross", "Crossing routes"]].concat(ROUTE_NAMES.map((n) => [n, "Everyone runs a " + n])).forEach(([v, l]) => { const o = document.createElement("option"); o.value = v; o.textContent = l; pickRoute.appendChild(o); });
    function setMode(m) {
      mode = m; hover = null; stuck = null; tip.hidden = true; tipKey = null;
      modeSeg.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x.dataset.mode === m ? "true" : "false"));
      pickBox.hidden = m !== "pick"; modeHint.textContent = HINTS[m] || "";
      if (m === "random") { playing = false; clock = (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) ? 4.2 : 0; target = pickTarget(); assignRoutes("mixed"); tipKey = null; }
      if (m === "classic") { playing = false; clock = 0; target = pickTarget(); classicRoutes(); tipKey = null; paused = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches; setPauseLabel(); }
      if (m === "pick") { playing = false; clock = 0; target = null; assignRoutes("mixed"); tipKey = null; paused = false; setPauseLabel(); }
      redrawIfPaused(); draw();
    }
    function runPlay(code) {
      const pool = teams.filter((t) => conf === "All" || t.conference === conf);
      let t = (code && byTeam(code)) || (pickTeam.value && byTeam(pickTeam.value)) || null;
      if (!t || (conf !== "All" && t.conference !== conf)) t = pool[Math.floor(Math.random() * pool.length)];   // a team hidden by the conference filter can't catch the ball
      if (code) pickTeam.value = code;
      assignRoutes(pickRoute.value || "mixed"); target = t; clock = 0; playing = true; paused = false; stuck = null; hover = null; tip.hidden = true; tipKey = null; setPauseLabel(); draw();
    }
    const byTeam = (code) => teams.find((t) => t.team === code);
    [["random", "Random plays"], ["classic", "Classic"], ["pick", "Pick a play"]].concat(window.NFLGame && NFLTeams.helmets ? [["game", "Play a game"]] : []).forEach(([m, l]) => {
      const b = document.createElement("button"); b.type = "button"; b.dataset.mode = m; b.textContent = l; b.setAttribute("aria-pressed", m === "random" ? "true" : "false");
      b.addEventListener("click", () => {
        if (m === "game") { const back = mode; paused = true; setPauseLabel(); NFLGame.open(container, { teams, summary, selected, ball: (g, x, y, len, ang, spin) => football(x, y, len, ang, 1, spin, g), onClose: () => { paused = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches; setPauseLabel(); setMode(back === "game" ? "random" : back); } }); return; }
        setMode(m);
      });
      modeSeg.appendChild(b);
    });
    modeHint.textContent = HINTS.random;
    container.querySelector("#pick-run").addEventListener("click", () => runPlay(null));
    const pauseBtn = container.querySelector("#field-pause");
    const setPauseLabel = () => { pauseBtn.textContent = paused ? "Play" : "Pause"; pauseBtn.setAttribute("aria-label", paused ? "Play the field animation" : "Pause the field animation"); };
    setPauseLabel();
    // follow the visitor's motion setting, even if they change it while the page is open
    const motionQuery = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)");
    if (motionQuery && motionQuery.addEventListener) motionQuery.addEventListener("change", (e) => { paused = e.matches; setPauseLabel(); last = performance.now(); if (paused) draw(); });
    // no drawing while the field is scrolled out of view
    let onScreen = true;
    if (window.IntersectionObserver) new IntersectionObserver((entries) => { onScreen = entries[0].isIntersecting; last = performance.now(); if (onScreen && (paused || hover)) draw(); }).observe(container);
    pauseBtn.addEventListener("click", () => { paused = !paused; setPauseLabel(); last = performance.now(); redrawIfPaused(); });

    const ul = container.querySelector("ul");
    teams.slice().sort((a, b) => a.full_name.localeCompare(b.full_name)).forEach((t) => {
      const li = document.createElement("li"), a = document.createElement("a");
      a.href = opts.linkFor ? opts.linkFor(t.team) : "#";
      a.innerHTML = NFLTeams.badge(t.team) + " ";
      a.appendChild(document.createTextNode(t.full_name));
      a.addEventListener("click", (e) => { if (opts.onSelect) { e.preventDefault(); opts.onSelect(t.team); } });
      li.appendChild(a); ul.appendChild(li);
    });

    // ---------------------------------------------------------------- formation and routes (field units are yards)
    // Field is 120 yards long (10-yard end zones) and 53.3 yards wide. AFC lines up left, NFC right, two rows of eight.
    const order = (c) => teams.filter((t) => t.conference === c).sort((a, b) => a.division.localeCompare(b.division) || a.full_name.localeCompare(b.full_name));
    const slots = [];
    ["AFC", "NFC"].forEach((c, ci) => {
      order(c).forEach((t, i) => {
        const row = i % 2, lane = Math.floor(i / 2);
        const startX = ci === 0 ? 34 - row * 9 : 86 + row * 9;
        const startY = 5 + (lane + row * 0.5) * 6.1;
        const dir = ci === 0 ? 1 : -1;
        slots.push({ t, start: [startX, startY], dir, pts: [], lens: [], total: 0, i, ci });
      });
    });
    // Route tree choices. "Mixed" gives every team a random route, so no two plays look alike; the other concepts run a themed set.
    const CONCEPTS = { deep: ["go", "post", "corner", "fade", "wheel"], quick: ["slant", "hitch", "flat", "drag", "curl"], cross: ["drag", "dig", "slant", "out", "comeback"] };
    function setRoute(s, name, flip) {
      s.routeName = name;
      s.pts = ROUTES[name].map(([u, v]) => [s.start[0] + s.dir * u, Math.max(3, Math.min(50.3, s.start[1] + v * flip))]);
      s.lens = [0]; for (let k = 1; k < s.pts.length; k++) s.lens.push(s.lens[k - 1] + Math.hypot(s.pts[k][0] - s.pts[k - 1][0], s.pts[k][1] - s.pts[k - 1][1]));
      s.total = s.lens[s.lens.length - 1];
    }
    function assignRoutes(concept) {
      const pool = !concept || concept === "mixed" ? ROUTE_NAMES : CONCEPTS[concept] || [concept];
      slots.forEach((s) => setRoute(s, pool[Math.floor(Math.random() * pool.length)], Math.random() < 0.5 ? 1 : -1));
    }
    function classicRoutes() { slots.forEach((s) => setRoute(s, ROUTE_NAMES[(s.i * 5 + s.ci * 3) % ROUTE_NAMES.length], (s.i + s.ci) % 2 ? 1 : -1)); }   // the original board: every team keeps the same route every play
    assignRoutes("mixed");
    const slotOf = {}; slots.forEach((s) => (slotOf[s.t.team] = s));
    function along(s, p) { // point at fraction p of the route
      const d = p * s.total;
      for (let k = 1; k < s.pts.length; k++) if (d <= s.lens[k] + 1e-9) { const u = (d - s.lens[k - 1]) / Math.max(1e-9, s.lens[k] - s.lens[k - 1]); return [s.pts[k - 1][0] + (s.pts[k][0] - s.pts[k - 1][0]) * u, s.pts[k - 1][1] + (s.pts[k][1] - s.pts[k - 1][1]) * u]; }
      return s.pts[s.pts.length - 1];
    }
    // yard position of a team at a time within the cycle
    function yardsAt(s, tm) {
      if (tm < RUN_START) return s.pts[0];
      if (tm <= RUN_START + RUN_DUR) return along(s, ease(clamp01((tm - RUN_START) / RUN_DUR)));
      if (tm <= HOLD_UNTIL) return s.pts[s.pts.length - 1];
      const u = ease(clamp01((tm - HOLD_UNTIL) / RESET_DUR)), e = s.pts[s.pts.length - 1], b = s.pts[0];
      return [e[0] + (b[0] - e[0]) * u, e[1] + (b[1] - e[1]) * u];
    }

    const images = {};
    teams.forEach((t) => { const im = new Image(); im.referrerPolicy = "no-referrer"; im.onload = () => { im._ok = true; redrawIfPaused(); }; im.src = NFLTeams.helmets ? NFLTeams.helmetSheet(t.team) : t.logo; images[t.team] = im; });
    const values = (mid) => teams.map((t) => (summary.teams[t.team] ? summary.teams[t.team][mid] : NaN));
    const rankOf = (code, mid) => 1 + values(mid).filter((x) => x > summary.teams[code][mid]).length;

    // ---------------------------------------------------------------- layout
    let W = 0, H = 0, sx = 1, sy = 1, dpr = 1, dots = [];
    function layout() {
      W = Math.round(wrap.clientWidth);
      if (!W) return;
      H = Math.round(W / (W < 640 ? 1.25 : 2));
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = W * dpr; canvas.height = H * dpr; canvas.style.height = H + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      sx = W / 120; sy = H / 53.3;
      draw();
    }
    if (window.ResizeObserver) new ResizeObserver(layout).observe(wrap); else window.addEventListener("resize", layout);
    const px = (p) => [p[0] * sx, p[1] * sy];

    // ---------------------------------------------------------------- drawing
    // Draw text so the visible letters are centered on (x, y), ignoring trailing letter spacing and the font's baseline offset.
    function inkText(label, x, y, rot) {
      ctx.save(); ctx.textAlign = "left"; ctx.textBaseline = "alphabetic"; // set BEFORE measuring: the bounds are relative to these
      const m = ctx.measureText(label);
      const x0 = -(m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2, y0 = (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
      ctx.translate(x, y); ctx.rotate(rot || 0); ctx.fillText(label, x0, y0); ctx.restore();
    }

    // Field colors come from the site's CSS tokens so the board matches the page (and the light theme).
    let pal = null;
    function palette() {
      const cs = getComputedStyle(document.documentElement), v = (n, d) => (cs.getPropertyValue(n) || "").trim() || d;
      const light = document.documentElement.getAttribute("data-theme") === "light";
      pal = { light, bg: v("--bg", "#050b18"), surface: v("--surface", "#0b1730"), surface2: v("--surface2", "#112044"), line: v("--line", "#1d3260"),
        ink: light ? "10,26,51" : "245,247,251", dim: v("--dim", "#a6b4d0") };
      return pal;
    }
    new MutationObserver(() => { pal = null; redrawIfPaused(); }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    const glow = { on: false, x: 0, y: 0, tx: 0, ty: 0, a: 0 };
    const L = {}, M = {}, SP = {}, mouse = { x: 0, y: 0, on: false }; // eased hover lift and pointer-proximity swell per team
    let speed = 1; // play speed, eased so hovering slows the play down smoothly instead of stopping it dead
    function drawField() {
      const P = pal || palette(), ink = P.ink;
      // turf: two close navy tones in 10-yard bands, like the page's yard-line background
      for (let i = 0; i < 12; i++) { ctx.fillStyle = i % 2 ? P.surface : P.surface2; ctx.fillRect(i * 10 * sx, 0, 10 * sx + 1, H); }
      // end zones: league red and navy washes, as in the page's corner glows
      ctx.fillStyle = P.light ? "rgba(213,10,10,.16)" : "rgba(229,20,26,.30)"; ctx.fillRect(0, 0, 10 * sx, H);
      ctx.fillStyle = P.light ? "rgba(1,51,105,.18)" : "rgba(1,51,105,.62)"; ctx.fillRect(110 * sx, 0, 10 * sx, H);
      // soft vignette so the middle reads as the lit part of the board
      const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.2, W / 2, H / 2, W * 0.62);
      vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, P.light ? "rgba(10,26,51,.10)" : "rgba(2,6,16,.45)"); ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
      // light from above: a bright wash along the top fading to shade at the bottom, plus a glow under the pointer
      const lit = ctx.createLinearGradient(0, 0, 0, H);
      lit.addColorStop(0, P.light ? "rgba(255,255,255,.35)" : "rgba(120,160,255,.10)"); lit.addColorStop(0.5, "rgba(0,0,0,0)"); lit.addColorStop(1, P.light ? "rgba(10,26,51,.12)" : "rgba(0,4,14,.38)");
      ctx.fillStyle = lit; ctx.fillRect(0, 0, W, H);
      if (glow.a > 0.01) { ctx.save(); ctx.globalAlpha = glow.a; const gg = ctx.createRadialGradient(glow.x, glow.y, 0, glow.x, glow.y, H * 0.55); gg.addColorStop(0, P.light ? "rgba(213,10,10,.14)" : "rgba(255,182,18,.16)"); gg.addColorStop(1, "rgba(0,0,0,0)"); ctx.fillStyle = gg; ctx.fillRect(0, 0, W, H); ctx.restore(); }
      // end zone lettering in the display face, quiet like a watermark
      ctx.fillStyle = "rgba(" + ink + ",.55)"; ctx.font = Math.round(H * 0.15) + "px 'Bebas Neue', 'Geist', sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      if ("letterSpacing" in ctx) ctx.letterSpacing = Math.round(H * 0.025) + "px";
      [[5, "AFC", -Math.PI / 2], [115, "NFC", Math.PI / 2]].forEach(([yd, label, rot]) => inkText(label, yd * sx, H / 2, rot));
      if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
      // midfield logo, dimmed into the surface
      if (leagueImg && leagueImg.naturalWidth) { const lh = H * 0.36, lw = lh * (leagueImg.naturalWidth / leagueImg.naturalHeight); ctx.save(); ctx.globalAlpha = P.light ? 0.5 : 0.4; ctx.drawImage(leagueImg, 60 * sx - lw / 2, H / 2 - lh / 2, lw, lh); ctx.restore(); }
      // hairline yard lines
      for (let y = 10; y <= 110; y += 5) {
        const goal = y === 10 || y === 110;
        ctx.strokeStyle = "rgba(" + ink + "," + (goal ? 0.6 : y % 10 === 0 ? 0.26 : 0.12) + ")"; ctx.lineWidth = goal ? 2 : 1;
        ctx.beginPath(); ctx.moveTo(y * sx, 0); ctx.lineTo(y * sx, H); ctx.stroke();
      }
      ctx.strokeStyle = "rgba(" + ink + ",.16)"; ctx.lineWidth = 1;
      for (let y = 11; y < 110; y++) { if (y % 5 === 0) continue; [0.37, 0.63].forEach((f) => { ctx.beginPath(); ctx.moveTo(y * sx, H * f - H * 0.012); ctx.lineTo(y * sx, H * f + H * 0.012); ctx.stroke(); }); }
      // yard numbers in the site's mono face
      ctx.fillStyle = "rgba(" + ink + ",.34)"; ctx.font = "600 " + Math.round(H * 0.06) + "px 'Geist Mono', monospace"; if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
      [10, 20, 30, 40, 50, 40, 30, 20, 10].forEach((n, i) => { const x = (20 + i * 10) * sx; inkText(String(n), x, H * 0.075, Math.PI); inkText(String(n), x, H * 0.925, 0); });   // like a real field: the far (top) numbers are upside down, the near (bottom) ones read upright
      if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
      ctx.strokeStyle = P.line; ctx.lineWidth = 2; ctx.strokeRect(1, 1, W - 2, H - 2);
    }

    // A 3D game ball. The ball is a real football-shaped solid (a surface of revolution) that is ray-cast once into per-pixel
    // geometry. The leather, seams, laces and printing are painted on an unwrapped texture that is wrapped around it and lit from
    // above left, so turning the texture around the long axis gives a true spiral. Frames for 48 roll angles are rendered in the background, and
    // the roll blends between neighbouring frames so even a slow turn looks continuous. The crest is the league logo from the link in the nflverse teams file (not a manufacturer's branding).
    let ballSprite = null, ballGeo = null, ballTimer = 0;
    const invalidateBall = () => { clearTimeout(ballTimer); ballTimer = setTimeout(() => { ballSprite = null; redrawIfPaused(); }, 80); }; // fonts and the logo can finish together: rebuild once
    const BALL = { W: 380, H: 220, SS: 2, A: 170, B: 93, PITCH: 0.3, FRAMES: 48, TW: 640, TH: 372, Z0: 600, SHAPE: 0.7 };
    let leagueImg = null, leagueReadable = false;
    if (NFLTeams.leagueLogo && NFLTeams.leagueLogo()) {
      const url = NFLTeams.leagueLogo();
      // first try a CORS-enabled load so the logo can be read onto the ball; if that fails, load it plainly for the midfield paint only
      const load = (cors, fail) => {
        const im = new Image(); im.referrerPolicy = "no-referrer"; if (cors) im.crossOrigin = "anonymous";
        im.onload = () => { leagueImg = im; leagueReadable = cors; invalidateBall(); };
        im.onerror = fail || null; im.src = url;
      };
      load(true, () => load(false));
    }

    // the unwrapped leather: horizontal = along the ball, vertical = around it (4 panels, seams at 80, 240, 400, 560; laces on the one at 80).
    // Modeled on the look of a pro game ball: deep red-brown leather with cloudy tone changes, a very fine pebble, barely visible seams,
    // a short run of wide white laces inside a thin stitched oval, and a large league shield centred between two small text blocks.
    function makeBallTexture() {
      const TW = BALL.TW, TH = BALL.TH, c = document.createElement("canvas"); c.width = TH; c.height = TW;
      const g = c.getContext("2d");
      let seed = 11; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      const tints = ["#7c2a1c", "#762719", "#80301f", "#702518"];
      for (let k = 0; k < 4; k++) {
        const y0 = 80 + k * 160; g.fillStyle = tints[k];
        if (y0 + 160 <= TW) g.fillRect(0, y0, TH, 160); else { g.fillRect(0, y0, TH, TW - y0); g.fillRect(0, 0, TH, y0 + 160 - TW); }
      }
      // cloudy tone: broad, soft patches of slightly lighter and darker leather
      for (let i = 0; i < 70; i++) {
        const x = rnd() * TH, y = rnd() * TW, r = 28 + rnd() * 70, dark = rnd() < 0.5, gr = g.createRadialGradient(x, y, 0, x, y, r);
        gr.addColorStop(0, dark ? "rgba(30,8,4,.16)" : "rgba(205,70,55,.10)"); gr.addColorStop(1, "rgba(0,0,0,0)");
        g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
      }
      // leather pulls darker toward each seam
      for (let k = 0; k < 4; k++) {
        const cy = 160 + k * 160, gr = g.createLinearGradient(0, cy - 80, 0, cy + 80);
        gr.addColorStop(0, "rgba(0,0,0,.24)"); gr.addColorStop(0.3, "rgba(0,0,0,0)"); gr.addColorStop(0.7, "rgba(0,0,0,0)"); gr.addColorStop(1, "rgba(0,0,0,.24)");
        g.fillStyle = gr; g.fillRect(0, cy - 80, TH, 160);
      }
      // very fine pebble
      for (let i = 0; i < 34000; i++) {
        const x = rnd() * TH, y = rnd() * TW, r = 0.55 + rnd() * 0.75;
        g.fillStyle = "rgba(25,6,3," + (0.14 + rnd() * 0.16).toFixed(2) + ")"; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
        g.fillStyle = "rgba(255,140,120," + (0.05 + rnd() * 0.06).toFixed(2) + ")"; g.beginPath(); g.arc(x - r * 0.5, y - r * 0.6, r * 0.65, 0, TAU); g.fill();
      }
      // seams: a soft dark line with a faint lit edge; the stitching is nearly hidden, as on the real ball
      [80, 240, 400, 560].forEach((w) => {
        g.lineCap = "butt";
        g.strokeStyle = "rgba(14,4,2,.62)"; g.lineWidth = 4; g.beginPath(); g.moveTo(0, w); g.lineTo(TH, w); g.stroke();
        g.strokeStyle = "rgba(255,170,130,.10)"; g.lineWidth = 2; g.beginPath(); g.moveTo(0, w - 3.5); g.lineTo(TH, w - 3.5); g.stroke();
        for (let u = 8; u < TH - 4; u += 11) {
          g.strokeStyle = "rgba(18,6,2,.22)"; g.lineWidth = 1.3; g.beginPath(); g.moveTo(u, w - 6); g.lineTo(u, w + 6); g.stroke();
        }
      });
      // printed marks on the panel that faces the camera (centre at 160): a large shield between two small text blocks, in dark ink
      const cu = TH / 2, cw = 168, ink = "rgba(14,10,14,.82)", edge = "rgba(255,170,130,.10)";
      const text = (str, u, w, size, sp, font) => {
        g.font = font || (size + "px 'Bebas Neue', 'Geist', Arial, sans-serif"); g.textAlign = "center"; g.textBaseline = "middle";
        if ("letterSpacing" in g) g.letterSpacing = Math.round(size * sp) + "px";
        g.fillStyle = edge; g.fillText(str, u + 0.7, w + 0.9); g.fillStyle = ink; g.fillText(str, u, w);
        if ("letterSpacing" in g) g.letterSpacing = "0px";
      };
      text("“PLAYER STATS”", cu - TH * 0.27, cw - 9, 17, 0.1); text("2009–2025", cu - TH * 0.27, cw + 9, 20, 0.06);
      text("Regular season", cu + TH * 0.27, cw - 9, 19, 0, "italic 21px 'Instrument Serif', Georgia, serif"); text("PER TEAM-GAME", cu + TH * 0.27, cw + 9, 10.5, 0.14);
      if (leagueImg && leagueImg.naturalWidth && leagueReadable) {
        const lh = 86, lw = lh * (leagueImg.naturalWidth / leagueImg.naturalHeight);
        g.save(); g.globalAlpha = 0.96; g.shadowColor = "rgba(0,0,0,.3)"; g.shadowBlur = 2; g.shadowOffsetY = 1; g.drawImage(leagueImg, cu - lw / 2, cw - lh / 2, lw, lh); g.restore();
      }
      // laces: a thin stitched oval around a short, tight run of wide white cords wrapped over the seam at 80
      const lu = TH / 2;
      g.save(); g.beginPath(); g.ellipse(lu, 80, 100, 33, 0, 0, TAU);
      g.fillStyle = "rgba(0,0,0,.10)"; g.fill();
      g.strokeStyle = "rgba(10,3,1,.75)"; g.lineWidth = 2; g.setLineDash([5, 3]); g.stroke(); g.setLineDash([]);
      g.beginPath(); g.ellipse(lu, 82, 98, 32, 0, 0.15, Math.PI - 0.15); g.strokeStyle = "rgba(255,170,130,.12)"; g.lineWidth = 1.5; g.stroke(); g.restore();
      g.lineCap = "round";
      g.strokeStyle = "rgba(8,2,0,.85)"; g.lineWidth = 7; g.beginPath(); g.moveTo(lu - 72, 80); g.lineTo(lu + 72, 80); g.stroke();
      for (let k = -3; k <= 3; k++) {
        const x0 = lu + k * 22, half = 21 - Math.abs(k) * 0.9;
        g.strokeStyle = "rgba(10,3,1,.5)"; g.lineWidth = 15; g.beginPath(); g.moveTo(x0 + 2.5, 80 - half + 4); g.lineTo(x0 + 2.5, 80 + half + 4); g.stroke();
        const gr = g.createLinearGradient(x0 - 7, 0, x0 + 7, 0); gr.addColorStop(0, "#b9b3a6"); gr.addColorStop(0.3, "#ece8df"); gr.addColorStop(0.6, "#f6f3ec"); gr.addColorStop(1, "#aaa496");
        g.strokeStyle = gr; g.lineWidth = 15; g.beginPath(); g.moveTo(x0, 80 - half); g.lineTo(x0, 80 + half); g.stroke();
        g.strokeStyle = "rgba(90,80,62,.22)"; g.lineWidth = 1; g.beginPath(); g.moveTo(x0 - 2.5, 80 - half + 3); g.lineTo(x0 - 2.5, 80 + half - 3); g.stroke();
      }
      return g.getImageData(0, 0, TH, TW).data;
    }

    // per-pixel hit point, normal and lighting for the solid, computed once (they do not change as the ball rolls on its long axis)
    function makeBallGeo() {
      const W = BALL.W, H = BALL.H, SS = BALL.SS, A = BALL.A, B = BALL.B, Z0 = BALL.Z0, SH = BALL.SHAPE;
      const GW = W * SS, GH = H * SS, N = GW * GH, cp = Math.cos(BALL.PITCH), sp = Math.sin(BALL.PITCH);
      const rt = new Float32Array(1026);
      for (let i = 0; i < 1026; i++) { const u = i / 512 - 1; rt[i] = B * Math.pow(Math.max(0, 1 - u * u), SH); }
      const R = (x) => { const f = (x / A * 0.5 + 0.5) * 1024, i = Math.max(0, Math.min(1023, f | 0)); return rt[i] + (rt[i + 1] - rt[i]) * (f - i); };
      const s = new Float32Array(N), th = new Float32Array(N), sh = new Float32Array(N), spc = new Float32Array(N), ok = new Uint8Array(N);
      const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
      const lightDir = norm([-0.4, -0.62, -0.68]), Fl = norm([0.55, 0.45, -0.7]), Hh = norm([lightDir[0], lightDir[1], lightDir[2] - 1]);
      for (let j = 0; j < GH; j++) {
        const y = (j + 0.5 - GH / 2) / SS;
        if (Math.abs(y) >= B) continue;
        const zr = Math.sqrt(B * B - y * y);
        for (let i = 0; i < GW; i++) {
          const cx = (i + 0.5 - GW / 2) / SS, x0 = cx * cp + Z0 * sp, z0 = cx * sp - Z0 * cp;
          let t0 = (-zr - z0) / cp, t1 = (zr - z0) / cp;
          t0 = Math.max(t0, (x0 - A) / sp); t1 = Math.min(t1, (x0 + A) / sp);
          if (t1 <= t0) continue;
          const inside = (t) => { const x = x0 - t * sp, z = z0 + t * cp, r = R(x); return y * y + z * z <= r * r; };
          const K = 32; let found = -1;
          for (let k = 0; k <= K; k++) if (inside(t0 + (t1 - t0) * k / K)) { found = k; break; }
          if (found < 0) continue;
          let lo = found ? t0 + (t1 - t0) * (found - 1) / K : t0, hi = t0 + (t1 - t0) * found / K;
          for (let it = 0; it < 8; it++) { const mid = (lo + hi) / 2; if (inside(mid)) hi = mid; else lo = mid; }
          const x = x0 - hi * sp, z = z0 + hi * cp, rho = Math.hypot(y, z) || 1e-6, u = x / A, q = Math.max(0.02, 1 - u * u);
          const drdx = B * SH * Math.pow(q, SH - 1) * (-2 * u / A);
          const n = norm([-drdx, y / rho, z / rho]), nX = n[0] * cp + n[2] * sp, nY = n[1], nZ = -n[0] * sp + n[2] * cp;
          const d = Math.max(0, nX * lightDir[0] + nY * lightDir[1] + nZ * lightDir[2]), f = Math.max(0, nX * Fl[0] + nY * Fl[1] + nZ * Fl[2]);
          const hh = Math.max(0, nX * Hh[0] + nY * Hh[1] + nZ * Hh[2]);
          const p = j * GW + i;
          sh[p] = (0.3 + 1.0 * d + 0.12 * f) * (0.78 + 0.22 * (1 - Math.pow(Math.abs(u), 4)));
          spc[p] = 0.15 * Math.pow(hh, 18) * d;
          s[p] = x / A * 0.5 + 0.5; th[p] = Math.atan2(-z, -y); ok[p] = 1;
        }
      }
      return { GW, GH, s, th, sh, spc, ok };
    }

    function ballFrame(k) {
      if (!ballSprite) ballSprite = { frames: [], tex: null };
      if (!ballGeo) ballGeo = makeBallGeo();
      if (!ballSprite.tex) ballSprite.tex = makeBallTexture();
      if (ballSprite.frames[k]) return ballSprite.frames[k];
      const G = ballGeo, tex = ballSprite.tex, TW = BALL.TW, TH = BALL.TH, phi = (k / BALL.FRAMES) * TAU;
      const big = document.createElement("canvas"); big.width = G.GW; big.height = G.GH;
      const bctx = big.getContext("2d"), img = bctx.createImageData(G.GW, G.GH), d = img.data;
      for (let p = 0, n = G.GW * G.GH; p < n; p++) {
        if (!G.ok[p]) continue;
        const u = Math.min(TH - 1, (G.s[p] * (TH - 1)) | 0); let a = (G.th[p] - phi) / TAU; a -= Math.floor(a);
        const w = Math.min(TW - 1, (a * TW) | 0), ti = (w * TH + u) * 4, o = p * 4, l = G.sh[p] * 1.0, sp = G.spc[p] * 255;
        d[o] = Math.min(255, tex[ti] * l + sp); d[o + 1] = Math.min(255, tex[ti + 1] * l + sp * 0.9); d[o + 2] = Math.min(255, tex[ti + 2] * l + sp * 0.8); d[o + 3] = 255;
      }
      bctx.putImageData(img, 0, 0);
      const fr = document.createElement("canvas"); fr.width = BALL.W; fr.height = BALL.H;
      const fctx = fr.getContext("2d"); fctx.imageSmoothingQuality = "high"; fctx.drawImage(big, 0, 0, BALL.W, BALL.H);
      ballSprite.frames[k] = fr;
      if (k === 0) { const sprite = ballSprite; let next = 1; const fill = () => { if (ballSprite !== sprite || next >= BALL.FRAMES) return; if (!document.hidden) ballFrame(next++); setTimeout(fill, 24); }; setTimeout(fill, 120); }
      return fr;
    }
    if (document.fonts && document.fonts.load) document.fonts.load("20px 'Bebas Neue'").then(invalidateBall);

    // x, y: centre; len: length along the ball; angle: heading; spin: roll around the long axis (radians), 0 at rest
    function football(x, y, len, angle, alpha, spin, target) {
      const g = target || ctx;   // the game borrows this ball and passes its own canvas context
      const F = BALL.FRAMES, pos = ((((((spin || 0) - 0.35) / TAU) % 1) + 1) % 1) * F, k0 = Math.floor(pos) % F, f = pos - Math.floor(pos);
      ballFrame(0); // the first frame is made right away; the rest are made in the background
      const ready = (k) => { for (let d = 0; d < F; d++) { const fr = ballSprite.frames[(k - d + F) % F]; if (fr) return fr; } return ballSprite.frames[0]; };
      const fr0 = ready(k0), fr1 = f > 0.01 ? ballSprite.frames[(k0 + 1) % F] : null;
      const w = len * (BALL.W / (BALL.A * 2)), h = w * (BALL.H / BALL.W);
      g.save(); g.translate(x, y);
      if (Math.cos(angle) < 0) { g.scale(-1, 1); angle = Math.PI - angle; } // heading left: mirror, so the light stays above
      g.rotate(angle); const a0 = alpha == null ? 1 : alpha; g.globalAlpha = a0;
      g.drawImage(fr0, -w / 2, -h / 2, w, h);
      if (fr1 && fr1 !== fr0) { g.globalAlpha = a0 * f; g.drawImage(fr1, -w / 2, -h / 2, w, h); } // blend toward the next roll angle
      g.restore();
    }

    // the ball never sits still at midfield: it rolls slowly on its long axis, floats up and down a little, and sways
    const idle = (c) => ({ spin: c * 0.9, dy: Math.sin(c * 1.7) * 3.5, ang: Math.sin(c * 0.8) * 0.1 });

    function draw() {
      if (!W) return;
      ctx.clearRect(0, 0, W, H);
      drawField();
      const tm = clock % CYCLE;
      const vals = values(measureId).filter((x) => !Number.isNaN(x)), lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
      const m = measures.find((x) => x.id === measureId), r0 = Math.max(8, Math.min(13, H * 0.03));

      // route diagrams: dashed line from the formation spot to the end of the route, with an arrowhead
      slots.forEach((s) => {
        const on = conf === "All" || conf === s.t.conference, hot = hover === s.t.team || selected === s.t.team;
        ctx.globalAlpha = on ? 1 : 0.12;
        ctx.strokeStyle = hot ? "#ffb612" : "rgba(" + (pal || palette()).ink + ",.22)"; ctx.lineWidth = hot ? 2.5 : 1.2; ctx.setLineDash([5, 5]);
        ctx.beginPath(); s.pts.forEach((p, k) => { const q = px(p); k ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); }); ctx.stroke(); ctx.setLineDash([]);
        const e = px(s.pts[s.pts.length - 1]), p0 = px(s.pts[s.pts.length - 2]), ang = Math.atan2(e[1] - p0[1], e[0] - p0[0]);
        ctx.beginPath(); ctx.moveTo(e[0], e[1]); ctx.lineTo(e[0] - 8 * Math.cos(ang - 0.45), e[1] - 8 * Math.sin(ang - 0.45)); ctx.moveTo(e[0], e[1]); ctx.lineTo(e[0] - 8 * Math.cos(ang + 0.45), e[1] - 8 * Math.sin(ang + 0.45)); ctx.stroke();
        ctx.globalAlpha = 1;
      });

      // ball at rest on the 50-yard line before the throw
      const center = px([60, 26.65]);
      if (tm < THROW_AT) { const id = idle(clock); ctx.fillStyle = "rgba(0,0,0," + (0.3 - id.dy * 0.01).toFixed(3) + ")"; ctx.beginPath(); ctx.ellipse(center[0] + 3, center[1] + 8, W * 0.02 * (1 - id.dy * 0.012), H * 0.014 * (1 - id.dy * 0.012), 0, 0, TAU); ctx.fill(); football(center[0], center[1] + id.dy, Math.max(48, W * 0.092), id.ang, 1, id.spin); }

      // teams
      dots = [];
      slots.forEach((s) => {
        const t = s.t, pos = px(yardsAt(s, tm));
        const v = summary.teams[t.team] ? summary.teams[t.team][measureId] : NaN;
        const norm = sized && hi > lo && !Number.isNaN(v) ? (v - lo) / (hi - lo) : 0.5, lf = L[t.team] || 0, mg = M[t.team] || 0, rad = r0 * (0.8 + 0.6 * norm) * (1 + 0.16 * mg + 0.1 * lf);
        const on = conf === "All" || conf === t.conference, col = NFLTeams.color(t.team);
        const isHover = hover === t.team, isSel = selected === t.team;
        const running = tm > RUN_START && tm < RUN_START + RUN_DUR;
        if (running) { // motion trail behind the runner
          ctx.strokeStyle = col; ctx.lineCap = "round";
          for (let k = 1; k <= 6; k++) { const a = px(yardsAt(s, tm - (k - 1) * 0.045)), b = px(yardsAt(s, tm - k * 0.045)); ctx.globalAlpha = (on ? 0.6 : 0.1) * (1 - k / 7); ctx.lineWidth = Math.max(2, rad * 0.55); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
        }
        ctx.globalAlpha = on ? 1 : 0.18;
        const lift = 6 * lf; pos[1] -= lift; // the chosen dot rises off the turf
        const im = images[t.team], helm = NFLTeams.helmets && im && im._ok;
        if (helm) { // 3D helmet picture instead of a round logo; the hover glow is a soft ring under it
          const ph = (t.team.charCodeAt(0) * 7 + t.team.charCodeAt(t.team.length - 1) * 13) % 100 / 15.9;   // each team has its own rhythm
          const idleF = calm ? 0 : Math.sin(clock * 1.25 + ph) * 0.95, bob = calm || !running ? 0 : -Math.abs(Math.sin(clock * 11 + ph)) * rad * 0.22, lean = calm || !running ? 0 : Math.sin(clock * 11 + ph) * 0.07;
          let pop = 1; if (flash && flash.team === t.team) { const u = Math.min(1, (performance.now() - flash.start) / 520); pop = 1 + 0.32 * Math.sin(u * Math.PI) * (1 - u * 0.4); }
          const hs = rad * 3.1 * (1 + 0.12 * lf) * pop, hy = pos[1] - hs * 0.04 + bob;
          if (lf > 0.02) { ctx.save(); ctx.globalAlpha *= lf; ctx.beginPath(); ctx.ellipse(pos[0], pos[1] + hs * 0.34, hs * 0.56, hs * 0.16, 0, 0, TAU); ctx.fillStyle = "rgba(255,182,18,.55)"; ctx.fill(); ctx.restore(); }
          ctx.save(); ctx.shadowColor = "rgba(0,0,0," + (0.45 + 0.1 * lf).toFixed(2) + ")"; ctx.shadowBlur = 8 + 8 * lf + 5 * mg; ctx.shadowOffsetY = 4 + 6 * lf + 2 * mg;
          const fw = im.naturalWidth / 7, fi = Math.max(0, Math.min(6, Math.round((SP[t.team] === undefined ? 3 : SP[t.team]) + idleF * (1 - Math.min(1, Math.abs((SP[t.team] === undefined ? 3 : SP[t.team]) - 3))))));
          ctx.translate(pos[0], hy); ctx.rotate(lean);
          ctx.drawImage(im, fi * fw, 0, fw, im.naturalHeight, -hs / 2, -hs / 2, hs, hs); ctx.restore();
        } else {
        ctx.save(); ctx.shadowColor = "rgba(0,0,0," + (0.5 + 0.1 * lf).toFixed(2) + ")"; ctx.shadowBlur = 10 + 10 * lf + 6 * mg; ctx.shadowOffsetY = 5 + 7 * lf + 3 * mg;
        ctx.beginPath(); ctx.arc(pos[0], pos[1], rad + 1.5 + 2 * lf, 0, TAU); ctx.fillStyle = "rgb(255," + Math.round(255 - 73 * lf) + "," + Math.round(255 - 237 * lf) + ")"; ctx.fill(); ctx.restore();
        ctx.beginPath(); ctx.arc(pos[0], pos[1], rad, 0, TAU); ctx.fillStyle = col; ctx.fill();
        if (im && im._ok) {
          ctx.save(); ctx.beginPath(); ctx.arc(pos[0], pos[1], rad - 1.5, 0, TAU); ctx.clip();
          ctx.fillStyle = "rgba(255,255,255,.96)"; ctx.fillRect(pos[0] - rad, pos[1] - rad, rad * 2, rad * 2);
          const sz = (rad - 1.5) * 1.55; ctx.drawImage(im, pos[0] - sz / 2, pos[1] - sz / 2, sz, sz); ctx.restore();
        } else { ctx.fillStyle = "#fff"; ctx.font = "700 " + Math.round(rad * 0.75) + "px 'Geist Mono', monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(t.team, pos[0], pos[1] + 1); }
        { const gl = ctx.createRadialGradient(pos[0] - rad * 0.4, pos[1] - rad * 0.5, rad * 0.1, pos[0], pos[1], rad); gl.addColorStop(0, "rgba(255,255,255,.38)"); gl.addColorStop(0.45, "rgba(255,255,255,0)"); gl.addColorStop(1, "rgba(0,0,0,.28)"); ctx.beginPath(); ctx.arc(pos[0], pos[1], rad, 0, TAU); ctx.fillStyle = gl; ctx.fill(); } // domed highlight
        }
        if (lf > 0.02) { ctx.save(); ctx.globalAlpha *= lf; ctx.font = "700 11px 'Geist Mono', monospace"; ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.fillStyle = "#ffb612"; ctx.fillText(t.team, pos[0], pos[1] + rad + 5); ctx.restore(); }
        if (flash && flash.team === t.team) { // a ring that spreads out from the dot you just clicked
          const u = Math.min(1, (performance.now() - flash.start) / 1100);
          ctx.globalAlpha = 1 - u; ctx.strokeStyle = "#ffb612"; ctx.lineWidth = 4 * (1 - u) + 1;
          ctx.beginPath(); ctx.arc(pos[0], pos[1], rad + 6 + u * 34, 0, TAU); ctx.stroke();
        }
        ctx.globalAlpha = 1;
        dots.push({ t, x: pos[0], y: pos[1], r: NFLTeams.helmets ? rad * 1.45 : rad, on });
      });

      // the pass: arc from the 50-yard line to the target, then carried by the catcher, then back to the line
      let caught = null;
      if (target && tm >= THROW_AT) {
        const s = slotOf[target.team], arrive = px(yardsAt(s, CATCH_AT)), ballLen = Math.max(52, W * 0.105);
        if (tm < CATCH_AT) {
          const u = clamp01((tm - THROW_AT) / (CATCH_AT - THROW_AT)), lift = Math.sin(u * Math.PI);
          const x = center[0] + (arrive[0] - center[0]) * u, y = Math.max(ballLen * 0.5, center[1] + (arrive[1] - center[1]) * u - lift * H * 0.22);
          const ahead = { x: center[0] + (arrive[0] - center[0]) * (u + 0.02), y: Math.max(ballLen * 0.5, center[1] + (arrive[1] - center[1]) * (u + 0.02) - Math.sin(Math.min(1, u + 0.02) * Math.PI) * H * 0.22) };
          ctx.fillStyle = "rgba(0,0,0,.25)"; ctx.beginPath(); ctx.ellipse(center[0] + (arrive[0] - center[0]) * u, center[1] + (arrive[1] - center[1]) * u + 6, ballLen * 0.4, ballLen * 0.13, 0, 0, TAU); ctx.fill();
          football(x, y, ballLen * (1 + lift * 0.35), Math.atan2(ahead.y - y, ahead.x - x), 1, idle(clock - tm + THROW_AT).spin + (tm - THROW_AT) * 13);
        } else if (tm < HOLD_UNTIL) {
          const p = px(yardsAt(s, tm)), pulse = clamp01((tm - CATCH_AT) / 0.7);
          ctx.strokeStyle = "rgba(255,182,18," + (1 - pulse) + ")"; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(p[0], p[1], 14 + pulse * 40, 0, TAU); ctx.stroke();
          football(p[0] + 15, p[1] - 12, ballLen * 0.75, -0.5);
          caught = target;
        } else {
          const u = ease(clamp01((tm - HOLD_UNTIL) / RESET_DUR)), p = px(yardsAt(s, HOLD_UNTIL - 0.0001));
          const id = idle(clock); football(p[0] + (center[0] - p[0]) * u + 15 * (1 - u), p[1] + (center[1] - p[1]) * u - 12 * (1 - u) + id.dy * u, ballLen * (0.75 + 0.25 * u), -0.5 * (1 - u) + id.ang * u, 1, id.spin);
        }
      }

      const focus = hover || (caught && caught.team);
      const capText = focus
        ? (hover ? "" : "Completed pass to ") + focus + " · " + NFLTeams.name(focus) + (sized ? " · " + m.label + " " + fmt(m, summary.teams[focus][measureId]) + " (rank " + rankOf(focus, measureId) + " of 32)" : "")
        : "AFC teams run right, NFC teams run left. The ball goes to a random team every few seconds. " + summary.scope + ". Hover a team to freeze the play.";
      if (caption.textContent !== capText) caption.textContent = capText;
      if (!hover) { if (caught) showTip(dots.find((d) => d.t.team === caught.team)); else { tip.hidden = true; tipKey = null; } }
      if (flash) { // keep redrawing while the click ring plays, even when the play is paused or frozen
        if (performance.now() - flash.start > 1100) flash = null;
        else if (!flashRaf) { flashRaf = requestAnimationFrame(() => { flashRaf = 0; draw(); }); }
      }
    }

    // ---------------------------------------------------------------- interaction
    function pick(e) {
      let x, y;
      if (e.target === canvas && e.offsetX !== undefined) { x = e.offsetX; y = e.offsetY; } // local coords, correct while the board is tilted
      else { const rect = canvas.getBoundingClientRect(); x = e.clientX - rect.left; y = e.clientY - rect.top; }
      let best = null, bd = 1e9;
      dots.forEach((d) => { if (!d.on) return; const dd = Math.hypot(d.x - x, d.y - y); if (dd <= d.r + (e.pointerType === "touch" ? 14 : 8) && dd < bd) { bd = dd; best = d; } });
      return best;
    }
    let stuck = null; // touch: the team whose tooltip a first tap left open
    function showTip(d) {
      if (!d) { tip.hidden = true; tipKey = null; return; }
      const t = d.t, s = summary.teams[t.team], key = t.team + measureId + (stuck === t.team ? "!" : "");
      if (key !== tipKey) {
        tipKey = key;
        tip.innerHTML = "<b></b><div class='row'><span></span><span></span></div>";
        tip.firstChild.innerHTML = NFLTeams.badge(t.team) + " "; tip.firstChild.appendChild(document.createTextNode(t.full_name));
        const sub = tip.querySelector(".row"); sub.firstChild.textContent = t.conference + " " + t.division; sub.lastChild.textContent = s.games + " games";
        measures.forEach((m) => { const row = document.createElement("div"); row.className = "row"; if (sized && m.id === measureId) row.style.color = "#ffb612"; row.innerHTML = "<span></span><span></span>"; row.firstChild.textContent = m.label; row.lastChild.textContent = fmt(m, s[m.id]); tip.appendChild(row); });
        if (stuck === t.team) { // touch: a real button, so a second tap on the dot is not the only way in
          const b = document.createElement("button"); b.type = "button"; b.className = "btn small go-btn"; b.textContent = opts.goButton || "Open team";
          b.addEventListener("click", (ev) => { ev.stopPropagation(); chooseTeam(t.team); });
          tip.appendChild(b);
        } else { const go = document.createElement("div"); go.className = "go"; go.textContent = mode === "pick" ? "Click to throw to this team" : (opts.goText || "Click to open this team"); tip.appendChild(go); }
      }
      tip.classList.toggle("sticky", stuck === t.team);
      tip.hidden = false;
      const w = wrap.clientWidth, left = d.x + d.r + 14 + 235 > w ? d.x - d.r - 14 - 235 : d.x + d.r + 14;
      tip.style.left = Math.max(6, left) + "px"; tip.style.top = Math.max(6, Math.min(H - tip.offsetHeight - 6, d.y - 20)) + "px";
    }
    const calm = !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);   // no idle or running animation for visitors who ask for less motion
    const tiltOk = window.matchMedia && matchMedia("(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)").matches;
    canvas.addEventListener("pointermove", (e) => {
      if (e.pointerType === "touch") return; // a finger dragging to scroll is not hovering
      if (tiltOk) { // lean the board toward the pointer and light the turf under it
        const rc = canvas.getBoundingClientRect(), u = (e.clientX - rc.left) / rc.width, v = (e.clientY - rc.top) / rc.height;
        wrap.style.setProperty("--rx", ((0.5 - v) * 5).toFixed(2) + "deg"); wrap.style.setProperty("--ry", ((u - 0.5) * 6).toFixed(2) + "deg");
        wrap.style.setProperty("--mx", (u * 100).toFixed(1) + "%"); wrap.style.setProperty("--my", (v * 100).toFixed(1) + "%");
        glow.tx = e.offsetX !== undefined && e.target === canvas ? e.offsetX : u * W; glow.ty = e.target === canvas ? e.offsetY : v * H;
        if (!glow.on && glow.a < 0.02) { glow.x = glow.tx; glow.y = glow.ty; } glow.on = true; mouse.x = glow.tx; mouse.y = glow.ty; mouse.on = true;
      }
      const d = pick(e), code = d ? d.t.team : null;
      canvas.style.cursor = d ? "pointer" : "default";
      if (code !== hover) { hover = code; tipKey = null; redrawIfPaused(); if (hover) draw(); }
      showTip(d);
    });
    canvas.addEventListener("pointerleave", (e) => { glow.on = false; mouse.on = false; wrap.style.removeProperty("--rx"); wrap.style.removeProperty("--ry"); if (e.pointerType === "touch" && stuck) return; hover = null; tip.hidden = true; tipKey = null; last = performance.now(); redrawIfPaused(); });
    function chooseTeam(code) {
      stuck = null; hover = null; tip.hidden = true; tip.classList.remove("sticky"); tipKey = null; last = performance.now();
      selected = code; flash = { team: code, start: performance.now() };
      if (opts.onSelect) opts.onSelect(code);
      draw();
    }
    canvas.addEventListener("click", (e) => {
      const d = pick(e);
      if (mode === "pick") { if (d) runPlay(d.t.team); return; }
      if (e.pointerType === "touch") {
        if (!d) { stuck = null; hover = null; tip.hidden = true; tip.classList.remove("sticky"); tipKey = null; last = performance.now(); redrawIfPaused(); return; }
        if (stuck !== d.t.team) { stuck = d.t.team; hover = d.t.team; tipKey = null; draw(); showTip(d); return; } // first tap: show the numbers
      }
      if (d && opts.onSelect) chooseTeam(d.t.team);
    });

    function pickTarget() {
      const pool = teams.filter((t) => conf === "All" || t.conference === conf);
      return pool[Math.floor(Math.random() * pool.length)];
    }
    function redrawIfPaused() { if (paused || hover) draw(); }
    // eased values that make the board feel alive: hover lift, swell near the pointer, glow that follows the pointer with a little lag
    function stepAnim(dt) {
      const k = 1 - Math.exp(-dt * 12); let busy = false;
      const ease1 = (map, key, goal) => { const v = map[key] || 0, nv = v + (goal - v) * k; map[key] = Math.abs(goal - nv) < 0.003 ? goal : nv; if (map[key] !== goal) busy = true; };
      slots.forEach((sl) => { const c = sl.t.team; ease1(L, c, hover === c || selected === c ? 1 : 0); });
      dots.forEach((d) => { const c = d.t.team; ease1(M, c, mouse.on && tiltOk && d.on ? Math.pow(Math.max(0, 1 - Math.hypot(d.x - mouse.x, d.y - mouse.y) / 110), 2) : 0); });
      dots.forEach((d) => { // helmets turn to look at the pointer when it is near
        const c = d.t.team, dir = d.t.conference === "NFC" ? -1 : 1, near = mouse.on && tiltOk && d.on ? Math.max(0, 1 - Math.hypot(d.x - mouse.x, d.y - mouse.y) / 150) : 0;
        const goal = 3 + dir * Math.max(-1, Math.min(1, (mouse.x - d.x) / 70)) * 3 * Math.min(1, near * 2.2), v = SP[c] === undefined ? 3 : SP[c], nv = v + (goal - v) * k * 0.9;
        SP[c] = Math.abs(goal - nv) < 0.02 ? goal : nv; if (SP[c] !== goal) busy = true;
      });
      glow.x += (glow.tx - glow.x) * k; glow.y += (glow.ty - glow.y) * k; const ga = glow.on ? 1 : 0; glow.a += (ga - glow.a) * k;
      if (Math.abs(ga - glow.a) < 0.01) glow.a = ga; else busy = true;
      if (glow.on && (Math.abs(glow.tx - glow.x) > 0.3 || Math.abs(glow.ty - glow.y) > 0.3)) busy = true;
      return busy;
    }
    function frame(now) {
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      if (!document.hidden && onScreen) {
        const goal = paused || (hover && !(mode === "pick" && playing)) ? 0 : 1;
        speed += (goal - speed) * (1 - Math.exp(-dt * 7)); if (Math.abs(goal - speed) < 0.004) speed = goal;
        const busy = stepAnim(dt);
        if (speed > 0 || busy) {
          const before = Math.floor(clock / CYCLE);
          if (!(mode === "pick" && !playing)) clock += dt * speed;   // in "pick" mode the field waits for you between plays
          if (Math.floor(clock / CYCLE) !== before) {
            if (mode === "pick") { playing = false; clock = 0; tipKey = null; }
            else { target = pickTarget(); if (mode !== "classic") assignRoutes("mixed"); tipKey = null; }   // a new random route for every team on every play (not in Classic)
          } else if (!target && mode !== "pick") { target = pickTarget(); tipKey = null; }
          draw();
        }
      }
      requestAnimationFrame(frame);
    }
    target = pickTarget();
    requestAnimationFrame(frame);
    layout();

    const api = {
      setSelected(code) { selected = code; redrawIfPaused(); }, redraw: draw,
      // test hook: jump the play clock to a moment (seconds into the play) and draw that frame
      setClock(t) { clock = t; if (!target) target = pickTarget(); draw(); },
    };
    if (/fielddebug/.test(location.search)) window.__field = api;
    return api;
  }

  window.NFLField = { mount };
})();
