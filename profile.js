// =====================================================================
// NEXTWAVE - Profil
//   renderMyProfile   - eigenes Profil mit Tabs (Videos/Geliked/Gespeichert)
//   renderUserProfile - fremdes Profil mit Folgen-Button
//   renderEditProfile - Profil bearbeiten (inkl. Avatar- und Banner-Upload)
//   renderConnections - Follower / Gefolgte
// =====================================================================
import * as data from "./data.js";
import {
  escapeHtml, validators, describeError, toast, debounce,
  publicUrl, formatCount,
} from "./utils.js";
import {
  icon, avatarHtml, bottomNav, emptyState, errorState, skeletonRows,
  userRow, memberSince, videoTile, badgeHtml,
} from "./ui.js";
import { MAX_BANNER_BYTES, IMAGE_MIME_TYPES } from "./config.js";

/* =====================================================================
   Eigenes Profil
===================================================================== */
export async function renderMyProfile(root, ctx) {
  root.innerHTML = `
    <div class="screen">
      <div data-body>${skeletonRows(3)}</div>
    </div>
    ${bottomNav("profile", ctx.unreadCount)}`;
  const body = root.querySelector("[data-body]");
  try {
    const profile = await data.getMyProfile(ctx.user.id);
    if (!profile) throw new Error("Profil konnte nicht geladen werden.");
    ctx.profile = profile;
    body.innerHTML = profileHeader(profile, { isSelf: true });
    wireHeader(root, profile, ctx);
    mountGrid(root, ctx, profile, "videos");
  } catch (error) {
    body.innerHTML = errorState(describeError(error));
    const retry = body.querySelector("[data-retry]");
    if (retry) retry.onclick = () => renderMyProfile(root, ctx);
  }
}

/* =====================================================================
   Fremdes Profil
===================================================================== */
export async function renderUserProfile(root, ctx, params) {
  const id = params?.id;
  root.innerHTML = `
    <div class="screen">
      <div class="topbar">
        <button class="icon-btn" data-back aria-label="Zurueck">${icon("back")}</button>
        <h2 class="grow" style="margin:0;" data-title></h2>
      </div>
      <div data-body>${skeletonRows(3)}</div>
    </div>`;
  root.querySelector("[data-back]").onclick = () => history.back();
  const body = root.querySelector("[data-body]");

  if (id === ctx.user.id) { ctx.navigate("profile"); return; }

  try {
    const profile = await data.getProfileById(id);
    if (!profile) {
      body.innerHTML = emptyState("&#128100;", "Profil nicht verfuegbar",
        "Es existiert nicht oder ist privat.");
      return;
    }
    root.querySelector("[data-title]").textContent = "@" + profile.username;
    const following = await data.isFollowing(ctx.user.id, profile.id).catch(() => false);
    body.innerHTML = profileHeader(profile, { isSelf: false, following });
    wireHeader(root, profile, ctx);
    wireFollowButton(body, profile.id, following, ctx);
    mountGrid(root, ctx, profile, "videos");
  } catch (error) {
    body.innerHTML = errorState(describeError(error));
  }
}

