// =====================================================================
// NEXTWAVE - App-Shell (Einstiegspunkt)
// =====================================================================
// Aufgaben:
//   * Supabase-Sitzung aufbauen und dauerhaft wiederherstellen
//   * Zwischen den Ansichten routen (Hash-Routing)
//   * Untere Navigation verdrahten
//   * Das gemeinsam genutzte ctx-Objekt bereitstellen
//
// Jede Ansicht rendert ihre eigene Bildschirmstruktur (inkl. unterer
// Navigation). Diese Datei entscheidet nur, WELCHE Ansicht wann dran ist.
// =====================================================================
import { supabase } from "./supabaseClient.js";
import { IS_CONFIGURED } from "./config.js";
import { describeError, toast, escapeHtml } from "./utils.js";
import { errorState, icon } from "./ui.js";
import * as data from "./data.js";

import {
  renderWelcome, renderSignUp, renderLogin,
  renderForgotPassword, renderResetPassword,
} from "./auth.js";
import { renderFeed, renderWatch } from "./feed.js";
import { renderUpload } from "./upload.js";
import {
  renderMyProfile, renderUserProfile, renderConnections, renderEditProfile,
} from "./profile.js";
import { renderDiscover, renderActivity, renderAdmin } from "./misc.js";

const root = document.getElementById("app");

/* ---------------------------------------------------------------------
   Routing-Tabelle
--------------------------------------------------------------------- */
const PAGES = {
  welcome: renderWelcome,
  signup: renderSignUp,
  login: renderLogin,
  forgot: renderForgotPassword,
  resetPassword: renderResetPassword,

  home: renderFeed,
  watch: renderWatch,
  upload: renderUpload,
  discover: renderDiscover,
  activity: renderActivity,
  profile: renderMyProfile,
  user: renderUserProfile,
  connections: renderConnections,
  editProfile: renderEditProfile,
  admin: renderAdmin,
};

// Seiten, die ohne Anmeldung erreichbar sind.
const AUTH_PAGES = new Set(["welcome", "signup", "login", "forgot", "resetPassword"]);

/* ---------------------------------------------------------------------
   Zustand
--------------------------------------------------------------------- */
let booted = false;       // Erststart abgeschlossen?
let recoveryMode = false; // Passwort-zuruecksetzen-Link geoeffnet?

/* ---------------------------------------------------------------------
   Gemeinsamer Kontext fuer alle Ansichten
--------------------------------------------------------------------- */
const ctx = {
  user: null,
  profile: null,
  unreadCount: 0,
  settings: null,   // globale Plattform-Einstellungen (Lockdown & Schalter)
  navigate,
  signOut,
  refreshUnread,
};

/* =====================================================================
   Routing (Hash-basiert: #/page?param=wert)
===================================================================== */
function parseHash() {
  const raw = location.hash.replace(/^#\/?/, "");
  const [path, query] = raw.split("?");
  const params = {};
  if (query) new URLSearchParams(query).forEach((v, k) => { params[k] = v; });
  return { page: path || "", params };
}

function buildHash(page, params) {
  const qs = new URLSearchParams(
    Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== null)
  ).toString();
  return "#/" + page + (qs ? "?" + qs : "");
}

/** Wechselt die Ansicht. */
function navigate(page, params) {
  const hash = buildHash(page, params);
  if (location.hash === hash) {
    render();
  } else {
    location.hash = hash; // loest "hashchange" aus -> render()
  }
}

/* =====================================================================
   Untere Navigation (delegiert, ueberlebt Neu-Rendern)
===================================================================== */
document.addEventListener("click", (event) => {
  const item = event.target.closest("[data-nav]");
  if (!item) return;
  if (!ctx.user) return;
  navigate(item.dataset.nav);
});

/* =====================================================================
   Sitzung & Kontext
===================================================================== */
async function loadContext() {
  if (!ctx.user) return;
  try {
    ctx.profile = await data.getMyProfile(ctx.user.id);
  } catch {
    ctx.profile = null;
  }
  try {
    ctx.unreadCount = await data.countUnreadNotifications(ctx.user.id);
  } catch {
    ctx.unreadCount = 0;
  }
  try {
    ctx.settings = await data.getPlatformSettings();
  } catch {
    ctx.settings = null;
  }
  updateNavBadge();
}

/** Ist die Plattform im Lockdown und darf dieser Nutzer nicht durch? */
function isLockedOut() {
  if (!ctx.settings?.lockdown_enabled) return false;
  const role = ctx.profile?.role;
  return role !== "admin" && role !== "moderator";
}

async function refreshUnread() {
  if (!ctx.user) { ctx.unreadCount = 0; updateNavBadge(); return; }
  try {
    ctx.unreadCount = await data.countUnreadNotifications(ctx.user.id);
  } catch {
    ctx.unreadCount = 0;
  }
  updateNavBadge();
}

/** Aktualisiert das Zaehler-Abzeichen, ohne die Seite neu zu rendern. */
function updateNavBadge() {
  const btn = document.querySelector('[data-nav="activity"]');
  if (!btn) return;
  let badge = btn.querySelector(".nav-badge");
  if (ctx.unreadCount > 0) {
    if (!badge) {
      badge = document.createElement("span");
      badge.className = "nav-badge";
      btn.appendChild(badge);
    }
    badge.textContent = ctx.unreadCount > 99 ? "99+" : String(ctx.unreadCount);
  } else if (badge) {
    badge.remove();
  }
}

async function signOut() {
  try {
    await supabase.auth.signOut();
  } catch (error) {
    toast(describeError(error), "error");
  }
  ctx.user = null;
  ctx.profile = null;
  ctx.unreadCount = 0;
  recoveryMode = false;
  navigate("welcome");
}

