/* "Explore" on the dashboard: a choice between picking a team or picking a player.
   - Pick a team: a grid of the 32 logos. Once a team is chosen the team is the focus: a header plus five cards, the team's best single
     season for passing, rushing and receiving yards, sacks and interceptions in the seasons in view.
   - Pick a player: once a player is chosen, a profile card replaces the team cards.
   Each card or profile has a drawn jersey back (last name over the number, in the team's colors; never a photo), the team logo, and the
   key facts. Every number comes from the same calculations the charts use (stats.js topPlayerSeasons and aggregate); the jersey numbers
   come from data/player_numbers.csv. This file only reads the dashboard through the small window.NFLDash handle, and the filters,
   charts and table work exactly as before. Delete its <link> and <script> to remove it. */
(function () {
  "use strict";
  var QS = (document.currentScript && document.currentScript.src.split("?")[1]) || "";   // this file's version tag, reused so the data files it loads are never stale
  var CATS = [
    { id: "pass_yds", tag: "Most passing yards in a season", label: "passing yards" },
    { id: "rush_yds", tag: "Most rushing yards in a season", label: "rushing yards" },
    { id: "rec_yds", tag: "Most receiving yards in a season", label: "receiving yards" },
    { id: "sacks", tag: "Most sacks in a season", label: "sacks" },
    { id: "ints_def", tag: "Most interceptions in a season", label: "interceptions" }
  ];
  var POS_MEASURE = { QB: "pass_yds", RB: "rush_yds", WR: "rec_yds", TE: "rec_yds", DL: "sacks", LB: "sacks", DB: "ints_def" };
  var numbers = null, sec = null, token = 0, uid = 0, lastKey = "", prevSel = "|", userMode = "team", peek = null, pickerOpen = false, pendingFocus = null;
  var esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };

  function loadNumbers() {
    if (numbers) return Promise.resolve();
    return fetch("data/player_numbers.csv" + (QS ? "?" + QS : "")).then(function (r) { return r.ok ? r.text() : ""; }).then(function (t) {
      numbers = new Map();
      // player_id, team, first_season, last_season, jersey_number: the number a player wore with a team over a run of seasons
      t.trim().split("\n").slice(1).forEach(function (line) {
        var f = line.split(",");
        if (f.length < 5 || !f[4].trim()) return;
        if (!numbers.has(f[0])) numbers.set(f[0], []);
        numbers.get(f[0]).push({ team: f[1], first: +f[2], last: +f[3], n: f[4].trim() });
      });
    }).catch(function () { numbers = new Map(); });
  }

  // the number a player wore with a team in a season (never a number from some other year)
  function numberFor(id, team, season) {
    var runs = numbers && numbers.get(id);
    if (!runs) return "";
    for (var i = 0; i < runs.length; i++) if (runs[i].team === team && runs[i].first <= season && season <= runs[i].last) return runs[i].n;
    return "";
  }

  // ---- the drawn jersey back ----
  // "Odell Beckham Jr." -> "Beckham", "Amon-Ra St. Brown" -> "St. Brown", "Kyle Van Noy" -> "Van Noy", "D.J. Moore" -> "Moore"
  function lastName(full) {
    var s = String(full || "").replace(/\s+/g, " ").trim(), tail = /[,\s]+(?:jr|sr|ii|iii|iv|v)\.?$/i;
    if (!s) return "";
    var t = s.replace(tail, "").replace(tail, "").trim() || s, w = t.split(" "), i = w.length - 1;
    if (!i) return t;
    while (i > 1 && /^(?:st\.?|van|vander|vanden|von|der|den|de|del|della|di|du|la|le|al|el|ah|bin|ten|ter)$/i.test(w[i - 1])) i--;
    if (i === w.length - 1 && w[i].length < 3 && /[a-z]{2}/i.test(w[i - 1])) i--;   // "Randle El"
    var out = w.slice(i).join(" ");
    return /[A-Za-zÀ-ɏ]{2}/.test(out) ? out : t;
  }

  // The back of a jersey in the team's real primary colors (data/team_jerseys.csv): body, number and outline, name, sleeve stripes and collar.
  // Decorative: the card text names the player.
  function jersey(spec, number, name) {
    var id = "sp" + (uid++), u = lastName(name).toLocaleUpperCase("en-US"), em = 0, fs, i, nm = "";
    var body = "M45 10 L22 16 L3 47 L20 57 L25 53 L25 122 Q60 127 95 122 L95 53 L100 57 L117 47 L98 16 L75 10 Q60 22 45 10 Z";
    var dark = NFLTeams.luminance(spec.body) < 0.1, edge = dark ? "#fff" : "#000", font = "Bebas Neue, Impact, sans-serif";
    var cols = [spec.s1, spec.s2, spec.s3].filter(Boolean), marks = "";
    if (spec.pattern === "stripes" || spec.pattern === "cuff-stripes") {   // bands across each sleeve end, from the cuff toward the shoulder
      cols.forEach(function (c, k) {
        var y = 41 - k * 7;
        marks += '<path d="M0 ' + y + " L25 " + (y + 14.7) + " M120 " + y + " L95 " + (y + 14.7) + '" stroke="' + c + '" stroke-width="4.2"/>';
      });
    } else if (spec.pattern === "shoulder-stripes") {   // bands running along each shoulder
      cols.forEach(function (c, k) {
        var d = 4 + k * 4.2;
        marks += '<path d="M46 ' + (10 + d) + " L21 " + (16 + d) + " M74 " + (10 + d) + " L99 " + (16 + d) + '" stroke="' + c + '" stroke-width="3.4"/>';
      });
    } else if (cols.length && spec.pattern && spec.pattern !== "none") {   // a single accent flash on each shoulder
      marks += '<path d="M40 8 L18 30 M80 8 L102 30" stroke="' + cols[0] + '" stroke-width="5"/>';
    }
    if (u) {
      for (i = 0; i < u.length; i++) em += /[I.'’,\- ]/.test(u[i]) ? 0.27 : /[MW]/.test(u[i]) ? 0.56 : 0.43;   // rough Bebas Neue widths, in em
      fs = Math.min(17, (64 - 0.5 * (u.length - 1)) / em);
      nm = '<text x="60" y="43" text-anchor="middle" fill="' + spec.name + '" font-family="' + font + '" font-size="' + Math.max(9, fs).toFixed(1) + '"' +
        (fs < 9 ? ' textLength="64" lengthAdjust="spacingAndGlyphs"' : ' letter-spacing="0.5"') + ">" + esc(u) + "</text>";
    }
    var numAttrs = spec.outline ? ' stroke="' + spec.outline + '" stroke-width="2.2" paint-order="stroke" stroke-linejoin="round"' : "";
    var num = '<text x="60" y="108" text-anchor="middle" fill="' + spec.num + '" font-family="' + font + '" font-size="' + (number ? 70 : 56) + '"' +
      (number ? numAttrs : ' opacity="0.35"') + ">" + (number ? esc(number) : "#") + "</text>";
    return '<svg class="sp-figure' + (dark ? " sp-dark" : "") + '" viewBox="0 0 120 130" aria-hidden="true" focusable="false">' +
      '<defs><clipPath id="' + id + '"><path d="' + body + '"/></clipPath></defs>' +
      '<path d="' + body + '" fill="' + spec.body + '" stroke="' + edge + '" stroke-opacity="0.4" stroke-linejoin="round"/>' +
      '<g clip-path="url(#' + id + ')" fill="none">' + marks + '</g>' +
      '<path d="M22 16 Q27 36 25 53 M98 16 Q93 36 95 53" fill="none" stroke="#000" stroke-opacity="0.22"/>' +
      '<path d="M47 13.5 Q60 24 73 13.5" fill="none" stroke="' + (spec.collar || "rgba(0,0,0,0.3)") + '" stroke-width="2.4" stroke-linecap="round"/>' + nm + num + "</svg>";
  }
  var jerseys = null;
  function loadJerseys() {
    if (jerseys) return Promise.resolve();
    return fetch("data/team_jerseys.csv" + (QS ? "?" + QS : "")).then(function (r) { return r.ok ? r.text() : ""; }).then(function (t) {
      jerseys = {};
      var lines = t.trim().split("\n"), head = lines[0].split(",");
      lines.slice(1).forEach(function (line) { var f = line.split(","), o = {}; head.forEach(function (h, i) { o[h] = (f[i] || "").trim(); }); if (o.team) jerseys[o.team] = o; });
    }).catch(function () { jerseys = {}; });
  }
  function look(code) {
    var t = NFLTeams.byCode[code], vivid = NFLTeams.color(code), j = jerseys && jerseys[code];
    var spec;
    if (j && j.jersey_hex) {
      spec = { body: j.jersey_hex, num: j.number_hex || "#ffffff", outline: j.number_outline_hex && j.number_outline_hex !== "none" ? j.number_outline_hex : "", name: j.name_hex || j.number_hex || "#ffffff",
        pattern: j.sleeve_pattern, s1: j.sleeve_hex_1, s2: j.sleeve_hex_2, s3: j.sleeve_hex_3, collar: j.collar_hex };
    } else {
      var trim = t && t.color2 && t.color2.toLowerCase() !== t.color.toLowerCase() ? t.color2 : "#ffffff", ink = NFLTeams.inkOn(vivid);
      spec = { body: vivid, num: ink, outline: "", name: ink, pattern: "stripes", s1: trim, s2: "", s3: "", collar: trim };
    }
    return { t: t, vivid: vivid, spec: spec };
  }
  function logoImg(t, cls) { return '<img class="' + cls + '" src="' + esc(t.logo) + '" alt="" referrerpolicy="no-referrer" onerror="this.remove()">'; }

  // ---- text helpers ----
  function seasonTypeText(f) {
    var st = f.cats && f.cats.season_type;
    return st && st.length === 1 ? (st[0] === "REG" ? "regular season" : "playoffs") : "regular season and playoffs";
  }
  function yearsText(f) { return f.seasonMin === f.seasonMax ? String(f.seasonMin) : f.seasonMin + " to " + f.seasonMax; }
  function span(a, b) { return a === b ? String(a) : a + " to " + b; }

  // ---- the section ----
  function ensure() {
    if (sec) return sec;
    var anchor = document.getElementById("field-panel") || document.querySelector(".filters");
    if (!anchor) return null;
    sec = document.createElement("section");
    sec.className = "card explore"; sec.id = "explore"; sec.hidden = true; sec.setAttribute("aria-label", "Explore teams and players");
    anchor.parentNode.insertBefore(sec, anchor);
    sec.addEventListener("click", onClick);
    sec.addEventListener("pointermove", function (e) {
      var card = e.target.closest(".sp-card");
      if (!card) return;
      var r = card.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      card.style.setProperty("--mx", (x * 100).toFixed(0) + "%"); card.style.setProperty("--my", (y * 100).toFixed(0) + "%");
      card.style.setProperty("--rx", ((0.5 - y) * 9).toFixed(1) + "deg"); card.style.setProperty("--ry", ((x - 0.5) * 11).toFixed(1) + "deg");
    });
    return sec;
  }

  function onClick(e) {
    var D = window.NFLDash, b;
    if (!D) return;
    if ((b = e.target.closest("[data-mode]"))) { peek = b.dataset.mode; userMode = peek; pendingFocus = ".ex-seg [aria-pressed=true]"; draw(true); return; }
    if ((b = e.target.closest(".ex-logo"))) { pendingFocus = "#ex-focus"; pickerOpen = false; peek = null; D.setTeam(b.dataset.team); draw(true); return; }
    if (e.target.closest(".ex-change")) { pickerOpen = !pickerOpen; pendingFocus = pickerOpen ? ".ex-logo[aria-pressed=true], .ex-logo" : ".ex-change"; draw(true); return; }
    if (e.target.closest(".ex-clear-team")) { pendingFocus = ".ex-logo"; peek = null; D.setTeam(""); draw(true); return; }
    if (e.target.closest(".ex-clear-player")) { pendingFocus = ".ex-search"; peek = "player"; userMode = "player"; D.clearPlayer(); draw(true); return; }
    if ((b = e.target.closest(".sp-card, .sp-card-link"))) { pendingFocus = "#ex-focus"; peek = null; D.pickPlayer(b.dataset.id); return; }
    if (e.target.closest(".ex-search")) {
      var input = document.getElementById("player-search");
      if (input) { input.scrollIntoView({ block: "center", behavior: "smooth" }); input.focus({ preventScroll: true }); }
    }
  }

  function logoGrid(st) {
    var conf = { AFC: 0, NFC: 1 }, div = { East: 0, North: 1, South: 2, West: 3 };
    var list = NFLTeams.list.slice().sort(function (a, b) {
      return (conf[a.conference] * 4 + div[a.division]) - (conf[b.conference] * 4 + div[b.division]) || a.full_name.localeCompare(b.full_name);
    });
    function half(c) {
      return '<div class="ex-conf"><h3>' + c + '</h3><div class="ex-logos">' + list.filter(function (t) { return t.conference === c; }).map(function (t) {
        return '<button type="button" class="ex-logo" data-team="' + esc(t.team) + '" aria-pressed="' + (st.team === t.team) + '" aria-label="' + esc(t.full_name) + '" title="' + esc(t.full_name) + '" style="--c:' + esc(t.color) + '">' +
          '<img src="' + esc(t.logo) + '" alt="" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement(\'i\'),{textContent:\'' + esc(t.team) + '\'}))"></button>';
      }).join("") + "</div></div>";
    }
    return '<div class="ex-confs">' + half("AFC") + half("NFC") + "</div>";
  }

  function card(D, p, team) {
    var r = p.row, n = numberFor(r.playerId, team, r.season), lk = look(team), value = D.S.format(p.m.fmt, r.value);
    var meta = esc(r.position) + (n ? " · #" + esc(n) : "");
    return '<button type="button" class="sp-card" data-id="' + esc(r.playerId) + '" style="--c:' + lk.vivid + '" aria-label="' + esc(r.name + ", " + r.position + (n ? ", number " + n : "") + ", " + NFLTeams.name(team) + ": " + value + " " + p.c.label + " in " + r.season + ", " + r.games + (r.games === 1 ? " game" : " games") + ". Opens this player.") + '">' +
      '<span class="sp-tag">' + esc(p.c.tag) + "</span>" +
      '<span class="sp-avatar">' + jersey(lk.spec, n, r.name) + logoImg(lk.t, "sp-logo") + "</span>" +
      '<span class="sp-name">' + esc(r.name) + "</span>" +
      '<span class="sp-meta">' + meta + "</span>" +
      '<span class="sp-stat"><b>' + esc(value) + "</b> " + p.c.label + "</span>" +
      '<span class="sp-sub">' + r.season + " season · " + r.games + (r.games === 1 ? " game" : " games") + "</span></button>";
  }

  function teamBody(D, st, f) {
    var t = NFLTeams.byCode[st.team], lk = look(st.team);
    var cats = Object.assign({}, f.cats);
    delete cats.player_id; delete cats.opponent_team; cats.team = [st.team]; cats.position_group = null; cats.unit = null;
    var f2 = { seasonMin: f.seasonMin, seasonMax: f.seasonMax, weekMin: f.weekMin, weekMax: f.weekMax, cats: cats };
    var picks = [];
    CATS.forEach(function (c) {
      var m = D.S.MEASURE_BY_ID[c.id];
      if (!m) return;
      var top = D.S.topPlayerSeasons(D.store, f2, m, 1);
      if (top.length && top[0].value > 0) picks.push({ c: c, m: m, row: top[0] });
    });
    var head = '<div class="ex-team-head" style="--c:' + lk.vivid + '">' + logoImg(t, "ex-team-logo") +
      '<div class="ex-team-text"><h3 id="ex-focus" tabindex="-1">' + esc(t.full_name) + "</h3><p>" + esc(t.conference + " " + t.division) + " · " + esc(yearsText(f)) + ", " + esc(seasonTypeText(f)) + "</p></div>" +
      '<div class="ex-actions"><button type="button" class="ex-btn ex-change" aria-expanded="' + pickerOpen + '">Change team</button><button type="button" class="ex-btn ex-clear-team">All teams</button></div></div>';
    var body = picks.length
      ? '<div class="sp-grid">' + picks.map(function (p) { return card(D, p, st.team); }).join("") + "</div>" +
        '<p class="ex-note">Each card is one player’s best total in a single season with this team, in the seasons, weeks and season type in view. It is not a career total. Position, unit and opponent filters are ignored. Each jersey number is the one listed for that season. Click a card to open that player.</p>'
      : '<p class="ex-empty">No games for the ' + esc(t.full_name) + " with these filters. Try widening the season range or the season type.</p>";
    return head + (pickerOpen ? logoGrid(st) : "") + body;
  }

  function pickTeamBody(st) {
    return '<p class="ex-lead">Pick a team to see its best players.</p>' + logoGrid(st);
  }

  function pickPlayerBody() {
    return '<div class="ex-prompt"><p class="ex-lead">Find any player in the data and the whole dashboard focuses on that player.</p>' +
      '<button type="button" class="ex-btn ex-search">Search by name</button>' +
      '<p class="ex-note">Picking a team instead shows its best players. The filters below work the same either way.</p></div>';
  }

  var GROUP_NOTE = { DL: "Ends and tackles are counted together.", LB: "All linebackers are counted together.", DB: "Safeties and cornerbacks are counted together.", RB: "Fullbacks are counted with running backs." };
  // How the player's best season compares with every season at the same position group, in the same seasons, weeks and season type.
  function compareBlock(D, p, f, m, best, label) {
    var cf = { seasonMin: f.seasonMin, seasonMax: f.seasonMax, weekMin: f.weekMin, weekMax: f.weekMax, cats: { season_type: f.cats.season_type || null, position_group: [p.position_group] } };
    var cohort = D.S.topPlayerSeasons(D.store, cf, m, 100000).filter(function (r) { return r.value > 0; });
    var n = cohort.length, v = best.row.value;
    if (n < 10 || !(v > 0)) return "";
    var higher = 0, equal = 0;
    cohort.forEach(function (r) { if (r.value > v) higher++; else if (r.value === v) equal++; });
    var rank = higher + 1, lead = cohort[0], tenth = cohort[9].value, g = p.position_group + " seasons";
    var fmt = function (x) { return D.S.format(m.fmt, x); };
    var rankText = (equal > 1 ? "Tied #" : "#") + rank + " of " + n.toLocaleString("en-US") + " " + g;
    var isLeader = lead.playerId === p.id && lead.season === best.row.season;
    var chip = isLeader ? '<span class="ex-lead-self">Best season in view</span>'
      : '<button type="button" class="ex-lead-chip sp-card-link" data-id="' + esc(lead.playerId) + '" aria-label="Open ' + esc(lead.name) + ", " + esc(fmt(lead.value)) + " " + esc(label) + " in " + lead.season + '">Best: ' + esc(lead.name) + ", " + esc(fmt(lead.value)) + " (" + lead.season + ")</button>";
    var spoken = "How this player compares. " + label + ". Best season in view: " + fmt(v) + " in " + best.row.season + ", ranked " + (equal > 1 ? "tied for " : "") + "number " + rank + " of " + n.toLocaleString("en-US") + " " + g + ". Top-10 cutoff: " + fmt(tenth) + ". " + (isLeader ? "This is the best season in view." : "Best: " + lead.name + ", " + fmt(lead.value) + " in " + lead.season + ".");
    var pct = function (x) { return Math.max(0, Math.min(100, (x / lead.value) * 100)).toFixed(1); };
    return '<div class="ex-compare" role="group" aria-label="' + esc(spoken) + '">' +
      '<h4>How this player compares</h4><p class="ex-compare-sub">Best season in view for ' + esc(label) + ", against every " + esc(p.position_group) + " season in the same seasons, weeks and season type.</p>" +
      '<div class="ex-bar" aria-hidden="true"><div class="ex-bar-fill" style="width:' + pct(v) + '%"></div><div class="ex-bar-mark" style="left:' + pct(tenth) + '%" title="10th best: ' + esc(fmt(tenth)) + '"></div></div>' +
      '<div class="ex-compare-row"><span class="ex-compare-main"><b>' + esc(fmt(v)) + "</b> " + esc(label) + " in " + best.row.season + " \u00B7 " + esc(rankText) + '</span><span class="ex-compare-tick">| 10th best: ' + esc(fmt(tenth)) + "</span></div>" +
      '<div class="ex-compare-lead">' + chip + "</div>" +
      '<p class="ex-note">Rank counts every ' + esc(p.position_group) + " season with at least one " + esc(label.replace(/s$/, "")) + ". " + (GROUP_NOTE[p.position_group] ? esc(GROUP_NOTE[p.position_group]) + " " : "") + "A season is one player\u2019s total across all teams, and equal totals share a rank.</p></div>";
  }

  function profileBody(D, st, f) {
    var p = st.player, M = D.S.MEASURE_BY_ID;
    var pc = Object.assign({}, f.cats); delete pc.team; delete pc.opponent_team;
    f = { seasonMin: f.seasonMin, seasonMax: f.seasonMax, weekMin: f.weekMin, weekMax: f.weekMax, cats: pc };
    var gamesAgg = D.S.aggregate(D.store, f, "all", [M.games]).get(0), games = gamesAgg ? gamesAgg.rows : 0;
    var seasons = D.S.aggregate(D.store, f, "season", [M.games]).size;
    var best = null, position = p.position_group, mid = POS_MEASURE[p.position_group];
    if (mid && M[mid]) {
      var top = D.S.topPlayerSeasons(D.store, f, M[mid], 1, 1);
      if (top.length) { position = top[0].position || position; if (top[0].value > 0) best = { row: top[0], m: M[mid], label: CATS.filter(function (c) { return c.id === mid; })[0].label }; }
    }
    // the jersey shows the team and number from the season the profile is about: the best season shown, else the last season in view
    var seasonKeys = Array.from(D.S.aggregate(D.store, f, "season", [M.games]).keys());
    var shownSeason = best ? best.row.season : (seasonKeys.length ? Math.max.apply(null, seasonKeys) : p.last), shownTeam = p.team;
    if (best && best.row.parts && best.row.parts.length) shownTeam = best.row.parts.slice().sort(function (a, b) { return b.share - a.share; })[0].team;
    else { var wore = (p.teams || []).filter(function (x) { return x.first <= shownSeason && shownSeason <= x.last; }); if (wore.length) shownTeam = wore[wore.length - 1].team; }
    var lk = look(shownTeam), n = numberFor(p.id, shownTeam, shownSeason);
    var compare = best ? compareBlock(D, p, f, M[mid], best, CATS.filter(function (c) { return c.id === mid; })[0].label) : "";
    var teams = (p.teams || []).map(function (x) {
      var t = NFLTeams.byCode[x.team];
      return '<li>' + (t ? logoImg(t, "ex-mini") : "") + "<span>" + esc(x.team) + " <em>" + esc(span(x.first, x.last)) + "</em></span></li>";
    }).join("");
    return '<div class="ex-profile" style="--c:' + lk.vivid + '">' +
      '<div class="ex-profile-avatar sp-avatar">' + jersey(lk.spec, n, p.name) + (lk.t ? logoImg(lk.t, "sp-logo") : "") + "</div>" +
      '<div class="ex-profile-text"><h3 id="ex-focus" tabindex="-1">' + esc(p.name) + "</h3>" +
      '<p class="ex-sub">' + esc(position) + (n ? " · #" + esc(n) : "") + (lk.t ? " · " + shownSeason + " with " + esc(lk.t.full_name) : "") + "</p>" +
      '<dl class="ex-facts"><div><dt>Seasons in view</dt><dd>' + seasons + "</dd></div><div><dt>Games in view</dt><dd>" + games + "</dd></div>" +
      (best ? "<div><dt>Best season in view</dt><dd>" + esc(D.S.format(best.m.fmt, best.row.value)) + " " + esc(best.label) + ", " + best.row.season + "</dd></div>" : "") + "</dl>" +
      compare +
      (teams ? '<p class="ex-teams-label">Teams in this data</p><ul class="ex-teams">' + teams + "</ul>" : "") +
      '<p class="ex-note">Numbers are for the seasons, weeks and season type in view, not career totals. The jersey shows the team and number from ' + shownSeason + (best ? ', the best season shown above.' : ', the last season in view.') + '</p>' +
      '<button type="button" class="ex-btn ex-clear-player">Back to all players</button></div></div>';
  }

  // ---- draw ----
  function draw(force) {
    var D = window.NFLDash, el = ensure();
    if (!D || !el || !window.NFLTeams || !NFLTeams.list || !NFLTeams.list.length) return;
    var st = D.state();
    if (st.view !== "players" || st.h2h) { el.hidden = true; lastKey = ""; return; }
    var sel = (st.team || "") + "|" + (st.player ? st.player.id : "");
    if (sel !== prevSel) { var hadPeek = peek; peek = null; pickerOpen = false; if (sel !== "|") userMode = st.player ? "player" : "team"; else if (!hadPeek) userMode = "team"; prevSel = sel; }
    var mode = peek || (st.player ? "player" : st.team ? "team" : userMode);
    var f = D.filters();
    var key = JSON.stringify([document.documentElement.dataset.theme || "", mode, st.team, st.player && st.player.id, pickerOpen, f.seasonMin, f.seasonMax, f.weekMin, f.weekMax, f.cats && f.cats.season_type]);
    if (!force && key === lastKey && !el.hidden) return;
    lastKey = key;
    var mine = ++token;
    Promise.all([loadNumbers(), loadJerseys()]).then(function () {
      if (mine !== token) return;
      var inner;
      if (mode === "player" && st.player) inner = profileBody(D, st, f);
      else if (mode === "player") inner = pickPlayerBody();
      else if (st.team) inner = teamBody(D, st, f);
      else inner = pickTeamBody(st);
      el.innerHTML =
        '<div class="ex-top"><div><h2>Explore the league</h2><p>Pick a team or a player to start.</p></div>' +
        '<div class="seg ex-seg" role="group" aria-label="Explore by"><button type="button" data-mode="team" aria-pressed="' + (mode === "team") + '">Pick a team</button>' +
        '<button type="button" data-mode="player" aria-pressed="' + (mode === "player") + '">Pick a player</button></div></div>' +
        '<div class="ex-body">' + inner + "</div>";
      el.hidden = false;
      if (pendingFocus) { var target = el.querySelector(pendingFocus); pendingFocus = null; if (target) target.focus({ preventScroll: true }); }
    });
  }

  document.addEventListener("nfl:update", function () { try { draw(false); } catch (e) { if (sec) sec.hidden = true; } });
  if (window.NFLDash) { try { draw(false); } catch (e) {} }   // the first update may have run before this script did
})();
