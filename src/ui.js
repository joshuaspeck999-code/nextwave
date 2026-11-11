// =====================================================================
// NEXTWAVE - Gemeinsame UI-Bausteine (reine HTML-Erzeuger)
// =====================================================================
import { escapeHtml, avatarUrl, initials, formatCount, publicUrl } from "./utils.js";

/* ---------------------------------------------------------------------
   Icons (inline SVG, erben die Textfarbe)
--------------------------------------------------------------------- */
const PATHS = {
  home: '<path d="M3 10.5 12 3l9 7.5V21a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
  plus: '<rect x="3.5" y="3.5" width="17" height="17" rx="5"/><path d="M12 8.5v7M8.5 12h7"/>',
  heart: '<path d="M12 20.5S4.5 16 4.5 10.5A4 4 0 0 1 12 8.2a4 4 0 0 1 7.5 2.3C19.5 16 12 20.5 12 20.5z"/>',
  user: '<circle cx="12" cy="8.5" r="4"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>',
  comment: '<path d="M20.5 12a8.5 8.5 0 0 1-8.5 8.5H8.5L4 23v-4.2A8.5 8.5 0 1 1 20.5 12z"/>',
  bookmark: '<path d="M6.5 3.5h11v17l-5.5-3.8-5.5 3.8z"/>',
  share: '<path d="M4 11.5v7a1.5 1.5 0 0 0 1.5 1.5h13a1.5 1.5 0 0 0 1.5-1.5v-7"/><path d="M12 3v13"/><path d="m7.5 7.5 4.5-4.5 4.5 4.5"/>',
  volume: '<path d="M4 9.5v5h3l4 3.5V6L7 9.5H4z"/><path d="M15 9.5a3.5 3.5 0 0 1 0 5"/><path d="M17.5 7a7 7 0 0 1 0 10"/>',
  mute: '<path d="M4 9.5v5h3l4 3.5V6L7 9.5H4z"/><path d="m15 10 4 4M19 10l-4 4"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  more: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8"/>',
  play: '<path d="M8 5.5v13l11-6.5z"/>',
  grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/>',
  link: '<path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1"/>',
  logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 12H3"/><path d="m6.5 8.5-3.5 3.5 3.5 3.5"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="3"/><circle cx="9" cy="10" r="1.6"/><path d="m5 18 5-5 4 4 2.5-2.5L20 18"/>',
  flag: '<path d="M6 21V4h12l-2 4 2 4H6"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  trash: '<path d="M4.5 7h15"/><path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7"/><path d="M6.5 7l1 12.5A1.5 1.5 0 0 0 9 21h6a1.5 1.5 0 0 0 1.5-1.5L17.5 7"/>',
  bell: '<path d="M6 9a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>',
};

