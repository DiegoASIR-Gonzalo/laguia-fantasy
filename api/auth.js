import crypto from "node:crypto";

const AUTH_BASE = "https://login.laliga.es/laligadspprob2c.onmicrosoft.com/oauth2/v2.0";
const POLICY = "B2C_1A_5ULAIP_PARAMETRIZED_SIGNIN";
const TOKEN_URL = AUTH_BASE + "/token?p=" + POLICY;
const AUTHORIZE_URL = AUTH_BASE + "/authorize";
const CLIENT_ID = "af88bcff-1157-40a0-b579-030728aacf0b";
const REDIRECT_URI = "authredirect://com.lfp.laligafantasy";
const API_BASE = "https://fantasy-api.llt-services.com/api";

const SESSION_COOKIE = "lf_session";
const REFRESH_COOKIE = "lf_refresh";
const STATE_COOKIE = "lf_oauth_state";
const VERIFIER_COOKIE = "lf_oauth_verifier";
const NONCE_COOKIE = "lf_oauth_nonce";
const OAUTH_COOKIE_AGE = 15 * 60;
const DEFAULT_REFRESH_COOKIE_AGE = 30 * 24 * 60 * 60;

function json(res, status, body) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
  return res.status(status).end(JSON.stringify(body));
}

function cookie(name, value, maxAge, sameSite) {
  return name + "=" + encodeURIComponent(value) +
    "; Max-Age=" + Math.max(0, Math.floor(maxAge)) +
    "; Path=/api/auth; HttpOnly; Secure; SameSite=" + (sameSite || "Strict") +
    "; Priority=High";
}

function clearCookie(name, path) {
  return name + "=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=" + (path || "/api/auth") + "; HttpOnly; Secure; SameSite=Strict";
}

function clearOAuthCookies() {
  return [STATE_COOKIE, VERIFIER_COOKIE, NONCE_COOKIE].flatMap(function (name) {
    return [clearCookie(name, "/api/auth"), clearCookie(name, "/")];
  });
}

function clearSessionCookies() {
  return [SESSION_COOKIE, REFRESH_COOKIE].flatMap(function (name) {
    return [clearCookie(name, "/api/auth"), clearCookie(name, "/")];
  });
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || "").split(";")) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const name = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    try {
      out[name] = decodeURIComponent(value);
    } catch {
      out[name] = value;
    }
  }
  return out;
}

function base64url(buffer) {
  return Buffer.from(buffer).toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomUrlSafe(bytes) {
  return base64url(crypto.randomBytes(bytes));
}

function pkceChallenge(verifier) {
  return base64url(crypto.createHash("sha256").update(verifier).digest());
}

function tokenPayload(token) {
  try {
    const parts = String(token || "").split(".");
    if (parts.length !== 3) return null;
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function tokenExpiry(token) {
  const payload = tokenPayload(token);
  return Number.isFinite(payload && payload.exp) ? payload.exp * 1000 : 0;
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  const forwardedHost = req.headers["x-forwarded-host"] || req.headers.host || "";
  const expectedHost = String(forwardedHost).split(",")[0].trim().toLowerCase();
  if (!origin || !expectedHost) return false;
  try {
    const u = new URL(origin);
    return (u.protocol === "https:" || u.protocol === "http:") &&
      u.host.toLowerCase() === expectedHost;
  } catch {
    return false;
  }
}

function fantasyHeaders(token) {
  return {
    "Accept": "application/json",
    "Authorization": "Bearer " + token,
    "x-app": "2",
    "x-lang": "es",
    "Referer": "https://fantasy.laliga.com/",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36"
  };
}

async function responseJson(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

async function getMe(token) {
  const response = await fetch(API_BASE + "/v4/user/me", {
    method: "GET",
    headers: fantasyHeaders(token),
    cache: "no-store",
    signal: AbortSignal.timeout(12000)
  });
  return { status: response.status, body: await responseJson(response) };
}

function sessionCookieHeaders(token, refreshToken, refreshAge) {
  const expiresAt = tokenExpiry(token);
  const accessAge = Math.max(1, Math.floor((expiresAt - Date.now()) / 1000));
  const refreshCookieAge = refreshToken
    ? Math.max(60, Math.min(Number(refreshAge) || DEFAULT_REFRESH_COOKIE_AGE, 365 * 24 * 60 * 60))
    : 0;
  const headers = [cookie(SESSION_COOKIE, token, accessAge, "Strict")];
  headers.push(refreshToken
    ? cookie(REFRESH_COOKIE, refreshToken, refreshCookieAge, "Strict")
    : clearCookie(REFRESH_COOKIE));
  return headers;
}

async function exchangeCode(code, verifier) {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json"
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      code: code,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
      scope: "openid offline_access"
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(15000)
  });
  return { status: response.status, body: await responseJson(response) };
}

async function refreshSession(refreshToken) {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json"
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
      scope: "openid offline_access"
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(15000)
  });
  const body = await responseJson(response);
  if (!response.ok) return null;

  const token = typeof body.access_token === "string" && body.access_token
    ? body.access_token
    : (typeof body.id_token === "string" ? body.id_token : "");
  if (!token || tokenExpiry(token) <= Date.now()) return null;

  return {
    token: token,
    refreshToken: typeof body.refresh_token === "string" && body.refresh_token
      ? body.refresh_token
      : refreshToken,
    refreshAge: Number(body.refresh_token_expires_in) || DEFAULT_REFRESH_COOKIE_AGE
  };
}

