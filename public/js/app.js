const appEl = document.getElementById("app");
const STAFF_KEY = "axel_pd_staff";
const CIV_KEY = "axel_pd_citizen";
const DEVICE_KEY = "axel_pd_device";
const REG_KEY = "axel_pd_registered";

const FILTERS = [
  ["pending", "Pending"],
  ["accepted", "Accepted"],
  ["rejected", "Rejected"],
  ["final_accepted", "Final accept"],
  ["final_rejected", "Final reject"],
  ["all", "All"],
];

const STATUS_LABEL = {
  pending: "Pending",
  accepted: "Preliminary accept",
  rejected: "Rejected",
  final_accepted: "Final accept",
  final_rejected: "Final reject",
  approved: "Approved",
  denied: "Denied",
};

const state = {
  route: "home",
  token: localStorage.getItem(STAFF_KEY) || localStorage.getItem("axle_pd_token") || localStorage.getItem("apex_pd_token"),
  civToken: localStorage.getItem(CIV_KEY),
  me: null,
  citizen: null,
  settings: { reapplyCooldownHours: 24 },
  civMode: "signin",
  protocols: [],
  rules: [],
  applications: [],
  bookings: [],
  staff: [],
  civilians: [],
  ranks: [],
  desk: { leaves: [], promotions: [], chat: [], dutyLogs: [], reports: [], allLeaves: [], allPromotions: [] },
  issuedCreds: null,
  tickets: [],
  myTickets: [],
  ticketTypes: [],
  ticketType: "",
  toast: "",
  slots: null,
  month: new Date().getMonth() + 1,
  year: new Date().getFullYear(),
  pickedDate: null,
  commandTab: "desk",
  login: { username: "", password: "", discord: "", rank: "", unitCode: "" },
  docForm: { kind: "protocol", code: "", title: "", body: "" },
  staffForm: { username: "", password: "", displayName: "", rank: "r7", civilianId: "", discord: "", unitCode: "" },
  filter: "pending",
};

function deviceId() {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = `dev-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

function relativeTime(iso) {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const diff = Date.now() - t;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} hour(s) ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return "yesterday";
  if (d === 2) return "the day before yesterday";
  if (d < 7) return `${d} days ago`;
  return new Date(iso).toLocaleString();
}

async function loadMeta() {
  const meta = await api("/api/meta");
  if (Array.isArray(meta.ranks) && meta.ranks.length) state.ranks = meta.ranks;
}

function headers(json = true, which = "staff") {
  const h = {};
  if (json) h["Content-Type"] = "application/json";
  const tok = which === "citizen" ? state.civToken : state.token;
  if (tok) h.Authorization = `Bearer ${tok}`;
  return h;
}

async function api(path, opts = {}) {
  const which = opts.as || "staff";
  const { as, ...rest } = opts;
  const res = await fetch(path, { ...rest, headers: { ...headers(Boolean(opts.body), which), ...(opts.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

function setRoute() {
  const hash = (location.hash || "#home").slice(1);
  state.route = hash.split("/")[0] || "home";
  document.querySelectorAll("nav a").forEach((a) => {
    a.classList.toggle("active", a.getAttribute("href") === `#${state.route}`);
  });
  render();
}

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function field(name, label, type = "text", optional = false) {
  const req = optional ? "" : "required";
  const common = `name="${name}" autocomplete="off" autocorrect="off" spellcheck="false" ${req} readonly onfocus="this.removeAttribute('readonly')"`;
  const tag =
    type === "textarea"
      ? `<textarea ${common}></textarea>`
      : `<input ${common} type="${type}" />`;
  return `<label>${escapeHtml(label)}${tag}</label>`;
}

async function loadPublic() {
  const [protocols, rules] = await Promise.all([api("/api/protocols"), api("/api/rules")]);
  state.protocols = protocols;
  state.rules = rules;
}

async function loadMe() {
  if (!state.token) {
    state.me = null;
    return;
  }
  try {
    state.me = await api("/api/auth/me");
  } catch {
    state.token = null;
    state.me = null;
    localStorage.removeItem(STAFF_KEY);
    localStorage.removeItem("axle_pd_token");
    localStorage.removeItem("apex_pd_token");
  }
}

async function loadCitizen() {
  if (!state.civToken) {
    state.citizen = null;
    return;
  }
  try {
    state.citizen = await api("/api/citizen/me", { as: "citizen" });
  } catch {
    state.civToken = null;
    state.citizen = null;
    localStorage.removeItem(CIV_KEY);
  }
}

async function loadSlots() {
  state.slots = await api(`/api/training/slots?year=${state.year}&month=${state.month}`);
}

function monthName(m) {
  return new Date(2000, m - 1, 1).toLocaleString("en-US", { month: "long" });
}

function homeView() {
  return `
    <section class="hero">
      <div>
        <div class="kicker">Los Santos · Axel Town</div>
        <h1>Protect<br/>the city.</h1>
        <p class="lede">Welcome to the Axel Town Police Department. Read the protocols. Learn the rules. Create an account, then file your application. Academy is Thursday and Saturday — you attend only after the Chief signs final acceptance.</p>
        <div class="actions">
          <a class="btn" href="#apply">Apply to the PD</a>
          <a class="btn ghost" href="#tickets">Open a ticket</a>
          <a class="btn ghost" href="#protocols">Read protocols</a>
        </div>
      </div>
      <div>
        <div class="stat-card"><span>Academy</span><strong>Thu · Sat · 20:00</strong></div>
        <div class="stat-card"><span>Command</span><strong>22 ranks</strong></div>
        <div class="stat-card"><span>Clearance</span><strong>Chief final accept</strong></div>
      </div>
    </section>
    <section class="section">
      <h2>How intake works</h2>
      <p class="help">Account → application → command review → Chief final accept → academy day.</p>
      <div class="grid">
        <article class="card"><header><span class="code">01</span></header><h3>Sign in first</h3><p>Create an account with a username and password. You must be signed in before you can apply.</p></article>
        <article class="card"><header><span class="code">02</span></header><h3>Write every answer</h3><p>Questions cover protocol, use of force, radio, and command. Fill each field yourself. No copy-paste of defaults.</p></article>
        <article class="card"><header><span class="code">03</span></header><h3>Chief decides the academy</h3><p>Command may give a preliminary accept. Only the Chief of Police can clear you to attend training.</p></article>
      </div>
    </section>`;
}

function docsView(kind) {
  const items = kind === "protocols" ? state.protocols : state.rules;
  const title = kind === "protocols" ? "Standard protocols" : "Department rules";
  const cards = items
    .map(
      (item) => `
      <article class="card">
        <header><span class="code">${escapeHtml(item.code)}</span></header>
        <h3>${escapeHtml(item.title)}</h3>
        <p>${escapeHtml(item.body)}</p>
      </article>`
    )
    .join("");
  return `<section class="section"><div class="kicker">General orders</div><h2>${title}</h2><p class="help">Public record. Chief and Deputy can add or revise entries from the command desk.</p><div class="grid">${cards || "<p class='muted'>Nothing published yet.</p>"}</div></section>`;
}

function formatWait(ms) {
  const h = Math.ceil(ms / 3600000);
  if (h >= 24) return `${Math.ceil(h / 24)} day(s)`;
  return `${Math.max(1, h)} hour(s)`;
}