/* =====================================================================
   Gemeinsamer Kopfbereich
===================================================================== */
function profileHeader(profile, { isSelf, following = false }) {
  const banner = profile.banner_path ? publicUrl("banners", profile.banner_path) : null;
  const bannerStyle = banner
    ? `background-image:url('${escapeHtml(banner)}')`
    : "";
  const website = profile.website_url
    ? `<a href="${escapeHtml(normalizeUrl(profile.website_url))}" target="_blank" rel="noopener noreferrer">
         ${escapeHtml(profile.website_url)}</a>`
    : "";

  return `
    <div class="profile-head">
      <div class="profile-banner" style="${bannerStyle}"></div>
      <div class="profile-id">
        ${avatarHtml(profile, "xl", "profile-avatar")}
        <div class="profile-actions">
          ${isSelf
            ? `${(profile.role === "admin" || profile.role === "moderator")
                 ? `<button class="btn btn-ghost btn-compact" data-admin>${icon("flag")} Moderation</button>`
                 : ""}
               <button class="btn btn-ghost btn-compact" data-edit>${icon("settings")} Bearbeiten</button>
               <button class="btn btn-ghost btn-compact" data-share-profile aria-label="Profil teilen">${icon("share")}</button>`
            : `<button class="btn ${following ? "btn-ghost" : "btn-primary"} btn-compact" data-follow-main>
                 ${following ? "Folgt" : "Folgen"}
               </button>
               <button class="btn btn-ghost btn-compact" data-share-profile aria-label="Profil teilen">${icon("share")}</button>`}
        </div>
      </div>

      <h2 style="margin:0 0 2px;">${escapeHtml(profile.display_name || profile.username)}${badgeHtml(profile)}</h2>
      <div class="muted small">@${escapeHtml(profile.username)}
        ${profile.is_private ? `<span class="badge" style="margin-left:6px;">${icon("lock")} Privat</span>` : ""}
      </div>
      ${profile.bio ? `<p class="profile-bio">${escapeHtml(profile.bio)}</p>` : ""}
      ${website ? `<div class="small">${icon("link")} ${website}</div>` : ""}
      <div class="muted small" style="margin-top:4px;">${escapeHtml(memberSince(profile.created_at))}</div>
    </div>

    <div class="stats-row">
      <div class="stat"><div class="value">${profile.video_count}</div><div class="name">Videos</div></div>
      <button class="stat stat-btn" data-conn="followers"><div class="value">${profile.follower_count}</div><div class="name">Follower</div></button>
      <button class="stat stat-btn" data-conn="following"><div class="value">${profile.following_count}</div><div class="name">Gefolgt</div></button>
      <div class="stat"><div class="value">${formatCount(profile.total_like_count)}</div><div class="name">Likes</div></div>
    </div>

    <div class="tabs">
      <button class="tab active" data-tab="videos">Videos</button>
      ${isSelf ? `
        <button class="tab" data-tab="liked">Geliked</button>
        <button class="tab" data-tab="saved">Gespeichert</button>` : ""}
    </div>
    <div data-grid class="video-grid">${gridSkeleton()}</div>`;
}

function wireHeader(root, profile, ctx) {
  const shareBtn = root.querySelector("[data-share-profile]");
  if (shareBtn) shareBtn.onclick = () => shareProfile(profile);

  const editBtn = root.querySelector("[data-edit]");
  if (editBtn) editBtn.onclick = () => ctx.navigate("editProfile");

  const adminBtn = root.querySelector("[data-admin]");
  if (adminBtn) adminBtn.onclick = () => ctx.navigate("admin");

  const tabs = root.querySelectorAll("[data-tab]");
  if (tabs.length) {
    tabs.forEach((tab) => {
      tab.onclick = () => {
        tabs.forEach((t) => t.classList.remove("active"));
        tab.classList.add("active");
        mountGrid(root, ctx, profile, tab.dataset.tab);
      };
    });
  }

  root.querySelectorAll("[data-conn]").forEach((b) => {
    b.onclick = () => ctx.navigate("connections", { id: profile.id, tab: b.dataset.conn });
  });
}

function wireFollowButton(root, targetId, following, ctx) {
  const btn = root.querySelector('[data-follow-main]');
  if (!btn) return;
  let state = following;
  btn.onclick = async () => {
    btn.disabled = true;
    try {
      if (state) { await data.unfollow(ctx.user.id, targetId); state = false; }
      else { await data.follow(ctx.user.id, targetId); state = true; }
      btn.textContent = state ? "Folgt" : "Folgen";
      btn.className = `btn ${state ? "btn-ghost" : "btn-primary"} btn-compact`;
      toast(state ? "Du folgst jetzt." : "Nicht mehr gefolgt.", "success");
    } catch (error) {
      toast(describeError(error), "error");
    } finally {
      btn.disabled = false;
    }
  };
}

function shareProfile(profile) {
  const url = `${location.origin}${location.pathname}?u=${profile.username}`;
  if (navigator.share) { navigator.share({ title: "NEXTWAVE", url }).catch(() => {}); return; }
  navigator.clipboard?.writeText(url)
    .then(() => toast("Profil-Link kopiert.", "success"))
    .catch(() => toast(url));
}

