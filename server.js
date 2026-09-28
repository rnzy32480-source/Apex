const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, "data");
const DB_PATH = path.join(DATA_DIR, "db.json");
const SECRET = process.env.PD_SECRET || "axel-town-pd-change-this-secret";
const TOKEN_TTL_MS = 1000 * 60 * 60 * 16;

const DEFAULT_RANK_NAMES = [
  "Cadet",
  "Recruit",
  "Private",
  "Private First Class",
  "Specialist",
  "Corporal",
  "Sergeant",
  "Staff Sergeant",
  "Sergeant First Class",
  "Master Sergeant",
  "First Sergeant",
  "Sergeant Major",
  "Second Lieutenant",
  "First Lieutenant",
  "Captain",
  "Major",
  "Lieutenant Colonel",
  "Colonel",
  "Commander",
  "Assistant Chief",
  "Deputy Chief",
  "Chief of Police",
];

const NOTICE = {
  accepted:
    "PRELIMINARY ACCEPTANCE: Command has accepted your file. Await final clearance from the Chief of Police before you may attend academy.",
  final_accepted:
    "FINAL ACCEPTANCE: The Chief of Police has cleared you. You may attend your academy appointment.",
  rejected: "Your application was rejected. Command may still reverse this, or issue a final rejection.",
  final_rejected: "FINAL REJECTION: This file is closed. You may file a new application after the cooldown, unless command lifts it.",
};

const APPLY_FIELDS = [
  "icName",
  "age",
  "whyJoin",
  "priorLeo",
  "availability",
  "character",
  "useOfForce",
  "trafficStop",
  "chainOfCommand",
  "backup",
  "bribe",
  "oath",
];

function defaultRanks() {
  return DEFAULT_RANK_NAMES.map((label, i) => ({
    id: `r${i + 1}`,
    order: i + 1,
    label,
  }));
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 32).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(":");
  const next = crypto.scryptSync(password, salt, 32).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(next, "hex"));
}

function signToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function readToken(header) {
  if (!header || !header.startsWith("Bearer ")) return null;
  const token = header.slice(7);
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  if (payload.exp < Date.now()) return null;
  return payload;
}

function rankLabel(db, rankId) {
  return (db.ranks || []).find((r) => r.id === rankId)?.label || "Unassigned";
}

function isTopN(order, max, n) {
  return max > 0 && order >= max - n + 1;
}

function getPerms(db, rankId) {
  const ranks = db.ranks || [];
  const r = ranks.find((x) => x.id === rankId);
  const order = r?.order || 0;
  const max = Math.max(0, ...ranks.map((x) => x.order));
  const isChief = order === max && max > 0;
  const isDeputy = order === max - 1 && max > 1;
  const top2 = isTopN(order, max, 2);
  const top6 = isTopN(order, max, 6);
  const top7 = isTopN(order, max, 7);
  return {
    label: r?.label || "Unassigned",
    order,
    isChief,
    isDeputy,
    canOfficer: order >= 1,
    canReview: top6,
    canTraining: top6,
    canPersonnel: top6,
    canContent: top2,
    canStaff: top7,
    canFinalAccept: isChief,
    canRenameRanks: top2,
    canSettings: top2,
    canApprovePromo: top6,
    canTicketsComplaint: top2,
    canTicketsInquiry: top6,
    canTicketsApply: top6,
    canOpenInquiry: order >= 1,
  };
}

function seedDb() {
  const ranks = defaultRanks();
  return {
    ranks,
    staff: [
      {
        id: "staff-chief",
        username: "chief",
        displayName: "Department Chief",
        rank: "r22",
        discord: "chief",
        unitCode: "C0A1",
        password: hashPassword("ApexPD2026"),
        createdAt: new Date().toISOString(),
      },
    ],
    protocols: [
      {
        id: "prot-1",
        code: "SOP-01",
        title: "Use of Force Continuum",
        body: "Officers shall use only the force reasonably necessary to overcome resistance. De-escalation is required when time and circumstances permit. Lethal force is authorized only to protect life.",
        updatedAt: new Date().toISOString(),
      },
      {
        id: "prot-2",
        code: "SOP-02",
        title: "Radio & 10-Codes Discipline",
        body: "Keep radio traffic short. Identify unit, location, and status. Priority traffic always yields. No OOC chatter on department frequencies.",
        updatedAt: new Date().toISOString(),
      },
      {
        id: "prot-3",
        code: "SOP-03",
        title: "Traffic Stop Procedure",
        body: "Call out plate, vehicle, and location before the stop. Position the cruiser offset. Approach with cover. Identify yourself, state the reason, request license and registration.",
        updatedAt: new Date().toISOString(),
      },
    ],
    rules: [
      {
        id: "rule-1",
        code: "R-01",
        title: "Chain of Command",
        body: "Orders flow down the 22-rank structure. Disputes go to the next rank, then Deputy Chief, then Chief of Police.",
        updatedAt: new Date().toISOString(),
      },
      {
        id: "rule-2",
        code: "R-02",
        title: "Uniform & Conduct",
        body: "On duty: full Axel Town PD uniform, no OOC in character, no corruption RP without command approval.",
        updatedAt: new Date().toISOString(),
      },
      {
        id: "rule-3",
        code: "R-03",
        title: "Academy Attendance",
        body: "Cadets may attend Thursday/Saturday academy only after the Chief of Police issues final acceptance.",
        updatedAt: new Date().toISOString(),
      },
    ],
    civilians: [],
    settings: { reapplyCooldownHours: 24, training: defaultTraining(), discordMessages: defaultDiscordMessages() },
    applications: [],
    bookings: [],
    leaves: [],
    promotions: [],
    chat: [],
    dutyLogs: [],
    reports: [],
    tickets: [],
    inviteCodes: [],
    emailCodes: [],
  };
}

function migrate(db) {
  let changed = false;
  if (!Array.isArray(db.ranks) || db.ranks.length !== 22) {
    db.ranks = defaultRanks();
    changed = true;
  }
  if (!db.rules) {
    db.rules = db.laws || [];
    changed = true;
  }
  const oldMap = { chief: "r22", commander: "r19", sergeant: "r7", officer: "r6", deputy: "r21" };
  for (const s of db.staff || []) {
    if (oldMap[s.rank]) {
      s.rank = oldMap[s.rank];
      changed = true;
    }
  }
  if (!Array.isArray(db.civilians)) {
    db.civilians = [];
    changed = true;
  }
  if (!db.settings) {
    db.settings = { reapplyCooldownHours: 24 };
    changed = true;
  }
  if (typeof db.settings.reapplyCooldownHours !== "number") {
    db.settings.reapplyCooldownHours = 24;
    changed = true;
  }
  for (const key of ["leaves", "promotions", "chat", "dutyLogs", "reports", "tickets", "inviteCodes", "emailCodes"]) {
    if (!Array.isArray(db[key])) {
      db[key] = [];
      changed = true;
    }
  }
  for (const s of db.staff || []) {
    if (!s.discord) {
      s.discord = s.username === "chief" ? "chief" : "";
      changed = true;
    }
    if (!s.unitCode) {
      s.unitCode = s.username === "chief" ? "C0A1" : "";
      changed = true;
    }
  }
  if (!db.settings.smtp) {
    db.settings.smtp = { host: "", port: 587, user: "", pass: "", from: "", secure: false };
    changed = true;
  }
  if (!db.settings.training) {
    db.settings.training = defaultTraining();
    changed = true;
  }
  if (!db.settings.discordMessages) {
    db.settings.discordMessages = defaultDiscordMessages();
    changed = true;
  }
  return changed;
}

function loadDb() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_PATH)) {
    const seeded = seedDb();
    fs.writeFileSync(DB_PATH, JSON.stringify(seeded, null, 2));
    return seeded;
  }
  const db = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
  if (migrate(db)) saveDb(db);
  return db;
}