function parseRedirect(value) {
  const clean = String(value || "").trim().replace(/&amp;/gi, "&");
  if (!clean) throw new Error("Pega la URL de redirección completa de LALIGA.");
  if (clean.length > 8192 || clean.includes("…") || /%E2%80%A6/i.test(clean)) {
    throw new Error("La URL parece cortada. Cópiala completa desde la cabecera Location o la URL de la redirección.");
  }
  if (!/^authredirect:\/\/com\.lfp\.laligafantasy(?:[/?#]|$)/i.test(clean)) {
    throw new Error("La URL debe empezar por authredirect://com.lfp.laligafantasy.");
  }

  const question = clean.indexOf("?");
  if (question < 0) throw new Error("La URL no contiene los parámetros code y state.");
  const query = clean.slice(question + 1).split("#")[0];
  const values = {};
  for (const item of query.split("&")) {
    if (!item) continue;
    const idx = item.indexOf("=");
    const rawKey = idx < 0 ? item : item.slice(0, idx);
    const rawValue = idx < 0 ? "" : item.slice(idx + 1);
    let key, val;
    try {
      key = decodeURIComponent(rawKey);
      val = decodeURIComponent(rawValue);
    } catch {
      throw new Error("La URL de redirección contiene caracteres no válidos.");
    }
    values[key] = val;
  }

  const code = values.code || "";
  const state = values.state || "";
  if (values.error) throw new Error("LALIGA no completó el login: " + String(values.error_description || values.error).slice(0, 180));
  if (!code || !state) throw new Error("La URL debe incluir los parámetros code y state.");
  if (code.split(".").length !== 5 || code.split(".").some(function (part) { return !part; })) {
    throw new Error("El código está incompleto o no tiene el formato esperado. Copia la URL de nuevo.");
  }
  return { code: code, state: state };
}

function sameSecret(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right);
}

function safeProfile(body) {
  const data = body && typeof body === "object" ? body : {};
  const managerName = data.managerName || data.nickname || data.name || null;
  const userId = data.id === undefined || data.id === null ? null : String(data.id);
  return { managerName: managerName, userId: userId };
}

async function handleStatus(req, res) {
  const jar = parseCookies(req.headers.cookie);
  let token = jar[SESSION_COOKIE] || "";
  let refreshToken = jar[REFRESH_COOKIE] || "";
  let didRefresh = false;
  let refreshAge = DEFAULT_REFRESH_COOKIE_AGE;

  if (!token) return json(res, 200, { authenticated: false });

  if (!tokenExpiry(token)) {
    res.setHeader("Set-Cookie", clearSessionCookies());
    return json(res, 200, { authenticated: false });
  }

  if (tokenExpiry(token) <= Date.now() + 120000) {
    if (!refreshToken) {
      res.setHeader("Set-Cookie", clearSessionCookies());
      return json(res, 200, { authenticated: false });
    }
    const renewed = await refreshSession(refreshToken);
    if (!renewed) {
      res.setHeader("Set-Cookie", clearSessionCookies());
      return json(res, 200, { authenticated: false });
    }
    token = renewed.token;
    refreshToken = renewed.refreshToken;
    refreshAge = renewed.refreshAge;
    didRefresh = true;
  }

  let profileResponse = await getMe(token);
  if (profileResponse.status === 401 && refreshToken && !didRefresh) {
    const renewed = await refreshSession(refreshToken);
    if (renewed) {
      token = renewed.token;
      refreshToken = renewed.refreshToken;
      refreshAge = renewed.refreshAge;
      didRefresh = true;
      profileResponse = await getMe(token);
    }
  }

  if (profileResponse.status === 401) {
    res.setHeader("Set-Cookie", clearSessionCookies());
    return json(res, 200, { authenticated: false });
  }
  if (profileResponse.status < 200 || profileResponse.status >= 300) {
    return json(res, 502, {
      authenticated: false,
      error: "No se pudo comprobar la sesión en LALIGA Fantasy. Inténtalo de nuevo."
    });
  }

  if (didRefresh) {
    res.setHeader("Set-Cookie", sessionCookieHeaders(token, refreshToken, refreshAge));
  }

  const profile = safeProfile(profileResponse.body);
  return json(res, 200, {
    authenticated: true,
    expiresAt: tokenExpiry(token),
    managerName: profile.managerName,
    userId: profile.userId
  });
}

const PRIVATE_READ_ALLOWLIST = [
  /^\/v4\/user\/me$/,
  /^\/v1\/competition\/1\/leagues$/,
  /^\/v1\/competition\/1\/leagues\/[A-Za-z0-9_-]+\/standing$/,
  /^\/v1\/competition\/1\/leagues\/[A-Za-z0-9_-]+\/standing\/\d+$/,
  /^\/v1\/competition\/1\/leagues\/[A-Za-z0-9_-]+\/teams\/[A-Za-z0-9_-]+$/,
  /^\/v1\/competition\/1\/leagues\/[A-Za-z0-9_-]+\/activity\/\d+$/,
  /^\/v1\/competition\/1\/teams\/[A-Za-z0-9_-]+\/money$/,
  /^\/v1\/competition\/1\/teams\/[A-Za-z0-9_-]+\/lineup$/,
  /^\/v1\/competition\/1\/teams\/[A-Za-z0-9_-]+\/lineup\/week\/\d+$/,
  /^\/v1\/competition\/1\/league\/[A-Za-z0-9_-]+\/market$/,
  /^\/v1\/competition\/1\/league\/[A-Za-z0-9_-]+\/playerTeam\/[A-Za-z0-9_-]+\/offer$/,
  /^\/v1\/competition\/1\/player\/[A-Za-z0-9_-]+\/league\/[A-Za-z0-9_-]+$/,
  /^\/v1\/competition\/1\/league\/[A-Za-z0-9_-]+\/player-team\/[A-Za-z0-9_-]+\/check-shield$/,
  /^\/v1\/competition\/1\/league\/[A-Za-z0-9_-]+\/team\/[A-Za-z0-9_-]+\/check-daily-reward$/,
  /^\/v1\/competition\/1\/daily-reward$/
];

function privateReadAllowed(path) {
  return PRIVATE_READ_ALLOWLIST.some(function (rule) { return rule.test(path); });
}

async function requestFantasyRead(path, token) {
  const url = new URL(API_BASE + path);
  url.searchParams.set("x-lang", "es");
  const response = await fetch(url, {
    method: "GET",
    headers: fantasyHeaders(token),
    cache: "no-store",
    signal: AbortSignal.timeout(15000)
  });
  const text = await response.text();
  return {
    status: response.status,
    contentType: response.headers.get("content-type") || "application/json; charset=utf-8",
    text: text
  };
}


const PRIVATE_WRITE_RULES = [
  { method: "POST", test: /^\/v1\/competition\/1\/league\/[A-Za-z0-9_-]+\/market\/[A-Za-z0-9_-]+\/bid$/, action: "market_bid" },
  { method: "POST", test: /^\/v1\/competition\/1\/league\/[A-Za-z0-9_-]+\/buyout\/[A-Za-z0-9_-]+\/pay$/, action: "buyout_pay" },
  { method: "PUT", test: /^\/v1\/competition\/1\/teams\/[A-Za-z0-9_-]+\/lineup$/, action: "lineup_save" },
  { method: "POST", test: /^\/v1\/competition\/1\/league\/[A-Za-z0-9_-]+\/team\/daily-reward$/, action: "daily_reward" }
];
const ALLOWED_FORMATIONS = new Set(["5,4,1", "5,3,2", "4,5,1", "4,4,2", "4,3,3", "3,5,2", "3,4,3", "5,2,3", "4,6,0", "4,2,4", "3,6,1", "3,3,4"]);
const APPROVAL_TICKET_TTL_MS = 90 * 1000;

function privateWriteRule(method, path) {
  return PRIVATE_WRITE_RULES.find(function (rule) {
    return rule.method === method && rule.test.test(path);
  }) || null;
}

function normalizeLineupId(value) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value);
  return /^[A-Za-z0-9_-]{1,40}$/.test(normalized) ? normalized : null;
}