/* =====================================================================
   Render-Schleife
===================================================================== */
async function render() {
  const { page, params } = parseHash();
  let target = page || (ctx.user ? "home" : "welcome");

  // Zugriffsschutz
  if (!ctx.user && !AUTH_PAGES.has(target)) { navigate("welcome"); return; }
  if (ctx.user && AUTH_PAGES.has(target) && target !== "resetPassword") {
    navigate("home");
    return;
  }

  const view = PAGES[target];
  if (!view) { navigate(ctx.user ? "home" : "welcome"); return; }

  // Lockdown: normale Nutzer sehen einen Sperrbildschirm.
  if (ctx.user && isLockedOut() && !AUTH_PAGES.has(target)) {
    renderLockdownScreen();
    return;
  }

  // Vorherige Ansicht aufraeumen (laufende Videos stoppen).
  root.querySelectorAll("video").forEach((v) => { try { v.pause(); } catch { /* egal */ } });

  root.innerHTML = `
    <div class="screen no-nav">
      <div class="center" style="margin-top:40vh;"><div class="spinner"></div></div>
    </div>`;

  try {
    await view(root, ctx, params);
  } catch (error) {
    root.innerHTML = `<div class="screen no-nav">${errorState(describeError(error))}</div>`;
    const retry = root.querySelector("[data-retry]");
    if (retry) retry.onclick = render;
  }
}

/** Vollbild-Sperrbildschirm waehrend eines aktiven Lockdowns. */
function renderLockdownScreen() {
  const message = ctx.settings?.lockdown_message
    || "NEXTWAVE ist vor\u00fcbergehend pausiert. Bitte schau sp\u00e4ter noch einmal vorbei.";
  root.innerHTML = `
    <div class="screen no-nav">
      <div class="center" style="margin-top:22vh;">
        <div class="wordmark">NEXTWAVE</div>
        <div class="lockdown-icon">${icon("lock")}</div>
        <h2 style="margin:16px 0 6px;">Kurz pausiert</h2>
        <p class="muted" style="max-width:340px;">${escapeHtml(message)}</p>
        <div class="row" style="gap:10px;margin-top:22px;">
          <button class="btn btn-primary" data-reload>Erneut versuchen</button>
          <button class="btn btn-ghost" data-logout>Abmelden</button>
        </div>
      </div>
    </div>`;

  root.querySelector("[data-reload]").onclick = async () => {
    await loadContext();
    render();
  };
  root.querySelector("[data-logout]").onclick = () => signOut();
}

/* =====================================================================
   Auth-Status
===================================================================== */
async function onAuthChange(event, session) {
  if (event === "SIGNED_OUT") {
    ctx.user = null;
    ctx.profile = null;
    ctx.unreadCount = 0;
    recoveryMode = false;
    navigate("welcome");
    return;
  }

  if (event === "PASSWORD_RECOVERY") {
    recoveryMode = true;
    if (session?.user) {
      ctx.user = session.user;
      await loadContext();
    }
    navigate("resetPassword");
    return;
  }

  if (session?.user) {
    ctx.user = session.user;
    await loadContext();
    if ((event === "SIGNED_IN" || event === "INITIAL_SESSION") && !recoveryMode) {
      const { page } = parseHash();
      if (!page || AUTH_PAGES.has(page)) navigate("home");
    }
  }
}

/* =====================================================================
   Erststart
===================================================================== */
function renderConfigError() {
  root.innerHTML = `
    <div class="screen no-nav">
      <div class="center" style="margin-top:30vh;">
        <div class="wordmark">NEXTWAVE</div>
      </div>
      <div class="card stack" style="margin-top:24px;">
        <h2>Verbindung fehlt</h2>
        <p class="muted small">
          Die Supabase-Zugangsdaten sind nicht gesetzt. Bitte trage
          <code>SUPABASE_URL</code> und <code>SUPABASE_ANON_KEY</code>
          in <code>src/config.js</code> ein.
        </p>
      </div>
    </div>`;
}

async function boot() {
  if (!IS_CONFIGURED) { renderConfigError(); return; }

  // Deep-Links aus der Adresszeile (?u=<benutzername>, ?v=<video-id>)
  const search = new URLSearchParams(location.search);
  const deepUser = search.get("u");
  const deepVideo = search.get("v");

  // Bestehende Sitzung wiederherstellen (z. B. nach Neuinstallation/Neuladen).
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    if (sessionData?.session?.user) {
      ctx.user = sessionData.session.user;
      await loadContext();
    }
  } catch {
    ctx.user = null;
  }

  // Auf Aenderungen des Auth-Status reagieren.
  supabase.auth.onAuthStateChange((event, session) => {
    // Verzoegert ausfuehren, damit keine Supabase-Interna blockiert werden.
    setTimeout(() => {
      if (!booted) return; // Erststart uebernimmt boot()
      onAuthChange(event, session);
    }, 0);
  });

  booted = true;

  // Erstes Ziel bestimmen: Deep-Link schlaegt Hash schlaegt Standard.
  if (ctx.user && deepVideo) {
    navigate("watch", { id: deepVideo });
    return;
  }
  if (ctx.user && deepUser) {
    await openUserByUsername(deepUser);
    return;
  }
  render();
}

async function openUserByUsername(username) {
  try {
    const profile = await data.getProfileByUsername(username);
    if (profile) { navigate("user", { id: profile.id }); return; }
    toast("Profil nicht gefunden.", "error");
  } catch {
    toast("Profil konnte nicht geladen werden.", "error");
  }
  navigate("home");
}

/* =====================================================================
   Start
===================================================================== */
window.addEventListener("hashchange", render);

window.addEventListener("offline", () =>
  toast("Keine Internetverbindung.", "error"));
window.addEventListener("online", () =>
  toast("Wieder online.", "success"));

boot();