function saveDb(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function id(prefix) {
  return `${prefix}-${crypto.randomBytes(6).toString("hex")}`;
}

function isThuOrSat(date) {
  const d = date.getUTCDay();
  return d === 4 || d === 6;
}

function utcDate(y, m, day) {
  return new Date(Date.UTC(y, m - 1, day));
}

function formatYmd(date) {
  return date.toISOString().slice(0, 10);
}

function defaultTraining() {
  return {
    location: "Airport",
    when: "Thursday and Saturday at 20:00",
    message: "Your military training is at the airport. Arrive on time in uniform.",
  };
}

function defaultDiscordMessages() {
  return {
    accepted: "Axel Town PD — تم قبولك مبدئياً في الأكاديمية العسكرية. راجع الموقع واحجز يوم التدريب.",
    final_accepted: "Axel Town PD — تم قبولك نهائياً في الأكاديمية العسكرية. راجع الموقع لمعرفة مكان التدريب.",
    final_rejected: "Axel Town PD — تم رفضك نهائياً. راجع الموقع.",
  };
}

function discordMessages(db) {
  const d = db.settings?.discordMessages || {};
  const fallback = defaultDiscordMessages();
  return {
    accepted: String(d.accepted || fallback.accepted).slice(0, 1800),
    final_accepted: String(d.final_accepted || fallback.final_accepted).slice(0, 1800),
    final_rejected: String(d.final_rejected || fallback.final_rejected).slice(0, 1800),
  };
}

function trainingSettings(db) {
  const t = db.settings?.training || {};
  const fallback = defaultTraining();
  return {
    location: String(t.location || fallback.location).slice(0, 200),
    when: String(t.when || fallback.when).slice(0, 200),
    message: String(t.message || fallback.message).slice(0, 800),
  };
}

function academyBriefing(db, status) {
  if (status !== "final_accepted") return null;
  return trainingSettings(db);
}

function publicApplication(item, db) {
  const booking = (db.bookings || []).find((b) => b.applicationId === item.id);
  return {
    id: item.id,
    icName: item.icName,
    account: item.accountUsername || "",
    status: item.status,
    notice: item.notice || "",
    canAttend: item.status === "final_accepted",
    academy: academyBriefing(db, item.status),
    booking: booking ? { date: booking.date, weekday: booking.weekday, time: booking.time } : null,
  };
}

function latestAppForUser(db, civilianId) {
  return (db.applications || []).find((a) => a.civilianId === civilianId) || null;
}

function cooldownHours(db) {
  const n = Number(db.settings?.reapplyCooldownHours || 24);
  return Math.min(168, Math.max(1, n));
}

function reapplyState(civilian, db) {
  if (!civilian?.reapplyAt) return { blocked: false, reapplyAt: null, remainingMs: 0 };
  const at = new Date(civilian.reapplyAt).getTime();
  const remainingMs = at - Date.now();
  return { blocked: remainingMs > 0, reapplyAt: civilian.reapplyAt, remainingMs: Math.max(0, remainingMs) };
}

const humanChecks = new Map();

function pruneHumanChecks() {
  const now = Date.now();
  for (const [key, row] of humanChecks) {
    if (row.expires < now) humanChecks.delete(key);
  }
}

function scatterPoints(count) {
  const cells = [];
  for (let y = 0; y < 3; y += 1) {
    for (let x = 0; x < 5; x += 1) cells.push([x, y]);
  }
  for (let i = cells.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(0, i + 1);
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }
  return cells.slice(0, count).map(([cx, cy]) => ({
    x: 28 + cx * 52 + crypto.randomInt(0, 8),
    y: 28 + cy * 42 + crypto.randomInt(0, 6),
  }));
}

function svgStopSign(x, y) {
  const s = 11;
  const pts = [
    [x, y - s],
    [x + s * 0.7, y - s * 0.7],
    [x + s, y],
    [x + s * 0.7, y + s * 0.7],
    [x, y + s],
    [x - s * 0.7, y + s * 0.7],
    [x - s, y],
    [x - s * 0.7, y - s * 0.7],
  ]
    .map((p) => p.join(","))
    .join(" ");
  return `<polygon points="${pts}" fill="#c45c5c" stroke="#f3d77a" stroke-width="1.2"/><text x="${x}" y="${y + 3.5}" text-anchor="middle" font-size="6" fill="#fff" font-family="Arial">STOP</text>`;
}

function svgBike(x, y) {
  return `<g fill="none" stroke="#d7e4f5" stroke-width="1.6">
    <circle cx="${x - 10}" cy="${y + 6}" r="7"/>
    <circle cx="${x + 10}" cy="${y + 6}" r="7"/>
    <path d="M${x - 10} ${y + 6} L${x - 2} ${y - 4} L${x + 8} ${y - 4} L${x + 10} ${y + 6}"/>
    <path d="M${x - 2} ${y - 4} L${x - 6} ${y - 10} M${x + 4} ${y - 4} L${x + 2} ${y - 10} L${x + 8} ${y - 10}"/>
  </g>`;
}

function svgStar(x, y) {
  const r = 10;
  const pts = [];
  for (let i = 0; i < 5; i += 1) {
    const a = (-Math.PI / 2) + (i * 2 * Math.PI) / 5;
    pts.push([x + Math.cos(a) * r, y + Math.sin(a) * r]);
    const b = a + Math.PI / 5;
    pts.push([x + Math.cos(b) * r * 0.42, y + Math.sin(b) * r * 0.42]);
  }
  return `<polygon points="${pts.map((p) => p.join(",")).join(" ")}" fill="#d4af37" stroke="#f3d77a" stroke-width="0.8"/>`;
}

function makeHumanCheck() {
  pruneHumanChecks();
  const kinds = [
    { type: "signs", prompt: "How many stop signs are in the picture?", draw: svgStopSign },
    { type: "bikes", prompt: "How many bicycles are in the picture?", draw: svgBike },
    { type: "stars", prompt: "How many stars are in the picture?", draw: svgStar },
  ];
  const kind = kinds[crypto.randomInt(0, kinds.length)];
  const count = crypto.randomInt(4, 9);
  const decoys = crypto.randomInt(1, 4);
  const decoyDraw = kinds.filter((k) => k.type !== kind.type)[crypto.randomInt(0, 2)].draw;
  const spots = scatterPoints(count + decoys);
  const items = [
    ...spots.slice(0, count).map((p) => ({ ...p, draw: kind.draw })),
    ...spots.slice(count).map((p) => ({ ...p, draw: decoyDraw })),
  ];
  const art = items.map((p) => p.draw(p.x, p.y)).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 280 140" role="img">${art}</svg>`;
  const checkId = id("hum");
  humanChecks.set(checkId, { answer: count, expires: Date.now() + 10 * 60 * 1000 });
  return { id: checkId, prompt: kind.prompt, svg };
}

function checkHumanAnswer(checkId, answer) {
  pruneHumanChecks();
  const row = humanChecks.get(String(checkId || ""));
  if (!row) return false;
  return Number(answer) === row.answer;
}

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

function tokenPayload(req) {
  return readToken(req.headers.authorization);
}

function auth(req, res, next) {
  const payload = tokenPayload(req);
  if (!payload) return res.status(401).json({ error: "Unauthorized" });
  const db = loadDb();
  const user = db.staff.find((s) => s.id === payload.sid);
  if (!user) return res.status(401).json({ error: "Unauthorized" });
  if (payload.kind && payload.kind !== "staff") return res.status(401).json({ error: "Unauthorized" });
  req.user = user;
  req.rank = getPerms(db, user.rank);
  next();
}

function citizenAuth(req, res, next) {
  const payload = tokenPayload(req);
  if (!payload) return res.status(401).json({ error: "Sign in required" });
  const db = loadDb();
  const user = (db.civilians || []).find((s) => s.id === payload.sid);
  if (!user) return res.status(401).json({ error: "Sign in required" });
  req.civilian = user;
  next();
}

function requirePerm(key) {
  return (req, res, next) => {
    if (!req.rank[key]) return res.status(403).json({ error: "Insufficient rank" });
    next();
  };
}

function staffPayload(user, db) {
  const permissions = getPerms(db, user.rank);
  return {
    staff: {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      rank: user.rank,
      rankLabel: permissions.label,
      discord: user.discord || "",
      unitCode: user.unitCode || "",
    },
    permissions,
  };
}

const loginHits = new Map();
function tooManyTries(key, max = 8, windowMs = 15 * 60 * 1000) {
  const now = Date.now();
  const row = loginHits.get(key) || [];
  const fresh = row.filter((t) => now - t < windowMs);
  fresh.push(now);
  loginHits.set(key, fresh);
  return fresh.length > max;
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isDiscordId(value) {
  return /^\d{17,20}$/.test(String(value || "").trim());
}

function normalizeStanding(value) {
  const v = String(value || "").toLowerCase();
  return v === "whitelist" || v === "other" ? v : "";
}

function smtpConfig(db) {
  const s = db.settings?.smtp || {};
  return {
    host: process.env.PD_SMTP_HOST || s.host || "",
    port: Number(process.env.PD_SMTP_PORT || s.port || 587),
    user: process.env.PD_SMTP_USER || s.user || "",
    pass: process.env.PD_SMTP_PASS || s.pass || "",
    from: process.env.PD_SMTP_FROM || s.from || s.user || "",
    secure: String(process.env.PD_SMTP_SECURE || s.secure ? "1" : "") === "1" || Number(s.port) === 465,
  };
}

async function sendMail(db, to, subject, text, html) {
  const cfg = smtpConfig(db);
  if (!cfg.host || !cfg.user || !cfg.pass) {
    const err = new Error("Email is not configured yet. Chief/Deputy must save SMTP in Staff desk → Access, then try again.");
    err.status = 400;
    throw err;
  }
  const nodemailer = require("nodemailer");
  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure || cfg.port === 465,
    auth: { user: cfg.user, pass: cfg.pass },
  });
  await transporter.sendMail({
    from: `"Axel Town PD" <${cfg.from || cfg.user}>`,
    to,
    subject,
    text,
    html: html || `<pre style="font-family:Arial,sans-serif;white-space:pre-wrap;line-height:1.7">${text.replace(/</g, "&lt;")}</pre>`,
  });
}

