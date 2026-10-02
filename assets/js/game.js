/* "Play a game": a short, just-for-fun football game on the field board. Pick two teams, call plays (or watch a simulation) and the helmets
   play each snap out on a camera-follow field with the same 3D ball as the play board, dust, hits, flags, kicks and touchdown confetti.
   Under the hood every play is a random draw shaped by each team's real averages in data/team_summary.json (passing and rushing yards,
   sacks, QB hits, interceptions, penalties per team-game, 2009 to 2025), so stronger teams really do win more. It is a simulation, not a
   real game result. Opened from the field board (assets/js/field.js). Delete this file, game.css and the mode button in field.js to remove it. */
(function () {
  "use strict";
  const R = Math.random, TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v)), clamp01 = (u) => clamp(u, 0, 1), lerp = (a, b, u) => a + (b - a) * u;
  const ease = (u) => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2), easeOut = (u) => 1 - Math.pow(1 - u, 3);
  const norm = (m, s) => m + s * Math.sqrt(-2 * Math.log(1 - R())) * Math.cos(TAU * R());
  const calm = () => window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const STAT_IDS = ["pass_yds_tg", "rush_yds_tg", "sacks_tg", "qb_hits_tg", "ints_tg", "pen_tg"];
  const DRIVES_PLAY = 12, DRIVES_SIM = 22;
  const CY = 26.65;                       // the middle of the field, in yards
  const imgs = {};
  const sheet = (code) => { if (!imgs[code]) { const im = new Image(); im.src = NFLTeams.helmetSheet(code); imgs[code] = im; } return imgs[code]; };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function open(container, opts) {
    const teams = opts.teams, SUM = opts.summary.teams, byCode = {};
    teams.forEach((t) => { byCode[t.team] = t; });
    const AVG = {}; STAT_IDS.forEach((id) => { const cs = Object.keys(SUM); AVG[id] = cs.reduce((a, c) => a + SUM[c][id], 0) / cs.length; });
    const nm = (c) => byCode[c].name || byCode[c].full_name, ratio = (c, id) => SUM[c][id] / AVG[id];

    const hidden = [...container.children];
    hidden.forEach((el) => { el._prev = el.style.display; el.style.display = "none"; });
    const root = document.createElement("div"); root.className = "game"; container.appendChild(root);
    let raf = 0;
    function close() { if (G) G.id++; anim = null; cancelAnimationFrame(raf); document.removeEventListener("keydown", keys); window.removeEventListener("resize", size); root.remove(); hidden.forEach((el) => { el.style.display = el._prev || ""; }); if (opts.onClose) opts.onClose(); }

    let you = opts.selected && byCode[opts.selected] ? opts.selected : "KC", opp = "BUF"; if (you === opp) opp = "SF";
    let G = null, mode = "play", DRIVES = DRIVES_PLAY, busy = false;
    const side = (p) => (p === "you" ? you : opp), other = (p) => (p === "you" ? "opp" : "you");
    const abs = (p, b) => 10 + (p === "you" ? b : 100 - b);   // where a yard line sits on the 120-yard field (you attack to the right)

    // ================================================================== setup
    const options = (sel) => teams.slice().sort((a, b) => a.full_name.localeCompare(b.full_name)).map((t) => "<option value='" + t.team + "'" + (t.team === sel ? " selected" : "") + ">" + esc(t.full_name) + "</option>").join("");
    function setup() {
      if (G) G.id++; anim = null; cancelAnimationFrame(raf); document.removeEventListener("keydown", keys);
      root.innerHTML = "<div class='g-top'><h2>Play a game</h2><button type='button' class='btn ghost small g-back'>← Back to the field</button></div>" +
        "<p class='g-lead'>Pick two teams. Call the plays yourself, or sit back and watch a simulated game. Just for fun: stronger teams win more often, but anything can happen.</p>" +
        "<div class='g-pick'><div class='g-side' style='--c:" + esc(byCode[you].color) + "'><span class='g-bighelm'>" + NFLTeams.helm(you) + "</span><label>You<select id='g-you'>" + options(you) + "</select></label></div><span class='g-vs'>VS</span>" +
        "<div class='g-side' style='--c:" + esc(byCode[opp].color) + "'><span class='g-bighelm'>" + NFLTeams.helm(opp) + "</span><label>Opponent<select id='g-opp'>" + options(opp) + "</select></label></div></div>" +
        "<div class='g-actions'><button type='button' class='btn g-go'>Kick off: I call the plays</button><button type='button' class='btn ghost g-watch'>Watch a simulated game</button><button type='button' class='btn ghost g-sim'>Skip to the final score</button></div>";
      root.querySelector(".g-back").onclick = close;
      root.querySelector("#g-you").onchange = (e) => { you = e.target.value; if (you === opp) opp = teams.find((t) => t.team !== you).team; setup(); root.querySelector("#g-you").focus(); };
      root.querySelector("#g-opp").onchange = (e) => { opp = e.target.value; if (you === opp) you = teams.find((t) => t.team !== opp).team; setup(); root.querySelector("#g-opp").focus(); };
      root.querySelector(".g-go").onclick = () => start("play"); root.querySelector(".g-watch").onclick = () => start("watch"); root.querySelector(".g-sim").onclick = () => start("skip");
    }

    // ================================================================== the football engine (a random draw shaped by the real averages)
    const fgDist = () => 100 - G.ball + 17;
    function cpuOffense() {
      const d = G.down, tg = G.toGo, r = R();
      if (d === 4) { if (G.ball >= 62) return "fg"; if (G.ball < 50 && tg > 2) return "punt"; if (G.ball >= 50 && tg > 5 && r < 0.5) return "fg"; return tg > 4 ? "short" : "run"; }
      if (d === 3 && tg > 7) return r < 0.5 ? "short" : r < 0.88 ? "deep" : "run";
      if (d === 3 && tg <= 3) return r < 0.6 ? "run" : "short";
      return r < 0.42 ? "run" : r < 0.8 ? "short" : "deep";
    }
    function cpuDefense() {
      const r = R(), tg = G.toGo;
      if (tg >= 8) return r < 0.5 ? "cov" : r < 0.75 ? "bal" : "blitz";
      if (tg <= 3) return r < 0.5 ? "stop" : r < 0.8 ? "bal" : "blitz";
      return r < 0.4 ? "bal" : r < 0.62 ? "blitz" : r < 0.82 ? "cov" : "stop";
    }
    function resolve(call, def, O, D) {
      const ro = (id) => ratio(O, id), rd = (id) => ratio(D, id);
      if (call === "punt") return { kind: "punt", yards: Math.round(clamp(norm(44, 6), 30, 62)) };
      if (call === "fg") { const p = clamp(0.97 - (fgDist() - 25) * 0.012, 0.15, 0.97); return { kind: R() < p ? "fg_good" : "fg_miss", yards: fgDist() }; }
      if (R() < 0.04 * ro("pen_tg")) return { kind: "pen_off", yards: -10 };
      if (R() < 0.035 * rd("pen_tg")) return { kind: "pen_def", yards: 5 };
      const sackMod = { bal: 1, blitz: 1.9, cov: 0.75, stop: 0.85 }[def], intMod = { bal: 1, blitz: 0.9, cov: 1.5, stop: 0.9 }[def];
      if (call === "run") {
        const mean = 4.0 * Math.pow(ro("rush_yds_tg"), 1.6) * { bal: 1, blitz: 1.08, cov: 1.15, stop: 0.62 }[def];
        let y = Math.round(norm(mean, 3.4)); if (R() < 0.07) y += Math.round((8 + R() * 30) * (def === "blitz" ? 1.3 : 1)); y = Math.max(-4, y);
        if (R() < 0.012) return { kind: "fumble", yards: y };
        return { kind: "gain", call, yards: y };
      }
      const deep = call === "deep";
      const sackP = (deep ? 0.07 : 0.055) * rd("sacks_tg") * sackMod, intP = (deep ? 0.042 : 0.015) * Math.pow(rd("ints_tg"), 1.3) * intMod;
      const compP = clamp((deep ? 0.40 : 0.70) * Math.pow(ro("pass_yds_tg"), deep ? 0.9 : 0.6) / Math.pow(rd("qb_hits_tg"), 0.4) * { bal: 1, blitz: deep ? 1 : 0.93, cov: deep ? 0.55 : 0.9, stop: deep ? 1.1 : 1.06 }[def], 0.1, 0.92);
      if (R() < sackP) return { kind: "sack", yards: -Math.round(clamp(norm(7, 2.5), 3, 14)) };
      if (R() < intP) return { kind: "int", yards: Math.round(R() * 14) };
      if (R() > compP) return { kind: "incomplete", call, yards: 0 };
      let y = Math.round(norm((deep ? 20 : 6.5) * ro("pass_yds_tg") * { bal: 1, blitz: 1.1, cov: 0.85, stop: 1 }[def], deep ? 7 : 3.5));
      if (R() < 0.06) y += Math.round(10 + R() * 25); y = Math.max(deep ? 8 : 1, y);
      return { kind: "gain", call, yards: y, pass: true };
    }

    // ================================================================== game state
    function start(m) {
      mode = m; DRIVES = mode === "play" ? DRIVES_PLAY : DRIVES_SIM;
      G = { id: (G ? G.id : 0) + 1, score: { you: 0, opp: 0 }, poss: "you", ball: 25, down: 1, toGo: 10, drive: 1, over: false, log: [], box: { you: { yds: 0, tds: 0, fgs: 0, turnovers: 0, sacks: 0 }, opp: { yds: 0, tds: 0, fgs: 0, turnovers: 0, sacks: 0 } } };
      buildStage(); if (mode === "skip") skipToEnd(); else { formation(true); turn(); }
    }
    function skipToEnd() { mode = "skip"; if (G.pending) { const p = G.pending; G.pending = null; p(); } hideBanner(); G.id++; anim = null; let n = 0; while (!G.over && n++ < 600) snap(null, null, true); formation(true); turn(); }
    function lineText() { const sp = G.ball <= 50 ? "own " + G.ball : "the other side's " + (100 - G.ball); return ["", "1st", "2nd", "3rd", "4th"][clamp(G.down, 1, 4)] + " & " + (G.ball + G.toGo >= 100 ? "goal" : G.toGo) + " at " + sp; }

    // ================================================================== the stage (DOM + canvas)
    let cv, ctx, W = 0, H = 0, PX = 10, PY = 10, anim = null, bannerEl;
    const SC = { A: [], B: [], parts: [], texts: [], cam: 60, shake: 0, ts: 1, los: 35, first: 45, losT: 35, firstT: 45, focus: null, ball: { x: 60, y: CY, z: 0, spin: 0, ang: 0, vis: true }, flash: 0, crowd: [], t: 0, flag: null };
    function mkActors(code) { return Array.from({ length: 9 }, (_, i) => ({ code, i, x: 60, y: CY, tx: 60, ty: CY, sp: 0, ph: R() * 6, direct: false, hop: 0, down: 0, face: 1, k: 6 })); }
    function buildStage() {
      root.innerHTML = "<div class='g-top'><h2>Play a game</h2><button type='button' class='btn ghost small g-quit'>End game</button></div>" +
        "<div class='g-board'></div><div class='g-field'><canvas aria-hidden='true'></canvas><div class='g-banner' hidden></div></div>" +
        "<div class='g-situation' role='status' aria-live='polite'></div><div class='g-calls' role='group' aria-label='Call a play'></div><ol class='g-log' aria-label='Play by play' aria-live='polite'></ol>";
      root.querySelector(".g-quit").onclick = () => { setup(); };
      cv = root.querySelector("canvas"); ctx = cv.getContext("2d"); bannerEl = root.querySelector(".g-banner");
      SC.A = mkActors(you); SC.B = mkActors(opp); SC.parts = []; SC.texts = []; SC.ts = 1; SC.shake = 0; anim = null; SC.flag = null; SC.flash = 0;
      SC.crowd = Array.from({ length: 140 }, () => ({ x: R(), top: R() < 0.5, d: R(), ph: R() * 6, c: R() < 0.6 ? 0 : R() < 0.5 ? 1 : 2 }));
      size(); window.removeEventListener("resize", size); window.addEventListener("resize", size); document.addEventListener("keydown", keys);
      cancelAnimationFrame(raf); last = 0; raf = requestAnimationFrame(frame);
    }
    function size() {
      if (!cv) return; const w = cv.parentNode.clientWidth || 800, dpr = Math.min(2, window.devicePixelRatio || 1), phone = w < 560;
      W = w; H = Math.round(w * (phone ? 0.78 : 0.5)); cv.style.width = W + "px"; cv.style.height = H + "px"; cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      PX = W / (phone ? 34 : 46); PY = H / 38;
    }
    function keys(e) { if (!root.isConnected || e.ctrlKey || e.metaKey || e.altKey || (e.target && e.target.closest && e.target.closest("select,input,textarea"))) return; const n = parseInt(e.key, 10); if (!n) return; const b = root.querySelectorAll(".g-calls button:not([disabled])")[n - 1]; if (b) b.click(); }
    const SX = (x) => W / 2 + (x - SC.cam) * PX, SY = (y, z) => H / 2 + (y - CY) * PY * 0.95 - (z || 0) * PY * 1.25;

    // where everyone lines up
    function formation(snapTo) {
      const offP = G.poss, dir = offP === "you" ? 1 : -1, L = abs(offP, G.ball), O = offP === "you" ? SC.A : SC.B, D = offP === "you" ? SC.B : SC.A;
      const set = (a, x, y) => { a.tx = x; a.ty = y; if (snapTo) { a.x = x; a.y = y; } a.direct = false; a.k = 6; };
      for (let i = 0; i < 5; i++) set(O[i], L - dir * 0.8, CY + (i - 2) * 1.9);
      set(O[5], L - dir * 4.8, CY); set(O[6], L - dir * 7.2, CY + 2.4); set(O[7], L - dir * 0.6, CY - 15); set(O[8], L - dir * 0.6, CY + 15);
      for (let j = 0; j < 4; j++) set(D[j], L + dir * 1.7, CY + (j - 1.5) * 2.4);
      set(D[4], L + dir * 4.8, CY - 4.2); set(D[5], L + dir * 4.8, CY + 4.2); set(D[6], L + dir * 10, CY - 14); set(D[7], L + dir * 10, CY + 14); set(D[8], L + dir * 16, CY);
      O.forEach((a) => { a.face = dir; a.down = 0; }); D.forEach((a) => { a.face = -dir; a.down = 0; });
      SC.losT = L; SC.firstT = abs(offP, Math.min(100, G.ball + G.toGo)); if (snapTo) { SC.los = SC.losT; SC.first = SC.firstT; SC.cam = L + dir * 5; }
      SC.ball.vis = true; SC.ball.z = 0; SC.ball.x = L; SC.ball.y = CY; SC.ball.ang = 0; SC.focus = null;
    }

    // ================================================================== one snap
    function snap(offCall, defCall, instant) {
      const offP = G.poss, defP = other(offP), O = side(offP), D = side(defP);
      if (mode !== "play") { offCall = cpuOffense(); defCall = cpuDefense(); } else if (offP === "you") defCall = cpuDefense(); else offCall = cpuOffense();
      const out = resolve(offCall, defCall, O, D); out.offCall = offCall; out.defCall = defCall;
      play(out, offP, defP, O, D, instant);
    }
    function play(out, offP, defP, O, D, instant) {
      const bx = G.ball, before = lineText(), nmO = nm(O), box = G.box[offP], boxD = G.box[defP];
      let text = "", cls = "", turnoverAt = null, scored = null, tag = "";
      switch (out.kind) {
        case "gain": {
          const y = out.yards, nb = clamp(bx + y, 1, 100); box.yds += Math.max(0, nb - bx); out.to = nb; G.ball = nb; G.toGo -= nb - bx;
          if (nb >= 100) { scored = "td"; text = "TOUCHDOWN " + nmO + "!"; cls = "good"; }
          else { text = (out.call === "run" ? "Run" : out.call === "deep" ? "Deep pass" : "Pass") + " for " + (y >= 0 ? y + " yards" : "a loss of " + (-y)) + "."; if (G.toGo <= 0) { G.down = 1; G.toGo = Math.min(10, 100 - G.ball); text += " First down!"; tag = "FIRST DOWN"; } else G.down++; }
          break;
        }
        case "incomplete": out.to = bx; text = "Incomplete."; G.down++; tag = "INCOMPLETE"; break;
        case "sack": out.to = Math.max(1, bx + out.yards); boxD.sacks++; G.ball = out.to; G.toGo -= out.yards; G.down++; text = "SACK! " + nm(D) + " drops the QB for " + (-out.yards) + "."; cls = "bad"; tag = "SACK"; break;
        case "int": box.turnovers++; text = "INTERCEPTED by " + nm(D) + "!"; cls = "bad"; turnoverAt = bx + 9 >= 100 ? 20 : clamp(100 - (bx + 9) + out.yards, 1, 99); out.to = Math.min(99, bx + 9); tag = "INTERCEPTION"; break;
        case "fumble": box.turnovers++; text = "FUMBLE! " + nm(D) + " recovers."; cls = "bad"; turnoverAt = bx + out.yards >= 100 ? 20 : clamp(100 - (bx + out.yards), 1, 99); out.to = clamp(bx + out.yards, 1, 99); tag = "FUMBLE"; break;
        case "pen_off": text = "Flag! Penalty on " + nmO + ", 10 yards back."; cls = "bad"; G.ball = Math.max(1, bx - 10); G.toGo += 10; out.to = G.ball; tag = "FLAG"; break;
        case "pen_def": text = "Flag! Penalty on " + nm(D) + ", 5 yards."; cls = "good"; G.ball = Math.min(99, bx + 5); G.toGo -= 5; out.to = G.ball; tag = "FLAG"; if (G.toGo <= 0) { G.down = 1; G.toGo = Math.min(10, 100 - G.ball); } break;
        case "punt": text = nmO + " punts " + out.yards + " yards."; turnoverAt = (bx + out.yards >= 100) ? 20 : clamp(100 - (bx + out.yards), 1, 99); out.to = Math.min(100, bx + out.yards); break;
        case "fg_good": scored = "fg"; text = "FIELD GOAL is good from " + out.yards + "!"; cls = "good"; break;
        case "fg_miss": text = "Field goal missed from " + out.yards + "."; cls = "bad"; turnoverAt = clamp(100 - bx, 20, 99); tag = "NO GOOD"; break;
      }
      if (!turnoverAt && !scored && G.down > 4) { text += " Turned over on downs."; cls = "bad"; turnoverAt = 100 - G.ball; tag = "TURNOVER ON DOWNS"; }
      const gid0 = G.id; let endDrive = false, didSettle = false, didAdvance = false;
      const settle = () => {
        logAdd("<b>" + esc(nm(O)) + "</b> <span class='g-dn'>" + before + "</span> " + text, offP === "you" ? cls : cls === "good" ? "bad" : cls === "bad" ? "good" : cls);
        if (scored) { G.score[offP] += scored === "td" ? 7 : 3; G.box[offP][scored === "td" ? "tds" : "fgs"]++; endDrive = true; turnoverAt = 25; } else if (turnoverAt !== null) endDrive = true;
      };
      const advance = () => {
        if (endDrive) { G.drive++; G.poss = other(offP); G.ball = turnoverAt; G.down = 1; G.toGo = 10; if (G.drive > DRIVES) { if (G.score.you !== G.score.opp && (G.drive - 1) % 2 === 0) G.over = true; else if (G.drive > DRIVES + 6) G.over = true; } }
      };
      const doSettle = () => { if (!didSettle) { didSettle = true; settle(); } }, doAdvance = () => { if (!didAdvance) { didAdvance = true; advance(); } };
      if (instant) { doSettle(); doAdvance(); return; }
      G.pending = () => { doSettle(); doAdvance(); };
      startScene(out, offP, defP, bx, scored, turnoverAt, () => {
        if (G.id !== gid0) return; doSettle(); boardScore();
        const showTag = scored ? (scored === "td" ? "TOUCHDOWN" : "FIELD GOAL") : tag;
        if (showTag) banner(showTag, scored ? offP : (out.kind === "int" || out.kind === "fumble" || tag === "SACK" || tag === "TURNOVER ON DOWNS") ? defP : offP, !!scored);
        const quick = !showTag || tag === "INCOMPLETE" || tag === "FIRST DOWN";
        const wait = calm() ? 200 : scored ? 2300 : quick ? 500 : 1100;
        setTimeout(() => { if (G.id !== gid0) return; doAdvance(); G.pending = null; anim = null; hideBanner(); SC.ts = 1; formation(false); turn(); }, mode === "watch" ? Math.min(wait, scored ? 1800 : 700) : wait);
      });
    }

    // ================================================================== whose turn: buttons
    function turn() {
      if (!root.querySelector(".g-board")) return; board(); busy = false;
      const calls = root.querySelector(".g-calls"), sit = root.querySelector(".g-situation"); if (!calls) return;
      if (G.over) return finish();
      const offYou = G.poss === "you";
      if (mode === "watch") {
        sit.innerHTML = "<b>" + esc(nm(side(G.poss))) + " ball.</b> " + lineText() + ".";
        calls.innerHTML = ""; const sk = document.createElement("button"); sk.type = "button"; sk.className = "btn ghost small"; sk.textContent = "Skip to the final score"; sk.onclick = skipToEnd; calls.appendChild(sk);
        const id = G.id; setTimeout(() => { if (G.id === id && !G.over && !anim) snap(null, null); }, calm() ? 150 : 650); return;
      }
      sit.innerHTML = "<b>" + esc(nm(side(G.poss))) + " ball.</b> " + lineText() + ". " + (offYou ? "Call your play." : "Call your defense.");
      const btn = (label, sub, fn) => { const b = document.createElement("button"); b.type = "button"; b.className = "btn g-call"; b.innerHTML = "<b>" + label + "</b><small>" + sub + "</small>"; b.onclick = () => { if (busy) return; busy = true; calls.querySelectorAll("button").forEach((x) => { x.disabled = true; }); fn(); }; return b; };
      calls.innerHTML = "";
      const refocus = () => { const ae = document.activeElement; if (!ae || ae === document.body || root.contains(ae)) { const f = calls.querySelector("button:not([disabled])"); if (f) f.focus({ preventScroll: true }); } };
      if (offYou) {
        calls.appendChild(btn("Run", "grind it out", () => snap("run"))); calls.appendChild(btn("Short pass", "safer gains", () => snap("short"))); calls.appendChild(btn("Deep pass", "go for it all", () => snap("deep")));
        if (G.down === 4) { calls.appendChild(btn("Punt", "flip the field", () => snap("punt"))); if (G.ball >= 55) calls.appendChild(btn("Field goal", fgDist() + " yards", () => snap("fg"))); }
      } else {
        [["bal", "Balanced", "no surprises"], ["blitz", "Blitz", "go get the QB"], ["cov", "Coverage", "no deep balls"], ["stop", "Run-stop", "stuff the run"]].forEach(([k, l, s]) => calls.appendChild(btn(l, s, () => snap(null, k))));
      }
      refocus();
    }
    function board() {
      if (!root.querySelector(".g-board")) return;
      const row = (p) => "<div class='g-team" + (G.poss === p ? " has" : "") + "' style='--c:" + esc(byCode[side(p)].color) + "'><span class='g-helm'>" + NFLTeams.helm(side(p)) + "</span><b>" + esc(nm(side(p))) + "</b><span class='g-pts' data-p='" + p + "'>" + G.score[p] + "</span></div>";
      root.querySelector(".g-board").innerHTML = row("you") + "<div class='g-mid'>Drive " + Math.min(G.drive, DRIVES) + " of " + DRIVES + (G.drive > DRIVES ? " (overtime)" : "") + "</div>" + row("opp");
    }
    function boardScore() { root.querySelectorAll(".g-pts").forEach((el) => { const p = el.dataset.p; if (String(G.score[p]) !== el.textContent) { el.textContent = G.score[p]; el.classList.remove("bump"); void el.offsetWidth; el.classList.add("bump"); } }); }
    function logAdd(text, cls) { G.log.unshift({ text, cls }); const ol = root.querySelector(".g-log"); if (!ol) return; const li = document.createElement("li"); li.className = cls || ""; li.innerHTML = text; ol.insertBefore(li, ol.firstChild); while (ol.children.length > 4) ol.removeChild(ol.lastChild); }
    function banner(t, p, big) { if (!bannerEl) return; bannerEl.textContent = t; bannerEl.style.setProperty("--c", byCode[side(p)].color); bannerEl.classList.toggle("big", !!big); bannerEl.hidden = false; bannerEl.style.animation = "none"; void bannerEl.offsetWidth; bannerEl.style.animation = ""; }
    function hideBanner() { if (bannerEl) bannerEl.hidden = true; }

    // ================================================================== scenes: each play is a short animation driven by u from 0 to 1
    const DUR = { run: 1.9, short: 2.3, deep: 2.7, incomplete: 2.3, sack: 2.0, int: 2.8, fumble: 2.3, punt: 2.8, fg: 2.5, pen: 1.2 };
    function startScene(out, offP, defP, bx, scored, turnoverAt, done) {
      const kind = out.kind, dir = offP === "you" ? 1 : -1, L = abs(offP, bx);
      const E = out.to !== undefined ? abs(offP, out.to) : L;
      const kk = kind === "gain" ? (out.pass ? (out.call === "deep" ? "deep" : "short") : "run") : kind === "incomplete" ? "incomplete" : kind === "sack" ? "sack" : kind === "int" ? "int" : kind === "fumble" ? "fumble" : kind === "punt" ? "punt" : kind.startsWith("fg") ? "fg" : "pen";
      const T = calm() ? 0.25 : (DUR[kk] || 2) * (mode === "watch" ? 0.72 : 1);
      anim = { out, kind, kk, offP, defP, dir, L, E, T, t: 0, scored, turnoverAt, done, fired: false, did: {} };
      SC.ball.vis = true;
      const a0 = anim; setTimeout(() => { if (anim === a0 && !a0.fired) { a0.fired = true; a0.done(); } }, T * 1000 * 1.9 + 600);   // keeps the game moving even if frames are throttled
    }
    const O_ = (a) => (a.offP === "you" ? SC.A : SC.B), D_ = (a) => (a.offP === "you" ? SC.B : SC.A);
    function put(a, x, y) { a.x = x; a.y = y; a.tx = x; a.ty = y; a.direct = true; }
    function chase(a, x, y, k) { a.tx = x; a.ty = y; a.direct = false; a.k = k || 6; }
    function ballTo(x, y, z, ang) { SC.ball.x = x; SC.ball.y = y; SC.ball.z = z || 0; if (ang !== undefined) SC.ball.ang = ang; }
    function trail() { if (!calm() && R() < 0.55) SC.parts.push({ x: SC.ball.x, y: SC.ball.y, z: SC.ball.z, vx: 0, vy: 0, vz: 0, life: 0.32, age: 0, c: "rgba(255,255,255,.35)", s: 3, k: "trail" }); }
    function tackle(x, y, col, n) {
      if (calm()) return;
      for (let i = 0; i < (n || 22); i++) { const a = R() * TAU, s = 3 + R() * 9; SC.parts.push({ x, y, z: 0.6, vx: Math.cos(a) * s, vy: Math.sin(a) * s * 0.6, vz: 2 + R() * 5, life: 0.5 + R() * 0.5, age: 0, c: i % 3 ? "rgba(255,255,255,.9)" : col, s: 2 + R() * 3, k: "spark" }); }
      for (let i = 0; i < 8; i++) SC.parts.push({ x, y, z: 0, vx: (R() - 0.5) * 6, vy: (R() - 0.5) * 3, vz: 1 + R() * 2, life: 0.8, age: 0, c: "rgba(190,160,110,.5)", s: 6 + R() * 6, k: "dust" });
      SC.shake = Math.max(SC.shake, 0.5);
    }
    function dust(x, y) { if (calm() || R() > 0.55) return; SC.parts.push({ x, y: y + 0.4, z: 0, vx: (R() - 0.5) * 1.2, vy: (R() - 0.5) * 0.8, vz: 0.4, life: 0.55, age: 0, c: "rgba(200,175,130,.4)", s: 4 + R() * 4, k: "dust" }); }
    function confetti(p) {
      if (calm()) return; const cols = [byCode[side(p)].color, "#ffffff", "#ffd23c", byCode[side(p)].color2 || "#ffffff"];
      for (let i = 0; i < 90; i++) SC.parts.push({ x: SC.cam + (R() - 0.5) * 36, y: CY + (R() - 0.5) * 30, z: 12 + R() * 8, vx: (R() - 0.5) * 6, vy: (R() - 0.5) * 4, vz: -(1 + R() * 3), life: 2.2 + R() * 1.2, age: 0, c: cols[i % cols.length], s: 4 + R() * 5, k: "conf", rot: R() * TAU, vr: (R() - 0.5) * 12 });
    }
    function floater(x, y, text, col) { SC.texts.push({ x, y, z: 2, text, col: col || "#fff", age: 0, life: 1.1 }); }

    function runScene(a, u, dt) {
      const { dir, L, E, kk, out } = a, O = O_(a), D = D_(a), cy = CY, col = byCode[side(a.offP)].color;
      SC.focus = null;
      const ol = O.slice(0, 5), qb = O[5], rb = O[6], w1 = O[7], w2 = O[8], dl = D.slice(0, 4), lb = [D[4], D[5]], db = [D[6], D[7]], sf = D[8];
      const shove = ease(clamp01((u - 0.25) / 0.5));
      if (kk === "run" || kk === "fumble") {
        const pu = clamp01((u - 0.3) / 0.6), p = easeOut(pu); let cx, cyy;
        if (u < 0.3) { const q = ease(u / 0.3); cx = L - dir * (7.2 - 2 * q); cyy = cy + 2.4 - 1.4 * q; } else { cx = lerp(L - dir * 5.2, E, p); cyy = cy + 1 + Math.sin(p * 7) * 1.9 * (1 - p); }
        const fum = kk === "fumble", cut = fum ? 0.7 : 1; if (fum && u >= cut) { cx = a.fx !== undefined ? a.fx : cx; }
        put(rb, cx, cyy);
        ol.forEach((o, i) => chase(o, L - dir * 0.8 + dir * 1.3 * shove, cy + (i - 2) * 1.9, 9));
        chase(qb, L - dir * (4.8 - 0.5 * ease(clamp01((u - 0.3) / 0.4))), cy, 8); chase(w1, L + dir * 9 * ease(u), cy - 15, 5); chase(w2, L + dir * 9 * ease(u), cy + 15, 5);
        dl.forEach((d, i) => chase(d, lerp(L + dir * 1.7, cx + dir * 0.9, 0.55 * ease(clamp01(u / 0.85))), lerp(cy + (i - 1.5) * 2.4, cyy, 0.6 * ease(clamp01(u / 0.85))), 6));
        lb.forEach((d, i) => chase(d, u > 0.22 ? cx + dir * (1.1 + i * 0.5) : L + dir * 4.8, u > 0.22 ? cyy + (i ? 0.9 : -0.9) : cy + (i ? 4.2 : -4.2), 5.5));
        db.forEach((d, i) => chase(d, u > 0.4 ? cx + dir * (2 + i) : L + dir * 10 - dir * 2 * u, u > 0.4 ? cyy + (i ? 1.3 : -1.3) : cy + (i ? 14 : -14), 4.5)); chase(sf, u > 0.5 ? cx + dir * 3.6 : L + dir * 16, u > 0.5 ? cyy : cy, 4);
        if (u < 0.14) { const q = u / 0.14; ballTo(lerp(L, L - dir * 4.8, q), cy, Math.sin(q * Math.PI) * 0.9); }
        else if (u < 0.3) { const q = (u - 0.14) / 0.16; ballTo(lerp(L - dir * 4.8, L - dir * 7, q), lerp(cy, cy + 2.4, q), Math.sin(q * Math.PI) * 0.9); }
        else if (!fum || u < cut) { ballTo(cx + dir * 0.5, cyy - 0.3, 0.6, dir > 0 ? 0 : Math.PI); }
        if (fum && u >= cut) {
          if (!a.did.fum) { a.did.fum = 1; a.fx = rb.x; a.fy = rb.y; a.fvx = -dir * 4 + (R() - 0.5) * 2; a.fvy = (R() - 0.5) * 7; tackle(rb.x, rb.y, col, 26); floater(rb.x, rb.y, "FUMBLE!", "#ffd23c"); }
          const t2 = u - cut; ballTo(a.fx + a.fvx * t2 * 2, a.fy + a.fvy * t2 * 2, Math.abs(Math.sin(t2 * 14)) * 1.8 * Math.max(0, 1 - t2 * 1.6)); SC.ball.spin += dt * 22; db.concat(lb).forEach((d) => chase(d, SC.ball.x, SC.ball.y, 7));
        }
        if (u > 0.3 && u < 0.92 && !fum) dust(cx - dir * 0.8, cyy);
        if (u >= 0.9 && !fum && !a.did.tackle) { a.did.tackle = 1; if (!a.scored) { tackle(cx, cyy, col); if (out.yards >= 8) floater(cx, cyy, "+" + out.yards, "#7CFF9B"); } }
        if (u >= 0.9 && !fum && !a.scored) lb.concat(db, dl.slice(0, 2)).forEach((d, i) => chase(d, cx + dir * (0.4 + (i % 3) * 0.5), cyy + (i - 3) * 0.55, 10));
        SC.focus = cx; return;
      }
      if (kk === "short" || kk === "deep" || kk === "incomplete" || kk === "int") {
        const deep = out.call === "deep" || kk === "deep", air = kk === "int" ? 9 : kk === "incomplete" ? (deep ? 24 : 9) : Math.max(4, out.yards - Math.min(6, out.yards * 0.3));
        const catchU = 0.62, throwU = 0.34, tx = L + dir * air, ty = cy - 5.5, rcv = w1;
        const qbDrop = ease(clamp01(u / 0.4)), pk = ease(clamp01(u / 0.3));
        put(qb, L - dir * (4.8 + 3.2 * qbDrop), cy);
        ol.forEach((o, i) => chase(o, L - dir * (0.8 + 0.9 * pk), cy + (i - 2) * (1.9 + 0.35 * pk), 9));
        chase(rb, L - dir * 7.2, cy + 2.4 + Math.sin(u * 5) * 0.2, 6); chase(w2, L + dir * (10 + 18 * ease(u)), cy + 15 - 6 * ease(u), 5);
        const rp = ease(clamp01(u / catchU)); put(rcv, lerp(L - dir * 0.6, tx, rp), lerp(cy - 15, ty, rp) + Math.sin(rp * 3) * (deep ? 0.8 : 0.4));
        dl.forEach((d, i) => chase(d, lerp(L + dir * 1.7, L - dir * 3.5, 0.55 * ease(clamp01(u / 0.55))), lerp(cy + (i - 1.5) * 2.4, cy + (i - 1.5) * 0.9, 0.7 * ease(clamp01(u / 0.55))), 6));
        lb.forEach((d, i) => chase(d, L + dir * (4.8 + 2 * u), cy + (i ? 6 : -6) - (i ? 0 : 3) * u, 4)); chase(sf, L + dir * (16 + 3 * u), cy - 3 * u, 3);
        if (kk !== "int") chase(db[0], lerp(L + dir * 10, tx + dir * 1.2, ease(clamp01(u / catchU))), lerp(cy - 14, ty + 0.6, ease(clamp01(u / catchU))), 8);
        chase(db[1], L + dir * 10, cy + 14, 4);
        if (u < 0.1) { const q = u / 0.1; ballTo(lerp(L, L - dir * 4.8, q), cy, Math.sin(q * Math.PI) * 0.8); }
        else if (u < throwU) ballTo(qb.x + dir * 0.4, qb.y, 0.9);
        else if (u < catchU) {
          const q = (u - throwU) / (catchU - throwU), bx2 = lerp(qb.x, tx, q), by2 = lerp(qb.y, kk === "int" ? ty + 4 : ty, q), peak = clamp(air * 0.28 + 2.5, 3, 9);
          ballTo(bx2, by2, Math.sin(q * Math.PI) * peak + 0.9 * (1 - q), (dir > 0 ? 0 : Math.PI) + (q - 0.5) * 0.6); SC.ball.spin += dt * 24; trail();
        } else {
          if (kk === "short" || kk === "deep") {
            const q = easeOut(clamp01((u - catchU) / (0.94 - catchU))); put(rcv, lerp(tx, E, q), lerp(ty, cy + 2, q)); ballTo(rcv.x + dir * 0.5, rcv.y - 0.2, 0.7, dir > 0 ? 0 : Math.PI);
            if (!a.did.catch) { a.did.catch = 1; floater(tx, ty, "CAUGHT", "#ffffff"); }
            if (u > catchU + 0.04 && u < 0.92) dust(rcv.x - dir * 0.8, rcv.y);
            chase(db[0], rcv.x + dir * 1.0, rcv.y + 0.8, 9); chase(db[1], rcv.x + dir * 1.8, rcv.y - 0.8, 7); lb.forEach((d) => chase(d, rcv.x + dir * 1.4, rcv.y + 1, 6));
            if (u >= 0.94 && !a.did.tackle) { a.did.tackle = 1; if (!a.scored) { tackle(rcv.x, rcv.y, col); if (out.yards >= 15) floater(rcv.x, rcv.y, "+" + out.yards, "#7CFF9B"); } }
            SC.focus = rcv.x; return;
          }
          if (kk === "incomplete") {
            const q = clamp01((u - catchU) / 0.3); ballTo(tx + dir * 1.6 * q, ty + 1.2 * q, Math.abs(Math.sin(q * 3.6)) * 1.8 * (1 - q)); SC.ball.spin += dt * 10; chase(db[0], tx + dir * 0.6, ty + 1.2, 9);
            if (!a.did.inc) { a.did.inc = 1; floater(tx, ty, "INCOMPLETE", "#ffb4b4"); } SC.focus = tx; return;
          }
          if (kk === "int") {
            const D0 = db[1], ret = easeOut(clamp01((u - catchU) / (0.94 - catchU))), Nx = abs(a.defP, a.turnoverAt);
            put(D0, lerp(tx, Nx, ret), lerp(ty + 4, cy + 3, ret)); ballTo(D0.x - dir * 0.5, D0.y - 0.2, 0.7, dir > 0 ? Math.PI : 0);
            if (!a.did.int) { a.did.int = 1; floater(tx, ty + 4, "PICKED OFF!", "#ffd23c"); tackle(tx, ty + 4, "#ffd23c", 14); }
            chase(rcv, D0.x + dir * 0.6, D0.y + 0.6, 6); ol.slice(0, 3).forEach((o) => chase(o, D0.x + dir * 3, D0.y + (o.i - 1) * 1.4, 6)); SC.focus = D0.x; if (u > 0.5 && u < 0.92) dust(D0.x + dir * 0.8, D0.y);
            if (u >= 0.94 && !a.did.tackle) { a.did.tackle = 1; tackle(D0.x, D0.y, "#ffd23c", 18); } return;
          }
        }
        SC.focus = u < throwU ? qb.x : qb.x + (SC.ball.x - qb.x) * 0.6; return;
      }
      if (kk === "sack") {
        const hitU = 0.55, q = easeOut(clamp01(u / 0.4)); put(qb, L - dir * (4.8 + 2.4 * q + Math.max(0, u - hitU) * (Math.abs(out.yards) - 2.4) * 2.2), cy);
        ol.forEach((o, i) => chase(o, L - dir * (0.8 + 1.0 * q), cy + (i - 2) * 1.9, 9)); chase(rb, L - dir * 7, cy + 2.4, 6); chase(w1, L + dir * 8, cy - 15, 5); chase(w2, L + dir * 8, cy + 15, 5);
        dl.forEach((d, i) => chase(d, lerp(L + dir * 1.7, qb.x + dir * (0.6 + (i % 2) * 0.5), ease(clamp01(u / hitU))), lerp(cy + (i - 1.5) * 2.4, qb.y + (i - 1.5) * 0.45, ease(clamp01(u / hitU))), 7)); lb.forEach((d, i) => chase(d, lerp(L + dir * 4.8, qb.x + dir * 1.2, ease(clamp01((u - 0.1) / hitU))), cy + (i ? 1.4 : -1.4), 6)); db.forEach((d, i) => chase(d, L + dir * 8, cy + (i ? 13 : -13), 3)); chase(sf, L + dir * 14, cy, 3);
        if (u < 0.1) { const t2 = u / 0.1; ballTo(lerp(L, L - dir * 4.8, t2), cy, Math.sin(t2 * Math.PI) * 0.8); } else ballTo(qb.x + dir * 0.4, qb.y - 0.2, 0.8, dir > 0 ? 0 : Math.PI);
        if (u >= hitU && !a.did.hit) { a.did.hit = 1; tackle(qb.x, qb.y, col, 30); floater(qb.x, qb.y, "SACK!", "#ff8a80"); qb.down = 1; }
        SC.focus = qb.x; return;
      }
      if (kk === "punt") {
        const pu = clamp01((u - 0.3) / 0.45), land = abs(a.offP, out.to), Px = L - dir * 14;
        put(qb, Px, cy); ol.forEach((o, i) => chase(o, L - dir * (0.8 - 6 * ease(clamp01(u / 0.9))), cy + (i - 2) * 1.9 + (i - 2) * 0.5 * ease(u), 4)); chase(rb, Px + dir * 2, cy + 3, 5); chase(w1, L + dir * 4 + dir * 38 * ease(clamp01(u / 0.9)), cy - 13, 3); chase(w2, L + dir * 4 + dir * 38 * ease(clamp01(u / 0.9)), cy + 13, 3);
        dl.forEach((d, i) => chase(d, L + dir * 0.8, cy + (i - 1.5) * 2.4, 4)); lb.forEach((d) => chase(d, L + dir * 3, d.ty, 3)); db.forEach((d, i) => chase(d, land + dir * (i ? -2 : 3), cy + (i ? 6 : -6), 3)); chase(sf, land, cy, 5);
        if (u < 0.12) { const t2 = u / 0.12; ballTo(lerp(L, Px, t2), cy, Math.sin(t2 * Math.PI) * 0.7); } else if (u < 0.3) ballTo(Px + dir * 0.3, cy, 0.9);
        else { const bx2 = lerp(Px, land, pu); ballTo(bx2, lerp(cy, cy - 2, pu), Math.sin(pu * Math.PI) * 14 + 0.6, (dir > 0 ? 0 : Math.PI) + (pu - 0.5) * 1.4); SC.ball.spin += dt * 16; trail(); }
        if (u > 0.78) { put(sf, land, cy); ballTo(land, cy, 0.8); if (!a.did.p) { a.did.p = 1; floater(land, cy, out.yards + " YD PUNT", "#fff"); } }
        SC.focus = u < 0.3 ? Px : SC.ball.x; return;
      }
      if (kk === "fg") {
        const good = out.kind === "fg_good", post = a.offP === "you" ? 120 : 0, kx = L - dir * 7.5, hx = kx + dir * 1.2, ku = clamp01((u - 0.42) / 0.5);
        if (a.miss === undefined) a.miss = (R() < 0.5 ? -1 : 1) * 4.6;
        put(qb, kx - dir * 0.3, cy + 0.3); put(rb, hx, cy - 0.3); ol.forEach((o, i) => chase(o, L - dir * 0.8, cy + (i - 2) * 1.5, 8)); chase(w1, L - dir * 1, cy - 4, 6); chase(w2, L - dir * 1, cy + 4, 6);
        dl.forEach((d, i) => chase(d, L + dir * (1.7 - (u > 0.45 ? 0.6 : 0)), cy + (i - 1.5) * 2.4, 6)); lb.forEach((d) => chase(d, L + dir * 4, d.ty, 4)); db.concat([sf]).forEach((d, i) => chase(d, L + dir * 6, cy + (i - 1) * 3, 3));
        if (u < 0.12) { const t2 = u / 0.12; ballTo(lerp(L, hx, t2), cy, Math.sin(t2 * Math.PI) * 0.7); } else if (u < 0.42) ballTo(hx, cy, 0.4, dir > 0 ? Math.PI / 2 : -Math.PI / 2);
        else { const bx2 = lerp(hx, post, ku), by2 = lerp(cy, cy + (good ? 0.3 : a.miss), ku), pk = clamp(Math.abs(post - hx) * 0.1 + 4, 5, 9); ballTo(bx2, by2, Math.sin(ku * Math.PI) * pk * (1 - ku * 0.3) + (ku > 0.9 ? 3.4 : 0.4) * ku, (dir > 0 ? 0 : Math.PI) + 1.1 * (1 - ku)); SC.ball.spin += dt * 26; trail(); }
        if (u > 0.4 && !a.did.kick) { a.did.kick = 1; tackle(hx + dir * 0.5, cy, "#ffffff", 8); SC.shake = 0.15; }
        if (u >= 0.94 && !a.did.res) { a.did.res = 1; SC.flash = good ? 1 : 0.4; if (good) { confetti(a.offP); floater(post, cy, "IT'S GOOD!", "#7CFF9B"); } else floater(post, cy, "NO GOOD", "#ff8a80"); }
        SC.focus = u < 0.42 ? hx : lerp(hx, post, ku * 0.7); return;
      }
      if (kk === "pen") {
        ol.forEach((o) => chase(o, o.tx, o.ty, 8)); dl.forEach((o) => chase(o, o.tx, o.ty, 8));
        if (u > 0.1 && !a.did.flag) { a.did.flag = 1; SC.flag = { x: L, y: cy - 24, t: 0 }; floater(L, cy - 6, out.kind === "pen_off" ? "FLAG: 10 YARDS" : "FLAG: 5 YARDS", "#ffd23c"); }
        ballTo(L, cy, 0.3); SC.focus = L;
      }
    }

    // ================================================================== the frame loop
    let last = 0;
    function frame(now) {
      raf = requestAnimationFrame(frame); if (!root.isConnected) { cancelAnimationFrame(raf); return; }
      const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016); last = now;
      step(dt); draw();
    }
    function step(dt) {
      if (!G) return; SC.t += dt;
      let sdt = dt;
      if (anim) {
        sdt = dt * SC.ts; anim.t += sdt; const u = clamp01(anim.t / anim.T);
        runScene(anim, u, sdt);
        if (u >= 1 && !anim.fired) {
          anim.fired = true; const a = anim;
          if (a.scored) { SC.ts = 0.4; setTimeout(() => { SC.ts = 1; }, 900); confetti(a.offP); SC.flash = 1; const car = a.kk === "run" ? O_(a)[6] : O_(a)[7]; car.hop = 1; O_(a).forEach((o) => { o.hop = Math.max(o.hop, 0.5 + R() * 0.4); }); setTimeout(() => confetti(a.offP), 450); }
          a.done();
        }
      }
      // helmets: key actors move exactly, everyone else eases toward a target
      [SC.A, SC.B].forEach((arr) => arr.forEach((a) => {
        const ox = a.x, oy = a.y;
        if (!a.direct) { const k = 1 - Math.exp(-sdt * (a.k || 6)); a.x += (a.tx - a.x) * k; a.y += (a.ty - a.y) * k; }
        const v = Math.hypot(a.x - ox, a.y - oy) / Math.max(sdt, 1e-3); a.sp += (Math.min(v, 30) - a.sp) * 0.18; a.ph += dt * (5 + Math.min(a.sp, 14) * 0.9); a.hop = Math.max(0, a.hop - dt * 0.8);
        a.direct = false;
      }));
      // camera, lines, effects
      const dirNow = G.poss === "you" ? 1 : -1, view = W / PX, focus = anim && SC.focus != null ? SC.focus : SC.losT + dirNow * 6, kc = calm() ? 1 : 1 - Math.exp(-dt * (anim ? 4.2 : 2.6));
      SC.cam += (clamp(focus, view / 2 - 3, 120 - view / 2 + 3) - SC.cam) * kc;
      const kl = 1 - Math.exp(-dt * 5); SC.los += (SC.losT - SC.los) * kl; SC.first += (SC.firstT - SC.first) * kl;
      SC.shake = Math.max(0, SC.shake - dt * 2.4); SC.flash = Math.max(0, SC.flash - dt * 1.2); SC.ball.spin += dt * 0.5;
      for (let i = SC.parts.length - 1; i >= 0; i--) { const p = SC.parts[i]; p.age += dt; if (p.age >= p.life) { SC.parts.splice(i, 1); continue; } p.x += p.vx * dt; p.y += p.vy * dt; if (p.k === "conf") { p.vz += 4 * dt * 0.6; p.vx += Math.sin(p.age * 5 + p.rot) * dt * 3; p.rot += p.vr * dt; } else if (p.k === "spark") p.vz -= 14 * dt; p.z = Math.max(0, p.z + p.vz * dt); }
      for (let i = SC.texts.length - 1; i >= 0; i--) { const t = SC.texts[i]; t.age += dt; if (t.age > t.life) SC.texts.splice(i, 1); }
      if (SC.flag) { SC.flag.t += dt; if (SC.flag.t > 1.4) SC.flag = null; }
    }

    // ================================================================== drawing
    function helmet(a) {
      const im = sheet(a.code); if (!im.complete || !im.naturalWidth) return;
      const sz = clamp(H * 0.088, 26, 54), x = SX(a.x), moving = clamp01(a.sp / 7);
      const bob = calm() ? 0 : -Math.abs(Math.sin(a.ph)) * sz * 0.16 * moving - (a.hop > 0 ? Math.abs(Math.sin((1 - a.hop) * 9)) * sz * 0.9 * a.hop : 0);
      const y = SY(a.y) + bob - sz * 0.1, lean = calm() ? 0 : Math.sin(a.ph) * 0.1 * moving + (a.down ? 0.9 : 0), natRight = byCode[a.code].conference === "AFC", flip = natRight !== (a.face > 0);
      const vyN = clamp((a.ty - a.y) * 0.5, -1, 1), fw = im.naturalWidth / 7, fi = clamp(Math.round(3 + vyN * 2 * (flip ? -1 : 1) + Math.sin(SC.t * 1.1 + a.ph) * 0.45 * (1 - moving)), 0, 6);
      ctx.fillStyle = "rgba(0,0,0,.28)"; ctx.beginPath(); ctx.ellipse(x, SY(a.y) + sz * 0.3, sz * 0.4, sz * 0.12, 0, 0, TAU); ctx.fill();
      ctx.save(); ctx.translate(x, y); if (lean) ctx.rotate(lean); if (flip) ctx.scale(-1, 1); ctx.shadowColor = "rgba(0,0,0,.4)"; ctx.shadowBlur = 4; ctx.drawImage(im, fi * fw, 0, fw, im.naturalHeight, -sz / 2, -sz / 2, sz, sz); ctx.restore();
    }
    function ballDraw() {
      const b = SC.ball; if (!b.vis) return; const sz = clamp(H * 0.088, 26, 54), x = SX(b.x), y = SY(b.y, b.z);
      ctx.fillStyle = "rgba(0,0,0," + (0.3 / (1 + b.z * 0.25)).toFixed(3) + ")"; ctx.beginPath(); ctx.ellipse(x, SY(b.y) + sz * 0.1, sz * 0.32 / (1 + b.z * 0.08), sz * 0.1 / (1 + b.z * 0.08), 0, 0, TAU); ctx.fill();
      if (opts.ball) opts.ball(ctx, x, y, sz * 0.95, b.ang, b.spin); else { ctx.save(); ctx.translate(x, y); ctx.rotate(b.ang); ctx.fillStyle = "#8a3f12"; ctx.beginPath(); ctx.ellipse(0, 0, sz * 0.45, sz * 0.27, 0, 0, TAU); ctx.fill(); ctx.restore(); }
    }
    function field() {
      const v0 = SC.cam - W / PX / 2 - 1, v1 = SC.cam + W / PX / 2 + 1;
      const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, "#0e2748"); g.addColorStop(0.5, "#123562"); g.addColorStop(1, "#0c2444"); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      for (let x = Math.floor(v0 / 5) * 5; x < v1; x += 5) { if (Math.floor(x / 5) % 2) { ctx.fillStyle = "rgba(255,255,255,.028)"; ctx.fillRect(SX(x), 0, 5 * PX + 1, H); } }
      [["you", 0], ["opp", 110]].forEach(([p, s]) => { ctx.fillStyle = byCode[side(p)].color; ctx.globalAlpha = 0.55; ctx.fillRect(SX(s), 0, 10 * PX, H); ctx.globalAlpha = 1; ctx.save(); ctx.fillStyle = "rgba(255,255,255,.92)"; ctx.font = "400 " + Math.round(H * 0.17) + "px 'Bebas Neue', Impact, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.translate(SX(s + 5), H / 2); ctx.rotate(p === "you" ? -Math.PI / 2 : Math.PI / 2); ctx.fillText(nm(side(p)).toUpperCase(), 0, 0); ctx.restore(); });
      ctx.font = "600 " + Math.round(H * 0.075) + "px 'Geist Mono', monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      for (let x = Math.max(10, Math.floor(v0)); x <= Math.min(110, v1); x++) {
        if (x % 5 === 0) { ctx.strokeStyle = x % 10 === 0 ? "rgba(255,255,255,.34)" : "rgba(255,255,255,.17)"; ctx.lineWidth = x === 10 || x === 110 ? 3 : 1.3; ctx.beginPath(); ctx.moveTo(SX(x), 0); ctx.lineTo(SX(x), H); ctx.stroke(); }
        else { ctx.strokeStyle = "rgba(255,255,255,.1)"; ctx.lineWidth = 1; for (const yy of [CY - 2.9, CY + 2.9]) { ctx.beginPath(); ctx.moveTo(SX(x), SY(yy) - 3); ctx.lineTo(SX(x), SY(yy) + 3); ctx.stroke(); } }
        if (x % 10 === 0 && x > 10 && x < 110) { const n = x <= 60 ? x - 10 : 110 - x; ctx.fillStyle = "rgba(255,255,255,.2)"; ctx.fillText(String(n), SX(x), H * 0.9); ctx.save(); ctx.translate(SX(x), H * 0.1); ctx.rotate(Math.PI); ctx.fillText(String(n), 0, 0); ctx.restore(); }   // like a real field: the far (top) numbers are upside down
      }
      [0, 120].forEach((x) => { const px = SX(x); ctx.strokeStyle = "#ffd23c"; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(px, SY(CY - 3.1)); ctx.lineTo(px, SY(CY + 3.1)); ctx.stroke(); ctx.lineWidth = 3; [CY - 3.1, CY + 3.1].forEach((yy) => { ctx.beginPath(); ctx.arc(px, SY(yy), 4, 0, TAU); ctx.stroke(); }); });
      const glow = (x, c) => { ctx.save(); ctx.strokeStyle = c; ctx.shadowColor = c; ctx.shadowBlur = 10; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(SX(x), 0); ctx.lineTo(SX(x), H); ctx.stroke(); ctx.restore(); };
      glow(SC.los, "rgba(90,160,255,.95)"); if (SC.first > 0 && SC.first < 120) glow(SC.first, "rgba(255,210,60,.95)");
    }
    function crowd() {
      const top = H * 0.045, bot = H * 0.955;
      SC.crowd.forEach((c) => { const tw = 0.5 + 0.5 * Math.sin(SC.t * (1 + c.d * 2) + c.ph), fl = SC.flash * 0.8, x = (c.x * 1.3 * W - SC.cam * PX * 0.15 + 4 * W) % W, y = c.top ? top * (0.35 + c.d * 0.8) : bot + (H - bot) * (0.1 + c.d * 0.8); ctx.fillStyle = (c.c === 0 ? "rgba(255,255,255," : c.c === 1 ? "rgba(255,210,90," : "rgba(130,190,255,") + clamp(0.08 + tw * 0.2 + fl * (0.6 + tw * 0.4), 0, 1).toFixed(2) + ")"; ctx.beginPath(); ctx.arc(x, y, 1.4 + c.d * 1.6 + fl * 1.2, 0, TAU); ctx.fill(); });
    }
    function draw() {
      if (!ctx || !G) return; ctx.save(); ctx.clearRect(0, 0, W, H);
      if (SC.shake > 0 && !calm()) ctx.translate((R() - 0.5) * SC.shake * 12, (R() - 0.5) * SC.shake * 8);
      field(); crowd();
      const list = SC.A.concat(SC.B).sort((p, q) => p.y - q.y), held = SC.ball.z < 1.2;
      list.forEach((a) => { if (a.y <= SC.ball.y || !held) helmet(a); });
      if (held) ballDraw();
      list.forEach((a) => { if (a.y > SC.ball.y && held) helmet(a); });
      if (!held) ballDraw();
      SC.parts.forEach((p) => { const x = SX(p.x), y = SY(p.y, p.z), u = p.age / p.life; ctx.globalAlpha = clamp01(p.k === "conf" ? Math.min(1, (1 - u) * 2) : 1 - u);
        if (p.k === "conf") { ctx.save(); ctx.translate(x, y); ctx.rotate(p.rot); ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s * 0.2, p.s, p.s * 0.45); ctx.restore(); } else { ctx.fillStyle = p.c; ctx.beginPath(); ctx.arc(x, y, p.s * (p.k === "dust" ? 1 + u * 1.3 : 1 - u * 0.5), 0, TAU); ctx.fill(); } ctx.globalAlpha = 1; });
      if (SC.flag) { const f = SC.flag, u = clamp01(f.t / 0.5), x = SX(f.x), y = lerp(SY(f.y), SY(CY - 5), easeOut(u)) - Math.sin(u * Math.PI) * 40; ctx.save(); ctx.translate(x, y); ctx.rotate(f.t * 8); ctx.font = Math.round(H * 0.1) + "px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("🚩", 0, 0); ctx.restore(); }
      SC.texts.forEach((t) => { const u = t.age / t.life; ctx.globalAlpha = 1 - u * u; ctx.font = "700 " + Math.round(H * 0.07) + "px 'Geist Mono', monospace"; ctx.textAlign = "center"; ctx.lineWidth = 4; ctx.strokeStyle = "rgba(0,0,0,.6)"; const x = SX(t.x), y = SY(t.y, t.z + u * 3); ctx.strokeText(t.text, x, y); ctx.fillStyle = t.col; ctx.fillText(t.text, x, y); ctx.globalAlpha = 1; });
      if (SC.flash > 0 && !calm()) { ctx.fillStyle = "rgba(255,255,255," + (SC.flash * 0.12).toFixed(3) + ")"; ctx.fillRect(0, 0, W, H); }
      const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, H * 1.05); vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,.4)"); ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }

    // ================================================================== the end
    function finish() {
      const tie = G.score.you === G.score.opp, w = G.score.you > G.score.opp ? "you" : "opp", a = G.box.you, b = G.box.opp;
      root.querySelector(".g-calls").innerHTML = "";
      root.querySelector(".g-situation").innerHTML = "<b>Final.</b> " + (tie ? "A tie, " + G.score.you + " to " + G.score.opp + "." : esc(nm(side(w))) + " win " + Math.max(G.score.you, G.score.opp) + " to " + Math.min(G.score.you, G.score.opp) + (mode !== "play" ? "." : w === "you" ? ". Nice calling!" : ". Run it back?"));
      if (!root.querySelector(".g-final")) { confetti(w); SC.flash = 1; }
      const row = (l, x, y) => "<tr><th scope='row'>" + l + "</th><td>" + x + "</td><td>" + y + "</td></tr>";
      const el = document.createElement("div"); el.className = "g-final";
      el.innerHTML = "<table><caption>Box score</caption><thead><tr><th></th><th>" + esc(nm(you)) + "</th><th>" + esc(nm(opp)) + "</th></tr></thead><tbody>" + row("Points", G.score.you, G.score.opp) + row("Touchdowns", a.tds, b.tds) + row("Field goals", a.fgs, b.fgs) + row("Yards gained", a.yds, b.yds) + row("Sacks", a.sacks, b.sacks) + row("Turnovers", a.turnovers, b.turnovers) + "</tbody></table>" +
        "<div class='g-final-actions'><button type='button' class='btn g-again'>Play again</button><button type='button' class='btn ghost g-back2'>Back to the field</button></div>";
      const old = root.querySelector(".g-final"); if (old) old.remove(); root.appendChild(el);
      el.querySelector(".g-again").onclick = () => setup(); el.querySelector(".g-back2").onclick = close;
    }

    setup();
    return { close };
  }
  window.NFLGame = { open };
})();
