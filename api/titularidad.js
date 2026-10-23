// GET /api/titularidad
// Devuelve la probabilidad de titularidad de cada jugador para su próxima jornada, leída de
// futbolfantasy.com y emparejada con los ids de LaLiga Fantasy:
//   { updatedAt, count, unmatched, players: { "<idLaLiga>": { p, w, rival, home, ff } } }
// futbolfantasy.com no ofrece API: se lee el HTML de su página de mercado (una sola petición).
// La respuesta se cachea 15 min en el CDN de Vercel para no cargar su servidor.

const FF_MARKET_URL = "https://www.futbolfantasy.com/analytics/laliga-fantasy/mercado";
const API_BASE = "https://fantasy-api.llt-services.com/api";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

// ---------- Normalización (port de matching.go) ----------
const FOLD = { "ø": "o", "ł": "l", "đ": "d", "ı": "i", "ß": "ss" };
function norm(text) {
  return String(text || "").toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[øłđıß]/g, function (c) { return FOLD[c]; })
    .replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}
const TEAM_ALIASES = {
  "alaves": "deportivo alaves", "athletic": "athletic club", "atletico": "atletico de madrid",
  "barcelona": "fc barcelona", "betis": "real betis", "celta": "celta", "deportivo": "rc deportivo",
  "elche": "elche cf", "espanyol": "rcd espanyol", "getafe": "getafe cf", "girona": "girona fc",
  "levante": "levante ud", "malaga": "malaga cf", "mallorca": "rcd mallorca", "osasuna": "ca osasuna",
  "oviedo": "real oviedo", "racing": "r racing club", "rayo": "rayo vallecano", "real madrid": "real madrid",
  "real sociedad": "real sociedad", "sevilla": "sevilla fc", "valencia": "valencia cf", "villarreal": "villarreal cf"
};
function normTeam(name) {
  let base = norm(name);
  if (TEAM_ALIASES[base]) base = TEAM_ALIASES[base];
  base = base.replace(/\b(fc|cf|ud|cd|rc|rcd|ca|sd|club|de|del|real)\b/g, " ");
  return base.split(/\s+/).filter(function (t) { return t.length > 1; }).join(" ");
}
const FF_POSITIONS = { portero: 1, defensa: 2, centrocampista: 3, mediocampista: 3, medio: 3, delantero: 4, entrenador: 5 };

// ---------- Lectura de la página de mercado (port de ParseMarket) ----------
const ATTRS = ["id", "nombre", "posicion", "equipo"];
function unescapeHtml(s) {
  return String(s || "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#0*39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(Number(n)); })
    .replace(/&#x([0-9a-f]+);/gi, function (_, n) { return String.fromCharCode(parseInt(n, 16)); });
}
function parseTeamMap(page) {
  const out = {};
  const block = /<select[^>]*name="equipo"[^>]*>([\s\S]*?)<\/select>/.exec(page);
  if (!block) return out;
  const re = /<option[^>]*value="(\d+)"[^>]*>([^<]+)<\/option>/g;
  let m;
  while ((m = re.exec(block[1]))) if (m[1] !== "0") out[m[1]] = unescapeHtml(m[2]).trim();
  return out;
}
function parseMarket(page) {
  const teams = parseTeamMap(page);
  const rows = [];
  const chunks = page.split('class="elemento_jugador').slice(1);
  chunks.forEach(function (chunk) {
    const a = {};
    ATTRS.forEach(function (k) {
      const f = new RegExp('data-' + k + '="([^"]*)"').exec(chunk);
      if (f) a[k] = f[1];
    });
    if (!a.id || !a.nombre) return;
    const display = /class="player-name"><span[^>]*>([^<]+)</.exec(chunk);
    const fixture = /title="Jornada (\d+)[^"]*?Pr[^"]*?rival: ([^("]+)\(([^)]+)\)"/.exec(chunk);
    const prob = /class="prob-\d+"[^>]*>(\d+)%</.exec(chunk);
    rows.push({
      id: a.id,
      name: unescapeHtml(a.nombre),
      display: display ? unescapeHtml(display[1]).trim() : "",
      position: a.posicion || "",
      teamId: a.equipo || "",
      team: teams[a.equipo] || "",
      week: fixture ? Number(fixture[1]) : null,
      rival: fixture ? unescapeHtml(fixture[2]).trim() : null,
      home: fixture ? /^cas/i.test(fixture[3].trim()) : null,
      prob: prob ? Number(prob[1]) : null
    });
  });
  return rows;
}