function mailLayout(title, innerHtml, innerText) {
  const html = `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#0b1220;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0b1220;padding:28px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;background:#121c30;border:1px solid #d4af37;border-collapse:collapse;">
          <tr>
            <td style="padding:22px 28px;border-bottom:1px solid #d4af37;font-family:Arial,sans-serif;color:#d4af37;letter-spacing:3px;font-size:13px;text-transform:uppercase;">
              Axel Town Police Department
            </td>
          </tr>
          <tr>
            <td style="padding:28px;font-family:Arial,sans-serif;color:#e8eef6;font-size:16px;line-height:1.75;">
              <h1 style="margin:0 0 16px;font-size:22px;color:#f3d77a;font-weight:700;">${title}</h1>
              ${innerHtml}
              <p style="margin:28px 0 0;font-size:13px;color:#8ea0b8;line-height:1.7;">
                If this is not in your main inbox, check Spam / Junk / Promotions.<br/>
                Axel Town PD · Los Santos
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  const text = `Axel Town Police Department\n\n${title}\n\n${innerText}\n\nIf this is not in your main inbox, check Spam / Junk / Promotions.`;
  return { html, text };
}

function discordBotToken(db) {
  return process.env.PD_DISCORD_BOT || db.settings?.discordBotToken || "";
}

async function sendDiscordDm(db, discordId, content) {
  const token = discordBotToken(db);
  if (!token) return { sent: false, reason: "no_bot" };
  if (!isDiscordId(discordId)) return { sent: false, reason: "no_id" };
  try {
    const chRes = await fetch("https://discord.com/api/v10/users/@me/channels", {
      method: "POST",
      headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ recipient_id: discordId }),
    });
    if (!chRes.ok) return { sent: false, reason: chRes.status === 403 ? "cannot_dm" : "channel_failed" };
    const channel = await chRes.json();
    const msgRes = await fetch(`https://discord.com/api/v10/channels/${channel.id}/messages`, {
      method: "POST",
      headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    return { sent: msgRes.ok, reason: msgRes.ok ? null : "message_failed" };
  } catch {
    return { sent: false, reason: "error" };
  }
}

async function notifyAcceptance(db, item, kind) {
  const civ = (db.civilians || []).find((c) => c.id === item.civilianId);
  const discordId = civ?.discordId || "";
  const content = discordMessages(db)[kind];
  if (!content) return { sent: false, reason: "no_message" };
  return sendDiscordDm(db, discordId, content);
}

async function verifyDiscordAccount(db, discordId, username) {
  if (!isDiscordId(discordId)) {
    return { ok: false, error: "Discord user ID must be the 17–20 digit ID. In Discord: Settings → Advanced → Developer Mode, then right-click your name → Copy User ID." };
  }
  const token = discordBotToken(db);
  if (!token) return { ok: true, verified: false };
  try {
    const res = await fetch(`https://discord.com/api/v10/users/${discordId}`, {
      headers: { Authorization: `Bot ${token}` },
    });
    if (res.status === 404) return { ok: false, error: "No Discord account exists with that user ID." };
    if (!res.ok) return { ok: true, verified: false };
    const u = await res.json();
    const want = String(username || "").toLowerCase().replace(/^@/, "");
    const names = [u.username, u.global_name, u.display_name].filter(Boolean).map((x) => String(x).toLowerCase());
    if (want && names.length && !names.includes(want)) {
      return { ok: false, error: "That Discord username does not match the user ID." };
    }
    return { ok: true, verified: true };
  } catch {
    return { ok: true, verified: false };
  }
}

function consumeEmailCode(db, email, code) {
  const now = Date.now();
  db.emailCodes = (db.emailCodes || []).filter((c) => c.exp > now);
  const row = db.emailCodes.find((c) => c.email === email);
  if (!row) return false;
  if (!verifyPassword(String(code || ""), row.hash)) return false;
  db.emailCodes = db.emailCodes.filter((c) => c.email !== email);
  return true;
}

function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "")
    .split(",")[0]
    .trim();
}

function normalizeDiscord(value) {
  return String(value || "")
    .trim()
    .replace(/^@/, "")
    .toLowerCase();
}

function makeInvite() {
  const chunk = () => crypto.randomBytes(3).toString("hex").toUpperCase();
  return `AXEL-${chunk()}-${chunk()}-${chunk()}`;
}

app.get("/api/meta", (_req, res) => {
  const db = loadDb();
  res.json({
    department: "Axel Town Police Department",
    city: "Los Santos",
    trainingDays: ["Thursday", "Saturday"],
    ranks: (db.ranks || []).sort((a, b) => a.order - b.order),
  });
});

app.post("/api/auth/login", (req, res) => {
  const { username, password, discord, rank, unitCode } = req.body || {};
  const ip = clientIp(req);
  if (tooManyTries(`staff:${ip}`)) return res.status(429).json({ error: "Too many sign-in tries. Wait 15 minutes." });
  const db = loadDb();
  const user = db.staff.find((s) => s.username.toLowerCase() === String(username || "").toLowerCase());
  if (!user || !verifyPassword(String(password || ""), user.password)) {
    return res.status(401).json({ error: "Invalid credentials" });
  }
  const disc = normalizeDiscord(discord);
  if (!disc) return res.status(400).json({ error: "Discord username is required" });
  if (user.discord && normalizeDiscord(user.discord) !== disc) {
    return res.status(401).json({ error: "Discord username does not match this staff file" });
  }
  if (!user.discord) user.discord = disc;
  if (!rank || rank !== user.rank) {
    return res.status(401).json({ error: "Selected rank does not match your issued rank" });
  }
  const code = String(unitCode || "").trim().toUpperCase();
  if (!code) return res.status(400).json({ error: "Unit code is required" });
  if ((user.unitCode || "").toUpperCase() !== code) {
    return res.status(401).json({ error: "Unit code does not match this officer file" });
  }
  saveDb(db);
  const token = signToken({ sid: user.id, kind: "staff", exp: Date.now() + TOKEN_TTL_MS });
  res.json({ token, ...staffPayload(user, db) });
});

app.get("/api/auth/me", auth, (req, res) => {
  res.json(staffPayload(req.user, loadDb()));
});

function citizenPayload(user, db) {
  const appItem = latestAppForUser(db, user.id);
  const cool = reapplyState(user, db);
  return {
    civilian: {
      id: user.id,
      username: user.username,
      discord: user.discord || "",
      discordId: user.discordId || "",
      standing: user.standing || "",
      email: user.email || "",
    },
    application: appItem ? publicApplication(appItem, db) : null,
    cooldown: cool,
    canApply: (() => {
      if (!appItem) return !cool.blocked;
      if (["pending", "accepted", "final_accepted", "rejected"].includes(appItem.status)) return false;
      if (appItem.status === "final_rejected") return !cool.blocked;
      return false;
    })(),
  };
}

