// =====================================================================
// NEXTWAVE - Entdecken (Suche), Aktivitaeten (Benachrichtigungen), Moderation
// =====================================================================
import * as data from "./data.js";
import { escapeHtml, describeError, toast, debounce } from "./utils.js";
import {
  icon, avatarHtml, bottomNav, emptyState, errorState, skeletonRows,
  userRow, videoTile, timeAgo,
} from "./ui.js";

/* =====================================================================
   Entdecken / Suche
===================================================================== */
export async function renderDiscover(root, ctx, params) {
  const initialQ = (params?.q || "").replace(/^#/, "");
  root.innerHTML = `
    <div class="screen">
      <div class="topbar"><h2 class="grow" style="margin:0;">Entdecken</h2></div>

      <form class="searchbar" data-form>
        ${icon("search")}
        <input class="input" name="q" placeholder="Nutzer, Videos, Hashtags suchen"
               autocomplete="off" value="${escapeHtml(initialQ)}" />
      </form>

      <div class="tabs" style="margin-top:14px;">
        <button class="tab active" data-tab="users">Nutzer</button>
        <button class="tab" data-tab="videos">Videos</button>
        <button class="tab" data-tab="hashtags">Hashtags</button>
      </div>

      <div data-results>${skeletonRows(6)}</div>
    </div>
    ${bottomNav("discover", ctx.unreadCount)}`;

  const form = root.querySelector("[data-form]");
  const input = form.querySelector("[name='q']");
  const results = root.querySelector("[data-results]");
  let tab = "users";
  let requestId = 0;

  const runSearch = async () => {
    const q = input.value.trim();
    const current = ++requestId;
    results.innerHTML = skeletonRows(6);
    try {
      const html = await renderResults(tab, q, ctx);
      if (current !== requestId) return; // veraltete Antwort verwerfen
      results.innerHTML = html;
      wireResults(results, ctx, tab);
    } catch (error) {
      if (current !== requestId) return;
      results.innerHTML = errorState(describeError(error));
      const retry = results.querySelector("[data-retry]");
      if (retry) retry.onclick = runSearch;
    }
  };

  const debounced = debounce(runSearch, 350);
  input.addEventListener("input", debounced);
  form.onsubmit = (e) => { e.preventDefault(); runSearch(); };

  root.querySelectorAll("[data-tab]").forEach((t) => {
    t.onclick = () => {
      root.querySelectorAll("[data-tab]").forEach((x) => x.classList.remove("active"));
      t.classList.add("active");
      tab = t.dataset.tab;
      runSearch();
    };
  });

  runSearch();
}

async function renderResults(tab, q, ctx) {
  if (tab === "users") {
    const people = await data.searchProfiles(q, 30);
    if (!people.length) return emptyState("&#128269;", "Keine Nutzer gefunden", q ? `Nichts zu "${q}".` : "");
    const mine = await data.listMyFollowingIds(ctx.user.id).catch(() => new Set());
    return `<div class="list">${people.map((p) =>
      userRow(p, { showFollow: p.id !== ctx.user.id, following: mine.has(p.id) })).join("")}</div>`;
  }

  if (tab === "videos") {
    const videos = q ? await data.searchVideos(q, 30) : await data.listVideos({ limit: 24 });
    if (!videos.length) return emptyState("&#127916;", "Keine Videos gefunden", q ? `Nichts zu "${q}".` : "");
    return `<div class="video-grid">${videos.map(videoTile).join("")}</div>`;
  }

  // hashtags
  if (!q) return emptyState("&#35;", "Hashtags durchsuchen", "Gib einen Begriff ein, um Hashtags zu finden.");
  const tags = await data.searchHashtags(q, 30);
  if (!tags.length) return emptyState("&#35;", "Keine Hashtags gefunden", `Nichts zu "${q}".`);
  return `<div class="list">${tags.map((t) =>
    `<button class="hashtag-row" data-tag="${escapeHtml(t.tag)}">
       <span class="hashtag-sym">#</span>
       <span class="grow">${escapeHtml(t.tag)}</span>
       ${icon("compass")}
     </button>`).join("")}</div>`;
}

function wireResults(container, ctx, tab) {
  container.querySelectorAll("[data-open-user]").forEach((row) => {
    row.onclick = (e) => {
      if (e.target.closest("[data-follow]")) return;
      ctx.navigate("user", { id: row.dataset.openUser });
    };
  });
  container.querySelectorAll("[data-watch]").forEach((tile) => {
    tile.onclick = () => ctx.navigate("watch", { id: tile.dataset.watch });
  });
  container.querySelectorAll("[data-tag]").forEach((row) => {
    row.onclick = () => ctx.navigate("discover", { q: "#" + row.dataset.tag });
  });
  container.querySelectorAll("[data-follow]").forEach((btn) => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const id = btn.dataset.follow;
      const following = btn.classList.contains("following");
      try {
        if (following) await data.unfollow(ctx.user.id, id);
        else await data.follow(ctx.user.id, id);
        btn.classList.toggle("following", !following);
        btn.textContent = following ? "Folgen" : "Folgt";
      } catch (error) { toast(describeError(error), "error"); }
    };
  });
}