/* =====================================================================
   Video-Raster mit Tabs
===================================================================== */
async function mountGrid(root, ctx, profile, tab) {
  const grid = root.querySelector("[data-grid]");
  if (!grid) return;
  grid.innerHTML = gridSkeleton();

  try {
    let videos = [];
    if (tab === "videos") videos = await data.listVideos({ userId: profile.id, limit: 30 });
    else if (tab === "liked") videos = await data.listLikedVideos(profile.id);
    else if (tab === "saved") videos = await data.listSavedVideos(profile.id);

    if (!videos.length) {
      const messages = {
        videos: ["&#127916;", "Noch keine Videos", "Hier erscheinen die Veroeffentlichungen."],
        liked: ["&#10084;", "Noch keine Likes", "Gelikte Videos erscheinen hier."],
        saved: ["&#128278;", "Noch nichts gespeichert", "Gespeicherte Videos erscheinen hier."],
      };
      const [emoji, title, text] = messages[tab] || messages.videos;
      grid.classList.add("grid-empty");
      grid.innerHTML = emptyState(emoji, title, text);
      return;
    }
    grid.classList.remove("grid-empty");
    grid.innerHTML = videos.map(videoTile).join("");
    grid.querySelectorAll("[data-watch]").forEach((tile) => {
      tile.onclick = () => ctx.navigate("watch", { id: tile.dataset.watch });
    });
  } catch (error) {
    grid.classList.add("grid-empty");
    grid.innerHTML = errorState(describeError(error));
  }
}

function gridSkeleton() {
  return Array.from({ length: 6 }).map(() =>
    `<div class="skeleton" style="aspect-ratio:3/4;border-radius:12px;"></div>`).join("");
}

/* =====================================================================
   Follower / Gefolgte
===================================================================== */
export async function renderConnections(root, ctx, params) {
  const userId = params?.id || ctx.user.id;
  const tab = params?.tab === "following" ? "following" : "followers";
  root.innerHTML = `
    <div class="screen">
      <div class="topbar">
        <button class="icon-btn" data-back aria-label="Zurueck">${icon("back")}</button>
        <h2 class="grow" style="margin:0;">
          ${tab === "following" ? "Gefolgte Nutzer" : "Follower"}
        </h2>
      </div>
      <div data-list>${skeletonRows(6)}</div>
    </div>`;
  root.querySelector("[data-back]").onclick = () => history.back();
  const list = root.querySelector("[data-list]");

  try {
    const people = tab === "following"
      ? await data.listFollowing(userId)
      : await data.listFollowers(userId);

    if (!people.length) {
      list.innerHTML = emptyState("&#128101;",
        tab === "following" ? "Folgt noch niemandem" : "Noch keine Follower");
      return;
    }
    list.innerHTML = people.map((p) => userRow(p, { showFollow: p.id !== ctx.user.id })).join("");
    list.querySelectorAll("[data-open-user]").forEach((row) => {
      row.onclick = (e) => {
        if (e.target.closest("[data-follow]")) return;
        ctx.navigate("user", { id: row.dataset.openUser });
      };
    });
    // Folgen-Status nachladen und Buttons korrekt beschriften
    const mine = await data.listMyFollowingIds(ctx.user.id).catch(() => new Set());
    list.querySelectorAll("[data-follow]").forEach((btn) => {
      const id = btn.dataset.follow;
      btn.classList.toggle("following", mine.has(id));
      btn.textContent = mine.has(id) ? "Folgt" : "Folgen";
      btn.onclick = async (e) => {
        e.stopPropagation();
        try {
          if (mine.has(id)) { await data.unfollow(ctx.user.id, id); mine.delete(id); }
          else { await data.follow(ctx.user.id, id); mine.add(id); }
          btn.classList.toggle("following", mine.has(id));
          btn.textContent = mine.has(id) ? "Folgt" : "Folgen";
        } catch (error) { toast(describeError(error), "error"); }
      };
    });
  } catch (error) {
    list.innerHTML = errorState(describeError(error));
  }
}