app.post("/api/verify/email", async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    if (!isEmail(email)) return res.status(400).json({ error: "Enter a valid email first" });
    const ip = clientIp(req);
    if (tooManyTries(`mail:${ip}:${email}`, 5, 30 * 60 * 1000)) {
      return res.status(429).json({ error: "Too many codes sent. Wait before requesting another." });
    }
    const db = loadDb();
    if ((db.civilians || []).some((c) => normalizeEmail(c.email) === email)) {
      return res.status(409).json({ error: "This email is already used. Sign in instead." });
    }
    const code = `ATPD-${crypto.randomInt(100000, 1000000)}`;
    db.emailCodes = (db.emailCodes || []).filter((c) => c.email !== email);
    db.emailCodes.push({
      email,
      hash: hashPassword(code),
      exp: Date.now() + 10 * 60 * 1000,
      createdAt: new Date().toISOString(),
    });
    saveDb(db);
    const packed = mailLayout(
      "Your verification code",
      `<p style="margin:0 0 18px;">Use this code on the Axel Town PD apply page. It expires in 10 minutes.</p>
       <p style="margin:0 0 10px;font-size:13px;color:#8ea0b8;text-transform:uppercase;letter-spacing:2px;">Code</p>
       <p style="margin:0;padding:16px 18px;background:#0b1220;border:1px solid #d4af37;color:#f3d77a;font-size:28px;letter-spacing:4px;font-weight:700;">${code}</p>
       <p style="margin:18px 0 0;">Type it in the box under Email. Check Spam if you do not see this message.</p>`,
      `Use this code on the Axel Town PD apply page. It expires in 10 minutes.\n\nCODE: ${code}\n\nType it in the box under Email.`
    );
    await sendMail(db, email, `Axel Town PD code ${code}`, packed.text, packed.html);
    res.json({ ok: true, sent: true, email });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Could not send email" });
  }
});

app.get("/api/citizen/human-check", (_req, res) => {
  res.json(makeHumanCheck());
});

app.post("/api/citizen/register", async (req, res) => {
  try {
    const username = String(req.body?.username || "").trim();
    const password = String(req.body?.password || "");
    const email = normalizeEmail(req.body?.email);
    const emailCode = String(req.body?.emailCode || "").trim();
    const discord = normalizeDiscord(req.body?.discord);
    const discordId = String(req.body?.discordId || "").trim();
    const standing = normalizeStanding(req.body?.standing);
    const oath = Boolean(req.body?.oath);
    const notReboot = Boolean(req.body?.notReboot);
    const deviceId = String(req.body?.deviceId || "").trim().slice(0, 80);
    if (!isEmail(email)) return res.status(400).json({ error: "Email is required" });
    if (!emailCode) return res.status(400).json({ error: "Email verification code is required" });
    if (username.length < 3 || password.length < 6) {
      return res.status(400).json({ error: "Username (3+) and password (6+) are required" });
    }
    if (!discord || discord.length < 2) return res.status(400).json({ error: "Discord username is required" });
    if (!standing) return res.status(400).json({ error: "Choose whitelist or other" });
    if (!notReboot) return res.status(400).json({ error: "Confirm you are not a reboot" });
    if (!checkHumanAnswer(req.body?.humanCheckId, req.body?.humanCheckAnswer)) {
      return res.status(400).json({ error: "Human check failed. Count the items in the picture again." });
    }
    if (!oath) return res.status(400).json({ error: "You must confirm one account only" });
    const db = loadDb();
    if (!consumeEmailCode(db, email, emailCode)) {
      return res.status(400).json({ error: "Invalid or expired email code. Request a new one." });
    }
    const discCheck = await verifyDiscordAccount(db, discordId, discord);
    if (!discCheck.ok) return res.status(400).json({ error: discCheck.error });
    if (!db.civilians) db.civilians = [];
    const ip = clientIp(req);
    if (ip && db.civilians.some((c) => c.ip === ip)) {
      return res.status(409).json({ error: "An account was already created from this network. Sign in instead." });
    }
    if (deviceId && db.civilians.some((c) => c.deviceId && c.deviceId === deviceId)) {
      return res.status(409).json({ error: "This device already has an account. Sign in instead." });
    }
    if (db.civilians.some((c) => normalizeDiscord(c.discord) === discord) || db.staff.some((s) => normalizeDiscord(s.discord) === discord)) {
      return res.status(409).json({ error: "This Discord is already linked to an account. Sign in instead." });
    }
    if (db.civilians.some((c) => c.discordId === discordId) || db.staff.some((s) => s.discordId === discordId)) {
      return res.status(409).json({ error: "This Discord user ID is already linked. Sign in instead." });
    }
    if (db.civilians.some((c) => normalizeEmail(c.email) === email)) {
      return res.status(409).json({ error: "This email is already used. Sign in instead." });
    }
    const taken =
      db.civilians.some((c) => c.username.toLowerCase() === username.toLowerCase()) ||
      db.staff.some((s) => s.username.toLowerCase() === username.toLowerCase());
    if (taken) return res.status(409).json({ error: "Account already exists. Sign in instead." });
    humanChecks.delete(String(req.body?.humanCheckId || ""));
    const user = {
      id: id("civ"),
      username,
      email,
      discord,
      discordId,
      standing,
      icName: "",
      password: hashPassword(password),
      createdAt: new Date().toISOString(),
      reapplyAt: null,
      ip,
      deviceId: deviceId || null,
    };
    db.civilians.push(user);
    saveDb(db);
    const token = signToken({ sid: user.id, kind: "citizen", exp: Date.now() + TOKEN_TTL_MS });
    res.json({ token, ...citizenPayload(user, db), discordVerified: Boolean(discCheck.verified) });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Could not create account" });
  }
});

app.post("/api/citizen/login", async (req, res) => {
  try {
    const username = String(req.body?.username || "").trim();
    const password = String(req.body?.password || "");
    const email = normalizeEmail(req.body?.email);
    const discord = normalizeDiscord(req.body?.discord);
    const discordId = String(req.body?.discordId || "").trim();
    const standing = normalizeStanding(req.body?.standing);
    const ip = clientIp(req);
    if (tooManyTries(`civ:${ip}`)) return res.status(429).json({ error: "Too many sign-in tries. Wait 15 minutes." });
    const db = loadDb();
    const user = (db.civilians || []).find((c) => c.username.toLowerCase() === username.toLowerCase());
    if (!user || !verifyPassword(password, user.password)) {
      return res.status(401).json({ error: "Invalid username or password" });
    }
    if (!isEmail(email) || !discord || !isDiscordId(discordId) || !standing) {
      return res.status(400).json({ error: "Email, Discord username, Discord user ID, and whitelist/other are required" });
    }
    if (user.email && normalizeEmail(user.email) !== email) {
      return res.status(401).json({ error: "Email does not match this account" });
    }
    if (user.discord && normalizeDiscord(user.discord) !== discord) {
      return res.status(401).json({ error: "Discord username does not match this account" });
    }
    if (user.discordId && user.discordId !== discordId) {
      return res.status(401).json({ error: "Discord user ID does not match this account" });
    }
    if (user.standing && user.standing !== standing) {
      return res.status(401).json({ error: "Whitelist/other does not match this account" });
    }
    const discCheck = await verifyDiscordAccount(db, discordId, discord);
    if (!discCheck.ok) return res.status(400).json({ error: discCheck.error });
    if (!user.email) user.email = email;
    if (!user.discord) user.discord = discord;
    if (!user.discordId) user.discordId = discordId;
    if (!user.standing) user.standing = standing;
    saveDb(db);
    const token = signToken({ sid: user.id, kind: "citizen", exp: Date.now() + TOKEN_TTL_MS });
    res.json({ token, ...citizenPayload(user, db) });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Sign in failed" });
  }
});

app.get("/api/citizen/me", citizenAuth, (req, res) => {
  res.json(citizenPayload(req.civilian, loadDb()));
});

app.get("/api/settings", auth, requirePerm("canSettings"), (_req, res) => {
  const db = loadDb();
  const smtp = smtpConfig(db);
  res.json({
    reapplyCooldownHours: cooldownHours(db),
    maxHours: 168,
    smtp: {
      host: smtp.host,
      port: smtp.port,
      user: smtp.user,
      from: smtp.from,
      configured: Boolean(smtp.host && smtp.user && smtp.pass),
    },
    discordBotConfigured: Boolean(discordBotToken(db)),
    discordMessages: discordMessages(db),
    training: trainingSettings(db),
    inviteCodes: (db.inviteCodes || []).map((c) => ({
      id: c.id,
      code: c.code,
      used: Boolean(c.used),
      usedBy: c.usedBy || null,
      createdAt: c.createdAt,
    })),
  });
});