function validatePrivateWrite(method, path, payload) {
  const rule = privateWriteRule(method, path);
  if (!rule) throw new Error("Esta operación no está permitida por el proxy privado.");
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Los datos de la operación no tienen un formato válido.");
  }

  if (rule.action === "market_bid") {
    if (Object.keys(payload).length !== 1 || !Number.isSafeInteger(payload.money) || payload.money <= 0) {
      throw new Error("La puja debe contener un importe entero positivo en euros.");
    }
    return { rule: rule, payload: { money: payload.money } };
  }

  if (rule.action === "buyout_pay") {
    if (Object.keys(payload).length !== 1 || !Number.isSafeInteger(payload.buyoutClauseToPay) || payload.buyoutClauseToPay <= 0) {
      throw new Error("El pago de cláusula debe contener un importe entero positivo en euros.");
    }
    return { rule: rule, payload: { buyoutClauseToPay: payload.buyoutClauseToPay } };
  }

  const expectedKeys = ["goalkeeper", "defender", "midfield", "striker", "tactical_formation"];
  if (rule.action === "daily_reward") {
    if (Object.keys(payload).length !== 3 || payload.rewardedAdType !== "dailyreward" || payload.rewardedAd !== 1 ||
        typeof payload.teamId !== "string" || !/^[0-9]{1,20}$/.test(payload.teamId)) {
      throw new Error("La recompensa diaria debe llevar rewardedAdType \"dailyreward\", rewardedAd 1 y teamId como texto numérico.");
    }
    return { rule: rule, payload: { rewardedAdType: "dailyreward", rewardedAd: 1, teamId: payload.teamId } };
  }
  
  if (Object.keys(payload).length !== expectedKeys.length || expectedKeys.some(function (key) { return !Object.prototype.hasOwnProperty.call(payload, key); })) {
    throw new Error("La alineación debe incluir portero, defensas, centrocampistas, delanteros y formación táctica.");
  }

  const goalkeeper = normalizeLineupId(payload.goalkeeper);
  const defender = Array.isArray(payload.defender) ? payload.defender.map(normalizeLineupId) : null;
  const midfield = Array.isArray(payload.midfield) ? payload.midfield.map(normalizeLineupId) : null;
  const striker = Array.isArray(payload.striker) ? payload.striker.map(normalizeLineupId) : null;
  const formation = Array.isArray(payload.tactical_formation)
    ? payload.tactical_formation.map(function (value) { return typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value; })
    : null;

  if (!goalkeeper || !defender || !midfield || !striker || !formation || formation.length !== 3 ||
      formation.some(function (value) { return !Number.isInteger(value) || value < 0 || value > 6; })) {
    throw new Error("La alineación contiene identificadores o formación no válidos.");
  }
  if (defender.some(function (value) { return !value; }) ||
      midfield.some(function (value) { return !value; }) ||
      striker.some(function (value) { return !value; })) {
    throw new Error("Cada jugador seleccionado debe tener un ID de ficha válido.");
  }
  if (defender.length !== formation[0] || midfield.length !== formation[1] || striker.length !== formation[2] ||
      !ALLOWED_FORMATIONS.has(formation.join(","))) {
    throw new Error("La cantidad de jugadores no coincide con una formación gratuita permitida.");
  }

  const selected = [goalkeeper].concat(defender, midfield, striker);
  if (selected.length !== 11 || new Set(selected).size !== selected.length) {
    throw new Error("El once debe contener 11 fichas distintas, sin repetir jugadores.");
  }

  return {
    rule: rule,
    payload: {
      goalkeeper: goalkeeper,
      defender: defender,
      midfield: midfield,
      striker: striker,
      tactical_formation: formation
    }
  };
}