/* =====================================================================
   Profil bearbeiten
===================================================================== */
export async function renderEditProfile(root, ctx) {
  const profile = ctx.profile || await data.getMyProfile(ctx.user.id);
  if (!profile) { ctx.navigate("profile"); return; }

  const avatarPreview = avatarHtml(profile, "lg", "edit-avatar");
  const banner = profile.banner_path ? publicUrl("banners", profile.banner_path) : null;

  root.innerHTML = `
    <div class="screen">
      <div class="topbar">
        <button class="icon-btn" data-back aria-label="Zurueck">${icon("back")}</button>
        <h2 class="grow" style="margin:0;">Profil bearbeiten</h2>
      </div>

      <div data-banner></div>

      <div class="edit-banner" data-banner-preview
           style="${banner ? `background-image:url('${escapeHtml(banner)}')` : ""}">
        <label class="edit-banner-btn">
          ${icon("image")} Banner
          <input type="file" accept="image/jpeg,image/png,image/webp" data-banner-file hidden />
        </label>
      </div>

      <div class="edit-avatar-row">
        <div data-avatar-preview>${avatarPreview}</div>
        <label class="btn btn-ghost btn-compact">
          ${icon("image")} Profilbild
          <input type="file" accept="image/jpeg,image/png,image/webp" data-avatar-file hidden />
        </label>
      </div>

      <form class="stack" novalidate>
        <div class="field">
          <label class="label" for="ed-username">Benutzername</label>
          <input class="input" id="ed-username" name="username" value="${escapeHtml(profile.username)}" />
          <div class="field-hint" data-hint-for="username">3-24 Zeichen, Kleinbuchstaben, Zahlen, Punkt, Unterstrich.</div>
          <div class="field-error" data-error-for="username"></div>
        </div>

        <div class="field">
          <label class="label" for="ed-display">Anzeigename</label>
          <input class="input" id="ed-display" name="display_name" maxlength="50"
                 value="${escapeHtml(profile.display_name || "")}" />
          <div class="field-error" data-error-for="display_name"></div>
        </div>

        <div class="field">
          <label class="label" for="ed-bio">Biografie</label>
          <textarea class="input" id="ed-bio" name="bio" maxlength="300">${escapeHtml(profile.bio || "")}</textarea>
          <div class="field-hint"><span data-bio-count>${(profile.bio || "").length}</span> / 300 Zeichen</div>
        </div>

        <div class="field">
          <label class="label" for="ed-website">Profil-Link (optional)</label>
          <input class="input" id="ed-website" name="website_url" maxlength="200"
                 placeholder="https://..." value="${escapeHtml(profile.website_url || "")}" />
          <div class="field-error" data-error-for="website_url"></div>
        </div>

        <label class="switch-row">
          <span>
            <b>Privates Profil</b>
            <span class="small muted" style="display:block;">Nur Follower sehen deine Videos.</span>
          </span>
          <input type="checkbox" name="is_private" ${profile.is_private ? "checked" : ""} />
        </label>

        <button class="btn btn-primary" type="submit" data-submit>Speichern</button>
      </form>

      <div class="stack" style="margin-top:24px;">
        <button class="btn btn-ghost" data-logout>${icon("logout")} Abmelden</button>
      </div>
    </div>`;

  const form = root.querySelector("form");
  const bannerHost = root.querySelector("[data-banner]");
  const usernameInput = form.querySelector('[name="username"]');
  const hint = root.querySelector('[data-hint-for="username"]');

  root.querySelector("[data-back]").onclick = () => ctx.navigate("profile");
  root.querySelector("[data-logout]").onclick = () => ctx.signOut();

  // Zeichenzaehler
  const bio = form.querySelector('[name="bio"]');
  const bioCount = root.querySelector("[data-bio-count]");
  bio.addEventListener("input", () => { bioCount.textContent = bio.value.length; });

  // Benutzername live pruefen (nur wenn geaendert)
  const current = profile.username;
  const checkUsername = debounce(async (value) => {
    const v = value.trim().toLowerCase();
    if (v === current) { hint.className = "field-hint"; hint.textContent = "Dein aktueller Benutzername."; return; }
    if (validators.username(v)) { hint.className = "field-hint"; hint.textContent = "3-24 Zeichen, Kleinbuchstaben, Zahlen, Punkt, Unterstrich."; return; }
    hint.className = "field-hint"; hint.textContent = "Pruefe Verfuegbarkeit ...";
    try {
      const free = await data.isUsernameAvailable(v);
      hint.className = free ? "ok-hint" : "field-error";
      hint.textContent = free ? "Benutzername ist verfuegbar." : "Dieser Benutzername ist bereits vergeben.";
    } catch { hint.className = "field-hint"; hint.textContent = ""; }
  }, 450);
  usernameInput.addEventListener("input", (e) => checkUsername(e.target.value));

  let avatarFile = null;
  let bannerFile = null;

  root.querySelector("[data-avatar-file]").onchange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const err = validateImage(file, MAX_BANNER_BYTES, "5 MB");
    fieldError("avatar", err);
    if (err) { e.target.value = ""; return; }
    avatarFile = file;
    const url = URL.createObjectURL(file);
    root.querySelector("[data-avatar-preview]").innerHTML =
      `<div class="avatar lg edit-avatar" style="background-image:url('${url}')"></div>`;
  };

  root.querySelector("[data-banner-file]").onchange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const err = validateImage(file, MAX_BANNER_BYTES, "10 MB");
    fieldError("banner", err);
    if (err) { e.target.value = ""; return; }
    bannerFile = file;
    const url = URL.createObjectURL(file);
    root.querySelector("[data-banner-preview]").style.backgroundImage = `url('${url}')`;
  };

  form.onsubmit = async (event) => {
    event.preventDefault();
    bannerHost.innerHTML = "";
    const submit = root.querySelector("[data-submit]");

    const data_ = {
      username: usernameInput.value.trim().toLowerCase(),
      display_name: form.querySelector('[name="display_name"]').value.trim(),
      bio: bio.value.trim(),
      website_url: form.querySelector('[name="website_url"]').value.trim(),
      is_private: form.querySelector('[name="is_private"]').checked,
    };

    const usernameErr = validators.username(data_.username);
    const displayErr = data_.display_name ? null : "Bitte einen Anzeigenamen eingeben.";
    const websiteErr = data_.website_url && !/^https?:\/\/.+/i.test(data_.website_url)
      ? "Bitte mit http:// oder https:// beginnen." : null;

    fieldError("username", usernameErr);
    fieldError("display_name", displayErr);
    fieldError("website_url", websiteErr);
    if (usernameErr || displayErr || websiteErr) {
      bannerHost.innerHTML = `<div class="banner error">Bitte pruefe die markierten Felder.</div>`;
      return;
    }

    submit.disabled = true;
    submit.innerHTML = `<span class="spinner"></span> Wird gespeichert ...`;

    try {
      // Benutzername final pruefen, falls er sich aendert
      if (data_.username !== current) {
        const free = await data.isUsernameAvailable(data_.username);
        if (!free) {
          fieldError("username", "Dieser Benutzername ist bereits vergeben.");
          throw new Error("Der Benutzername ist leider schon vergeben.");
        }
      }

      // Bilder zuerst hochladen, dann die Pfade mit dem Profil speichern.
      const patch = {
        username: data_.username,
        display_name: data_.display_name,
        bio: data_.bio,
        website_url: data_.website_url || null,
        is_private: data_.is_private,
      };
      if (avatarFile) patch.avatar_path = await data.uploadImage("avatars", ctx.user.id, avatarFile, "avatar");
      if (bannerFile) patch.banner_path = await data.uploadImage("banners", ctx.user.id, bannerFile, "banner");

      const updated = await data.updateProfile(ctx.user.id, patch);
      ctx.profile = updated;
      toast("Profil gespeichert.", "success");
      ctx.navigate("profile");
    } catch (error) {
      bannerHost.innerHTML = `<div class="banner error">${escapeHtml(describeError(error))}</div>`;
      submit.disabled = false;
      submit.textContent = "Speichern";
    }
  };

  function fieldError(name, message) {
    const slot = root.querySelector(`[data-error-for="${name}"]`);
    if (slot) slot.textContent = message || "";
  }
}

function validateImage(file, maxBytes, label) {
  if (!IMAGE_MIME_TYPES.includes(file.type)) return "Nur JPG, PNG oder WebP erlaubt.";
  if (file.size > maxBytes) return `Das Bild darf hoechstens ${label} gross sein.`;
  return null;
}

function normalizeUrl(url) {
  return /^https?:\/\//i.test(url) ? url : "https://" + url;
}