app.put("/api/settings", auth, requirePerm("canSettings"), (req, res) => {
  const hours = Number(req.body?.reapplyCooldownHours);
  if (!Number.isFinite(hours) || hours < 1 || hours > 168) {
    return res.status(400).json({ error: "Cooldown must be between 1 and 168 hours (7 days)" });
  }
  const db = loadDb();
  db.settings = db.settings || {};
  db.settings.reapplyCooldownHours = Math.round(hours);
  saveDb(db);
  res.json({ reapplyCooldownHours: db.settings.reapplyCooldownHours, maxHours: 168 });
});

app.put("/api/settings/mail", auth, requirePerm("canSettings"), async (req, res) => {
  const db = loadDb();
  db.settings = db.settings || {};
  const prev = db.settings.smtp || {};
  const host = String(req.body?.host || "").trim();
  const port = Number(req.body?.port || 587);
  const user = String(req.body?.user || "").trim();
  const from = String(req.body?.from || user).trim();
  const pass = String(req.body?.pass || "");
  db.settings.smtp = {
    host,
    port: Number.isFinite(port) ? port : 587,
    user,
    from,
    pass: pass || prev.pass || "",
    secure: port === 465,
  };
  saveDb(db);
  res.json({ ok: true, configured: Boolean(host && user && db.settings.smtp.pass) });
});

app.put("/api/settings/discord-bot", auth, requirePerm("canSettings"), (req, res) => {
  const db = loadDb();
  db.settings = db.settings || {};
  const token = String(req.body?.token || "").trim();
  if (token) db.settings.discordBotToken = token;
  saveDb(db);
  res.json({ ok: true, discordBotConfigured: Boolean(discordBotToken(db)) });
});

app.put("/api/settings/discord-messages", auth, requirePerm("canSettings"), (req, res) => {
  const db = loadDb();
  db.settings = db.settings || {};
  const fallback = defaultDiscordMessages();
  const accepted = String(req.body?.accepted || "").trim() || fallback.accepted;
  const finalAccepted = String(req.body?.final_accepted || "").trim() || fallback.final_accepted;
  const finalRejected = String(req.body?.final_rejected || "").trim() || fallback.final_rejected;
  db.settings.discordMessages = {
    accepted: accepted.slice(0, 1800),
    final_accepted: finalAccepted.slice(0, 1800),
    final_rejected: finalRejected.slice(0, 1800),
  };
  saveDb(db);
  res.json({ ok: true, discordMessages: discordMessages(db) });
});

app.put("/api/settings/training", auth, requirePerm("canSettings"), (req, res) => {
  const db = loadDb();
  db.settings = db.settings || {};
  const location = String(req.body?.location || "").trim();
  const when = String(req.body?.when || "").trim();
  const message = String(req.body?.message || "").trim();
  if (!location || !when || !message) {
    return res.status(400).json({ error: "Place, when, and message are required" });
  }
  db.settings.training = {
    location: location.slice(0, 200),
    when: when.slice(0, 200),
    message: message.slice(0, 800),
  };
  saveDb(db);
  res.json({ ok: true, training: trainingSettings(db) });
});