function makeApprovalTicket(token, path, method, payload) {
  const ticketPayload = {
    path: path,
    method: method,
    hash: crypto.createHash("sha256").update(JSON.stringify(payload)).digest("base64url"),
    expiresAt: Date.now() + APPROVAL_TICKET_TTL_MS,
    nonce: randomUrlSafe(18)
  };
  const encoded = base64url(Buffer.from(JSON.stringify(ticketPayload), "utf8"));
  const signature = crypto.createHmac("sha256", token).update(encoded).digest("base64url");
  return encoded + "." + signature;
}

function verifyApprovalTicket(ticket, token, path, method, payload) {
  if (typeof ticket !== "string" || ticket.length > 2048) return false;
  const pieces = ticket.split(".");
  if (pieces.length !== 2) return false;
  const expected = crypto.createHmac("sha256", token).update(pieces[0]).digest("base64url");
  if (!sameSecret(expected, pieces[1])) return false;

  try {
    const decoded = JSON.parse(Buffer.from(pieces[0], "base64url").toString("utf8"));
    if (decoded.path !== path || decoded.method !== method ||
        !Number.isFinite(decoded.expiresAt) || decoded.expiresAt <= Date.now() ||
        decoded.expiresAt > Date.now() + APPROVAL_TICKET_TTL_MS + 5000) return false;
    const hash = crypto.createHash("sha256").update(JSON.stringify(payload)).digest("base64url");
    return sameSecret(decoded.hash, hash) && typeof decoded.nonce === "string";
  } catch {
    return false;
  }
}

