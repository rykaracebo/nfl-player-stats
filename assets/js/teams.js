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

  // A color for charts on the navy background: the team's primary color, or its second color, or a lightened primary when
  // the primary is too dark to see.
  function color(code) {
    const t = T.byCode[code];
    if (!t) return "#8899bb";
    if (luminance(t.color) >= 0.045) return t.color;
    if (luminance(t.color2) >= 0.06) return t.color2;
    return mix(t.color, "#ffffff", 0.45);
  }

  function badge(code) {
    const t = T.byCode[code];
    if (!t) return String(code);
    const fallback = "this.replaceWith(Object.assign(document.createElement('i'),{textContent:'" + code + "'}))";
    return "<span class='badge' style='--c:" + t.color + "'><img src='" + t.logo + "' alt='' loading='lazy' referrerpolicy='no-referrer' onerror=\"" + fallback + "\"><span>" + code + "</span></span>";
  }

  T.load = load; T.color = color; T.badge = badge; T.luminance = luminance;
  T.name = (code) => (T.byCode[code] ? T.byCode[code].full_name : code);
  window.NFLTeams = T;
})();