export function icon(name, cls = "") {
  const p = PATHS[name] || "";
  return `<svg class="ico ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
}

/* ---------------------------------------------------------------------
   Avatar
--------------------------------------------------------------------- */
export function avatarHtml(profile, size = "md", extraClass = "") {
  const url = avatarUrl(profile);
  const name = profile?.display_name || profile?.username || "?";
  const style = url ? ` style="background-image:url('${escapeHtml(url)}')"` : "";
  const inner = url ? "" : escapeHtml(initials(name));
  return `<div class="avatar ${size} ${extraClass}"${style}>${inner}</div>`;
}

/* ---------------------------------------------------------------------
   Untere Navigation
--------------------------------------------------------------------- */
export function bottomNav(active, unreadCount = 0) {
  const items = [
    { key: "home",     name: "home",    label: "Home" },
    { key: "discover", name: "compass", label: "Entdecken" },
    { key: "upload",   name: "plus",    label: "Upload" },
    { key: "activity", name: "heart",   label: "Aktivitaeten" },
    { key: "profile",  name: "user",    label: "Profil" },
  ];
  const badge = unreadCount > 0
    ? `<span class="nav-badge">${unreadCount > 99 ? "99+" : unreadCount}</span>`
    : "";
  return `<nav class="bottom-nav" role="navigation" aria-label="Hauptnavigation">
    ${items.map((it) => `
      <button class="nav-item ${it.key === active ? "active" : ""} ${it.key === "upload" ? "upload" : ""}"
              data-nav="${it.key}" aria-label="${it.label}"
              ${it.key === active ? 'aria-current="page"' : ""}>
        <span class="icon">${icon(it.name)}</span>
        <span>${it.label}</span>
        ${it.key === "activity" ? badge : ""}
      </button>`).join("")}
  </nav>`;
}

/* ---------------------------------------------------------------------
   Zustaende
--------------------------------------------------------------------- */
export function emptyState(emoji, title, text = "") {
  return `<div class="empty">
    <div class="emoji">${emoji}</div>
    <div style="color:var(--text);font-weight:600;margin-bottom:6px;">${escapeHtml(title)}</div>
    ${text ? `<div class="small">${escapeHtml(text)}</div>` : ""}
  </div>`;
}

export function errorState(message, actionLabel = "Erneut versuchen", actionAttr = "data-retry") {
  return `<div class="empty">
    <div class="emoji">&#9888;</div>
    <div style="color:var(--text);font-weight:600;margin-bottom:6px;">Etwas ist schiefgelaufen</div>
    <div class="small" style="margin-bottom:16px;">${escapeHtml(message)}</div>
    <button class="btn btn-ghost" style="max-width:220px;margin:0 auto;" ${actionAttr}>
      ${escapeHtml(actionLabel)}
    </button>
  </div>`;
}

export function skeletonRows(count = 5) {
  return Array.from({ length: count }).map(() =>
    `<div class="row" style="gap:12px;padding:10px 0;">
       <div class="skeleton" style="width:44px;height:44px;border-radius:50%;"></div>
       <div style="flex:1;">
         <div class="skeleton" style="height:12px;width:45%;margin-bottom:8px;"></div>
         <div class="skeleton" style="height:10px;width:70%;"></div>
       </div>
     </div>`
  ).join("");
}

/* ---------------------------------------------------------------------
   Formatierung
--------------------------------------------------------------------- */
export function timeAgo(iso) {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const sec = Math.floor(Math.max(0, Date.now() - then) / 1000);
  if (sec < 60) return "gerade eben";
  const min = Math.floor(sec / 60);
  if (min < 60) return `vor ${min} Min.`;
  const h = Math.floor(min / 60);
  if (h < 24) return `vor ${h} Std.`;
  const d = Math.floor(h / 24);
  if (d < 7) return `vor ${d} Tg.`;
  const w = Math.floor(d / 7);
  if (w < 5) return `vor ${w} Wo.`;
  return new Date(iso).toLocaleDateString("de-DE");
}

export function memberSince(iso) {
  if (!iso) return "";
  return "Dabei seit " + new Date(iso).toLocaleDateString("de-DE", { month: "long", year: "numeric" });
}

/* ---------------------------------------------------------------------
   Video-Kachel fuer Rasteransichten
--------------------------------------------------------------------- */
export function videoTile(video) {
  const thumb = video.thumbnail_path ? publicUrl("thumbnails", video.thumbnail_path) : null;
  const style = thumb ? ` style="background-image:url('${escapeHtml(thumb)}')"` : "";
  const flag = video.moderation_status && video.moderation_status !== "approved"
    ? `<span class="tile-flag">${escapeHtml(statusLabel(video.moderation_status))}</span>` : "";
  return `<button class="tile" data-watch="${escapeHtml(video.id)}"${style} aria-label="Video oeffnen">
    <span class="tile-views">${icon("play")} ${formatCount(video.view_count)}</span>
    ${flag}
  </button>`;
}

export function statusLabel(status) {
  return { pending: "In Pruefung", rejected: "Entfernt", removed: "Entfernt", approved: "" }[status] || status;
}

/* ---------------------------------------------------------------------
   Nutzer-Zeile fuer Listen
--------------------------------------------------------------------- */
export function userRow(profile, { showFollow = false, following = false } = {}) {
  return `<div class="user-row" data-open-user="${escapeHtml(profile.id)}" role="button" tabindex="0">
    ${avatarHtml(profile, "sm")}
    <div class="grow" style="min-width:0;">
      <div class="user-row-name">${escapeHtml(profile.display_name || profile.username)}</div>
      <div class="small muted">@${escapeHtml(profile.username)} &middot; ${formatCount(profile.follower_count)} Follower</div>
    </div>
    ${showFollow
      ? `<button class="btn-pill ${following ? "following" : ""}" data-follow="${escapeHtml(profile.id)}">
           ${following ? "Folgt" : "Folgen"}
         </button>`
      : `<span class="btn-pill ghost">Ansehen</span>`}
  </div>`;
}