async function requestFantasyWrite(method, path, payload, token) {
  const url = new URL(API_BASE + path);
  url.searchParams.set("x-lang", "es");
  const response = await fetch(url, {
    method: method,
    headers: Object.assign({}, fantasyHeaders(token), { "Content-Type": "application/json" }),
    body: JSON.stringify(payload),
    cache: "no-store",
    signal: AbortSignal.timeout(15000)
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = { message: text.slice(0, 500) }; }
  }
  return { status: response.status, data: data };
}

async function handlePrivateWrite(req, res, path, body) {
  const method = body.upstreamMethod;
  if (typeof path !== "string" || path.length > 400 || path.includes("?") || !path.startsWith("/") ||
      (body.actionPhase !== "prepare" && body.actionPhase !== "confirm")) {
    return json(res, 400, { error: "Falta una fase de confirmación válida para la operación." });
  }

  let validated;
  try {
    validated = validatePrivateWrite(method, path, body.payload);
  } catch (error) {
    return json(res, 403, { error: error.message || "Esta operación no está permitida." });
  }

  const jar = parseCookies(req.headers.cookie);
  let token = jar[SESSION_COOKIE] || "";
  let refreshToken = jar[REFRESH_COOKIE] || "";
  let didRefresh = false;
  let refreshAge = DEFAULT_REFRESH_COOKIE_AGE;

  if (body.actionPhase === "prepare") {
    if (!token || !tokenExpiry(token) || tokenExpiry(token) <= Date.now() + 120000) {
      if (!refreshToken) {
        res.setHeader("Set-Cookie", clearSessionCookies());
        return json(res, 401, { error: "La sesión ha caducado. Vuelve a iniciar sesión." });
      }
      const renewed = await refreshSession(refreshToken);
      if (!renewed) {
        res.setHeader("Set-Cookie", clearSessionCookies());
        return json(res, 401, { error: "La sesión ha caducado. Vuelve a iniciar sesión." });
      }
      token = renewed.token;
      refreshToken = renewed.refreshToken;
      refreshAge = renewed.refreshAge;
      didRefresh = true;
    }

    if (didRefresh) res.setHeader("Set-Cookie", sessionCookieHeaders(token, refreshToken, refreshAge));
    const approvalToken = makeApprovalTicket(token, path, method, validated.payload);
    return json(res, 200, {
      prepared: true,
      approvalToken: approvalToken,
      expiresAt: Date.now() + APPROVAL_TICKET_TTL_MS,
      operation: validated.rule.action
    });
  }

  if (body.confirmed !== true ||
      !verifyApprovalTicket(body.approvalToken, token, path, method, validated.payload)) {
    return json(res, 400, {
      error: "La confirmación ha caducado o no coincide con la operación preparada. Prepara de nuevo y revisa el resumen."
    });
  }

  if (!token || !tokenExpiry(token)) {
    return json(res, 401, { error: "La sesión ha caducado. Vuelve a iniciar sesión." });
  }
  if (tokenExpiry(token) <= Date.now() + 15000) {
    if (!refreshToken) {
      res.setHeader("Set-Cookie", clearSessionCookies());
      return json(res, 401, { error: "La sesión ha caducado. Vuelve a iniciar sesión." });
    }
    const renewed = await refreshSession(refreshToken);
    if (!renewed) {
      res.setHeader("Set-Cookie", clearSessionCookies());
      return json(res, 401, { error: "La sesión ha caducado. Vuelve a iniciar sesión." });
    }
    token = renewed.token;
    refreshToken = renewed.refreshToken;
    refreshAge = renewed.refreshAge;
    didRefresh = true;
  }

  let result = await requestFantasyWrite(method, path, validated.payload, token);
  if (result.status === 401 && refreshToken && !didRefresh) {
    const renewed = await refreshSession(refreshToken);
    if (renewed) {
      token = renewed.token;
      refreshToken = renewed.refreshToken;
      refreshAge = renewed.refreshAge;
      didRefresh = true;
      result = await requestFantasyWrite(method, path, validated.payload, token);
    }
  }

  if (didRefresh) res.setHeader("Set-Cookie", sessionCookieHeaders(token, refreshToken, refreshAge));
  if (result.status === 401) {
    res.setHeader("Set-Cookie", clearSessionCookies());
    return json(res, 401, { error: "LALIGA ha rechazado la sesión. Vuelve a iniciar sesión." });
  }
  if (result.status < 200 || result.status >= 300) {
    const upstream = result.data && typeof result.data === "object" ? result.data : {};
    return json(res, result.status, {
      error: upstream.message || upstream.error || "LALIGA ha rechazado la operación.",
      errorCode: upstream.errorCode || null
    });
  }

  privateApiCacheNoop();
  return json(res, 200, { success: true, result: result.data });
}

