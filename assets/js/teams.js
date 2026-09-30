/* Team data for the site: names, divisions, colors and logo links, loaded from data/teams.csv (which comes from nflverse).
   Logos are loaded by the visitor's browser from the links in that file; if one fails, a color badge is shown instead. */
(function () {
  "use strict";
  const T = { list: [], byCode: {} };

  function parseCsv(text) {
    const lines = text.trim().split("\n");
    const head = lines[0].split(",");
    return lines.slice(1).map((line) => {
      const f = line.split(",");
      const o = {};
      head.forEach((h, i) => (o[h] = f[i]));
      return o;
    });
  }

  async function load(base) {
    const r = await fetch((base || "") + "data/teams.csv");
    if (!r.ok) throw new Error("teams.csv " + r.status);
    T.list = parseCsv(await r.text());
    T.byCode = {};
    T.list.forEach((t) => (T.byCode[t.team] = t));
    return T.list;
  }

  function rgb(hex) {
    const h = (hex || "#888888").replace("#", "");
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  }
  function luminance(hex) {
    const [r, g, b] = rgb(hex).map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  function mix(hex, other, amount) {
    const a = rgb(hex), b = rgb(other);
    return "#" + a.map((v, i) => Math.round((v * (1 - amount) + b[i] * amount) * 255).toString(16).padStart(2, "0")).join("");
  }

  function contrast(a, b) {
    const la = luminance(a), lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }
  const isLight = () => document.documentElement.dataset.theme === "light";
  // the card color charts are drawn on, in the current theme
  function surface() {
    const v = getComputedStyle(document.documentElement).getPropertyValue("--surface").trim();
    return /^#[0-9a-f]{6}$/i.test(v) ? v : isLight() ? "#ffffff" : "#0b1730";
  }
  // A color for charts that stands out from the chart surface by at least 3:1 in the current theme: the team's primary color, or its
  // second color, or the primary pushed toward white (dark theme) or black (light theme) until it does. Many teams still look alike,
  // so charts also print the team code inside blocks and bars and in the hover text.
  const MIN_CONTRAST = 3;
  const colorCache = {};
  function color(code) {
    const t = T.byCode[code];
    if (!t) return isLight() ? "#5a6b90" : "#8899bb";
    const surf = surface(), key = code + surf;
    if (colorCache[key]) return colorCache[key];
    let out = null;
    for (const c of [t.color, t.color2]) if (c && contrast(c, surf) >= MIN_CONTRAST) { out = c; break; }
    if (!out) {
      const toward = isLight() ? "#000000" : "#ffffff";
      for (let a = 0.05; a <= 0.95 && !out; a += 0.05) { const c = mix(t.color, toward, a); if (contrast(c, surf) >= MIN_CONTRAST) out = c; }
      out = out || mix(t.color, toward, 0.95);
    }
    return (colorCache[key] = out);
  }
  // black or white text, whichever reads better on a fill
  const inkOn = (hex) => (contrast(hex, "#ffffff") >= contrast(hex, "#000000") ? "#ffffff" : "#000000");

  function badge(code) {
    const t = T.byCode[code];
    if (!t) return String(code);
    const fallback = "this.replaceWith(Object.assign(document.createElement('i'),{textContent:'" + code + "'}))";
    return "<span class='badge' style='--c:" + t.color + ";--ink:" + inkOn(t.color) + "'><img src='" + t.logo + "' alt='' loading='lazy' referrerpolicy='no-referrer' onerror=\"" + fallback + "\"><span>" + code + "</span></span>";
  }

  T.load = load; T.color = color; T.badge = badge; T.luminance = luminance; T.contrast = contrast; T.inkOn = inkOn;
  T.leagueLogo = () => (T.list[0] && T.list[0].league_logo) || null;
  T.name = (code) => (T.byCode[code] ? T.byCode[code].full_name : code);
  window.NFLTeams = T;
})();