/* =====================================================================
   Aktivitaeten / Benachrichtigungen
===================================================================== */
const NOTIFICATION_TEXT = {
  follow: "hat dir gefolgt",
  like: "gefaellt dein Video",
  comment: "hat dein Video kommentiert",
  comment_reply: "hat dir geantwortet",
  mention: "hat dich erwaehnt",
  moderation: "Moderationshinweis zu deinem Inhalt",
};

export async function renderActivity(root, ctx) {
  root.innerHTML = `
    <div class="screen">
      <div class="topbar">
        <h2 class="grow" style="margin:0;">Aktivitaeten</h2>
        <button class="btn-text" data-mark-read>Alle gelesen</button>
      </div>
      <div data-list>${skeletonRows(7)}</div>
    </div>
    ${bottomNav("activity", ctx.unreadCount)}`;

  const list = root.querySelector("[data-list]");
  const markBtn = root.querySelector("[data-mark-read]");

  const load = async () => {
    list.innerHTML = skeletonRows(7);
    try {
      const items = await data.listNotifications(ctx.user.id, 50);
      if (!items.length) {
        list.innerHTML = emptyState("&#128276;", "Noch keine Aktivitaeten",
          "Sobald dir jemand folgt oder dein Video liked, erscheint es hier.");
        markBtn.classList.add("hidden");
        return;
      }
      markBtn.classList.remove("hidden");
      list.innerHTML = items.map(notificationRow).join("");
      wireNotifications(list, ctx);
      // Beim Ansehen als gelesen markieren
      await data.markAllNotificationsRead(ctx.user.id).catch(() => {});
      ctx.refreshUnread?.();
    } catch (error) {
      list.innerHTML = errorState(describeError(error));
      const retry = list.querySelector("[data-retry]");
      if (retry) retry.onclick = load;
    }
  };

  markBtn.onclick = async () => {
    try {
      await data.markAllNotificationsRead(ctx.user.id);
      list.querySelectorAll(".notif.unread").forEach((n) => n.classList.remove("unread"));
      ctx.refreshUnread?.();
      toast("Alle als gelesen markiert.", "success");
    } catch (error) { toast(describeError(error), "error"); }
  };

  load();
}

function notificationRow(n) {
  const sender = n.sender || {};
  const iconName = { follow: "user", like: "heart", comment: "comment", comment_reply: "comment", mention: "spark", moderation: "flag" }[n.type] || "bell";
  const target = n.video_id ? `data-notif-video="${escapeHtml(n.video_id)}"` : "";
  const userTarget = sender.id ? `data-notif-user="${escapeHtml(sender.id)}"` : "";
  return `<div class="notif ${n.is_read ? "" : "unread"}" data-notif ${target} ${userTarget}>
    <div class="notif-icon">${icon(iconName)}</div>
    ${sender.id ? `<button class="notif-avatar" data-notif-user="${escapeHtml(sender.id)}">${avatarHtml(sender, "sm")}</button>` : ""}
    <div class="grow" style="min-width:0;">
      <div class="notif-text">
        <b>${escapeHtml(sender.display_name || sender.username || "Jemand")}</b>
        ${escapeHtml(NOTIFICATION_TEXT[n.type] || "hat etwas getan")}
      </div>
      <div class="small muted">${timeAgo(n.created_at)}</div>
    </div>
    ${n.is_read ? "" : '<span class="notif-dot"></span>'}
  </div>`;
}

function wireNotifications(container, ctx) {
  container.querySelectorAll("[data-notif]").forEach((row) => {
    row.onclick = (e) => {
      const u = e.target.closest("[data-notif-user]");
      if (u) { ctx.navigate("user", { id: u.dataset.notifUser }); return; }
      const v = row.dataset.notifVideo;
      if (v) { ctx.navigate("watch", { id: v }); return; }
      const uid = row.dataset.notifUser;
      if (uid) ctx.navigate("user", { id: uid });
    };
  });
}