app.post("/api/settings/mail/test", auth, requirePerm("canSettings"), async (req, res) => {
  try {
    const to = normalizeEmail(req.body?.to);
    if (!isEmail(to)) return res.status(400).json({ error: "Enter a test email" });
    const db = loadDb();
    const packed = mailLayout(
      "SMTP test",
      `<p style="margin:0 0 14px;">This is a test from Axel Town PD.</p>
       <p style="margin:0 0 14px;">Email sending works. Apply accounts can now receive a verification code.</p>
       <p style="margin:0;">This test does not include a login code. Codes are sent only when someone clicks Send verification code on Apply.</p>`,
      "This is a test from Axel Town PD.\n\nEmail sending works. Apply accounts can now receive a verification code.\n\nThis test does not include a login code."
    );
    await sendMail(db, to, "Axel Town PD — email test", packed.text, packed.html);
    res.json({ ok: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Send failed" });
  }
});

app.post("/api/invites", auth, requirePerm("canSettings"), (req, res) => {
  const db = loadDb();
  const item = {
    id: id("inv"),
    code: makeInvite(),
    used: false,
    createdAt: new Date().toISOString(),
    createdBy: req.user.displayName,
  };
  db.inviteCodes.unshift(item);
  saveDb(db);
  res.json(item);
});


app.get("/api/ranks", auth, (_req, res) => {
  const db = loadDb();
  res.json(db.ranks.sort((a, b) => a.order - b.order));
});

app.put("/api/ranks", auth, requirePerm("canRenameRanks"), (req, res) => {
  const incoming = req.body?.ranks;
  if (!Array.isArray(incoming) || incoming.length !== 22) {
    return res.status(400).json({ error: "Exactly 22 ranks are required" });
  }
  const db = loadDb();
  db.ranks = db.ranks.map((r) => {
    const next = incoming.find((x) => x.id === r.id);
    if (next && next.label) r.label = String(next.label).trim().slice(0, 48);
    return r;
  });
  saveDb(db);
  res.json(db.ranks.sort((a, b) => a.order - b.order));
});

app.get("/api/protocols", (_req, res) => {
  const db = loadDb();
  res.json(db.protocols.sort((a, b) => a.code.localeCompare(b.code)));
});

app.post("/api/protocols", auth, requirePerm("canContent"), (req, res) => {
  const { code, title, body } = req.body || {};
  if (!code || !title || !body) return res.status(400).json({ error: "Code, title, and body are required" });
  const db = loadDb();
  const item = { id: id("prot"), code: String(code).trim(), title: String(title).trim(), body: String(body).trim(), updatedAt: new Date().toISOString() };
  db.protocols.push(item);
  saveDb(db);
  res.json(item);
});

app.delete("/api/protocols/:id", auth, requirePerm("canContent"), (req, res) => {
  const db = loadDb();
  db.protocols = db.protocols.filter((p) => p.id !== req.params.id);
  saveDb(db);
  res.json({ ok: true });
});

app.get("/api/rules", (_req, res) => {
  const db = loadDb();
  res.json((db.rules || []).sort((a, b) => a.code.localeCompare(b.code)));
});

app.post("/api/rules", auth, requirePerm("canContent"), (req, res) => {
  const { code, title, body } = req.body || {};
  if (!code || !title || !body) return res.status(400).json({ error: "Code, title, and body are required" });
  const db = loadDb();
  if (!db.rules) db.rules = [];
  const item = { id: id("rule"), code: String(code).trim(), title: String(title).trim(), body: String(body).trim(), updatedAt: new Date().toISOString() };
  db.rules.push(item);
  saveDb(db);
  res.json(item);
});

app.delete("/api/rules/:id", auth, requirePerm("canContent"), (req, res) => {
  const db = loadDb();
  db.rules = (db.rules || []).filter((p) => p.id !== req.params.id);
  saveDb(db);
  res.json({ ok: true });
});

app.post("/api/applications", citizenAuth, (req, res) => {
  const a = req.body || {};
  for (const key of APPLY_FIELDS) {
    if (!a[key] && a[key] !== false) return res.status(400).json({ error: `Missing field: ${key}` });
  }
  if (a.oath !== true) return res.status(400).json({ error: "You must accept the oath" });
  const db = loadDb();
  const civ = db.civilians.find((c) => c.id === req.civilian.id);
  const existing = latestAppForUser(db, civ.id);
  const cool = reapplyState(civ, db);
  if (existing && ["pending", "accepted", "rejected", "final_accepted"].includes(existing.status)) {
    return res.status(400).json({ error: "You already have an open file. Wait for command." });
  }
  if (existing && existing.status === "final_rejected" && cool.blocked) {
    const hours = Math.ceil(cool.remainingMs / 3600000);
    return res.status(400).json({ error: `Cooldown active. You may apply again in about ${hours} hour(s).` });
  }
  const item = {
    id: id("app"),
    civilianId: civ.id,
    accountUsername: civ.username,
    icName: String(a.icName).trim(),
    oocName: String(a.oocName || "").trim(),
    age: String(a.age).trim(),
    whyJoin: String(a.whyJoin).trim(),
    priorLeo: String(a.priorLeo).trim(),
    availability: String(a.availability).trim(),
    character: String(a.character).trim(),
    useOfForce: String(a.useOfForce).trim(),
    trafficStop: String(a.trafficStop).trim(),
    chainOfCommand: String(a.chainOfCommand).trim(),
    backup: String(a.backup).trim(),
    bribe: String(a.bribe).trim(),
    status: "pending",
    notice: "",
    commandNote: "",
    createdAt: new Date().toISOString(),
  };
  db.applications.unshift(item);
  saveDb(db);
  res.json({ application: publicApplication(item, db), next: "training" });
});

app.get("/api/applications/public/:id", (req, res) => {
  const db = loadDb();
  const item = db.applications.find((a) => a.id === req.params.id);
  if (!item) return res.status(404).json({ error: "Not found" });
  res.json(publicApplication(item, db));
});

app.get("/api/applications", auth, requirePerm("canReview"), (req, res) => {
  const db = loadDb();
  const status = req.query.status;
  let list = db.applications;
  if (status) list = list.filter((a) => a.status === status);
  res.json(
    list.map((a) => {
      const civ = (db.civilians || []).find((c) => c.id === a.civilianId);
      return {
        ...a,
        accountUsername: a.accountUsername || civ?.username || "",
        cooldown: civ ? reapplyState(civ, db) : { blocked: false },
        hasBooking: Boolean((db.bookings || []).find((b) => b.applicationId === a.id)),
        booking: (db.bookings || []).find((b) => b.applicationId === a.id) || null,
      };
    })
  );
});

app.patch("/api/applications/:id", auth, requirePerm("canReview"), async (req, res) => {
  const action = String(req.body?.action || req.body?.status || "");
  const db = loadDb();
  const item = db.applications.find((a) => a.id === req.params.id);
  if (!item) return res.status(404).json({ error: "Not found" });
  if (item.status === "final_rejected" && action !== "waive_cooldown") {
    return res.status(400).json({ error: "Final rejection cannot be reversed. Lift the cooldown if they may reapply." });
  }
  if (item.status === "final_accepted") return res.status(400).json({ error: "Final acceptance is locked" });

  let notifyKind = "";
  if (action === "accepted" || action === "accept") {
    if (!["pending", "rejected"].includes(item.status)) {
      return res.status(400).json({ error: "Preliminary accept is only for pending or rejected files" });
    }
    item.status = "accepted";
    item.notice = NOTICE.accepted;
    notifyKind = "accepted";
  } else if (action === "rejected" || action === "reject") {
    if (item.status !== "pending") return res.status(400).json({ error: "Use final reject from the rejected tray" });
    item.status = "rejected";
    item.notice = NOTICE.rejected;
  } else if (action === "final_reject" || action === "final_rejected") {
    if (!["rejected", "accepted"].includes(item.status)) {
      return res.status(400).json({ error: "Final reject is only after a preliminary reject or a preliminary accept" });
    }
    item.status = "final_rejected";
    item.notice = NOTICE.final_rejected;
    const hours = cooldownHours(db);
    const civ = db.civilians.find((c) => c.id === item.civilianId);
    if (civ) civ.reapplyAt = new Date(Date.now() + hours * 3600000).toISOString();
    db.bookings = (db.bookings || []).filter((b) => b.applicationId !== item.id);
    notifyKind = "final_rejected";
  } else if (action === "waive_cooldown") {
    if (item.status !== "final_rejected") return res.status(400).json({ error: "Lift is only for a final rejection" });
    const civ = db.civilians.find((c) => c.id === item.civilianId);
    if (civ) civ.reapplyAt = null;
    item.notice = "Cooldown lifted. This person may file a new application now.";
  } else if (action === "final_accept" || action === "final_accepted") {
    if (!req.rank.canFinalAccept) return res.status(403).json({ error: "Only the Chief of Police can issue final acceptance" });
    if (item.status !== "accepted") return res.status(400).json({ error: "Final accept is only after preliminary accept" });
    const booked = (db.bookings || []).find((b) => b.applicationId === item.id);
    if (!booked) return res.status(400).json({ error: "Final accept is only after the cadet reserved a training day" });
    item.status = "final_accepted";
    item.notice = NOTICE.final_accepted;
    notifyKind = "final_accepted";
  } else {
    return res.status(400).json({ error: "Unknown action" });
  }

  item.reviewedBy = req.user.displayName;
  item.reviewedAt = new Date().toISOString();
  saveDb(db);
  let discordNotify = { sent: false };
  if (notifyKind) discordNotify = await notifyAcceptance(db, item, notifyKind);
  res.json({ ...item, discordNotify });
});

app.get("/api/training/slots", (req, res) => {
  const year = Number(req.query.year);
  const month = Number(req.query.month);
  if (!year || !month || month < 1 || month > 12) {
    return res.status(400).json({ error: "year and month required" });
  }
  const db = loadDb();
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const today = formatYmd(new Date());
  const weeksMap = new Map();
  for (let day = 1; day <= last; day++) {
    const date = utcDate(year, month, day);
    if (!isThuOrSat(date)) continue;
    const ymd = formatYmd(date);
    const taken = db.bookings.filter((b) => b.date === ymd).length;
    const week = Math.ceil(day / 7);
    const slot = {
      date: ymd,
      weekday: date.getUTCDay() === 4 ? "Thursday" : "Saturday",
      day,
      seats: Math.max(0, 8 - taken),
      past: ymd < today,
    };
    if (!weeksMap.has(week)) weeksMap.set(week, []);
    weeksMap.get(week).push(slot);
  }
  const weeks = [...weeksMap.entries()].map(([week, slots]) => ({ week, slots }));
  res.json({ year, month, weeks, trainingTime: "20:00" });
});

app.post("/api/training/book", citizenAuth, (req, res) => {
  const { date } = req.body || {};
  if (!date) return res.status(400).json({ error: "date required" });
  const db = loadDb();
  const application = latestAppForUser(db, req.civilian.id);
  if (!application) return res.status(404).json({ error: "Application not found. Submit an application first." });
  if (application.status === "final_rejected") return res.status(400).json({ error: "This file is closed." });
  if (!["accepted", "final_accepted"].includes(application.status)) {
    return res.status(400).json({ error: "Your request is under review. You may pick a training day after a preliminary accept." });
  }
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || !isThuOrSat(parsed)) {
    return res.status(400).json({ error: "Training is only on Thursday and Saturday." });
  }
  if (formatYmd(parsed) < formatYmd(new Date())) {
    return res.status(400).json({ error: "That date has already passed." });
  }
  db.bookings = db.bookings.filter((b) => b.applicationId !== application.id);
  const taken = db.bookings.filter((b) => b.date === date).length;
  if (taken >= 8) return res.status(400).json({ error: "This session is full. Choose another date." });
  const booking = {
    id: id("bk"),
    applicationId: application.id,
    date,
    weekday: parsed.getUTCDay() === 4 ? "Thursday" : "Saturday",
    time: "20:00",
    discord: application.accountUsername,
    icName: application.icName,
    createdAt: new Date().toISOString(),
  };
  db.bookings.push(booking);
  saveDb(db);
  res.json({
    ...booking,
    canAttend: application.status === "final_accepted",
    notice:
      application.status === "final_accepted"
        ? NOTICE.final_accepted
        : "Slot reserved. You may attend only after the Chief of Police issues final acceptance.",
  });
});

app.get("/api/training/bookings", auth, requirePerm("canTraining"), (_req, res) => {
  const db = loadDb();
  const apps = Object.fromEntries(db.applications.map((a) => [a.id, a]));
  res.json(
    db.bookings
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((b) => ({
        ...b,
        status: apps[b.applicationId]?.status || "unknown",
        canAttend: apps[b.applicationId]?.status === "final_accepted",
      }))
  );
});

app.get("/api/staff", auth, requirePerm("canStaff"), (_req, res) => {
  const db = loadDb();
  res.json(
    db.staff.map((s) => ({
      id: s.id,
      username: s.username,
      displayName: s.displayName,
      rank: s.rank,
      rankLabel: rankLabel(db, s.rank),
      discord: s.discord || "",
      unitCode: s.unitCode || "",
      createdAt: s.createdAt,
    }))
  );
});

app.post("/api/staff", auth, requirePerm("canStaff"), (req, res) => {
  const { username, password, displayName, rank, discord } = req.body || {};
  const db = loadDb();
  const disc = normalizeDiscord(discord);
  if (!username || !password || !displayName || !disc || !db.ranks.some((r) => r.id === rank)) {
    return res.status(400).json({ error: "username, password, displayName, discord, and a valid rank are required" });
  }
  if (db.staff.some((s) => s.username.toLowerCase() === username.toLowerCase())) {
    return res.status(400).json({ error: "Username already exists" });
  }
  const user = {
    id: id("staff"),
    username: String(username).trim(),
    displayName: String(displayName).trim(),
    rank,
    discord: disc,
    password: hashPassword(String(password)),
    createdAt: new Date().toISOString(),
  };
  db.staff.push(user);
  saveDb(db);
  res.json({ id: user.id, username: user.username, displayName: user.displayName, rank: user.rank, rankLabel: rankLabel(db, rank) });
});

app.delete("/api/staff/:id", auth, requirePerm("canStaff"), (req, res) => {
  const db = loadDb();
  if (req.params.id === req.user.id) return res.status(400).json({ error: "You cannot remove yourself" });
  db.staff = db.staff.filter((s) => s.id !== req.params.id);
  saveDb(db);
  res.json({ ok: true });
});

app.get("/api/civilians", auth, requirePerm("canStaff"), (_req, res) => {
  const db = loadDb();
  const staffUsernames = new Set(db.staff.map((s) => s.username.toLowerCase()));
  const staffCiv = new Set(db.staff.map((s) => s.civilianId).filter(Boolean));
  res.json(
    (db.civilians || []).map((c) => ({
      id: c.id,
      username: c.username,
      createdAt: c.createdAt,
      hasApplication: Boolean(latestAppForUser(db, c.id)),
      alreadyStaff: staffUsernames.has(c.username.toLowerCase()) || staffCiv.has(c.id),
    }))
  );
});

app.post("/api/staff/commission", auth, requirePerm("canStaff"), (req, res) => {
  const { civilianId, username, password, displayName, rank, discord, unitCode } = req.body || {};
  const db = loadDb();
  const disc = normalizeDiscord(discord);
  const code = String(unitCode || "").trim().toUpperCase();
  if (!username || !password || !displayName || !disc || !code || !db.ranks.some((r) => r.id === rank)) {
    return res.status(400).json({ error: "username, password, displayName, discord, unit code, and a valid rank are required" });
  }
  if (!/^[A-Z0-9]{3,8}$/.test(code)) {
    return res.status(400).json({ error: "Unit code must be 3–8 letters or numbers, like F0A1" });
  }
  const civ = civilianId ? (db.civilians || []).find((c) => c.id === civilianId) : null;
  if (civilianId && !civ) return res.status(404).json({ error: "Registered account not found" });
  if (civ && db.staff.some((s) => s.civilianId === civ.id)) {
    return res.status(400).json({ error: "This person already has a staff login" });
  }
  if (db.staff.some((s) => s.username.toLowerCase() === String(username).toLowerCase())) {
    return res.status(400).json({ error: "Staff username already exists" });
  }
  if (db.staff.some((s) => normalizeDiscord(s.discord) === disc)) {
    return res.status(400).json({ error: "This Discord is already linked to a staff login" });
  }
  if (db.staff.some((s) => (s.unitCode || "").toUpperCase() === code)) {
    return res.status(400).json({ error: "This unit code is already issued" });
  }
  const user = {
    id: id("staff"),
    username: String(username).trim(),
    displayName: String(displayName).trim(),
    rank,
    discord: disc,
    unitCode: code,
    civilianId: civ?.id || null,
    password: hashPassword(String(password)),
    createdAt: new Date().toISOString(),
  };
  db.staff.push(user);
  saveDb(db);
  res.json({
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    rank: user.rank,
    rankLabel: rankLabel(db, rank),
    discord: disc,
    unitCode: code,
    issued: {
      username: user.username,
      password: String(password),
      discord: disc,
      unitCode: code,
      rankLabel: rankLabel(db, rank),
      forAccount: civ?.username || displayName,
    },
  });
});

app.get("/api/officer/desk", auth, (req, res) => {
  const db = loadDb();
  const sid = req.user.id;
  res.json({
    me: staffPayload(req.user, db),
    leaves: (db.leaves || []).filter((x) => x.staffId === sid),
    promotions: (db.promotions || []).filter((x) => x.staffId === sid),
    dutyLogs: (db.dutyLogs || []).filter((x) => x.staffId === sid).slice(0, 20),
    reports: (db.reports || []).filter((x) => x.staffId === sid).slice(0, 20),
    chat: (db.chat || []).slice(-80),
    allLeaves: req.rank.canPersonnel ? db.leaves || [] : [],
    allPromotions: req.rank.canApprovePromo || req.rank.canPersonnel ? db.promotions || [] : [],
  });
});

app.post("/api/officer/leave", auth, (req, res) => {
  const from = String(req.body?.from || "").trim();
  const to = String(req.body?.to || "").trim();
  const reason = String(req.body?.reason || "").trim();
  if (!from || !to || !reason) return res.status(400).json({ error: "From, to, and reason are required" });
  const db = loadDb();
  const item = {
    id: id("lv"),
    staffId: req.user.id,
    name: req.user.displayName,
    rankLabel: rankLabel(db, req.user.rank),
    from,
    to,
    reason,
    status: "pending",
    createdAt: new Date().toISOString(),
  };
  db.leaves.unshift(item);
  saveDb(db);
  res.json(item);
});

app.patch("/api/officer/leave/:id", auth, requirePerm("canPersonnel"), (req, res) => {
  const action = String(req.body?.action || "");
  const db = loadDb();
  const item = (db.leaves || []).find((x) => x.id === req.params.id);
  if (!item) return res.status(404).json({ error: "Not found" });
  if (action === "approve") item.status = "approved";
  else if (action === "deny") item.status = "denied";
  else return res.status(400).json({ error: "Unknown action" });
  item.reviewedBy = req.user.displayName;
  item.reviewedAt = new Date().toISOString();
  saveDb(db);
  res.json(item);
});

app.post("/api/officer/promotion", auth, (req, res) => {
  const targetRank = String(req.body?.targetRank || "");
  const reason = String(req.body?.reason || "").trim();
  const db = loadDb();
  if (!db.ranks.some((r) => r.id === targetRank) || !reason) {
    return res.status(400).json({ error: "Target rank and reason are required" });
  }
  const current = getPerms(db, req.user.rank);
  const next = getPerms(db, targetRank);
  if (next.order <= current.order) return res.status(400).json({ error: "Choose a higher rank than you hold now" });
  const item = {
    id: id("pr"),
    staffId: req.user.id,
    name: req.user.displayName,
    fromRank: req.user.rank,
    fromLabel: current.label,
    targetRank,
    targetLabel: next.label,
    reason,
    status: "pending",
    createdAt: new Date().toISOString(),
  };
  db.promotions.unshift(item);
  saveDb(db);
  res.json(item);
});

app.patch("/api/officer/promotion/:id", auth, (req, res) => {
  if (!req.rank.canApprovePromo) return res.status(403).json({ error: "Only Deputy or Chief can approve promotions" });
  const action = String(req.body?.action || "");
  const db = loadDb();
  const item = (db.promotions || []).find((x) => x.id === req.params.id);
  if (!item) return res.status(404).json({ error: "Not found" });
  if (item.status !== "pending") return res.status(400).json({ error: "Already reviewed" });
  if (action === "approve") {
    item.status = "approved";
    const officer = db.staff.find((s) => s.id === item.staffId);
    if (officer) officer.rank = item.targetRank;
  } else if (action === "deny") {
    item.status = "denied";
  } else {
    return res.status(400).json({ error: "Unknown action" });
  }
  item.reviewedBy = req.user.displayName;
  item.reviewedAt = new Date().toISOString();
  saveDb(db);
  res.json(item);
});

app.post("/api/officer/chat", auth, (req, res) => {
  const text = String(req.body?.text || "").trim();
  if (!text) return res.status(400).json({ error: "Message required" });
  const db = loadDb();
  const item = {
    id: id("msg"),
    staffId: req.user.id,
    name: req.user.displayName,
    rankLabel: rankLabel(db, req.user.rank),
    text: text.slice(0, 500),
    createdAt: new Date().toISOString(),
  };
  db.chat.push(item);
  if (db.chat.length > 200) db.chat = db.chat.slice(-200);
  saveDb(db);
  res.json(item);
});

app.post("/api/officer/duty", auth, (req, res) => {
  const note = String(req.body?.note || "").trim();
  if (!note) return res.status(400).json({ error: "Duty note required" });
  const db = loadDb();
  const item = {
    id: id("duty"),
    staffId: req.user.id,
    name: req.user.displayName,
    note: note.slice(0, 800),
    createdAt: new Date().toISOString(),
  };
  db.dutyLogs.unshift(item);
  saveDb(db);
  res.json(item);
});

app.post("/api/officer/report", auth, (req, res) => {
  const title = String(req.body?.title || "").trim();
  const body = String(req.body?.body || "").trim();
  if (!title || !body) return res.status(400).json({ error: "Title and body are required" });
  const db = loadDb();
  const item = {
    id: id("rpt"),
    staffId: req.user.id,
    name: req.user.displayName,
    rankLabel: rankLabel(db, req.user.rank),
    title: title.slice(0, 120),
    body: body.slice(0, 2000),
    createdAt: new Date().toISOString(),
  };
  db.reports.unshift(item);
  saveDb(db);
  res.json(item);
});

const TICKET_TYPES = {
  complaint_officer: {
    id: "complaint_officer",
    label: "Complaint against an officer",
    blurb: "شكوى على عسكري: تقرير سلوك أو إساءة من ضابط. يشوفه رئيس الشرطة ونائبه فقط.",
    about: "Use this if an officer broke protocol, was rude, corrupt, or abusive. Only the Chief and Deputy can read it.",
    audience: "public",
    view: "canTicketsComplaint",
  },
  inquiry: {
    id: "inquiry",
    label: "Inquiry about the police",
    blurb: "استفسار عن الشرطة: سؤال عام للأوامر. أي ضابط يقدر يفتحه، وأعلى ست رتب تقرأه.",
    about: "Ask how the department works, hours, academy, or command. Any ranked officer can open it. Top six ranks can read the queue.",
    audience: "staff",
    view: "canTicketsInquiry",
  },
  apply_issue: {
    id: "apply_issue",
    label: "Problem with application",
    blurb: "مشكلة في التقديم: عالق في الأبلاي أو التدريب. أعلى ست رتب تراجعها.",
    about: "Use this if apply, sign-in, or training booking is broken or stuck. Top six ranks review these.",
    audience: "public",
    view: "canTicketsApply",
  },
  crime_tip: {
    id: "crime_tip",
    label: "Civilian tip",
    blurb: "بلاغ مدني: تبليغ عن جريمة أو نشاط مشبوه. أعلى ست رتب تشوفه.",
    about: "Report a crime, location, plate, or suspicious activity. Not a PD-internal issue. Top six ranks can read it.",
    audience: "public",
    view: "canTicketsInquiry",
  },
  equipment: {
    id: "equipment",
    label: "Equipment / uniform",
    blurb: "معدات وزي: راديو، سلاح، أو يونيفورم. للأساكر، وأعلى ست رتب تراجع.",
    about: "Staff-only. Missing gear, radio, car, or uniform problems. Any officer can open it. Top six ranks can read it.",
    audience: "staff",
    view: "canTicketsInquiry",
  },
  internal: {
    id: "internal",
    label: "Internal conduct",
    blurb: "سلوك داخلي: أمر حساس بين الأساكر. رئيس الشرطة ونائبه فقط.",
    about: "Staff-only sensitive file: leaks, insubordination, or internal disputes. Only Chief and Deputy can read it.",
    audience: "staff",
    view: "canTicketsComplaint",
  },
};

function readAnyUser(req) {
  const payload = tokenPayload(req);
  if (!payload) return { kind: "public" };
  const db = loadDb();
  if (payload.kind === "staff") {
    const user = db.staff.find((s) => s.id === payload.sid);
    if (user) return { kind: "staff", user, rank: getPerms(db, user.rank), db };
  }
  const civ = (db.civilians || []).find((s) => s.id === payload.sid);
  if (civ) return { kind: "citizen", user: civ, db };
  return { kind: "public" };
}

function canViewTicketType(perms, typeId) {
  const t = TICKET_TYPES[typeId];
  if (!t || !perms) return false;
  return Boolean(perms[t.view]);
}

app.get("/api/tickets/types", (req, res) => {
  const who = readAnyUser(req);
  const perms = who.rank || {};
  res.json(
    Object.values(TICKET_TYPES).map((t) => ({
      ...t,
      canOpen: t.audience === "public" || who.kind === "staff",
      canView: who.kind === "staff" && canViewTicketType(perms, t.id),
    }))
  );
});

app.post("/api/tickets", (req, res) => {
  const typeId = String(req.body?.type || "");
  const type = TICKET_TYPES[typeId];
  if (!type) return res.status(400).json({ error: "Unknown ticket type" });
  const who = readAnyUser(req);
  if (type.audience === "staff" && who.kind !== "staff") {
    return res.status(401).json({ error: "Staff login is required to open this ticket" });
  }
  const title = String(req.body?.title || "").trim();
  const body = String(req.body?.body || "").trim();
  const name = String(req.body?.name || who.user?.displayName || who.user?.username || "").trim();
  const discord = normalizeDiscord(req.body?.discord || who.user?.discord);
  const against = String(req.body?.againstOfficer || "").trim();
  if (!title || !body || !name) return res.status(400).json({ error: "Name, title, and details are required" });
  const db = loadDb();
  const item = {
    id: id("tkt"),
    type: typeId,
    typeLabel: type.label,
    title: title.slice(0, 140),
    body: body.slice(0, 2500),
    name,
    discord,
    againstOfficer: against,
    status: "open",
    createdAt: new Date().toISOString(),
    authorKind: who.kind,
    authorId: who.user?.id || null,
    replies: [],
  };
  db.tickets.unshift(item);
  saveDb(db);
  res.json(item);
});

app.get("/api/tickets", auth, (req, res) => {
  const db = loadDb();
  const list = (db.tickets || []).filter((t) => canViewTicketType(req.rank, t.type));
  res.json(list);
});

app.get("/api/tickets/mine", (req, res) => {
  const who = readAnyUser(req);
  if (who.kind === "public") return res.json([]);
  const db = loadDb();
  const mine = (db.tickets || []).filter((t) => t.authorId === who.user.id);
  res.json(mine);
});

app.post("/api/tickets/:id/replies", (req, res) => {
  const who = readAnyUser(req);
  const text = String(req.body?.text || "").trim();
  if (!text) return res.status(400).json({ error: "Reply required" });
  const db = loadDb();
  const item = (db.tickets || []).find((t) => t.id === req.params.id);
  if (!item) return res.status(404).json({ error: "Not found" });
  const isAuthor = who.user && item.authorId === who.user.id;
  const canStaffReply = who.kind === "staff" && canViewTicketType(who.rank, item.type);
  if (!isAuthor && !canStaffReply) return res.status(403).json({ error: "Cannot reply to this ticket" });
  const reply = {
    id: id("tr"),
    name: who.user?.displayName || who.user?.username || "Guest",
    staff: who.kind === "staff",
    text: text.slice(0, 1200),
    createdAt: new Date().toISOString(),
  };
  item.replies = item.replies || [];
  item.replies.push(reply);
  saveDb(db);
  res.json(item);
});

app.patch("/api/tickets/:id", auth, (req, res) => {
  const db = loadDb();
  const item = (db.tickets || []).find((t) => t.id === req.params.id);
  if (!item) return res.status(404).json({ error: "Not found" });
  if (!canViewTicketType(req.rank, item.type)) return res.status(403).json({ error: "Cannot manage this ticket" });
  const action = String(req.body?.action || "");
  if (action === "close") item.status = "closed";
  else if (action === "open") item.status = "open";
  else return res.status(400).json({ error: "Unknown action" });
  saveDb(db);
  res.json(item);
});

app.listen(PORT, () => {
  console.log(`Axel Town PD portal running at http://localhost:${PORT}`);
  console.log("Command login — username: chief  password: ApexPD2026");
});