function privateApiCacheNoop() {
  // The browser invalidates its in-memory private cache after a confirmed write.
}

async function handlePrivateRead(req, res) {
  const pathValue = req.query && req.query.path;
  const path = Array.isArray(pathValue) ? pathValue[0] : pathValue;
  if (typeof path !== "string" || path.length > 400 || path.includes("?") || !path.startsWith("/") || !privateReadAllowed(path)) {
    return json(res, 403, { error: "Endpoint privado no permitido o ruta no válida." });
  }

  const jar = parseCookies(req.headers.cookie);
  let token = jar[SESSION_COOKIE] || "";
  let refreshToken = jar[REFRESH_COOKIE] || "";
  let didRefresh = false;
  let refreshAge = DEFAULT_REFRESH_COOKIE_AGE;
  if (!token) return json(res, 401, { error: "Inicia sesión con Google para consultar tus ligas." });

  if (!tokenExpiry(token) || tokenExpiry(token) <= Date.now() + 120000) {
    if (!refreshToken) {
      res.setHeader("Set-Cookie", clearSessionCookies());
      return json(res, 401, { error: "La sesión ha caducado. Vuelve a iniciar sesión." });
    }
    const renewed = await refreshSession(refreshToken);
    if (!renewed) {
      res.setHeader("Set-Cookie", clearSessionCookies());
      return json(res, 401, { error: "La sesión ha caducado. Vuelve a iniciar sesión." });
    }
    token = renewed.token;
    refreshToken = renewed.refreshToken;
    refreshAge = renewed.refreshAge;
    didRefresh = true;
  }

  let result = await requestFantasyRead(path, token);
  if (result.status === 401 && refreshToken && !didRefresh) {
    const renewed = await refreshSession(refreshToken);
    if (renewed) {
      token = renewed.token;
      refreshToken = renewed.refreshToken;
      refreshAge = renewed.refreshAge;
      didRefresh = true;
      result = await requestFantasyRead(path, token);
    }
  }

  if (didRefresh && result.status !== 401) {
    res.setHeader("Set-Cookie", sessionCookieHeaders(token, refreshToken, refreshAge));
  }
  if (result.status === 401) {
    res.setHeader("Set-Cookie", clearSessionCookies());
    return json(res, 401, { error: "LALIGA ha rechazado la sesión. Vuelve a iniciar sesión." });
  }

  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Content-Type", result.contentType);
  return res.status(result.status).end(result.text);
}