/* =====================================================================
   Moderationsbereich (nur moderator/admin)
===================================================================== */
export async function renderAdmin(root, ctx) {
  const role = ctx.profile?.role;
  if (role !== "admin" && role !== "moderator") {
    root.innerHTML = `<div class="screen">${emptyState("&#128274;", "Kein Zugriff",
      "Dieser Bereich ist nur fuer Moderatoren.")}</div>`;
    return;
  }

  root.innerHTML = `
    <div class="screen">
      <div class="topbar">
        <button class="icon-btn" data-back>${icon("back")}</button>
        <h2 class="grow" style="margin:0;">Moderation</h2>
      </div>
      <div class="tabs">
        <button class="tab active" data-tab="videos">Videos pruefen</button>
        <button class="tab" data-tab="reports">Meldungen</button>
      </div>
      <div data-body>${skeletonRows(5)}</div>
    </div>`;

  root.querySelector("[data-back]").onclick = () => history.back();
  const body = root.querySelector("[data-body]");

  const loadVideos = async () => {
    body.innerHTML = skeletonRows(5);
    try {
      const videos = await data.listPendingVideos(50);
      if (!videos.length) { body.innerHTML = emptyState("&#9989;", "Keine offenen Videos"); return; }
      body.innerHTML = videos.map((v) => `
        <div class="card" style="margin-bottom:12px;">
          <div class="row" style="align-items:flex-start;">
            ${avatarHtml(v.profiles, "sm")}
            <div class="grow" style="min-width:0;">
              <div class="small"><b>@${escapeHtml(v.profiles?.username || "")}</b> · ${timeAgo(v.created_at)}</div>
              <div class="small muted" style="margin-top:4px;">${escapeHtml(v.description || "(ohne Beschreibung)")}</div>
            </div>
          </div>
          <div class="row" style="margin-top:12px;gap:8px;">
            <button class="btn btn-primary btn-compact grow" data-approve="${v.id}">Freigeben</button>
            <button class="btn btn-danger btn-compact grow" data-reject="${v.id}">Ablehnen</button>
          </div>
        </div>`).join("");

      body.querySelectorAll("[data-approve]").forEach((b) => {
        b.onclick = () => moderate(b.dataset.approve, "approved", b);
      });
      body.querySelectorAll("[data-reject]").forEach((b) => {
        b.onclick = () => moderate(b.dataset.reject, "rejected", b);
      });
    } catch (error) {
      body.innerHTML = errorState(describeError(error));
    }
  };

  const moderate = async (id, status, btn) => {
    btn.disabled = true;
    try {
      await data.moderateVideo(id, status, "");
      toast(status === "approved" ? "Video freigegeben." : "Video abgelehnt.", "success");
      loadVideos();
    } catch (error) {
      toast(describeError(error), "error");
      btn.disabled = false;
    }
  };

  const loadReports = async () => {
    body.innerHTML = skeletonRows(5);
    try {
      const reports = await data.listOpenReports(50);
      if (!reports.length) { body.innerHTML = emptyState("&#9989;", "Keine offenen Meldungen"); return; }
      body.innerHTML = reports.map((r) => `
        <div class="card" style="margin-bottom:12px;">
          <div class="small muted">${escapeHtml(r.target_type)} · ${timeAgo(r.created_at)}</div>
          <div class="small" style="margin-top:6px;">
            Grund: <b>${escapeHtml(r.reason)}</b>
          </div>
          ${r.details ? `<div class="small muted" style="margin-top:4px;">${escapeHtml(r.details)}</div>` : ""}
          <div class="row" style="margin-top:12px;gap:8px;">
            <button class="btn btn-ghost btn-compact grow" data-dismiss="${r.id}">Verwerfen</button>
            <button class="btn btn-primary btn-compact grow" data-resolve="${r.id}">Erledigt</button>
          </div>
        </div>`).join("");

      body.querySelectorAll("[data-resolve]").forEach((b) => {
        b.onclick = () => resolve(b.dataset.resolve, "resolved", b);
      });
      body.querySelectorAll("[data-dismiss]").forEach((b) => {
        b.onclick = () => resolve(b.dataset.dismiss, "dismissed", b);
      });
    } catch (error) {
      body.innerHTML = errorState(describeError(error));
    }
  };

  const resolve = async (id, status, btn) => {
    btn.disabled = true;
    try {
      await data.resolveReport(id, status, "");
      toast("Meldung bearbeitet.", "success");
      loadReports();
    } catch (error) {
      toast(describeError(error), "error");
      btn.disabled = false;
    }
  };

  root.querySelectorAll("[data-tab]").forEach((t) => {
    t.onclick = () => {
      root.querySelectorAll("[data-tab]").forEach((x) => x.classList.remove("active"));
      t.classList.add("active");
      if (t.dataset.tab === "reports") loadReports(); else loadVideos();
    };
  });

  loadVideos();
}
