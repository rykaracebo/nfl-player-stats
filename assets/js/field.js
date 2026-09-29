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
    let measureId = measures[0].id, conf = "All";
    let paused = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    let hover = null, selected = opts.selected || null;
    let clock = paused ? 4.2 : 0, last = performance.now(), cycle = 0, target = null, tipKey = null;

    // ---------------------------------------------------------------- markup
    container.innerHTML =
      "<div class='field-head'><div><h2></h2><p></p></div><div class='field-tools'>" +
      "<div class='seg' role='group' aria-label='Conference'></div>" +
      "<label class='sr' for='field-measure'>Dot size shows</label><select id='field-measure'></select>" +
      "<button type='button' class='btn ghost small' id='field-pause'></button></div></div>" +
      "<div class='field-wrap'><canvas role='img'></canvas><div class='field-tip' hidden></div></div>" +
      "<p class='field-caption' aria-live='polite'></p>" +
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
    measures.forEach((m) => { const o = document.createElement("option"); o.value = m.id; o.textContent = "Dot size: " + m.label; sel.appendChild(o); });
    sel.addEventListener("change", () => { measureId = sel.value; tipKey = null; redrawIfPaused(); });
    const pauseBtn = container.querySelector("#field-pause");
    const setPauseLabel = () => (pauseBtn.textContent = paused ? "Play" : "Pause");
    setPauseLabel();
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
      W = Math.max(320, Math.round(rect.width));
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
    function drawField() {
      for (let i = 0; i < 12; i++) { ctx.fillStyle = i % 2 ? "#17592f" : "#1b6735"; ctx.fillRect(i * 10 * sx, 0, 10 * sx + 1, H); }
      ctx.fillStyle = "rgba(229,20,26,.62)"; ctx.fillRect(0, 0, 10 * sx, H);
      ctx.fillStyle = "rgba(1,51,105,.86)"; ctx.fillRect(110 * sx, 0, 10 * sx, H);
      // end zone lettering uses the same font, size and color as the yard numbers, and both read the same direction
      ctx.fillStyle = "rgba(255,255,255,.7)"; ctx.font = "700 " + Math.round(H * 0.09) + "px 'Geist Mono', monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      if ("letterSpacing" in ctx) ctx.letterSpacing = Math.round(H * 0.02) + "px";
      [[5, "AFC"], [115, "NFC"]].forEach(([yd, label]) => { ctx.save(); ctx.translate(yd * sx, H / 2); ctx.rotate(-Math.PI / 2); ctx.fillText(label, 0, 0); ctx.restore(); });
      if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
      for (let y = 10; y <= 110; y += 5) {
        ctx.strokeStyle = "rgba(255,255,255," + (y === 10 || y === 110 ? 0.95 : y % 10 === 0 ? 0.5 : 0.28) + ")"; ctx.lineWidth = y === 10 || y === 110 ? 3 : 1.5;
        ctx.beginPath(); ctx.moveTo(y * sx, 0); ctx.lineTo(y * sx, H); ctx.stroke();
      }
      ctx.strokeStyle = "rgba(255,255,255,.35)"; ctx.lineWidth = 1;
      for (let y = 11; y < 110; y++) { if (y % 5 === 0) continue; [0.37, 0.63].forEach((f) => { ctx.beginPath(); ctx.moveTo(y * sx, H * f - H * 0.012); ctx.lineTo(y * sx, H * f + H * 0.012); ctx.stroke(); }); }
      ctx.fillStyle = "rgba(255,255,255,.6)"; ctx.font = "700 " + Math.round(H * 0.06) + "px 'Geist Mono', monospace";
      [10, 20, 30, 40, 50, 40, 30, 20, 10].forEach((n, i) => { const x = (20 + i * 10) * sx; ctx.fillText(String(n), x, H * 0.075); ctx.save(); ctx.translate(x, H * 0.925); ctx.rotate(Math.PI); ctx.fillText(String(n), 0, 0); ctx.restore(); });
      ctx.strokeStyle = "rgba(255,255,255,.9)"; ctx.lineWidth = 3; ctx.strokeRect(1.5, 1.5, W - 3, H - 3);
    }

    // An NFL-style game ball, drawn once in detail (leather grain, shading, seams, stitching, raised laces) and then reused.
    let ballSprite = null;
    const SPR_W = 500, SPR_H = 280, SPR_A = 236;
    function makeBallSprite() {
      const c = document.createElement("canvas"); c.width = SPR_W; c.height = SPR_H;
      const g = c.getContext("2d"), cx0 = SPR_W / 2, cy0 = SPR_H / 2, a = SPR_A, b = a * 0.55;
      let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      g.translate(cx0, cy0);
      const outline = () => { g.beginPath(); g.moveTo(-a, 0); g.bezierCurveTo(-a * 0.6, -b * 1.3, a * 0.6, -b * 1.3, a, 0); g.bezierCurveTo(a * 0.6, b * 1.3, -a * 0.6, b * 1.3, -a, 0); g.closePath(); };
      // soft contact shadow baked under the ball edge
      g.save(); g.shadowColor = "rgba(0,0,0,.45)"; g.shadowBlur = 14; g.shadowOffsetY = 6; outline(); g.fillStyle = "#6b2a0a"; g.fill(); g.restore();
      outline(); g.save(); g.clip();
      // leather base: warm light on top, deep brown underneath
      let lg = g.createLinearGradient(0, -b, 0, b);
      lg.addColorStop(0, "#c9773a"); lg.addColorStop(0.35, "#a04a15"); lg.addColorStop(0.7, "#6e2c0a"); lg.addColorStop(1, "#3a1404");
      g.fillStyle = lg; g.fillRect(-a, -b * 1.4, a * 2, b * 2.8);
      // darker toward the pointed ends, like a curved surface
      let eg = g.createLinearGradient(-a, 0, a, 0);
      eg.addColorStop(0, "rgba(20,6,0,.65)"); eg.addColorStop(0.2, "rgba(20,6,0,0)"); eg.addColorStop(0.8, "rgba(20,6,0,0)"); eg.addColorStop(1, "rgba(20,6,0,.65)");
      g.fillStyle = eg; g.fillRect(-a, -b * 1.4, a * 2, b * 2.8);
      // pebbled grain
      for (let i = 0; i < 5200; i++) {
        const x = (rnd() * 2 - 1) * a, y = (rnd() * 2 - 1) * b * 1.15, r = 0.7 + rnd() * 1.4;
        g.fillStyle = rnd() < 0.55 ? "rgba(0,0,0,.14)" : "rgba(255,205,150,.10)";
        g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
      }
      // panel seams running tip to tip (top and bottom), with a lighter edge and stitching
      [-1, 1].forEach((sgn) => {
        const seam = () => { g.beginPath(); g.moveTo(-a * 0.96, 0); g.bezierCurveTo(-a * 0.55, sgn * b * 0.98, a * 0.55, sgn * b * 0.98, a * 0.96, 0); };
        seam(); g.strokeStyle = "rgba(25,8,1,.7)"; g.lineWidth = 3.2; g.stroke();
        g.save(); g.translate(0, -sgn * 1.6); seam(); g.strokeStyle = "rgba(255,200,150,.18)"; g.lineWidth = 1.4; g.stroke(); g.restore();
        seam(); g.setLineDash([5, 7]); g.strokeStyle = "rgba(240,220,190,.55)"; g.lineWidth = 1.3; g.stroke(); g.setLineDash([]);
      });
      // end panel seams near each tip
      [-1, 1].forEach((sgn) => { g.beginPath(); g.moveTo(sgn * a * 0.7, -b * 0.82); g.quadraticCurveTo(sgn * a * 0.8, 0, sgn * a * 0.7, b * 0.82); g.strokeStyle = "rgba(25,8,1,.6)"; g.lineWidth = 2.4; g.stroke(); });
      // broad soft highlight and a thin rim light along the underside
      const hi = g.createRadialGradient(-a * 0.12, -b * 0.55, 4, -a * 0.12, -b * 0.55, a * 0.72);
      hi.addColorStop(0, "rgba(255,232,205,.62)"); hi.addColorStop(0.5, "rgba(255,225,190,.16)"); hi.addColorStop(1, "rgba(255,225,190,0)");
      g.fillStyle = hi; g.fillRect(-a, -b * 1.4, a * 2, b * 2.8);
      const rim = g.createLinearGradient(0, b * 0.55, 0, b); rim.addColorStop(0, "rgba(255,170,110,0)"); rim.addColorStop(1, "rgba(255,170,110,.22)");
      g.fillStyle = rim; g.fillRect(-a, b * 0.3, a * 2, b);
      g.restore();
      outline(); g.lineWidth = 3; g.strokeStyle = "#241002"; g.stroke();
      // raised laces: a shadow underneath, the cord, and cross laces with rounded ends and eyelets
      const ly = -b * 0.36;
      g.lineCap = "round";
      g.strokeStyle = "rgba(20,6,0,.55)"; g.lineWidth = 9; g.beginPath(); g.moveTo(-a * 0.3, ly + 5); g.lineTo(a * 0.3, ly + 5); g.stroke();
      for (let k = -3; k <= 3; k++) { g.beginPath(); g.moveTo(k * a * 0.085, ly - b * 0.24 + 5); g.lineTo(k * a * 0.085, ly + b * 0.24 + 5); g.lineWidth = 9; g.stroke(); }
      const cord = (x1, y1, x2, y2, w) => { const gr = g.createLinearGradient(x1, y1 - w, x1, y1 + w); gr.addColorStop(0, "#ffffff"); gr.addColorStop(1, "#cfc6b6"); g.strokeStyle = gr; g.lineWidth = w; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); };
      cord(-a * 0.3, ly, a * 0.3, ly, 7);
      for (let k = -3; k <= 3; k++) cord(k * a * 0.085, ly - b * 0.24, k * a * 0.085, ly + b * 0.24, 7);
      g.fillStyle = "rgba(20,6,0,.85)"; [-1, 1].forEach((sgn) => { g.beginPath(); g.ellipse(sgn * a * 0.36, ly, 4, 3, 0, 0, TAU); g.fill(); });
      return c;
    }

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
      if (tm < THROW_AT) { ctx.fillStyle = "rgba(0,0,0,.3)"; ctx.beginPath(); ctx.ellipse(center[0] + 3, center[1] + 8, W * 0.02, H * 0.014, 0, 0, TAU); ctx.fill(); football(center[0], center[1], Math.max(34, W * 0.068), 0); }

      // teams
      dots = [];
      slots.forEach((s) => {
        const t = s.t, pos = px(yardsAt(s, tm));
        const v = summary.teams[t.team] ? summary.teams[t.team][measureId] : NaN;
        const norm = hi > lo && !Number.isNaN(v) ? (v - lo) / (hi - lo) : 0.5, rad = r0 * (0.8 + 0.6 * norm);
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
        ctx.globalAlpha = 1;
        dots.push({ t, x: pos[0], y: pos[1], r: rad, on });
      });

      // the pass: arc from the 50-yard line to the target, then carried by the catcher, then back to the line
      let caught = null;
      if (target && tm >= THROW_AT) {
        const s = slotOf[target.team], arrive = px(yardsAt(s, CATCH_AT)), ballLen = Math.max(34, W * 0.068);
        if (tm < CATCH_AT) {
          const u = clamp01((tm - THROW_AT) / (CATCH_AT - THROW_AT)), lift = Math.sin(u * Math.PI);
          const x = center[0] + (arrive[0] - center[0]) * u, y = center[1] + (arrive[1] - center[1]) * u - lift * H * 0.22;
          const ahead = { x: center[0] + (arrive[0] - center[0]) * (u + 0.02), y: center[1] + (arrive[1] - center[1]) * (u + 0.02) - Math.sin(Math.min(1, u + 0.02) * Math.PI) * H * 0.22 };
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
      caption.textContent = focus
        ? (hover ? "" : "Completed pass to ") + focus + " · " + NFLTeams.name(focus) + " · " + m.label + " " + fmt(m, summary.teams[focus][measureId]) + " (rank " + rankOf(focus, measureId) + " of 32)"
        : "AFC teams run right, NFC teams run left. The ball goes to a random team every few seconds. " + summary.scope + ". Hover a team to freeze the play.";
      if (!hover) { if (caught) showTip(dots.find((d) => d.t.team === caught.team)); else { tip.hidden = true; tipKey = null; } }
    }

    // ---------------------------------------------------------------- interaction
    function pick(e) {
      const rect = canvas.getBoundingClientRect(), x = e.clientX - rect.left, y = e.clientY - rect.top;
      let best = null, bd = 1e9;
      dots.forEach((d) => { if (!d.on) return; const dd = Math.hypot(d.x - x, d.y - y); if (dd <= d.r + 8 && dd < bd) { bd = dd; best = d; } });
      return best;
    }
    function showTip(d) {
      if (!d) { tip.hidden = true; tipKey = null; return; }
      const t = d.t, s = summary.teams[t.team], key = t.team + measureId;
      if (key !== tipKey) {
        tipKey = key;
        tip.innerHTML = "<b></b><div class='row'><span></span><span></span></div>";
        tip.firstChild.innerHTML = NFLTeams.badge(t.team) + " "; tip.firstChild.appendChild(document.createTextNode(t.full_name));
        const sub = tip.querySelector(".row"); sub.firstChild.textContent = t.conference + " " + t.division; sub.lastChild.textContent = s.games + " games";
        measures.forEach((m) => { const row = document.createElement("div"); row.className = "row"; if (m.id === measureId) row.style.color = "#ffb612"; row.innerHTML = "<span></span><span></span>"; row.firstChild.textContent = m.label; row.lastChild.textContent = fmt(m, s[m.id]); tip.appendChild(row); });
        const go = document.createElement("div"); go.className = "go"; go.textContent = "Click to open this team"; tip.appendChild(go);
      }
      tip.hidden = false;
      const w = wrap.clientWidth, left = d.x + d.r + 14 + 235 > w ? d.x - d.r - 14 - 235 : d.x + d.r + 14;
      tip.style.left = Math.max(6, left) + "px"; tip.style.top = Math.max(6, Math.min(H - tip.offsetHeight - 6, d.y - 20)) + "px";
    }
    canvas.addEventListener("pointermove", (e) => {
      const d = pick(e), code = d ? d.t.team : null;
      canvas.style.cursor = d ? "pointer" : "default";
      if (code !== hover) { hover = code; tipKey = null; redrawIfPaused(); if (hover) draw(); }
      showTip(d);
    });
    canvas.addEventListener("pointerleave", () => { hover = null; tip.hidden = true; tipKey = null; last = performance.now(); redrawIfPaused(); });
    canvas.addEventListener("click", (e) => { const d = pick(e); if (d && opts.onSelect) { selected = d.t.team; opts.onSelect(d.t.team); redrawIfPaused(); } });

    function pickTarget() {
      const pool = teams.filter((t) => conf === "All" || t.conference === conf);
      return pool[Math.floor(Math.random() * pool.length)];
    }
    function redrawIfPaused() { if (paused || hover) draw(); }
    function frame(now) {
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      if (!paused && !document.hidden && !hover) {
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