function citizenGate() {
  const isCreate = state.civMode === "register";
  const already = Boolean(localStorage.getItem(REG_KEY));
  const standing = `<label>Discord standing
            <select name="standing" required>
              <option value="">Choose one</option>
              <option value="whitelist">Whitelist</option>
              <option value="other">Other</option>
            </select>
          </label>`;
  return `
    <section class="section">
      <div class="kicker">Recruitment</div>
      <h2>${isCreate ? "Create account" : "Sign in"}</h2>
      <p class="help">${
        isCreate
          ? "Email first. We send a verification code. Then Discord username, Discord user ID, whitelist or other, username, and password. One account only."
          : "Sign in is not username and password alone. You must match email, Discord username, Discord user ID, and whitelist/other."
      }</p>
      <div class="auth-card wide">
        <div class="auth-toggle">
          <button class="btn ${isCreate ? "ghost" : ""}" data-civ-mode="signin">Sign in</button>
          <button class="btn ${isCreate ? "" : "ghost"}" data-civ-mode="register">Create account</button>
        </div>
        ${already && isCreate ? `<div class="notice bad">This browser already created an account. Sign in instead.</div>` : ""}
        <form class="stack" id="civ-auth-form" autocomplete="off">
          <label>Email <input name="email" type="email" required placeholder="you@email.com" /></label>
          ${
            isCreate
              ? `<div class="mail-block">
                   <button class="btn ghost" type="button" id="send-email-code">Send verification code</button>
                   <p class="help spam-note">Check your email for the code. If it is not in the inbox, look in Spam / Junk — test mail often lands there.</p>
                   <p class="muted" id="email-code-msg"></p>
                 </div>
                 <label>Email verification code <input name="emailCode" required maxlength="16" placeholder="ATPD-000000" /></label>`
              : ""
          }
          <label>Username <input name="username" autocomplete="username" required /></label>
          <label>Password <input name="password" type="password" autocomplete="${isCreate ? "new-password" : "current-password"}" required /></label>
          <label>Discord username <input name="discord" required placeholder="yourname" /></label>
          <label>Discord user ID <input name="discordId" required placeholder="17–20 digit ID" /></label>
          ${standing}
          ${
            isCreate
              ? `<div class="human-gate">
                   <label class="check-row"><input type="checkbox" name="notReboot" id="not-reboot" /> I am not reboot.</label>
                   <p class="muted reboot-status" id="reboot-status"></p>
                   <div class="human-board" id="human-check" hidden>
                     <p class="help" id="human-prompt"></p>
                     <div class="human-art" id="human-art"></div>
                     <input type="hidden" name="humanCheckId" />
                     <label>Your answer <input name="humanCheckAnswer" inputmode="numeric" maxlength="2" placeholder="Number" /></label>
                   </div>
                   <label class="check-row" id="oath-wrap" hidden><input type="checkbox" name="oath" /> I will not create a second account.</label>
                 </div>`
              : ""
          }
          <button class="btn" type="submit" ${already && isCreate ? "disabled" : ""}>${isCreate ? "Create account" : "Sign in"}</button>
          <p class="muted" id="civ-auth-msg"></p>
        </form>
      </div>
    </section>`;
}

function applyFormHtml() {
  return `
      <form class="stack" id="apply-form" autocomplete="off">
        ${field("icName", "IC full name")}
        ${field("oocName", "OOC name (optional)", "text", true)}
        ${field("age", "Age")}
        ${field("whyJoin", "Why do you want to join the Axel Town Police Department?", "textarea")}
        ${field("priorLeo", "Have you served in law enforcement before? Explain.", "textarea")}
        ${field("availability", "Are you available for Thursday and Saturday academy? Write your answer.", "textarea")}
        ${field("character", "Describe your character and how you roleplay a peace officer.", "textarea")}
        ${field("useOfForce", "When is lethal force authorized under department protocol?", "textarea")}
        ${field("trafficStop", "Walk through a lawful traffic stop, including radio.", "textarea")}
        ${field("chainOfCommand", "If you disagree with an order, who do you take it to?", "textarea")}
        ${field("backup", "When do you call for backup, and what do you say on the radio?", "textarea")}
        ${field("bribe", "A suspect offers you money to walk away. What do you do, and which rule does it break?", "textarea")}
        <label class="check-row">
          <input type="checkbox" name="oath" />
          I will follow Axel Town protocols, department rules, and command orders.
        </label>
        <button class="btn" type="submit">File application</button>
        <p class="muted" id="apply-msg"></p>
      </form>`;
}

function applyView() {
  if (!state.citizen) return citizenGate();
  const done = state.citizen.application;
  const canApply = state.citizen.canApply;
  const cool = state.citizen.cooldown || {};
  let banner = "";
  if (done) {
    const pending = done.status === "pending";
    const prelim = done.status === "accepted";
    banner = `<div class="notice ${done.status === "final_accepted" ? "ok" : String(done.status).includes("reject") ? "bad" : pending ? "pulse" : ""}">
      <strong>${pending ? "Your request is under review" : escapeHtml(STATUS_LABEL[done.status] || done.status)}</strong>
      <p>${pending ? "Command is reading your file. You cannot pick a training day until you receive a preliminary accept." : escapeHtml(done.notice || "")}</p>
      ${prelim ? `<p>You may now reserve a Thursday or Saturday on the <a href="#training">training calendar</a>.</p>` : ""}
      ${done.booking ? `<p><strong>Reserved:</strong> ${escapeHtml(done.booking.weekday)} ${escapeHtml(done.booking.date)} · ${escapeHtml(done.booking.time)}</p>` : ""}
      ${academyBlock(done)}
      ${cool.blocked ? `<p>You may apply again in ${formatWait(cool.remainingMs)}.</p>` : ""}
      </div>`;
  }
  return `
    <section class="section">
      <div class="kicker">Signed in as ${escapeHtml(state.citizen.civilian.username)}</div>
      <h2>Police application</h2>
      <p class="help">Write every answer yourself. After you file, wait for review. A training day opens only after preliminary accept. Final accept comes after you reserve that day.</p>
      ${banner}
      ${canApply ? applyFormHtml() : done ? "" : `<p class="muted">You cannot file a new application right now.</p>`}
      <p class="muted" style="margin-top:24px"><button class="btn ghost" id="civ-logout">Sign out</button></p>
    </section>`;
}

function academyBlock(app) {
  const a = app?.academy;
  if (!a || app.status !== "final_accepted") return "";
  return `<div class="notice ok" style="margin-top:12px">
    <strong>Training location (final accept)</strong>
    <p><strong>Place:</strong> ${escapeHtml(a.location)}</p>
    <p><strong>When:</strong> ${escapeHtml(a.when)}</p>
    <p>${escapeHtml(a.message)}</p>
  </div>`;
}

