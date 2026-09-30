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
    let hover = null, selected = opts.selected || null;
    let clock = paused ? 4.2 : 0, last = performance.now(), cycle = 0, target = null, tipKey = null;

    // ---------------------------------------------------------------- markup
    container.innerHTML =
      "<div class='field-head'><div><h2></h2><p></p></div><div class='field-tools'>" +
      "<div class='seg' role='group' aria-label='Conference'></div>" +
      (sized ? "<label class='sr' for='field-measure'>Dot size shows</label><select id='field-measure'></select>" : "") +
      "<button type='button' class='btn ghost small' id='field-pause'></button></div></div>" +
      "<div class='field-wrap'><canvas role='img'></canvas><div class='field-tip' hidden></div></div>" +
      "<p class='field-caption'></p>" +
      "<details class='teamlist'><summary>All 32 teams as a list</summary><ul></ul></details>";
    container.querySelector("h2").textContent = opts.title || "The league on the field";
    container.querySelector("p").textContent = opts.blurb || "";
    const canvas = container.querySelector("canvas"), tip = container.querySelector(".field-tip");
    const caption = container.querySelector(".field-caption"), wrap = container.querySelector(".field-wrap");
    const ctx = canvas.getContext("2d");
    canvas.setAttribute("aria-label", "A football field where the 32 NFL teams run routes and the ball is thrown to a random team. AFC teams run right, NFC teams run left. Use the team list below the field for keyboard access.");

    const seg = container.querySelector(".seg");
    ["All", "AFC", "NFC"].forEach((c) => {
      const b = document.createElement("button");
      b.type = "button"; b.textContent = c; b.setAttribute("aria-pressed", c === conf ? "true" : "false");
      b.addEventListener("click", () => { conf = c; seg.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x.textContent === c ? "true" : "false")); if (target && conf !== "All" && target.conference !== conf) target = null; redrawIfPaused(); });
      seg.appendChild(b);
    });
    const sel = container.querySelector("select");
    if (sel) {
      measures.forEach((m) => { const o = document.createElement("option"); o.value = m.id; o.textContent = "Dot size: " + m.label; sel.appendChild(o); });
      sel.addEventListener("change", () => { measureId = sel.value; tipKey = null; redrawIfPaused(); });
    }
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
        const route = ROUTES[ROUTE_NAMES[(i * 5 + ci * 3) % ROUTE_NAMES.length]];
        const flip = (i + ci) % 2 ? 1 : -1;
        const dir = ci === 0 ? 1 : -1;
        const pts = route.map(([u, v]) => [startX + dir * u, Math.max(3, Math.min(50.3, startY + v * flip))]);
        const lens = [0]; for (let k = 1; k < pts.length; k++) lens.push(lens[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
        slots.push({ t, pts, lens, total: lens[lens.length - 1], dir });
      });
    });
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
    teams.forEach((t) => { const im = new Image(); im.referrerPolicy = "no-referrer"; im.onload = () => { im._ok = true; redrawIfPaused(); }; im.src = t.logo; images[t.team] = im; });
    const values = (mid) => teams.map((t) => (summary.teams[t.team] ? summary.teams[t.team][mid] : NaN));
    const rankOf = (code, mid) => 1 + values(mid).filter((x) => x > summary.teams[code][mid]).length;

    // ---------------------------------------------------------------- layout
    let W = 0, H = 0, sx = 1, sy = 1, dpr = 1, dots = [];
    function layout() {
      const rect = wrap.getBoundingClientRect();
      W = Math.round(rect.width);
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

    function drawField() {
      for (let i = 0; i < 12; i++) { ctx.fillStyle = i % 2 ? "#17592f" : "#1b6735"; ctx.fillRect(i * 10 * sx, 0, 10 * sx + 1, H); }
      ctx.fillStyle = "rgba(229,20,26,.62)"; ctx.fillRect(0, 0, 10 * sx, H);
      ctx.fillStyle = "rgba(1,51,105,.86)"; ctx.fillRect(110 * sx, 0, 10 * sx, H);
      // end zone lettering: bold field-paint face; both words sit with their bottoms toward midfield
      ctx.fillStyle = "rgba(255,255,255,.88)"; ctx.font = Math.round(H * 0.15) + "px 'Bebas Neue', 'Geist', sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      if ("letterSpacing" in ctx) ctx.letterSpacing = Math.round(H * 0.025) + "px";
      [[5, "AFC", -Math.PI / 2], [115, "NFC", Math.PI / 2]].forEach(([yd, label, rot]) => inkText(label, yd * sx, H / 2, rot));
      if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
      // midfield logo painted on the turf
      if (leagueImg) { const lh = H * 0.36, lw = lh * (leagueImg.naturalWidth / leagueImg.naturalHeight); ctx.save(); ctx.globalAlpha = 0.86; ctx.drawImage(leagueImg, 60 * sx - lw / 2, H / 2 - lh / 2, lw, lh); ctx.restore(); }
      for (let y = 10; y <= 110; y += 5) {
        ctx.strokeStyle = "rgba(255,255,255," + (y === 10 || y === 110 ? 0.95 : y % 10 === 0 ? 0.5 : 0.28) + ")"; ctx.lineWidth = y === 10 || y === 110 ? 3 : 1.5;
        ctx.beginPath(); ctx.moveTo(y * sx, 0); ctx.lineTo(y * sx, H); ctx.stroke();
      }
      ctx.strokeStyle = "rgba(255,255,255,.35)"; ctx.lineWidth = 1;
      for (let y = 11; y < 110; y++) { if (y % 5 === 0) continue; [0.37, 0.63].forEach((f) => { ctx.beginPath(); ctx.moveTo(y * sx, H * f - H * 0.012); ctx.lineTo(y * sx, H * f + H * 0.012); ctx.stroke(); }); }
      ctx.fillStyle = "rgba(255,255,255,.72)"; ctx.font = Math.round(H * 0.085) + "px 'Bebas Neue', 'Geist', sans-serif"; if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
      [10, 20, 30, 40, 50, 40, 30, 20, 10].forEach((n, i) => { const x = (20 + i * 10) * sx; inkText(String(n), x, H * 0.075, 0); inkText(String(n), x, H * 0.925, Math.PI); });
      if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
      ctx.strokeStyle = "rgba(255,255,255,.9)"; ctx.lineWidth = 3; ctx.strokeRect(1.5, 1.5, W - 3, H - 3);
    }

    // A leather game ball in the style of a pro ball: warm red-brown leather with fine grain, laces along the top edge over a seam,
    // a curved lower seam, and printed marks on the belly. The crest and text are this site's own (not the NFL shield or any
    // manufacturer's branding). Drawn once in detail, then reused.
    let ballSprite = null;
    const SPR_W = 600, SPR_H = 340, SPR_A = 280;
    // the league logo is loaded from the link in the nflverse teams file; until it loads (or if it fails) the ball shows a plain crest
    let leagueImg = null;
    if (NFLTeams.leagueLogo && NFLTeams.leagueLogo()) {
      const im = new Image(); im.referrerPolicy = "no-referrer";
      im.onload = () => { leagueImg = im; ballSprite = null; redrawIfPaused(); };
      im.src = NFLTeams.leagueLogo();
    }
    function makeBallSprite() {
      const c = document.createElement("canvas"); c.width = SPR_W; c.height = SPR_H;
      const g = c.getContext("2d"), a = SPR_A, b = a * 0.55;
      let seed = 11; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      g.translate(SPR_W / 2, SPR_H / 2 + 6);
      // lemon-shaped profile: full in the middle, tapering to soft points (exponent below 1 would blunt the ends toward an ellipse)
      const outline = () => {
        const N = 90; g.beginPath();
        for (let i = 0; i <= N; i++) { const u = -1 + (2 * i) / N, x = a * u, y = -b * Math.pow(Math.max(0, 1 - u * u), 0.92); i ? g.lineTo(x, y) : g.moveTo(x, y); }
        for (let i = N; i >= 0; i--) { const u = -1 + (2 * i) / N, x = a * u, y = b * Math.pow(Math.max(0, 1 - u * u), 0.92); g.lineTo(x, y); }
        g.closePath();
      };
      g.save(); g.shadowColor = "rgba(0,0,0,.5)"; g.shadowBlur = 16; g.shadowOffsetY = 7; outline(); g.fillStyle = "#6a2a18"; g.fill(); g.restore();
      outline(); g.save(); g.clip();
      // red-brown leather: lighter across the middle, deeper at the edges
      let lg = g.createLinearGradient(0, -b, 0, b);
      lg.addColorStop(0, "#8f3f26"); lg.addColorStop(0.3, "#a44e2e"); lg.addColorStop(0.62, "#8a3a22"); lg.addColorStop(1, "#5e2414");
      g.fillStyle = lg; g.fillRect(-a, -b * 1.2, a * 2, b * 2.4);
      const vg = g.createRadialGradient(0, -b * 0.05, a * 0.2, 0, 0, a * 1.02);
      vg.addColorStop(0, "rgba(40,10,4,0)"); vg.addColorStop(0.72, "rgba(40,10,4,.10)"); vg.addColorStop(1, "rgba(30,6,2,.62)");
      g.fillStyle = vg; g.fillRect(-a, -b * 1.2, a * 2, b * 2.4);
      // fine pebbled grain
      for (let i = 0; i < 9000; i++) {
        const x = (rnd() * 2 - 1) * a, y = (rnd() * 2 - 1) * b, r = 0.6 + rnd() * 1.2;
        g.fillStyle = rnd() < 0.5 ? "rgba(40,10,4,.16)" : "rgba(255,190,150,.11)";
        g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
      }
      // top seam (runs tip to tip, hidden under the laces) and a softer curved seam low on the body
      const topSeam = () => { g.beginPath(); g.moveTo(-a * 0.97, -b * 0.06); g.bezierCurveTo(-a * 0.62, -b * 0.86, a * 0.62, -b * 0.86, a * 0.97, -b * 0.06); };
      topSeam(); g.strokeStyle = "rgba(25,7,2,.78)"; g.lineWidth = 3.4; g.stroke();
      g.save(); g.translate(0, 2.4); topSeam(); g.strokeStyle = "rgba(255,200,160,.16)"; g.lineWidth = 1.6; g.stroke(); g.restore();
      const lowSeam = () => { g.beginPath(); g.moveTo(-a * 0.96, b * 0.05); g.bezierCurveTo(-a * 0.6, b * 0.72, a * 0.6, b * 0.72, a * 0.96, b * 0.05); };
      lowSeam(); g.strokeStyle = "rgba(30,8,3,.55)"; g.lineWidth = 3; g.stroke();
      g.save(); g.translate(0, -2.2); lowSeam(); g.strokeStyle = "rgba(255,200,160,.14)"; g.lineWidth = 1.4; g.stroke(); g.restore();
      // broad soft highlight on the upper middle
      const hi = g.createRadialGradient(-a * 0.05, -b * 0.3, 6, -a * 0.05, -b * 0.3, a * 0.75);
      hi.addColorStop(0, "rgba(255,215,180,.34)"); hi.addColorStop(0.55, "rgba(255,205,165,.10)"); hi.addColorStop(1, "rgba(255,205,165,0)");
      g.fillStyle = hi; g.fillRect(-a, -b * 1.2, a * 2, b * 2.4);

      // printed marks: a small crest in the middle, text on either side (like a stamped game ball)
      const ink = "rgba(18,6,2,.86)", edge = "rgba(255,190,150,.16)";
      const text = (str, x, y, size, weight) => {
        g.font = size * 1.12 + "px 'Bebas Neue', 'Geist', Arial, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
        if ("letterSpacing" in g) g.letterSpacing = Math.round(size * 0.12) + "px";
        g.fillStyle = edge; g.fillText(str, x + 1, y + 1.3); g.fillStyle = ink; g.fillText(str, x, y);
        if ("letterSpacing" in g) g.letterSpacing = "0px";
      };
      text("PLAYER", -a * 0.55, -b * 0.06, 25, 700); text("STATS", -a * 0.55, b * 0.18, 17, 600);
      text("2009\u20132025", a * 0.55, -b * 0.06, 21, 700); text("REGULAR SEASON", a * 0.55, b * 0.18, 11.5, 600);
      const sw = a * 0.2, sh = a * 0.27, sy = b * 0.02;
      if (leagueImg) {
        // logo printed on the ball with a slight ink-on-leather look
        const lw = a * 0.44, lh = lw * (leagueImg.naturalHeight / leagueImg.naturalWidth);
        g.save(); g.translate(0, sy); g.globalAlpha = 0.96; g.shadowColor = "rgba(0,0,0,.35)"; g.shadowBlur = 4; g.shadowOffsetY = 1.5;
        g.drawImage(leagueImg, -lw / 2, -lh / 2, lw, lh); g.restore();
      } else {
      g.save(); g.translate(0, sy);
      const shield = () => { g.beginPath(); g.moveTo(-sw, -sh); g.lineTo(sw, -sh); g.lineTo(sw, sh * 0.2); g.quadraticCurveTo(sw, sh * 0.72, 0, sh); g.quadraticCurveTo(-sw, sh * 0.72, -sw, sh * 0.2); g.closePath(); };
      shield(); g.fillStyle = "#f3efe8"; g.fill();
      g.save(); shield(); g.clip();
      g.fillStyle = "#0d2c62"; g.fillRect(-sw, -sh, sw * 2, sh * 1.02);
      g.fillStyle = "#c8102e"; g.fillRect(-sw, sh * 0.16, sw * 2, sh * 0.4);
      g.fillStyle = "#fff"; g.font = "700 15px 'Geist', Arial, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; if ("letterSpacing" in g) g.letterSpacing = "2px"; g.fillText("STATS", 0, sh * 0.36); if ("letterSpacing" in g) g.letterSpacing = "0px";
      // stars and a small football
      for (let k = -2; k <= 2; k++) { g.save(); g.translate(k * sw * 0.36, -sh * 0.72); g.beginPath(); for (let p = 0; p < 10; p++) { const rr = p % 2 ? 3 : 7, an = -Math.PI / 2 + p * Math.PI / 5; g.lineTo(Math.cos(an) * rr, Math.sin(an) * rr); } g.closePath(); g.fillStyle = "#fff"; g.fill(); g.restore(); }
      g.save(); g.translate(0, -sh * 0.28); g.rotate(-0.5); g.beginPath(); g.ellipse(0, 0, sw * 0.42, sw * 0.2, 0, 0, TAU); g.fillStyle = "#f3efe8"; g.fill(); g.strokeStyle = "#0d2c62"; g.lineWidth = 1.6; g.beginPath(); g.moveTo(-sw * 0.16, 0); g.lineTo(sw * 0.16, 0); g.stroke(); g.restore();
      g.restore();
      shield(); g.lineWidth = 3; g.strokeStyle = "rgba(20,8,4,.5)"; g.stroke();
      g.restore();
      }
      g.restore();

      outline(); g.lineWidth = 3.2; g.strokeStyle = "#2a0f06"; g.stroke();
      // laces along the top edge: white cross laces with shadows, over a dark lace slit
      const ly = -b * 0.7, laceH = b * 0.26;
      g.save(); g.lineCap = "round";
      g.beginPath(); g.moveTo(-a * 0.38, ly + laceH * 0.62); g.quadraticCurveTo(0, ly + laceH * 0.95, a * 0.38, ly + laceH * 0.62); g.strokeStyle = "rgba(15,4,1,.88)"; g.lineWidth = 4; g.stroke();
      for (let k = -3; k <= 3; k++) {
        const x = k * a * 0.108, tilt = k * 0.028, y0 = ly - laceH * 0.5 + Math.abs(k) * 0.7;
        g.save(); g.translate(x, y0 + laceH * 0.5); g.rotate(tilt); g.translate(-x, -(y0 + laceH * 0.5));
        g.strokeStyle = "rgba(20,6,2,.6)"; g.lineWidth = 17; g.beginPath(); g.moveTo(x, y0 + 4); g.lineTo(x, y0 + laceH + 4); g.stroke();
        const gr = g.createLinearGradient(x - 8, 0, x + 8, 0); gr.addColorStop(0, "#d9d2c6"); gr.addColorStop(0.5, "#ffffff"); gr.addColorStop(1, "#d0c8ba");
        g.strokeStyle = gr; g.lineWidth = 15.5; g.beginPath(); g.moveTo(x, y0); g.lineTo(x, y0 + laceH); g.stroke();
        g.restore();
      }
      g.restore();
      return c;
    }
    if (document.fonts && document.fonts.load) document.fonts.load("20px 'Bebas Neue'").then(() => { ballSprite = null; redrawIfPaused(); if (!paused) draw(); });

    function football(x, y, len, angle, alpha) {
      if (!ballSprite) ballSprite = makeBallSprite();
      const w = len * (SPR_W / (SPR_A * 2)), h = w * (SPR_H / SPR_W);
      ctx.save(); ctx.translate(x, y); ctx.rotate(angle); ctx.globalAlpha = alpha == null ? 1 : alpha;
      ctx.drawImage(ballSprite, -w / 2, -h / 2, w, h);
      ctx.restore();
    }

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
        ctx.strokeStyle = hot ? "#ffb612" : "rgba(255,255,255,.22)"; ctx.lineWidth = hot ? 2.5 : 1.2; ctx.setLineDash([5, 5]);
        ctx.beginPath(); s.pts.forEach((p, k) => { const q = px(p); k ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); }); ctx.stroke(); ctx.setLineDash([]);
        const e = px(s.pts[s.pts.length - 1]), p0 = px(s.pts[s.pts.length - 2]), ang = Math.atan2(e[1] - p0[1], e[0] - p0[0]);
        ctx.beginPath(); ctx.moveTo(e[0], e[1]); ctx.lineTo(e[0] - 8 * Math.cos(ang - 0.45), e[1] - 8 * Math.sin(ang - 0.45)); ctx.moveTo(e[0], e[1]); ctx.lineTo(e[0] - 8 * Math.cos(ang + 0.45), e[1] - 8 * Math.sin(ang + 0.45)); ctx.stroke();
        ctx.globalAlpha = 1;
      });

      // ball at rest on the 50-yard line before the throw
      const center = px([60, 26.65]);
      if (tm < THROW_AT) { ctx.fillStyle = "rgba(0,0,0,.3)"; ctx.beginPath(); ctx.ellipse(center[0] + 3, center[1] + 8, W * 0.02, H * 0.014, 0, 0, TAU); ctx.fill(); football(center[0], center[1], Math.max(52, W * 0.105), 0); }

      // teams
      dots = [];
      slots.forEach((s) => {
        const t = s.t, pos = px(yardsAt(s, tm));
        const v = summary.teams[t.team] ? summary.teams[t.team][measureId] : NaN;
        const norm = sized && hi > lo && !Number.isNaN(v) ? (v - lo) / (hi - lo) : 0.5, rad = r0 * (0.8 + 0.6 * norm);
        const on = conf === "All" || conf === t.conference, col = NFLTeams.color(t.team);
        const isHover = hover === t.team, isSel = selected === t.team;
        const running = tm > RUN_START && tm < RUN_START + RUN_DUR;
        if (running) { // motion trail behind the runner
          ctx.strokeStyle = col; ctx.lineCap = "round";
          for (let k = 1; k <= 6; k++) { const a = px(yardsAt(s, tm - (k - 1) * 0.045)), b = px(yardsAt(s, tm - k * 0.045)); ctx.globalAlpha = (on ? 0.6 : 0.1) * (1 - k / 7); ctx.lineWidth = Math.max(2, rad * 0.55); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
        }
        ctx.globalAlpha = on ? 1 : 0.18;
        ctx.beginPath(); ctx.arc(pos[0], pos[1], rad + (isHover || isSel ? 3.5 : 1.5), 0, TAU); ctx.fillStyle = isHover || isSel ? "#ffb612" : "rgba(255,255,255,.95)"; ctx.fill();
        ctx.beginPath(); ctx.arc(pos[0], pos[1], rad, 0, TAU); ctx.fillStyle = col; ctx.fill();
        const im = images[t.team];
        if (im && im._ok) {
          ctx.save(); ctx.beginPath(); ctx.arc(pos[0], pos[1], rad - 1.5, 0, TAU); ctx.clip();
          ctx.fillStyle = "rgba(255,255,255,.96)"; ctx.fillRect(pos[0] - rad, pos[1] - rad, rad * 2, rad * 2);
          const sz = (rad - 1.5) * 1.55; ctx.drawImage(im, pos[0] - sz / 2, pos[1] - sz / 2, sz, sz); ctx.restore();
        } else { ctx.fillStyle = "#fff"; ctx.font = "700 " + Math.round(rad * 0.75) + "px 'Geist Mono', monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(t.team, pos[0], pos[1] + 1); }
        if (isSel || isHover) { ctx.font = "700 11px 'Geist Mono', monospace"; ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.fillStyle = "#ffb612"; ctx.fillText(t.team, pos[0], pos[1] + rad + 5); }
        if (flash && flash.team === t.team) { // a ring that spreads out from the dot you just clicked
          const u = Math.min(1, (performance.now() - flash.start) / 1100);
          ctx.globalAlpha = 1 - u; ctx.strokeStyle = "#ffb612"; ctx.lineWidth = 4 * (1 - u) + 1;
          ctx.beginPath(); ctx.arc(pos[0], pos[1], rad + 6 + u * 34, 0, TAU); ctx.stroke();
        }
        ctx.globalAlpha = 1;
        dots.push({ t, x: pos[0], y: pos[1], r: rad, on });
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
          football(x, y, ballLen * (1 + lift * 0.35), Math.atan2(ahead.y - y, ahead.x - x));
        } else if (tm < HOLD_UNTIL) {
          const p = px(yardsAt(s, tm)), pulse = clamp01((tm - CATCH_AT) / 0.7);
          ctx.strokeStyle = "rgba(255,182,18," + (1 - pulse) + ")"; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(p[0], p[1], 14 + pulse * 40, 0, TAU); ctx.stroke();
          football(p[0] + 15, p[1] - 12, ballLen * 0.75, -0.5);
          caught = target;
        } else {
          const u = ease(clamp01((tm - HOLD_UNTIL) / RESET_DUR)), p = px(yardsAt(s, HOLD_UNTIL - 0.0001));
          football(p[0] + (center[0] - p[0]) * u + 15 * (1 - u), p[1] + (center[1] - p[1]) * u - 12 * (1 - u), ballLen * (0.75 + 0.25 * u), -0.5 * (1 - u));
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
      const rect = canvas.getBoundingClientRect(), x = e.clientX - rect.left, y = e.clientY - rect.top;
      let best = null, bd = 1e9;
      dots.forEach((d) => { if (!d.on) return; const dd = Math.hypot(d.x - x, d.y - y); if (dd <= d.r + 8 && dd < bd) { bd = dd; best = d; } });
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
        } else { const go = document.createElement("div"); go.className = "go"; go.textContent = opts.goText || "Click to open this team"; tip.appendChild(go); }
      }
      tip.classList.toggle("sticky", stuck === t.team);
      tip.hidden = false;
      const w = wrap.clientWidth, left = d.x + d.r + 14 + 235 > w ? d.x - d.r - 14 - 235 : d.x + d.r + 14;
      tip.style.left = Math.max(6, left) + "px"; tip.style.top = Math.max(6, Math.min(H - tip.offsetHeight - 6, d.y - 20)) + "px";
    }
    canvas.addEventListener("pointermove", (e) => {
      if (e.pointerType === "touch") return; // a finger dragging to scroll is not hovering
      const d = pick(e), code = d ? d.t.team : null;
      canvas.style.cursor = d ? "pointer" : "default";
      if (code !== hover) { hover = code; tipKey = null; redrawIfPaused(); if (hover) draw(); }
      showTip(d);
    });
    canvas.addEventListener("pointerleave", (e) => { if (e.pointerType === "touch" && stuck) return; hover = null; tip.hidden = true; tipKey = null; last = performance.now(); redrawIfPaused(); });
    function chooseTeam(code) {
      stuck = null; hover = null; tip.hidden = true; tip.classList.remove("sticky"); tipKey = null; last = performance.now();
      selected = code; flash = { team: code, start: performance.now() };
      if (opts.onSelect) opts.onSelect(code);
      draw();
    }
    canvas.addEventListener("click", (e) => {
      const d = pick(e);
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
    function frame(now) {
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      if (!paused && !document.hidden && !hover && onScreen) {
        const before = Math.floor(clock / CYCLE);
        clock += dt;
        if (Math.floor(clock / CYCLE) !== before || !target) { cycle++; target = pickTarget(); tipKey = null; }
        draw();
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
