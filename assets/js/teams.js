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

  // hex <-> HSL, so a color can be made lighter or darker without going gray
  function toHsl(hex) {
    const [r, g, b] = rgb(hex), mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
    if (!d) return [0, 0, l];
    const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    const h = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h * 60, s, l];
  }
  function fromHsl(h, s, l) {
    const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return "#" + [f(0), f(8), f(4)].map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("");
  }
  const isLight = () => document.documentElement.dataset.theme === "light";
  // the card color charts are drawn on, in the current theme
  function surface() {
    const v = getComputedStyle(document.documentElement).getPropertyValue("--surface").trim();
    return /^#[0-9a-f]{6}$/i.test(v) ? v : isLight() ? "#ffffff" : "#0b1730";
  }
  // The team's primary color, made a little more vivid. Only a color that would nearly disappear into the chart background (below
  // 1.6:1) is nudged lighter or darker, keeping its hue and color, and every bar has a thin outline so it still reads. This is
  // deliberately looser than the 3:1 guideline for graphics: bars are labeled on the axis and named in the hover text.
  const MIN_CONTRAST = 1.6;
  const colorCache = {};
  function color(code) {
    const t = T.byCode[code];
    if (!t) return isLight() ? "#5a6b90" : "#8899bb";
    const surf = surface(), key = code + surf;
    if (colorCache[key]) return colorCache[key];
    let [h, sat, l] = toHsl(t.color);
    if (sat > 0.05) sat = Math.min(1, sat + (1 - sat) * 0.4); // more vivid; grays stay gray
    // on the dark card the very dark team colors (navy, black) are brightened so they pop; on the white card the palest are deepened a bit
    if (!isLight()) l = Math.max(l, sat > 0.05 ? 0.42 : 0.5); else l = Math.min(l, 0.62);
    let out = fromHsl(h, sat, l);
    const step = isLight() ? -0.03 : 0.03;
    for (let i = 0; i < 25 && contrast(out, surf) < MIN_CONTRAST; i++) { l = Math.max(0.08, Math.min(0.92, l + step)); out = fromHsl(h, sat, l); }
    return (colorCache[key] = out);
  }
  function contrast(a, b) {
    const la = luminance(a), lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
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