// ---------- Emparejamiento por pasadas, de estricto a laxo (port de matching.go) ----------
const TOKEN_ALIASES = { jr: "junior", fdez: "fernandez", fdz: "fernandez", glez: "gonzalez", gzlez: "gonzalez", hdez: "hernandez", mtnez: "martinez", dguez: "dominguez", rgez: "rodriguez", rodz: "rodriguez" };
function isAbbrev(s, l) {
  if (TOKEN_ALIASES[s] === l) return true;
  if (s.length < 3 || s.length >= l.length || s[0] !== l[0]) return false;
  let pos = 0;
  for (const ch of s) {
    const i = l.indexOf(ch, pos);
    if (i < 0) return false;
    pos = i + 1;
  }
  return true;
}
const tokenMatch = function (s, l) { return s === l || l.startsWith(s) || isAbbrev(s, l); };
function prefixSubset(mine, theirs) {
  if (!mine.length || mine.length > theirs.length) return false;
  const used = new Set();
  for (const t of mine) {
    let f = -1;
    for (let i = 0; i < theirs.length; i++) if (!used.has(i) && tokenMatch(t, theirs[i])) { f = i; break; }
    if (f < 0) return false;
    used.add(f);
  }
  return true;
}
function nicknameVariant(mine, theirs) {
  if (mine.length < 2 || theirs.length < 2 || mine[mine.length - 1] !== theirs[theirs.length - 1]) return false;
  let shared = 0;
  const a = mine[0], b = theirs[0];
  while (shared < a.length && shared < b.length && a[shared] === b[shared]) shared++;
  return shared >= 3;
}
function sameSet(a, b) {
  const x = new Set(a), y = new Set(b);
  if (x.size !== y.size) return false;
  for (const t of x) if (!y.has(t)) return false;
  return true;
}
// Equivalente a difflib.SequenceMatcher.ratio(): el umbral 0.82 está ajustado con esa medida.
function longestMatch(a, b) {
  let bestA = 0, bestB = 0, best = 0, prev = new Map();
  for (let i = 0; i < a.length; i++) {
    const cur = new Map();
    for (let j = 0; j < b.length; j++) {
      if (a[i] !== b[j]) continue;
      const size = (prev.get(j - 1) || 0) + 1;
      cur.set(j, size);
      if (size > best) { bestA = i - size + 1; bestB = j - size + 1; best = size; }
    }
    prev = cur;
  }
  return [bestA, bestB, best];
}
function matchingChars(a, b) {
  if (!a || !b) return 0;
  const m = longestMatch(a, b);
  if (!m[2]) return 0;
  return m[2] + matchingChars(a.slice(0, m[0]), b.slice(0, m[1])) + matchingChars(a.slice(m[0] + m[2]), b.slice(m[1] + m[2]));
}
const fuzzy = function (a, b) { const t = a.length + b.length; return t ? 2 * matchingChars(a, b) / t >= 0.82 : true; };

const PASSES = [
  function (p, r) { return p.variants.some(function (v) { return v === r.norm || (r.display && v === r.display); }); },
  function (p, r) { return p.tokenSets.some(function (t) { return sameSet(t, r.tokens); }); },
  function (p, r) { return p.tokenSets.some(function (t) { return prefixSubset(t, r.tokens); }); },
  function (p, r) { return p.tokenSets.some(function (t) { return nicknameVariant(t, r.tokens); }); },
  function (p, r) { return p.variants.some(function (v) { return fuzzy(v, r.norm); }); }
];

