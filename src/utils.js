// =====================================================================
// NEXTWAVE - Hilfsfunktionen: Validierung, Fehlermeldungen, Formatierung
// =====================================================================
import { SUPABASE_URL } from "./config.js";

/* ---------- Text / Sicherheit ---------- */

/** Escaped HTML, damit Nutzereingaben keinen Code ausfuehren koennen. */
export function escapeHtml(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** 1200 -> "1,2K"  */
export function formatCount(n) {
  const num = Number(n) || 0;
  if (num < 1000) return String(num);
  if (num < 1_000_000) return (num / 1000).toFixed(num < 10_000 ? 1 : 0).replace(".", ",") + "K";
  return (num / 1_000_000).toFixed(1).replace(".", ",") + "M";
}

/** Initialen fuer den Avatar-Platzhalter. */
export function initials(name) {
  const s = (name || "?").trim();
  return s.slice(0, 2).toUpperCase();
}

export function debounce(fn, ms = 400) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/* ---------- Validierung (identisch zur Datenbank) ---------- */

export const USERNAME_PATTERN = /^[a-z0-9._]{3,24}$/;
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const validators = {
  email: (v) => (EMAIL_PATTERN.test((v || "").trim()) ? null : "Bitte eine gueltige E-Mail-Adresse eingeben."),
  username: (v) =>
    USERNAME_PATTERN.test((v || "").trim())
      ? null
      : "3-24 Zeichen, nur Kleinbuchstaben, Zahlen, Punkt und Unterstrich.",
  password: (v) => ((v || "").length >= 8 ? null : "Das Passwort muss mindestens 8 Zeichen haben."),
  passwordRepeat: (v, original) => (v === original ? null : "Die Passwoerter stimmen nicht ueberein."),
  birthdate: (v) => {
    if (!v) return null;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return "Ungueltiges Geburtsdatum.";
    if (d > new Date()) return "Das Geburtsdatum kann nicht in der Zukunft liegen.";
    return null;
  },
};

/* ---------- Storage-URLs ---------- */

/** Oeffentliche URL eines Objekts in einem oeffentlichen Bucket. */
export function publicUrl(bucket, path) {
  if (!path) return null;
  return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`;
}

export function avatarUrl(profile) {
  if (!profile?.avatar_path) return null;
  return publicUrl("avatars", profile.avatar_path);
}

export function bannerUrl(profile) {
  if (!profile?.banner_path) return null;
  return publicUrl("banners", profile.banner_path);
}

/* ---------- Fehlermeldungen (immer verstaendlich, immer deutsch) ---------- */

export function describeError(error) {
  if (!error) return "Es ist ein unbekannter Fehler aufgetreten.";

  // Keine Verbindung
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return "Keine Internetverbindung. Bitte pruefe dein Netzwerk.";
  }
  if (error instanceof TypeError && /fetch/i.test(error.message || "")) {
    return "Keine Verbindung zum Server. Bitte pruefe dein Netzwerk.";
  }

  const msg = (error.message || "").toLowerCase();
  const code = error.code || error.status || "";

  // --- Auth-Fehler ---
  if (msg.includes("invalid login credentials")) return "E-Mail oder Passwort ist falsch.";
  if (msg.includes("user already registered") || msg.includes("already been registered"))
    return "Diese E-Mail-Adresse ist bereits registriert.";
  if (msg.includes("email not confirmed")) return "Bitte bestaetige zuerst deine E-Mail-Adresse.";
  if (msg.includes("password should be at least")) return "Das Passwort ist zu kurz (mindestens 8 Zeichen).";
  if (msg.includes("unable to validate email") || msg.includes("invalid email"))
    return "Diese E-Mail-Adresse ist ungueltig.";
  if (msg.includes("rate limit") || msg.includes("too many requests"))
    return "Zu viele Versuche. Bitte warte einen Moment.";
  if (msg.includes("user not found")) return "Zu dieser E-Mail existiert kein Konto.";
  if (msg.includes("same password")) return "Das neue Passwort muss sich vom alten unterscheiden.";
  if (msg.includes("jwt") || msg.includes("token has expired"))
    return "Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.";

  // --- Datenbank-Fehler (PostgREST) ---
  if (code === "23505") return "Dieser Wert ist bereits vergeben.";
  if (code === "23503") return "Der zugehoerige Datensatz existiert nicht mehr.";
  if (code === "42501") return "Keine Berechtigung fuer diese Aktion.";
  if (code === "PGRST116") return "Der gesuchte Datensatz wurde nicht gefunden.";
  if (code === "PGRST301") return "Keine gueltige Sitzung. Bitte melde dich erneut an.";

  // --- Storage ---
  if (msg.includes("payload too large") || code === "413")
    return "Die Datei ist zu gross fuer den Upload.";
  if (msg.includes("mime type") || msg.includes("invalid file type"))
    return "Dieser Dateityp ist nicht erlaubt.";
  if (msg.includes("duplicate") && msg.includes("object"))
    return "Diese Datei existiert bereits.";

  return error.message || "Es ist ein Fehler aufgetreten. Bitte versuche es erneut.";
}

/* ---------- Toast ---------- */

let toastTimer;
export function toast(message, type = "info") {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = message;
  el.className = "toast" + (type === "error" ? " error" : type === "success" ? " success" : "");
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 4200);
}

/* ---------- DOM ---------- */

export function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}