export default async function handler(req, res) {
  if (req.method === "GET" && req.query && req.query.provider === "google") {
    const state = randomUrlSafe(24);
    const verifier = randomUrlSafe(48);
    const nonce = state;
    const params = new URLSearchParams({
      p: POLICY,
      client_id: CLIENT_ID,
      response_type: "code",
      redirect_uri: REDIRECT_URI,
      scope: "openid offline_access",
      code_challenge: pkceChallenge(verifier),
      code_challenge_method: "S256",
      state: state,
      nonce: nonce
    });

    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Set-Cookie", [
      cookie(STATE_COOKIE, state, OAUTH_COOKIE_AGE, "Lax"),
      cookie(VERIFIER_COOKIE, verifier, OAUTH_COOKIE_AGE, "Lax"),
      cookie(NONCE_COOKIE, nonce, OAUTH_COOKIE_AGE, "Lax")
    ]);
    res.statusCode = 302;
    res.setHeader("Location", AUTHORIZE_URL + "?" + params.toString());
    return res.end();
  }

  if (req.method === "GET") {
    try {
      if (req.query && req.query.path !== undefined) return await handlePrivateRead(req, res);
      return await handleStatus(req, res);
    } catch (error) {
      const pathValue = req.query && req.query.path;
      if (pathValue !== undefined) {
        return json(res, 502, { error: "No se pudo consultar LALIGA Fantasy. Inténtalo de nuevo." });
      }
      return json(res, 502, {
        authenticated: false,
        error: "No se pudo comprobar la sesión con LALIGA Fantasy."
      });
    }
  }

  if (req.method === "DELETE") {
    if (!sameOrigin(req)) {
      return json(res, 403, { error: "Origen no permitido." });
    }
    res.setHeader("Set-Cookie", clearSessionCookies().concat(clearOAuthCookies()));
    return json(res, 200, { authenticated: false });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST, DELETE");
    return json(res, 405, { error: "Método no permitido." });
  }

  if (!sameOrigin(req)) {
    return json(res, 403, { error: "Origen no permitido. Recarga la página e inténtalo de nuevo." });
  }

  try {
    const raw = typeof req.body === "string" ? req.body : JSON.stringify(req.body || {});
    if (Buffer.byteLength(raw, "utf8") > 8192) {
      return json(res, 413, { error: "La solicitud es demasiado grande." });
    }
    const body = typeof req.body === "object" && req.body !== null ? req.body : JSON.parse(raw || "{}");
    const pathValue = req.query && req.query.path;
    const requestedPath = Array.isArray(pathValue) ? pathValue[0] : pathValue;
    if (requestedPath !== undefined) {
      return await handlePrivateWrite(req, res, requestedPath, body);
    }
    if (body.oauth !== "google") {
      return json(res, 400, { error: "Usa el inicio de sesión oficial de LALIGA con Google." });
    }

    const jar = parseCookies(req.headers.cookie);
    const verifier = jar[VERIFIER_COOKIE] || "";
    const expectedState = jar[STATE_COOKIE] || "";
    const expectedNonce = jar[NONCE_COOKIE] || "";
    if (!verifier || !expectedState || !expectedNonce) {
      return json(res, 400, { error: "El inicio de sesión ha caducado. Vuelve a pulsar Continuar con Google." });
    }

    const parsed = parseRedirect(body.redirect);
    if (!sameSecret(parsed.state, expectedState)) {
      return json(res, 400, { error: "El state no coincide con este intento. Copia la URL del mismo inicio de sesión." });
    }

    // Consume the pending PKCE attempt before contacting the token endpoint.
    res.setHeader("Set-Cookie", clearOAuthCookies());

    const tokenResponse = await exchangeCode(parsed.code, verifier);
    if (tokenResponse.status < 200 || tokenResponse.status >= 300) {
      return json(res, 401, {
        error: "LALIGA ha rechazado el código. Puede haber caducado o haberse usado; inicia un nuevo login."
      });
    }

    const tokenData = tokenResponse.body;
    const token = typeof tokenData.access_token === "string" && tokenData.access_token
      ? tokenData.access_token
      : (typeof tokenData.id_token === "string" ? tokenData.id_token : "");
    const refreshToken = typeof tokenData.refresh_token === "string" ? tokenData.refresh_token : "";
    const expiresAt = tokenExpiry(token);
    if (!token || !expiresAt || expiresAt <= Date.now()) {
      return json(res, 502, { error: "LALIGA no devolvió un token de sesión válido." });
    }

    if (tokenData.id_token) {
      const idClaims = tokenPayload(tokenData.id_token);
      if (idClaims && idClaims.nonce && !sameSecret(idClaims.nonce, expectedNonce)) {
        return json(res, 401, { error: "No se pudo validar la respuesta de autenticación. Inicia sesión otra vez." });
      }
    }

    const profileResponse = await getMe(token);
    if (profileResponse.status === 401) {
      return json(res, 401, { error: "LALIGA no aceptó la sesión para Fantasy. Vuelve a iniciar sesión." });
    }
    if (profileResponse.status < 200 || profileResponse.status >= 300) {
      return json(res, 502, { error: "El login llegó a LALIGA, pero no se pudo verificar la cuenta de Fantasy. Inténtalo de nuevo." });
    }

    const refreshAge = Number(tokenData.refresh_token_expires_in) || DEFAULT_REFRESH_COOKIE_AGE;
    res.setHeader("Set-Cookie", clearOAuthCookies().concat(sessionCookieHeaders(token, refreshToken, refreshAge)));
    const profile = safeProfile(profileResponse.body);
    return json(res, 200, {
      authenticated: true,
      expiresAt: expiresAt,
      managerName: profile.managerName,
      userId: profile.userId
    });
  } catch (error) {
    const message = error && typeof error.message === "string" ? error.message : "";
    const isNetwork = /fetch failed|timeout|aborted|network/i.test(message);
    return json(res, isNetwork ? 502 : 400, {
      error: isNetwork
        ? "No se pudo contactar con LALIGA. Inicia un nuevo login y vuelve a intentarlo."
        : (message || "No se pudo completar el inicio de sesión.")
    });
  }
}