function matchMarket(players, rows, teams) {
  // Los ids de equipo difieren entre fuentes: se cruzan por nombre normalizado.
  const teamIndex = new Map();
  teams.forEach(function (t) {
    ["name", "slug", "shortName"].forEach(function (k) {
      const n = normTeam(t[k]);
      if (n && !teamIndex.has(n)) teamIndex.set(n, String(t.id));
    });
  });
  const ffTeamToLaLiga = {};
  rows.forEach(function (r) {
    const t = teamIndex.get(normTeam(r.team));
    if (t) ffTeamToLaLiga[r.teamId] = t;
  });

  const prepared = players.map(function (p) {
    const raw = [p.nickname, p.name, p.slug].filter(Boolean).map(norm);
    const variants = raw.slice();
    raw.forEach(function (v) {   // "R.P. Bigas" también se prueba como "bigas"
      const trimmed = v.split(" ").filter(function (t) { return t.length > 1; }).join(" ");
      if (trimmed && trimmed !== v) variants.push(trimmed);
    });
    const vs = variants.filter(Boolean);
    return {
      id: String(p.id), team: String(p.teamId ?? p.team?.id ?? ""), position: Number(p.positionId) || 0,
      variants: vs, tokenSets: vs.map(function (v) { return v.split(" "); })
    };
  });
  const prepRows = rows.map(function (r) {
    const n = norm(r.name);
    return { row: r, norm: n, display: norm(r.display), tokens: n.split(" ").filter(Boolean),
      team: ffTeamToLaLiga[r.teamId] || "", position: FF_POSITIONS[norm(r.position)] || 0, live: true };
  });

  const open = new Map(prepared.map(function (p) { return [p.id, p]; }));
  const byTeam = new Map();
  prepared.forEach(function (p) { if (!byTeam.has(p.team)) byTeam.set(p.team, []); byTeam.get(p.team).push(p); });
  const matched = {};

  // La segunda ronda ignora el equipo, para resolver fichajes que futbolfantasy aún tiene en el club anterior.
  [true, false].forEach(function (sameTeam) {
    PASSES.forEach(function (predicate) {
      for (let progress = true; progress;) {
        progress = false;
        const pairs = [];
        prepRows.forEach(function (r) {
          if (!r.live) return;
          const pool = sameTeam && r.team ? (byTeam.get(r.team) || []) : prepared;
          let hits = pool.filter(function (p) { return open.has(p.id) && predicate(p, r); });
          if (hits.length > 1 && r.position) {
            const narrowed = hits.filter(function (p) { return p.position === r.position; });
            if (narrowed.length) hits = narrowed;
          }
          if (hits.length === 1) pairs.push([r, hits[0]]);
        });
        // Solo se confirma lo que es inequívoco en ambos sentidos: "raul" no debe robar el puesto de "raul moro".
        const claimed = new Map();
        pairs.forEach(function (x) { claimed.set(x[1].id, (claimed.get(x[1].id) || 0) + 1); });
        pairs.forEach(function (x) {
          if (claimed.get(x[1].id) !== 1 || !open.has(x[1].id)) return;
          matched[x[1].id] = x[0].row;
          open.delete(x[1].id);
          x[0].live = false;
          progress = true;
        });
      }
    });
  });
  return { matched: matched, unmatched: prepRows.filter(function (r) { return r.live; }).length };
}

// ---------- Descarga ----------
async function getText(url, headers) {
  const res = await fetch(url, { headers: headers, cache: "no-store", signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(url + " respondió " + res.status);
  return res.text();
}
async function getJson(path) {
  const text = await getText(API_BASE + path, { Accept: "application/json", "x-app": "2", "x-lang": "es", Referer: "https://fantasy.laliga.com/", "User-Agent": UA });
  return JSON.parse(text);
}
function listFrom(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") for (const k of ["players", "teams", "items", "results", "data", "content"]) if (Array.isArray(raw[k])) return raw[k];
  return [];
}

export function build(page, players, teams) {
  const rows = parseMarket(page);
  const result = matchMarket(players, rows, teams);
  const out = {};
  Object.keys(result.matched).forEach(function (id) {
    const r = result.matched[id];
    if (r.prob === null && r.week === null) return;
    out[id] = { p: r.prob, w: r.week, rival: r.rival, home: r.home, ff: r.name };
  });
  return { updatedAt: new Date().toISOString(), count: Object.keys(out).length, rows: rows.length, unmatched: result.unmatched, players: out };
}
export { parseMarket, matchMarket };

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Método no permitido." });
  }
  try {
    const results = await Promise.all([
      getText(FF_MARKET_URL, { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "Accept-Language": "es-ES,es;q=0.9" }),
      getJson("/v1/competition/1/players"),
      getJson("/v3/teams-master")
    ]);
    const body = build(results[0], listFrom(results[1]), listFrom(results[2]));
    if (!body.rows) throw new Error("La página de futbolfantasy no contiene jugadores (puede haber cambiado su formato).");
    res.setHeader("Cache-Control", "public, s-maxage=900, stale-while-revalidate=3600");
    return res.status(200).json(body);
  } catch (error) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(502).json({ error: "No se pudo obtener la titularidad de futbolfantasy.com.", detail: String(error && error.message || error).slice(0, 200) });
  }
}