function trainingView() {
  const app = state.citizen?.application;
  const weeks = state.slots?.weeks || [];
  const canBook = app && (app.status === "accepted" || app.status === "final_accepted");
  const locked = !canBook;
  const cleared = app?.status === "final_accepted";
  const pending = app?.status === "pending";
  let notice = `<div class="notice">Anyone may view academy days. You pick a date only after a preliminary accept.</div>`;
  if (pending) {
    notice = `<div class="notice pulse"><strong>Your request is under review.</strong><p>When command gives a preliminary accept, you can reserve Thursday or Saturday here.</p></div>`;
  } else if (app && app.status === "rejected") {
    notice = `<div class="notice bad">${escapeHtml(app.notice || "Your file was rejected.")}</div>`;
  } else if (app && String(app.status).includes("reject")) {
    notice = `<div class="notice bad">${escapeHtml(app.notice || "")}</div>`;
  } else if (canBook) {
    notice = `<div class="notice ${cleared ? "ok" : "pulse"}">${
      app.booking
        ? `<strong>Reserved:</strong> ${escapeHtml(app.booking.weekday)} ${escapeHtml(app.booking.date)} · ${escapeHtml(app.booking.time)}`
        : "<strong>Preliminary accept received.</strong> Choose a Thursday or Saturday, then confirm."
    }${
      cleared
        ? ""
        : app.booking
          ? "<p>Waiting for the Chief's final accept. The training place is not shown until then.</p>"
          : ""
    }</div>${academyBlock(app)}`;
  }
  return `
    <section class="section">
      <div class="kicker">Academy</div>
      <h2>Military training calendar</h2>
      <p class="help">Sessions run every Thursday and Saturday at 20:00. The calendar is public. Booking unlocks after preliminary accept.</p>
      ${notice}
      ${state.toast ? `<div class="toast ok" id="book-toast">${escapeHtml(state.toast)}</div>` : ""}
      <div class="row">
        <label>Month
          <select id="month">
            ${Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}" ${state.month === i + 1 ? "selected" : ""}>${monthName(i + 1)}</option>`).join("")}
          </select>
        </label>
        <label>Year
          <select id="year">
            ${[state.year - 1, state.year, state.year + 1].map((y) => `<option ${state.year === y ? "selected" : ""}>${y}</option>`).join("")}
          </select>
        </label>
      </div>
      <div class="week-board">
        ${weeks
          .map(
            (w) => `
          <div class="week">
            <h3>Week ${w.week} · ${monthName(state.month)} ${state.year}</h3>
            <div class="slots">
              ${w.slots
                .map((s) => {
                  const disabled = s.past || s.seats < 1 || locked;
                  return `<button class="slot ${disabled ? (s.past ? "past" : locked ? "locked" : "full") : ""} ${state.pickedDate === s.date ? "picked" : ""}" data-date="${s.date}" ${disabled ? "disabled" : ""}>
                    <strong>${s.weekday}</strong><br/>${s.date}<br/><span class="muted">${s.seats} seats${locked && !s.past ? " · view only" : ""}</span>
                  </button>`;
                })
                .join("")}
            </div>
          </div>`
          )
          .join("")}
      </div>
      <div class="actions">
        <button class="btn" id="book-btn" ${!canBook || !state.pickedDate ? "disabled" : ""}>Confirm training reservation</button>
      </div>
      <p class="muted" id="train-msg"></p>
    </section>`;
}

function ticketsView() {
  const types = state.ticketTypes || [];
  const picked = types.find((t) => t.id === state.ticketType);
  const mine = state.myTickets || [];
  return `
    <section class="section">
      <div class="kicker">Support</div>
      <h2>Open a ticket</h2>
      <p class="help">Pick a category. Officer complaints go only to the Chief and Deputy. Application issues go to the top six ranks. Police inquiries can be opened by any officer.</p>
      <div class="ticket-grid">
        ${types
          .map(
            (t) => `<button class="ticket-card ${state.ticketType === t.id ? "on" : ""}" data-ticket-type="${t.id}">
              <span class="code">${t.audience === "staff" ? "STAFF" : "PUBLIC"}</span>
              <h3>${escapeHtml(t.label)}</h3>
              <p>${escapeHtml(t.blurb)}</p>
              ${t.about ? `<p class="muted">${escapeHtml(t.about)}</p>` : ""}
            </button>`
          )
          .join("")}
      </div>
      ${
        picked
          ? `<form class="stack auth-card" id="ticket-form" style="max-width:720px;margin-top:24px">
        <h3>${escapeHtml(picked.label)}</h3>
        ${picked.audience === "staff" && !state.me ? `<p class="muted">Sign in at Staff login to open this ticket.</p>` : ""}
        <label>Your name <input name="name" required value="${escapeHtml(state.me?.staff?.displayName || state.citizen?.civilian?.username || "")}" /></label>
        <label>Discord username <input name="discord" required value="${escapeHtml(state.me?.staff?.discord || state.citizen?.civilian?.discord || "")}" /></label>
        ${picked.id === "complaint_officer" ? `<label>Officer named <input name="againstOfficer" placeholder="IC name or callsign" /></label>` : ""}
        <label>Title <input name="title" required /></label>
        <label>Details <textarea name="body" required></textarea></label>
        <button class="btn" type="submit" ${picked.audience === "staff" && !state.me ? "disabled" : ""}>Submit ticket</button>
        <p class="muted" id="ticket-msg"></p>
      </form>`
          : ""
      }
      ${
        mine.length
          ? `<h3 style="margin:28px 0 12px">Your tickets</h3>
        <div class="grid">${mine
          .map(
            (t) => `<article class="card"><header><span class="code">${escapeHtml(t.typeLabel)}</span><span class="tag ${t.status}">${escapeHtml(t.status)}</span></header>
            <h3>${escapeHtml(t.title)}</h3><p>${escapeHtml(t.body)}</p>
            <p class="muted">${escapeHtml(relativeTime(t.createdAt))}</p></article>`
          )
          .join("")}</div>`
          : ""
      }
    </section>`;
}

function staffTicketsView() {
  const list = state.tickets || [];
  return `
    <p class="help">You only see tickets your rank is allowed to read.</p>
    <div class="desk-grid">
      ${
        list
          .map(
            (t) => `<article class="panel">
          <h3>${escapeHtml(t.title)}</h3>
          <p class="muted">${escapeHtml(t.typeLabel)} · ${escapeHtml(t.name)} · ${escapeHtml(t.discord || "no discord")} · ${escapeHtml(relativeTime(t.createdAt))}</p>
          ${t.againstOfficer ? `<p>Against: ${escapeHtml(t.againstOfficer)}</p>` : ""}
          <p>${escapeHtml(t.body)}</p>
          <span class="tag ${t.status}">${escapeHtml(t.status)}</span>
          <ul class="mini-list">${(t.replies || [])
            .map((r) => `<li><strong>${escapeHtml(r.name)}</strong> <span class="muted">${escapeHtml(relativeTime(r.createdAt))}</span><br/>${escapeHtml(r.text)}</li>`)
            .join("")}</ul>
          <form class="row chat-form ticket-reply" data-ticket-id="${t.id}">
            <input name="text" placeholder="Reply…" required />
            <button class="btn" type="submit">Reply</button>
          </form>
          ${t.status === "open" ? `<button class="btn ghost" data-close-ticket="${t.id}">Close</button>` : ""}
        </article>`
          )
          .join("") || `<p class="muted">No tickets in your queue.</p>`
      }
    </div>`;
}

function loginView() {
  const rankOpts =
    `<option value="" disabled ${state.login.rank ? "" : "selected"}>Select rank</option>` +
    (state.ranks || [])
      .map((r) => `<option value="${r.id}" ${state.login.rank === r.id ? "selected" : ""}>${r.order}. ${escapeHtml(r.label)}</option>`)
      .join("");
  return `
    <section class="section">
      <div class="kicker">Restricted</div>
      <h2>Staff login</h2>
      <p class="help">If command already added you to the roster, sign in here with the username, password, Discord, rank, and unit code they issued. You do not need to apply first.</p>
      <form class="stack" id="login-form" autocomplete="off">
        <label>Username <input name="username" value="${escapeHtml(state.login.username)}" autocomplete="username" required /></label>
        <label>Password <input name="password" type="password" value="${escapeHtml(state.login.password)}" autocomplete="current-password" required /></label>
        <label>Discord username <input name="discord" value="${escapeHtml(state.login.discord)}" required /></label>
        <label>Your rank <select name="rank" required>${rankOpts}</select></label>
        <label>Unit code <input name="unitCode" value="${escapeHtml(state.login.unitCode)}" required placeholder="Unit code" /></label>
        <button class="btn" type="submit">Sign in</button>
        <p class="muted" id="login-msg"></p>
      </form>
    </section>`;
}

function appActions(a, perms) {
  if (a.status === "final_accepted") {
    return `<span class="muted">Cleared for academy</span>`;
  }
  if (a.status === "final_rejected") {
    const wait = a.cooldown?.blocked ? `Wait ${formatWait(a.cooldown.remainingMs)}` : "Cooldown clear";
    return `<div class="act-col"><span class="muted">${wait}</span><button class="btn" data-app="${a.id}" data-action="waive_cooldown">Lift cooldown</button></div>`;
  }
  const bits = [];
  if (a.status === "pending") {
    bits.push(`<button class="btn ok" data-app="${a.id}" data-action="accept">Accept</button>`);
    bits.push(`<button class="btn danger" data-app="${a.id}" data-action="reject">Reject</button>`);
  } else if (a.status === "rejected") {
    bits.push(`<button class="btn ok" data-app="${a.id}" data-action="accept">Accept</button>`);
    bits.push(`<button class="btn danger" data-app="${a.id}" data-action="final_reject">Final reject</button>`);
  } else if (a.status === "accepted") {
    if (perms.canFinalAccept) {
      bits.push(
        a.hasBooking
          ? `<button class="btn ok" data-app="${a.id}" data-action="final_accept">Final accept</button>`
          : `<span class="muted">Waiting for training day</span>`
      );
    } else {
      bits.push(`<span class="muted">Awaiting Chief final accept</span>`);
    }
    bits.push(`<button class="btn danger" data-app="${a.id}" data-action="final_reject">Final reject</button>`);
  }
  return `<div class="act-col">${bits.join("")}</div>`;
}

function statusTag(status) {
  return `<span class="tag ${escapeHtml(status)}">${escapeHtml(STATUS_LABEL[status] || status)}</span>`;
}

function deskView(perms) {
  const d = state.desk;
  const higherRanks = state.ranks.filter((r) => r.order > (perms.order || 0));
  const rankOpts = higherRanks
    .map((r) => `<option value="${r.id}">${r.order}. ${escapeHtml(r.label)}</option>`)
    .join("");
  return `
    <div class="desk-grid">
      <article class="panel">
        <h3>Leave request</h3>
        <p class="help">Submit vacation or time off. Sergeant and above review it.</p>
        <form class="stack" id="leave-form">
          <label>From <input type="date" name="from" required /></label>
          <label>To <input type="date" name="to" required /></label>
          <label>Reason <textarea name="reason" required></textarea></label>
          <button class="btn" type="submit">Submit leave</button>
          <p class="muted" id="leave-msg"></p>
        </form>
        <ul class="mini-list">
          ${(d.leaves || [])
            .map((x) => `<li><strong>${escapeHtml(x.from)} → ${escapeHtml(x.to)}</strong> ${statusTag(x.status)}<br/><span class="muted">${escapeHtml(x.reason)}</span></li>`)
            .join("") || "<li class='muted'>No leave filed.</li>"}
        </ul>
      </article>
      <article class="panel">
        <h3>Rank promotion</h3>
        <p class="help">Ask command to raise your rank. Deputy or Chief decides.</p>
        <form class="stack" id="promo-form">
          <label>Requested rank <select name="targetRank">${rankOpts || "<option value=''>No higher rank</option>"}</select></label>
          <label>Why you should be promoted <textarea name="reason" required></textarea></label>
          <button class="btn" type="submit" ${higherRanks.length ? "" : "disabled"}>Request promotion</button>
          <p class="muted" id="promo-msg"></p>
        </form>
        <ul class="mini-list">
          ${(d.promotions || [])
            .map((x) => `<li><strong>${escapeHtml(x.fromLabel)} → ${escapeHtml(x.targetLabel)}</strong> ${statusTag(x.status)}<br/><span class="muted">${escapeHtml(x.reason)}</span></li>`)
            .join("") || "<li class='muted'>No promotion requests.</li>"}
        </ul>
      </article>
      <article class="panel">
        <h3>Duty log</h3>
        <p class="help">Record patrol, arrests, or end-of-shift notes.</p>
        <form class="stack" id="duty-form">
          <label>Note <textarea name="note" required></textarea></label>
          <button class="btn" type="submit">Save log</button>
        </form>
        <ul class="mini-list">
          ${(d.dutyLogs || [])
            .map((x) => `<li><span class="muted">${new Date(x.createdAt).toLocaleString()}</span><br/>${escapeHtml(x.note)}</li>`)
            .join("") || "<li class='muted'>No duty notes yet.</li>"}
        </ul>
      </article>
      <article class="panel">
        <h3>Incident report</h3>
        <p class="help">File a written report for command.</p>
        <form class="stack" id="report-form">
          <label>Title <input name="title" required /></label>
          <label>Body <textarea name="body" required></textarea></label>
          <button class="btn" type="submit">File report</button>
        </form>
        <ul class="mini-list">
          ${(d.reports || [])
            .map((x) => `<li><strong>${escapeHtml(x.title)}</strong><br/><span class="muted">${escapeHtml(x.body)}</span></li>`)
            .join("") || "<li class='muted'>No reports filed.</li>"}
        </ul>
      </article>
      <article class="panel chat-panel">
        <h3>Department chat</h3>
        <p class="help">Staff-only channel. Keep it professional.</p>
        <div class="chat-log" id="chat-log">
          ${(d.chat || [])
            .map(
              (m) =>
                `<div class="chat-line"><strong>${escapeHtml(m.name)}</strong> <span class="muted">${escapeHtml(m.rankLabel)} · ${escapeHtml(relativeTime(m.createdAt))}</span><p>${escapeHtml(m.text)}</p></div>`
            )
            .join("") || `<p class="muted">No messages yet.</p>`}
        </div>
        <form class="row chat-form" id="chat-form">
          <input name="text" maxlength="500" placeholder="Write a message…" required />
          <button class="btn" type="submit">Send</button>
        </form>
      </article>
    </div>`;
}

function personnelView(perms) {
  const leaves = state.desk.allLeaves || [];
  const promos = state.desk.allPromotions || [];
  return `
    <div class="desk-grid">
      <article class="panel">
        <h3>Leave queue</h3>
        <table class="table"><thead><tr><th>Officer</th><th>Dates</th><th>Reason</th><th></th></tr></thead><tbody>
          ${
            leaves
              .map(
                (x) => `<tr>
              <td>${escapeHtml(x.name)}<br/><span class="muted">${escapeHtml(x.rankLabel)}</span></td>
              <td>${escapeHtml(x.from)} → ${escapeHtml(x.to)}</td>
              <td>${escapeHtml(x.reason)}<br/>${statusTag(x.status)}</td>
              <td>${
                x.status === "pending"
                  ? `<div class="act-col"><button class="btn ok" data-leave="${x.id}" data-action="approve">Approve</button><button class="btn danger" data-leave="${x.id}" data-action="deny">Deny</button></div>`
                  : `<span class="muted">${escapeHtml(x.reviewedBy || "")}</span>`
              }</td>
            </tr>`
              )
              .join("") || `<tr><td colspan="4" class="muted">No leave requests.</td></tr>`
          }
        </tbody></table>
      </article>
      <article class="panel">
        <h3>Promotion queue</h3>
        <p class="help">${perms.canApprovePromo ? "You can approve or deny rank raises." : "Deputy or Chief must approve promotions."}</p>
        <table class="table"><thead><tr><th>Officer</th><th>Request</th><th>Reason</th><th></th></tr></thead><tbody>
          ${
            promos
              .map(
                (x) => `<tr>
              <td>${escapeHtml(x.name)}</td>
              <td>${escapeHtml(x.fromLabel)} → ${escapeHtml(x.targetLabel)}<br/>${statusTag(x.status)}</td>
              <td>${escapeHtml(x.reason)}</td>
              <td>${
                x.status === "pending" && perms.canApprovePromo
                  ? `<div class="act-col"><button class="btn ok" data-promo="${x.id}" data-action="approve">Promote</button><button class="btn danger" data-promo="${x.id}" data-action="deny">Deny</button></div>`
                  : `<span class="muted">${escapeHtml(x.reviewedBy || "Awaiting command")}</span>`
              }</td>
            </tr>`
              )
              .join("") || `<tr><td colspan="4" class="muted">No promotion requests.</td></tr>`
          }
        </tbody></table>
      </article>
    </div>`;
}

function commandView() {
  const perms = state.me?.permissions || {};
  const tabs = [
    ["desk", "My desk"],
    perms.canReview ? ["applications", "Applications"] : null,
    perms.canTraining ? ["bookings", "Training"] : null,
    perms.canPersonnel ? ["personnel", "Personnel"] : null,
    perms.canTicketsComplaint || perms.canTicketsInquiry || perms.canTicketsApply ? ["tickets", "Tickets"] : null,
    perms.canContent ? ["content", "SOP / Rules"] : null,
    perms.canStaff ? ["staff", "Roster"] : null,
    perms.canRenameRanks ? ["ranks", "Ranks"] : null,
    perms.canSettings ? ["settings", "Access"] : null,
  ].filter(Boolean);

  if (!tabs.some((t) => t[0] === state.commandTab)) state.commandTab = tabs[0]?.[0] || "desk";

  let body = "";
  if (state.commandTab === "desk") {
    body = deskView(perms);
  } else if (state.commandTab === "personnel") {
    body = personnelView(perms);
  } else if (state.commandTab === "tickets") {
    body = staffTicketsView();
  } else if (state.commandTab === "applications") {
    const list = state.applications.filter((a) => (state.filter === "all" ? true : a.status === state.filter));
    body = `
      <div class="sub-rail">
        ${FILTERS.map(([id, label]) => `<button class="${state.filter === id ? "on" : ""}" data-filter="${id}">${label}</button>`).join("")}
      </div>
      <table class="table">
        <thead><tr><th>Cadet</th><th>Account</th><th>Answers</th><th>Status</th><th>Action</th></tr></thead>
        <tbody>
          ${
            list
              .map(
                (a) => `<tr>
              <td><strong>${escapeHtml(a.icName)}</strong><br/><span class="muted">${escapeHtml(a.oocName || "—")} · age ${escapeHtml(a.age)}<br/>${new Date(a.createdAt).toLocaleString()}${
                  a.booking ? `<br/>Day: ${escapeHtml(a.booking.weekday)} ${escapeHtml(a.booking.date)}` : "<br/>No training day yet"
                }</span></td>
              <td>${escapeHtml(a.accountUsername || "—")}</td>
              <td>
                <p><strong>Why join:</strong> ${escapeHtml(a.whyJoin)}</p>
                <p><strong>Prior LEO:</strong> ${escapeHtml(a.priorLeo)}</p>
                <p><strong>Availability:</strong> ${escapeHtml(a.availability)}</p>
                <p><strong>Character:</strong> ${escapeHtml(a.character)}</p>
                ${a.useOfForce ? `<p><strong>Use of force:</strong> ${escapeHtml(a.useOfForce)}</p>` : ""}
                ${a.trafficStop ? `<p><strong>Traffic stop:</strong> ${escapeHtml(a.trafficStop)}</p>` : ""}
                ${a.chainOfCommand ? `<p><strong>Chain of command:</strong> ${escapeHtml(a.chainOfCommand)}</p>` : ""}
                ${a.backup ? `<p><strong>Backup:</strong> ${escapeHtml(a.backup)}</p>` : ""}
                ${a.bribe ? `<p><strong>Bribe:</strong> ${escapeHtml(a.bribe)}</p>` : ""}
              </td>
              <td><span class="tag ${a.status}">${escapeHtml(STATUS_LABEL[a.status] || a.status)}</span>${a.reviewedBy ? `<br/><span class="muted">${escapeHtml(a.reviewedBy)}</span>` : ""}</td>
              <td>${appActions(a, perms)}</td>
            </tr>`
              )
              .join("") || `<tr><td colspan="5" class="muted">No files in this tray.</td></tr>`
          }
        </tbody>
      </table>`;
  } else if (state.commandTab === "bookings") {
    const t = state.settings?.training || { location: "Airport", when: "Thursday and Saturday at 20:00", message: "" };
    body = `
      ${
        perms.canSettings
          ? `<div class="panel" style="margin-bottom:22px">
        <h3>Training notice</h3>
        <p class="help">Chief and Deputy set the place and time. Preliminary accept never sees this — only final accept.</p>
        <form class="stack" id="training-settings-form">
          <label>Place <input name="location" required value="${escapeHtml(t.location || "")}" placeholder="Airport" /></label>
          <label>When <input name="when" required value="${escapeHtml(t.when || "")}" placeholder="Thursday and Saturday at 20:00" /></label>
          <label>Message shown to the cadet <textarea name="message" required rows="3">${escapeHtml(t.message || "")}</textarea></label>
          <button class="btn" type="submit">Save training notice</button>
          <p class="muted" id="training-settings-msg"></p>
        </form>
      </div>`
          : ""
      }
      <table class="table"><thead><tr><th>Date</th><th>Cadet</th><th>Account</th><th>Clearance</th></tr></thead><tbody>
      ${
        state.bookings
          .map(
            (b) =>
              `<tr><td>${escapeHtml(b.weekday)} ${escapeHtml(b.date)} · ${escapeHtml(b.time)}</td><td>${escapeHtml(b.icName)}</td><td>${escapeHtml(b.discord)}</td><td>${
                b.canAttend ? '<span class="tag final_accepted">May attend</span>' : `<span class="tag ${escapeHtml(b.status)}">${escapeHtml(STATUS_LABEL[b.status] || b.status)}</span>`
              }</td></tr>`
          )
          .join("") || `<tr><td colspan="4" class="muted">No reservations yet.</td></tr>`
      }
    </tbody></table>`;
  } else if (state.commandTab === "content") {
    body = `
      <p class="help">Chief and Deputy publish protocols and department rules from this desk.</p>
      <form class="stack" id="doc-form">
        <label>Type
          <select name="kind">
            <option value="protocol" ${state.docForm.kind === "protocol" ? "selected" : ""}>Protocol</option>
            <option value="rule" ${state.docForm.kind === "rule" ? "selected" : ""}>Rule</option>
          </select>
        </label>
        <label>Code <input name="code" value="${escapeHtml(state.docForm.code)}" placeholder="SOP-04 / R-04" /></label>
        <label>Title <input name="title" value="${escapeHtml(state.docForm.title)}" /></label>
        <label>Body <textarea name="body">${escapeHtml(state.docForm.body)}</textarea></label>
        <button class="btn" type="submit">Publish</button>
      </form>
      <h3 style="margin:28px 0 12px">Protocols</h3>
      <div class="grid">${state.protocols
        .map(
          (p) =>
            `<article class="card"><header><span class="code">${escapeHtml(p.code)}</span><button class="btn danger" data-del-prot="${p.id}">Remove</button></header><h3>${escapeHtml(p.title)}</h3><p>${escapeHtml(p.body)}</p></article>`
        )
        .join("")}</div>
      <h3 style="margin:28px 0 12px">Rules</h3>
      <div class="grid">${state.rules
        .map(
          (p) =>
            `<article class="card"><header><span class="code">${escapeHtml(p.code)}</span><button class="btn danger" data-del-rule="${p.id}">Remove</button></header><h3>${escapeHtml(p.title)}</h3><p>${escapeHtml(p.body)}</p></article>`
        )
        .join("")}</div>`;
  } else if (state.commandTab === "staff") {
    const rankOpts = state.ranks
      .map((r) => `<option value="${r.id}" ${state.staffForm.rank === r.id ? "selected" : ""}>${r.order}. ${escapeHtml(r.label)}</option>`)
      .join("");
    const civOpts = (state.civilians || [])
      .map((c) => {
        const sel = state.staffForm.civilianId === c.id ? "selected" : "";
        const mark = c.alreadyStaff ? " (already staff)" : c.hasApplication ? "" : " · registered, no apply";
        return `<option value="${c.id}" ${sel} ${c.alreadyStaff ? "disabled" : ""}>${escapeHtml(c.username)}${mark}</option>`;
      })
      .join("");
    body = `
      <p class="help">Add an officer directly. They can sign in at Staff login immediately with username, password, Discord, and the rank you assign. They do not need to apply. Linking a registered civilian is optional.</p>
      ${
        state.issuedCreds
          ? `<div class="notice ok"><strong>Send this to ${escapeHtml(state.issuedCreds.forAccount)}</strong><br/>Username: <code>${escapeHtml(
              state.issuedCreds.username
            )}</code><br/>Password: <code>${escapeHtml(state.issuedCreds.password)}</code><br/>Discord: <code>${escapeHtml(
              state.issuedCreds.discord || ""
            )}</code><br/>Rank: <code>${escapeHtml(state.issuedCreds.rankLabel || "")}</code><br/>Unit code: <code>${escapeHtml(
              state.issuedCreds.unitCode || ""
            )}</code></div>`
          : ""
      }
      <form class="stack" id="staff-form">
        <label>Registered account (optional)
          <select name="civilianId">
            <option value="">Direct add — no apply needed</option>
            ${civOpts}
          </select>
        </label>
        <label>Display name <input name="displayName" value="${escapeHtml(state.staffForm.displayName)}" required /></label>
        <label>Staff username <input name="username" value="${escapeHtml(state.staffForm.username)}" required /></label>
        <label>Staff password <input name="password" type="text" value="${escapeHtml(state.staffForm.password)}" required /></label>
        <label>Discord username <input name="discord" value="${escapeHtml(state.staffForm.discord)}" required /></label>
        <label>Unit code <input name="unitCode" value="${escapeHtml(state.staffForm.unitCode)}" required placeholder="F0A1" /></label>
        <label>Military rank <select name="rank">${rankOpts}</select></label>
        <button class="btn" type="submit">Issue rank + staff login</button>
        <p class="muted" id="staff-msg"></p>
      </form>
      <table class="table" style="margin-top:24px"><thead><tr><th>Name</th><th>User</th><th>Discord</th><th>Code</th><th>Rank</th><th></th></tr></thead><tbody>
        ${state.staff
          .map(
            (s) =>
              `<tr><td>${escapeHtml(s.displayName)}</td><td>${escapeHtml(s.username)}</td><td>${escapeHtml(s.discord || "—")}</td><td><code>${escapeHtml(
                s.unitCode || "—"
              )}</code></td><td>${escapeHtml(s.rankLabel)}</td><td>${
                s.id === "staff-chief" ? "" : `<button class="btn danger" data-del-staff="${s.id}">Remove</button>`
              }</td></tr>`
          )
          .join("")}
      </tbody></table>`;
  } else if (state.commandTab === "ranks") {
    body = `
      <p class="help">22 military ranks. Only Chief and Deputy can rename them. Names update everywhere immediately because officers are stored by rank ID, not by the old name.</p>
      <form id="ranks-form">
        <div class="rank-grid">
          ${state.ranks
            .map(
              (r) =>
                `<label><span>${r.order}</span><input name="${r.id}" value="${escapeHtml(r.label)}" /></label>`
            )
            .join("")}
        </div>
        <button class="btn" type="submit">Save rank names</button>
        <p class="muted" id="ranks-msg"></p>
      </form>`;
  } else if (state.commandTab === "settings") {
    body = `
      <p class="help">Cooldown after a final reject. Only Chief and Deputy can change this.</p>
      <form class="stack" id="settings-form">
        <label>Reapply cooldown (hours)
          <input name="reapplyCooldownHours" type="number" min="1" max="168" value="${escapeHtml(state.settings.reapplyCooldownHours)}" />
        </label>
        <button class="btn" type="submit">Save cooldown</button>
        <p class="muted" id="settings-msg"></p>
      </form>
      <div class="panel" style="margin-top:22px">
        <h3>Email SMTP</h3>
        <p class="help">Needed so apply accounts receive a verification code. Gmail: smtp.gmail.com, port 587, your Gmail, and a Google App Password. Status: ${
          state.settings.smtp?.configured ? "saved and ready" : "not configured — codes cannot send yet"
        }.</p>
        ${
          state.settings.smtp?.configured
            ? `<div class="notice ok">App password is stored on the server. The box below stays empty on purpose — we never show that password again. Leave it blank unless you want to replace it.</div>`
            : ""
        }
        <form class="stack" id="smtp-form">
          <label>SMTP host <input name="host" value="${escapeHtml(state.settings.smtp?.host || "smtp.gmail.com")}" /></label>
          <label>Port <input name="port" type="number" value="${escapeHtml(state.settings.smtp?.port || 587)}" /></label>
          <label>SMTP username (email) <input name="user" value="${escapeHtml(state.settings.smtp?.user || "")}" /></label>
          <label>From address <input name="from" value="${escapeHtml(state.settings.smtp?.from || "")}" /></label>
          <label>App password <input name="pass" type="password" autocomplete="new-password" placeholder="${
            state.settings.smtp?.configured ? "Saved — leave empty to keep it" : "paste the 16-character Google App Password"
          }" /></label>
          <button class="btn" type="submit">Save SMTP</button>
          <p class="muted" id="smtp-msg"></p>
        </form>
        <form class="row" id="smtp-test-form" style="margin-top:12px">
          <input name="to" type="email" placeholder="test@email.com" required />
          <button class="btn ghost" type="submit">Send test email</button>
        </form>
        <p class="muted" id="smtp-test-msg"></p>
      </div>
      <div class="panel" style="margin-top:22px">
        <h3>Discord bot (optional)</h3>
        <p class="help">Without a bot token we only check that the Discord ID looks valid. With a bot token we confirm the account exists and send a DM on preliminary accept, final accept, and final reject. Edit the three messages below. The cadet must share a Discord server with the bot, and DMs from server members must be allowed. Status: ${
          state.settings.discordBotConfigured ? "bot token stored" : "format check only"
        }.</p>
        ${
          state.settings.discordBotConfigured
            ? `<div class="notice ok">Bot token is stored. This box stays empty on purpose — same as the App password. Leave it blank unless you want to replace it.</div>`
            : ""
        }
        <form class="stack" id="discord-bot-form">
          <label>Bot token <input name="token" type="password" autocomplete="new-password" placeholder="${
            state.settings.discordBotConfigured ? "Saved — leave empty to keep it" : "paste token"
          }" /></label>
          <button class="btn" type="submit">Save bot token</button>
          <p class="muted" id="discord-bot-msg"></p>
        </form>
        <form class="stack" id="discord-messages-form" style="margin-top:16px">
          <label>DM · preliminary accept
            <textarea name="accepted" required rows="3">${escapeHtml(state.settings.discordMessages?.accepted || "")}</textarea>
          </label>
          <label>DM · final accept
            <textarea name="final_accepted" required rows="3">${escapeHtml(state.settings.discordMessages?.final_accepted || "")}</textarea>
          </label>
          <label>DM · final reject
            <textarea name="final_rejected" required rows="3">${escapeHtml(state.settings.discordMessages?.final_rejected || "")}</textarea>
          </label>
          <button class="btn" type="submit">Save bot messages</button>
          <p class="muted" id="discord-messages-msg"></p>
        </form>
      </div>`;
  }

  return `
    <section class="section">
      <div class="kicker">${escapeHtml(state.me.staff.rankLabel)}</div>
      <h2>Staff desk · ${escapeHtml(state.me.staff.displayName)}</h2>
      <p class="help">Leave, promotion, chat, and reports are for every officer. Command tools unlock by rank.</p>
      ${state.toast ? `<div class="toast ok">${escapeHtml(state.toast)}</div>` : ""}
      <div class="cmd-rail">
        ${tabs.map(([id, label]) => `<button class="${state.commandTab === id ? "on" : ""}" data-tab="${id}">${label}</button>`).join("")}
        <button id="logout">Sign out</button>
      </div>
      ${body}
    </section>`;
}

let renderSeq = 0;

async function render() {
  const seq = ++renderSeq;
  const navCmd = document.getElementById("nav-command");
  navCmd.textContent = state.me ? "Staff desk" : "Staff login";

  try {
    if (state.route === "home") {
      if (seq !== renderSeq) return;
      appEl.innerHTML = homeView();
    } else if (state.route === "protocols") {
      await loadPublic();
      if (seq !== renderSeq) return;
      appEl.innerHTML = docsView("protocols");
    } else if (state.route === "rules" || state.route === "laws") {
      await loadPublic();
      if (seq !== renderSeq) return;
      appEl.innerHTML = docsView("rules");
    } else if (state.route === "apply") {
      await loadCitizen();
      if (seq !== renderSeq) return;
      appEl.innerHTML = applyView();
    } else if (state.route === "training") {
      await Promise.all([loadSlots(), loadCitizen()]);
      if (seq !== renderSeq) return;
      appEl.innerHTML = trainingView();
    } else if (state.route === "tickets") {
      await Promise.all([loadMe(), loadCitizen()]);
      state.ticketTypes = await api("/api/tickets/types", { as: state.token ? "staff" : "citizen" });
      state.myTickets = await api("/api/tickets/mine", { as: state.token ? "staff" : "citizen" });
      if (seq !== renderSeq) return;
      appEl.innerHTML = ticketsView();
    } else if (state.route === "command") {
      await Promise.all([loadMe(), loadMeta()]);
      if (seq !== renderSeq) return;
      if (!state.me) {
        appEl.innerHTML = loginView();
      } else {
        state.desk = await api("/api/officer/desk");
        if (state.desk.me) state.me = state.desk.me;
        state.ranks = await api("/api/ranks");
        if (seq !== renderSeq) return;
        if (state.me.permissions.canReview) {
          state.applications = await api("/api/applications");
        }
        if (state.me.permissions.canTraining) {
          state.bookings = await api("/api/training/bookings");
        }
        if (seq !== renderSeq) return;
        if (state.me.permissions.canContent) await loadPublic();
        if (seq !== renderSeq) return;
        if (state.me.permissions.canStaff) {
          state.staff = await api("/api/staff");
          state.civilians = await api("/api/civilians");
        }
        if (seq !== renderSeq) return;
        if (state.me.permissions.canSettings) {
          state.settings = await api("/api/settings");
        }
        if (seq !== renderSeq) return;
        if (state.me.permissions.canTicketsComplaint || state.me.permissions.canTicketsInquiry || state.me.permissions.canTicketsApply) {
          state.tickets = await api("/api/tickets");
        }
        if (seq !== renderSeq) return;
        appEl.innerHTML = commandView();
      }
    } else {
      if (seq !== renderSeq) return;
      appEl.innerHTML = homeView();
    }
  } catch (err) {
    if (seq !== renderSeq) return;
    appEl.innerHTML = `<section class="section"><h2>Signal lost</h2><p class="help">${escapeHtml(err.message)}</p></section>`;
  }
  if (seq !== renderSeq) return;
  bind();
}

function bind() {
  const applyForm = document.getElementById("apply-form");
  if (applyForm) {
    applyForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const msg = document.getElementById("apply-msg");
      try {
        const fd = new FormData(applyForm);
        const payload = {
          icName: String(fd.get("icName") || ""),
          oocName: String(fd.get("oocName") || ""),
          age: String(fd.get("age") || ""),
          whyJoin: String(fd.get("whyJoin") || ""),
          priorLeo: String(fd.get("priorLeo") || ""),
          availability: String(fd.get("availability") || ""),
          character: String(fd.get("character") || ""),
          useOfForce: String(fd.get("useOfForce") || ""),
          trafficStop: String(fd.get("trafficStop") || ""),
          chainOfCommand: String(fd.get("chainOfCommand") || ""),
          backup: String(fd.get("backup") || ""),
          bribe: String(fd.get("bribe") || ""),
          oath: Boolean(applyForm.querySelector('[name="oath"]')?.checked),
        };
        await api("/api/applications", { method: "POST", body: JSON.stringify(payload), as: "citizen" });
        await loadCitizen();
        await render();
      } catch (err) {
        msg.textContent = err.message;
      }
    });
  }

  const month = document.getElementById("month");
  const year = document.getElementById("year");
  if (month) {
    month.addEventListener("change", async () => {
      state.month = Number(month.value);
      state.pickedDate = null;
      await loadSlots();
      await render();
    });
  }
  if (year) {
    year.addEventListener("change", async () => {
      state.year = Number(year.value);
      state.pickedDate = null;
      await loadSlots();
      await render();
    });
  }
  document.querySelectorAll(".slot[data-date]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.pickedDate = btn.dataset.date;
      render();
    });
  });
  const bookBtn = document.getElementById("book-btn");
  if (bookBtn) {
    bookBtn.addEventListener("click", async () => {
      const msg = document.getElementById("train-msg");
      if (!state.pickedDate) return;
      try {
        const booking = await api("/api/training/book", {
          method: "POST",
          body: JSON.stringify({ date: state.pickedDate }),
          as: "citizen",
        });
        state.toast = `Reserved ${booking.weekday} ${booking.date} at ${booking.time}. Waiting for the Chief's final accept.`;
        await loadCitizen();
        await loadSlots();
        await render();
        setTimeout(() => {
          state.toast = "";
        }, 8000);
      } catch (err) {
        msg.textContent = err.message;
      }
    });
  }

  const loginForm = document.getElementById("login-form");
  if (loginForm) {
    loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const msg = document.getElementById("login-msg");
      try {
        const fd = new FormData(loginForm);
        state.login = {
          username: String(fd.get("username") || "").trim(),
          password: String(fd.get("password") || ""),
          discord: String(fd.get("discord") || "").trim(),
          rank: String(fd.get("rank") || "").trim(),
          unitCode: String(fd.get("unitCode") || "").trim(),
        };
        if (msg) msg.textContent = "Signing in…";
        const data = await api("/api/auth/login", { method: "POST", body: JSON.stringify(state.login) });
        state.token = data.token;
        localStorage.setItem(STAFF_KEY, data.token);
        await loadMe();
        if (!state.me) throw new Error("Signed in, but the session did not load. Refresh and try again.");
        location.hash = "#command";
        await render();
      } catch (err) {
        if (msg) msg.textContent = err.message;
      }
    });
  }

  document.querySelectorAll("[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.commandTab = btn.dataset.tab;
      render();
    });
  });
  document.querySelectorAll("[data-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.filter = btn.dataset.filter;
      render();
    });
  });
  document.querySelectorAll("[data-app]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        const data = await api(`/api/applications/${btn.dataset.app}`, {
          method: "PATCH",
          body: JSON.stringify({ action: btn.dataset.action }),
        });
        if (data.discordNotify && ["accept", "final_accept", "final_reject"].includes(btn.dataset.action)) {
          state.toast = data.discordNotify.sent
            ? "Decision saved. Discord DM sent."
            : "Decision saved. Discord DM did not send — they may not share a server with the bot, or DMs are closed.";
        }
        await render();
        setTimeout(() => {
          state.toast = "";
        }, 8000);
      } catch (err) {
        state.toast = err.message;
        await render();
      }
    });
  });
  const logout = document.getElementById("logout");
  if (logout) {
    logout.onclick = () => {
      state.token = null;
      state.me = null;
      localStorage.removeItem(STAFF_KEY);
      render();
    };
  }

  document.querySelectorAll("[data-civ-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.civMode = btn.dataset.civMode;
      render();
    });
  });
  const civAuth = document.getElementById("civ-auth-form");
  if (civAuth) {
    civAuth.addEventListener("submit", async (e) => {
      e.preventDefault();
      const msg = document.getElementById("civ-auth-msg");
      const fd = new FormData(civAuth);
      const payload = {
        username: String(fd.get("username") || ""),
        password: String(fd.get("password") || ""),
        email: String(fd.get("email") || ""),
        discord: String(fd.get("discord") || ""),
        discordId: String(fd.get("discordId") || ""),
        standing: String(fd.get("standing") || ""),
      };
      if (state.civMode === "register") {
        payload.emailCode = String(fd.get("emailCode") || "");
        payload.notReboot = Boolean(civAuth.querySelector('[name="notReboot"]')?.checked);
        payload.humanCheckId = String(fd.get("humanCheckId") || "");
        payload.humanCheckAnswer = String(fd.get("humanCheckAnswer") || "");
        payload.oath = Boolean(civAuth.querySelector('[name="oath"]')?.checked);
        payload.deviceId = deviceId();
      }
      const body = JSON.stringify(payload);
      const path = state.civMode === "register" ? "/api/citizen/register" : "/api/citizen/login";
      try {
        if (state.civMode === "register") {
          if (!payload.notReboot) throw new Error("Check I am not reboot.");
          if (!payload.humanCheckId || !payload.humanCheckAnswer) throw new Error("Answer the picture check first.");
          if (!payload.oath) throw new Error("Confirm you will not create a second account.");
        }
        const data = await api(path, { method: "POST", body });
        state.civToken = data.token;
        localStorage.setItem(CIV_KEY, data.token);
        if (state.civMode === "register") localStorage.setItem(REG_KEY, "1");
        state.citizen = data;
        await render();
      } catch (err) {
        if (String(err.message).toLowerCase().includes("already exists")) {
          state.civMode = "signin";
        }
        msg.textContent = err.message;
      }
    });
  }
  const rebootBox = document.getElementById("not-reboot");
  if (rebootBox) {
    rebootBox.addEventListener("change", async () => {
      if (!rebootBox.checked) {
        rebootBox.checked = true;
        return;
      }
      rebootBox.disabled = true;
      const status = document.getElementById("reboot-status");
      const board = document.getElementById("human-check");
      const oathWrap = document.getElementById("oath-wrap");
      if (status) status.innerHTML = `<span class="spin"></span> Searching…`;
      await new Promise((r) => setTimeout(r, 2400));
      try {
        const data = await api("/api/citizen/human-check");
        if (status) status.textContent = "Clear. Count the items in the picture.";
        if (board) board.hidden = false;
        const prompt = document.getElementById("human-prompt");
        const art = document.getElementById("human-art");
        const hid = document.querySelector('[name="humanCheckId"]');
        if (prompt) prompt.textContent = data.prompt;
        if (art) art.innerHTML = data.svg;
        if (hid) hid.value = data.id;
        if (oathWrap) oathWrap.hidden = false;
      } catch (err) {
        rebootBox.disabled = false;
        rebootBox.checked = false;
        if (status) status.textContent = err.message;
      }
    });
  }
  const civLogout = document.getElementById("civ-logout");
  if (civLogout) {
    civLogout.onclick = () => {
      state.civToken = null;
      state.citizen = null;
      localStorage.removeItem(CIV_KEY);
      render();
    };
  }

  const settingsForm = document.getElementById("settings-form");
  if (settingsForm) {
    settingsForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const msg = document.getElementById("settings-msg");
      const hours = Number(new FormData(settingsForm).get("reapplyCooldownHours"));
      try {
        state.settings = await api("/api/settings", { method: "PUT", body: JSON.stringify({ reapplyCooldownHours: hours }) });
        const full = await api("/api/settings");
        state.settings = full;
        msg.textContent = "Cooldown saved.";
      } catch (err) {
        msg.textContent = err.message;
      }
    });
  }

  const sendCodeBtn = document.getElementById("send-email-code");
  if (sendCodeBtn) {
    sendCodeBtn.onclick = async () => {
      const form = document.getElementById("civ-auth-form");
      const msg = document.getElementById("email-code-msg");
      const email = String(new FormData(form).get("email") || "");
      try {
        await api("/api/verify/email", { method: "POST", body: JSON.stringify({ email }) });
        if (msg) msg.textContent = "Code sent. Open your email and type it below. If you do not see it, check Spam / Junk.";
      } catch (err) {
        if (msg) msg.textContent = err.message;
      }
    };
  }

  const smtpForm = document.getElementById("smtp-form");
  if (smtpForm) {
    smtpForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const msg = document.getElementById("smtp-msg");
      const fd = new FormData(smtpForm);
      try {
        const data = await api("/api/settings/mail", {
          method: "PUT",
          body: JSON.stringify({
            host: String(fd.get("host") || ""),
            port: Number(fd.get("port") || 587),
            user: String(fd.get("user") || ""),
            from: String(fd.get("from") || ""),
            pass: String(fd.get("pass") || ""),
          }),
        });
        state.settings = await api("/api/settings");
        if (msg) msg.textContent = data.configured
          ? "SMTP saved. The App password box will look empty — that is normal. It is stored."
          : "SMTP saved, but no App password is stored yet. Paste it and Save again.";
      } catch (err) {
        if (msg) msg.textContent = err.message;
      }
    });
  }
  const smtpTest = document.getElementById("smtp-test-form");
  if (smtpTest) {
    smtpTest.addEventListener("submit", async (e) => {
      e.preventDefault();
      const msg = document.getElementById("smtp-test-msg");
      try {
        await api("/api/settings/mail/test", {
          method: "POST",
          body: JSON.stringify({ to: String(new FormData(smtpTest).get("to") || "") }),
        });
        if (msg) msg.textContent = "Test email sent. Check inbox and spam.";
      } catch (err) {
        if (msg) msg.textContent = err.message;
      }
    });
  }
  const botForm = document.getElementById("discord-bot-form");
  if (botForm) {
    botForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const msg = document.getElementById("discord-bot-msg");
      try {
        await api("/api/settings/discord-bot", {
          method: "PUT",
          body: JSON.stringify({ token: String(new FormData(botForm).get("token") || "") }),
        });
        state.settings = await api("/api/settings");
        if (msg) msg.textContent = "Bot token saved. The box looks empty on purpose — it is stored.";
      } catch (err) {
        if (msg) msg.textContent = err.message;
      }
    });
  }
  const discordMessagesForm = document.getElementById("discord-messages-form");
  if (discordMessagesForm) {
    discordMessagesForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const msg = document.getElementById("discord-messages-msg");
      const fd = new FormData(discordMessagesForm);
      try {
        const data = await api("/api/settings/discord-messages", {
          method: "PUT",
          body: JSON.stringify({
            accepted: String(fd.get("accepted") || ""),
            final_accepted: String(fd.get("final_accepted") || ""),
            final_rejected: String(fd.get("final_rejected") || ""),
          }),
        });
        if (state.settings) state.settings.discordMessages = data.discordMessages;
        if (msg) msg.textContent = "Bot messages saved. The next accept or reject uses this text.";
      } catch (err) {
        if (msg) msg.textContent = err.message;
      }
    });
  }
  const trainingSettingsForm = document.getElementById("training-settings-form");
  if (trainingSettingsForm) {
    trainingSettingsForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const msg = document.getElementById("training-settings-msg");
      const fd = new FormData(trainingSettingsForm);
      try {
        const data = await api("/api/settings/training", {
          method: "PUT",
          body: JSON.stringify({
            location: String(fd.get("location") || ""),
            when: String(fd.get("when") || ""),
            message: String(fd.get("message") || ""),
          }),
        });
        if (state.settings) state.settings.training = data.training;
        if (msg) msg.textContent = "Training notice saved. Final-accept cadets see the new place immediately.";
      } catch (err) {
        if (msg) msg.textContent = err.message;
      }
    });
  }

  const docForm = document.getElementById("doc-form");
  if (docForm) {
    docForm.addEventListener("input", (e) => {
      if (e.target.name) state.docForm[e.target.name] = e.target.value;
    });
    docForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = state.docForm;
      const path = f.kind === "rule" ? "/api/rules" : "/api/protocols";
      await api(path, { method: "POST", body: JSON.stringify(f) });
      state.docForm = { kind: f.kind, code: "", title: "", body: "" };
      await render();
    });
  }
  document.querySelectorAll("[data-del-prot]").forEach((btn) => {
    btn.onclick = async () => {
      await api(`/api/protocols/${btn.dataset.delProt}`, { method: "DELETE" });
      await render();
    };
  });
  document.querySelectorAll("[data-del-rule]").forEach((btn) => {
    btn.onclick = async () => {
      await api(`/api/rules/${btn.dataset.delRule}`, { method: "DELETE" });
      await render();
    };
  });

  const staffForm = document.getElementById("staff-form");
  if (staffForm) {
    staffForm.addEventListener("input", (e) => {
      if (e.target.name) state.staffForm[e.target.name] = e.target.value;
    });
    staffForm.addEventListener("change", (e) => {
      if (e.target.name) state.staffForm[e.target.name] = e.target.value;
      if (e.target.name === "civilianId") {
        const civ = state.civilians.find((c) => c.id === e.target.value);
        if (civ) {
          if (!state.staffForm.displayName) {
            state.staffForm.displayName = civ.username;
            staffForm.querySelector('[name="displayName"]').value = civ.username;
          }
          if (!state.staffForm.username) {
            state.staffForm.username = civ.username.toLowerCase();
            staffForm.querySelector('[name="username"]').value = civ.username.toLowerCase();
          }
        }
      }
    });
    staffForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(staffForm);
      const msg = document.getElementById("staff-msg");
      try {
        const data = await api("/api/staff/commission", {
          method: "POST",
          body: JSON.stringify({
            civilianId: String(fd.get("civilianId") || ""),
            displayName: String(fd.get("displayName") || ""),
            username: String(fd.get("username") || ""),
            password: String(fd.get("password") || ""),
            discord: String(fd.get("discord") || ""),
            unitCode: String(fd.get("unitCode") || ""),
            rank: String(fd.get("rank") || "r7"),
          }),
        });
        state.issuedCreds = data.issued || null;
        state.staffForm = { username: "", password: "", displayName: "", rank: "r7", civilianId: "", discord: "", unitCode: "" };
        await render();
      } catch (err) {
        if (msg) msg.textContent = err.message;
      }
    });
  }
  document.querySelectorAll("[data-del-staff]").forEach((btn) => {
    btn.onclick = async () => {
      await api(`/api/staff/${btn.dataset.delStaff}`, { method: "DELETE" });
      await render();
    };
  });

  const ranksForm = document.getElementById("ranks-form");
  if (ranksForm) {
    ranksForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(ranksForm);
      const ranks = state.ranks.map((r) => ({ id: r.id, order: r.order, label: String(fd.get(r.id) || r.label) }));
      const msg = document.getElementById("ranks-msg");
      try {
        state.ranks = await api("/api/ranks", { method: "PUT", body: JSON.stringify({ ranks }) });
        try {
          state.me = await api("/api/auth/me");
        } catch {}
        msg.textContent = "Rank names saved. They now show with the new names on every desk.";
      } catch (err) {
        msg.textContent = err.message;
      }
    });
  }

  async function refreshDesk() {
    state.desk = await api("/api/officer/desk");
    await render();
  }

  const leaveForm = document.getElementById("leave-form");
  if (leaveForm) {
    leaveForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const msg = document.getElementById("leave-msg");
      const fd = new FormData(leaveForm);
      try {
        await api("/api/officer/leave", {
          method: "POST",
          body: JSON.stringify({ from: String(fd.get("from") || ""), to: String(fd.get("to") || ""), reason: String(fd.get("reason") || "") }),
        });
        await refreshDesk();
      } catch (err) {
        if (msg) msg.textContent = err.message;
      }
    });
  }
  const promoForm = document.getElementById("promo-form");
  if (promoForm) {
    promoForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const msg = document.getElementById("promo-msg");
      const fd = new FormData(promoForm);
      try {
        await api("/api/officer/promotion", {
          method: "POST",
          body: JSON.stringify({ targetRank: String(fd.get("targetRank") || ""), reason: String(fd.get("reason") || "") }),
        });
        await refreshDesk();
      } catch (err) {
        if (msg) msg.textContent = err.message;
      }
    });
  }
  const dutyForm = document.getElementById("duty-form");
  if (dutyForm) {
    dutyForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(dutyForm);
      try {
        await api("/api/officer/duty", { method: "POST", body: JSON.stringify({ note: String(fd.get("note") || "") }) });
        await refreshDesk();
      } catch (err) {
        alert(err.message);
      }
    });
  }
  const reportForm = document.getElementById("report-form");
  if (reportForm) {
    reportForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(reportForm);
      try {
        await api("/api/officer/report", {
          method: "POST",
          body: JSON.stringify({ title: String(fd.get("title") || ""), body: String(fd.get("body") || "") }),
        });
        await refreshDesk();
      } catch (err) {
        alert(err.message);
      }
    });
  }
  const chatForm = document.getElementById("chat-form");
  if (chatForm) {
    chatForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(chatForm);
      try {
        await api("/api/officer/chat", { method: "POST", body: JSON.stringify({ text: String(fd.get("text") || "") }) });
        await refreshDesk();
      } catch (err) {
        alert(err.message);
      }
    });
  }
  const chatLog = document.getElementById("chat-log");
  if (chatLog) chatLog.scrollTop = chatLog.scrollHeight;

  document.querySelectorAll("[data-leave]").forEach((btn) => {
    btn.onclick = async () => {
      await api(`/api/officer/leave/${btn.dataset.leave}`, { method: "PATCH", body: JSON.stringify({ action: btn.dataset.action }) });
      await refreshDesk();
    };
  });
  document.querySelectorAll("[data-promo]").forEach((btn) => {
    btn.onclick = async () => {
      await api(`/api/officer/promotion/${btn.dataset.promo}`, { method: "PATCH", body: JSON.stringify({ action: btn.dataset.action }) });
      await refreshDesk();
    };
  });

  const inviteBtn = document.getElementById("invite-btn");
  if (inviteBtn) {
    inviteBtn.onclick = async () => {
      await api("/api/invites", { method: "POST", body: JSON.stringify({}) });
      state.settings = await api("/api/settings");
      await render();
    };
  }

  document.querySelectorAll("[data-ticket-type]").forEach((btn) => {
    btn.onclick = () => {
      state.ticketType = btn.dataset.ticketType;
      render();
    };
  });
  const ticketForm = document.getElementById("ticket-form");
  if (ticketForm) {
    ticketForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const msg = document.getElementById("ticket-msg");
      const fd = new FormData(ticketForm);
      try {
        await api("/api/tickets", {
          method: "POST",
          as: state.token ? "staff" : "citizen",
          body: JSON.stringify({
            type: state.ticketType,
            name: String(fd.get("name") || ""),
            discord: String(fd.get("discord") || ""),
            againstOfficer: String(fd.get("againstOfficer") || ""),
            title: String(fd.get("title") || ""),
            body: String(fd.get("body") || ""),
          }),
        });
        if (msg) msg.textContent = "Ticket submitted.";
        await render();
      } catch (err) {
        if (msg) msg.textContent = err.message;
      }
    });
  }
  document.querySelectorAll(".ticket-reply").forEach((form) => {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      await api(`/api/tickets/${form.dataset.ticketId}/replies`, {
        method: "POST",
        body: JSON.stringify({ text: String(fd.get("text") || "") }),
      });
      await render();
    });
  });
  document.querySelectorAll("[data-close-ticket]").forEach((btn) => {
    btn.onclick = async () => {
      await api(`/api/tickets/${btn.dataset.closeTicket}`, { method: "PATCH", body: JSON.stringify({ action: "close" }) });
      await render();
    };
  });
}

window.addEventListener("hashchange", setRoute);
loadMeta().then(loadMe).then(setRoute);
