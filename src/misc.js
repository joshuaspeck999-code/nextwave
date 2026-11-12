// =====================================================================
// NEXTWAVE - Entdecken (Suche), Aktivitaeten (Benachrichtigungen), Moderation
// =====================================================================
import * as data from "./data.js";
import { escapeHtml, describeError, toast, debounce, formatCount } from "./utils.js";
import {
  icon, avatarHtml, bottomNav, emptyState, errorState, skeletonRows,
  userRow, videoTile, timeAgo, statusLabel, badgeHtml,
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
   Administrationsbereich (Moderation + Verwaltung + Lockdown)
   Moderatoren sehen: Übersicht, Nutzer, Videos, Meldungen, Kommentare.
   Zusaetzlich nur fuer Admins: der Lockdown-Tab.
===================================================================== */
export async function renderAdmin(root, ctx) {
  const role = ctx.profile?.role;
  const isAdmin = role === "admin";
  const isMod = role === "moderator" || isAdmin;
  if (!isMod) {
    root.innerHTML = `<div class="screen">${emptyState("&#128274;", "Kein Zugriff",
      "Dieser Bereich ist nur fuer Moderatoren.")}</div>`;
    return;
  }

  const tabs = [
    { id: "overview", label: "Übersicht" },
    { id: "users",    label: "Nutzer" },
    { id: "videos",   label: "Videos" },
    { id: "reports",  label: "Meldungen" },
    { id: "comments", label: "Kommentare" },
  ];
  if (isAdmin) {
    tabs.push({ id: "event", label: "Event" });
    tabs.push({ id: "lockdown", label: "Lockdown" });
  }

  root.innerHTML = `
    <div class="screen">
      <div class="topbar">
        <button class="icon-btn" data-back>${icon("back")}</button>
        <h2 class="grow" style="margin:0;">${isAdmin ? "Admin-Panel" : "Moderation"}</h2>
      </div>
      <div class="tabs tabs-scroll">
        ${tabs.map((t, i) => `<button class="tab ${i === 0 ? "active" : ""}"
          data-tab="${t.id}">${escapeHtml(t.label)}</button>`).join("")}
      </div>
      <div data-body>${skeletonRows(5)}</div>
    </div>`;

  root.querySelector("[data-back]").onclick = () => history.back();
  const body = root.querySelector("[data-body]");

  /* -----------------------------------------------------------------
     Übersicht / Statistiken
  ----------------------------------------------------------------- */
  const loadOverview = async () => {
    body.innerHTML = skeletonRows(4);
    try {
      const s = await data.getAdminStats();
      body.innerHTML = `
        <div class="admin-stats">
          ${statCard("Nutzer", s.users)}
          ${statCard("Videos", s.videos)}
          ${statCard("In Prüfung", s.pending)}
          ${statCard("Offene Meldungen", s.reports)}
          ${statCard("Gesperrt", s.blocked)}
          ${statCard("Kommentare", s.comments)}
        </div>
        <p class="muted small">Alle Zahlen werden live aus der Datenbank geladen.</p>`;
    } catch (error) {
      body.innerHTML = errorState(describeError(error));
    }
  };

  /* -----------------------------------------------------------------
     Nutzer verwalten
  ----------------------------------------------------------------- */
  const loadUsers = async () => {
    body.innerHTML = `
      <form class="searchbar" data-user-search>
        ${icon("search")}
        <input class="input" name="q" placeholder="Nutzer suchen" autocomplete="off" />
      </form>
      <div class="tabs" style="margin:12px 0;">
        <button class="tab active" data-ufilter="all">Alle</button>
        <button class="tab" data-ufilter="blocked">Gesperrt</button>
        <button class="tab" data-ufilter="moderators">Team</button>
      </div>
      <div data-user-list>${skeletonRows(6)}</div>`;

    const list = body.querySelector("[data-user-list]");
    const searchForm = body.querySelector("[data-user-search]");
    const searchInput = searchForm.querySelector("[name='q']");
    let query = "";
    let filter = "all";

    const run = async () => {
      list.innerHTML = skeletonRows(6);
      try {
        const users = await data.adminListProfiles({ query, filter });
        if (!users.length) { list.innerHTML = emptyState("&#128100;", "Keine Nutzer gefunden"); return; }
        list.innerHTML = users.map((p) => userAdminRow(p, ctx.user.id)).join("");

        list.querySelectorAll("[data-open]").forEach((b) => {
          b.onclick = () => ctx.navigate("user", { id: b.dataset.open });
        });
        list.querySelectorAll("[data-block]").forEach((b) => {
          b.onclick = async () => {
            const blocked = b.dataset.blocked === "true";
            b.disabled = true;
            try {
              await data.setUserBlocked(b.dataset.block, !blocked);
              toast(!blocked ? "Nutzer gesperrt." : "Nutzer entsperrt.", "success");
              run();
            } catch (error) {
              toast(describeError(error), "error");
              b.disabled = false;
            }
          };
        });
      } catch (error) {
        list.innerHTML = errorState(describeError(error));
        const retry = list.querySelector("[data-retry]");
        if (retry) retry.onclick = run;
      }
    };

    searchForm.onsubmit = (e) => { e.preventDefault(); query = searchInput.value.trim(); run(); };
    searchInput.addEventListener("input", debounce(() => { query = searchInput.value.trim(); run(); }, 350));
    body.querySelectorAll("[data-ufilter]").forEach((t) => {
      t.onclick = () => {
        body.querySelectorAll("[data-ufilter]").forEach((x) => x.classList.remove("active"));
        t.classList.add("active");
        filter = t.dataset.ufilter;
        run();
      };
    });

    run();
  };

  /* -----------------------------------------------------------------
     Videos prüfen
  ----------------------------------------------------------------- */
  const loadVideos = async () => {
    body.innerHTML = `
      <div class="tabs" style="margin-bottom:12px;">
        <button class="tab active" data-vstatus="pending">In Prüfung</button>
        <button class="tab" data-vstatus="approved">Freigegeben</button>
        <button class="tab" data-vstatus="rejected">Abgelehnt</button>
        <button class="tab" data-vstatus="all">Alle</button>
      </div>
      <div data-video-list>${skeletonRows(5)}</div>`;

    const list = body.querySelector("[data-video-list]");
    let status = "pending";

    const run = async () => {
      list.innerHTML = skeletonRows(5);
      try {
        const videos = await data.listVideosForModeration({ status });
        if (!videos.length) { list.innerHTML = emptyState("&#9989;", "Keine Videos in dieser Ansicht"); return; }
        list.innerHTML = videos.map((v) => `
          <div class="card" style="margin-bottom:12px;">
            <div class="row" style="align-items:flex-start;">
              ${avatarHtml(v.profiles, "sm")}
              <div class="grow" style="min-width:0;">
                <div class="small"><b>@${escapeHtml(v.profiles?.username || "")}</b> · ${timeAgo(v.created_at)}
                  ${v.moderation_status !== "approved" ? `<span class="badge">${escapeHtml(statusLabel(v.moderation_status))}</span>` : ""}</div>
                <div class="small muted" style="margin-top:4px;">${escapeHtml(v.description || "(ohne Beschreibung)")}</div>
              </div>
            </div>
            <div class="row" style="margin-top:12px;gap:8px;">
              <button class="btn btn-ghost btn-compact" data-vopen="${v.id}">Ansehen</button>
              ${v.moderation_status !== "approved" ? `<button class="btn btn-primary btn-compact grow" data-approve="${v.id}">Freigeben</button>` : ""}
              ${v.moderation_status !== "rejected" ? `<button class="btn btn-danger btn-compact grow" data-reject="${v.id}">Ablehnen</button>` : ""}
            </div>
          </div>`).join("");

        list.querySelectorAll("[data-vopen]").forEach((b) => {
          b.onclick = () => ctx.navigate("watch", { id: b.dataset.vopen });
        });
        list.querySelectorAll("[data-approve]").forEach((b) => {
          b.onclick = () => moderateVideo(b.dataset.approve, "approved", b);
        });
        list.querySelectorAll("[data-reject]").forEach((b) => {
          b.onclick = () => moderateVideo(b.dataset.reject, "rejected", b);
        });
      } catch (error) {
        list.innerHTML = errorState(describeError(error));
        const retry = list.querySelector("[data-retry]");
        if (retry) retry.onclick = run;
      }
    };

    const moderateVideo = async (id, newStatus, btn) => {
      btn.disabled = true;
      try {
        await data.moderateVideo(id, newStatus, "");
        toast(newStatus === "approved" ? "Video freigegeben." : "Video abgelehnt.", "success");
        run();
      } catch (error) {
        toast(describeError(error), "error");
        btn.disabled = false;
      }
    };

    body.querySelectorAll("[data-vstatus]").forEach((t) => {
      t.onclick = () => {
        body.querySelectorAll("[data-vstatus]").forEach((x) => x.classList.remove("active"));
        t.classList.add("active");
        status = t.dataset.vstatus;
        run();
      };
    });

    run();
  };

  /* -----------------------------------------------------------------
     Meldungen
  ----------------------------------------------------------------- */
  const loadReports = async () => {
    body.innerHTML = skeletonRows(5);
    try {
      const reports = await data.listOpenReports(50);
      if (!reports.length) { body.innerHTML = emptyState("&#9989;", "Keine offenen Meldungen"); return; }
      body.innerHTML = reports.map((r) => `
        <div class="card" style="margin-bottom:12px;">
          <div class="small muted">${escapeHtml(r.target_type)} · ${timeAgo(r.created_at)}
            ${r.reporter?.username ? `· von @${escapeHtml(r.reporter.username)}` : ""}</div>
          <div class="small" style="margin-top:6px;">Grund: <b>${escapeHtml(r.reason)}</b></div>
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

  /* -----------------------------------------------------------------
     Kommentare moderieren
  ----------------------------------------------------------------- */
  const loadComments = async () => {
    body.innerHTML = skeletonRows(6);
    try {
      const comments = await data.listRecentComments(50);
      if (!comments.length) { body.innerHTML = emptyState("&#128172;", "Noch keine Kommentare"); return; }
      body.innerHTML = comments.map((c) => {
        const author = c.profiles || {};
        const removed = c.moderation_status === "rejected" || c.moderation_status === "removed";
        return `<div class="card" style="margin-bottom:12px;">
          <div class="row" style="align-items:flex-start;gap:10px;">
            ${avatarHtml(author, "sm")}
            <div class="grow" style="min-width:0;">
              <div class="small"><b>@${escapeHtml(author.username || "unbekannt")}</b> · ${timeAgo(c.created_at)}
                ${removed ? '<span class="badge danger">Ausgeblendet</span>' : ""}</div>
              <div class="small" style="margin-top:4px;">${escapeHtml(c.content || "")}</div>
            </div>
          </div>
          <div class="row" style="margin-top:12px;gap:8px;">
            ${removed
              ? `<button class="btn btn-ghost btn-compact grow" data-keep="${c.id}">Wiederherstellen</button>`
              : `<button class="btn btn-danger btn-compact grow" data-hide="${c.id}">Ausblenden</button>`}
          </div>
        </div>`;
      }).join("");

      body.querySelectorAll("[data-hide]").forEach((b) => {
        b.onclick = () => moderateComment(b.dataset.hide, "rejected", b);
      });
      body.querySelectorAll("[data-keep]").forEach((b) => {
        b.onclick = () => moderateComment(b.dataset.keep, "approved", b);
      });
    } catch (error) {
      body.innerHTML = errorState(describeError(error));
    }
  };

  const moderateComment = async (id, newStatus, btn) => {
    btn.disabled = true;
    try {
      await data.moderateComment(id, newStatus, "");
      toast(newStatus === "approved" ? "Kommentar wiederhergestellt." : "Kommentar ausgeblendet.", "success");
      loadComments();
    } catch (error) {
      toast(describeError(error), "error");
      btn.disabled = false;
    }
  };

  /* -----------------------------------------------------------------
     Event (nur Admin): zeitlich begrenzte Aktion mit OG-Badge
  ----------------------------------------------------------------- */
  const loadEvent = async () => {
    body.innerHTML = skeletonRows(4);
    try {
      const [active, events] = await Promise.all([
        data.getActiveEvent(),
        data.listEvents(20),
      ]);
      const holders = active
        ? await data.countBadgeHolders(active.badge_label).catch(() => 0)
        : 0;

      body.innerHTML = `
        <div class="card" style="margin-bottom:16px;border-color:${active ? "var(--accent)" : "var(--outline)"};">
          <div class="row" style="align-items:center;gap:12px;">
            <div class="notif-icon" style="color:${active ? "var(--accent)" : "var(--text-2)"}">${icon("spark")}</div>
            <div class="grow">
              <div style="font-weight:600;">${active ? escapeHtml(active.name) : "Kein Event aktiv"}</div>
              <div class="small muted">${active
                ? `Badge &bdquo;${escapeHtml(active.badge_label)}&ldquo; &middot; endet am ${escapeHtml(new Date(active.ends_at).toLocaleString("de-DE"))}`
                : "Starte ein Event, damit jedes neue Konto automatisch das Badge bekommt."}</div>
              ${active ? `<div class="small muted" style="margin-top:4px;">${holders} Konto(en) tragen dieses Badge.</div>` : ""}
            </div>
          </div>
          ${active ? `<button class="btn btn-danger btn-compact" style="margin-top:12px;" data-stop-event>Event jetzt beenden</button>` : ""}
        </div>

        <form class="stack" data-event-form>
          <div class="field">
            <label class="label" for="ev-name">Event-Name</label>
            <input class="input" id="ev-name" name="name" maxlength="60"
                   placeholder="z. B. OG Launch" autocomplete="off" />
          </div>

          <div class="field">
            <label class="label" for="ev-badge">Badge-Beschriftung</label>
            <input class="input" id="ev-badge" name="badge" maxlength="20" value="OG" autocomplete="off" />
            <div class="field-hint">Erscheint neben dem Namen, max. 20 Zeichen (z. B. OG).</div>
          </div>

          <div class="field">
            <label class="label" for="ev-duration">Dauer</label>
            <div class="row" style="gap:8px;">
              <input class="input" id="ev-duration" name="duration" type="number"
                     min="1" step="1" value="24" style="flex:1;" />
              <select class="input" name="unit" style="flex:1;">
                <option value="1">Minuten</option>
                <option value="60" selected>Stunden</option>
                <option value="1440">Tage</option>
                <option value="10080">Wochen</option>
              </select>
            </div>
            <div class="field-hint">Nur Konten, die in diesem Zeitraum entstehen, erhalten das Badge.</div>
          </div>

          <button class="btn btn-primary" type="submit">Event starten</button>
        </form>

        <h3 style="margin:22px 0 8px;">Fr&uuml;here Events</h3>
        <div>${events.length
          ? events.map(eventHistoryRow).join("")
          : `<p class="muted small">Noch keine Events gestartet.</p>`}</div>`;

      const form = body.querySelector("[data-event-form]");
      form.onsubmit = async (e) => {
        e.preventDefault();
        const btn = form.querySelector("[type='submit']");
        const fd = new FormData(form);
        const name = String(fd.get("name") || "").trim();
        const badge = String(fd.get("badge") || "").trim();
        const amount = Number(fd.get("duration"));
        const perUnit = Number(fd.get("unit")) || 1;
        if (!name) { toast("Bitte einen Event-Namen angeben.", "error"); return; }
        if (!badge) { toast("Bitte eine Badge-Beschriftung angeben.", "error"); return; }
        if (!Number.isFinite(amount) || amount < 1) { toast("Bitte eine g\u00fcltige Dauer w\u00e4hlen.", "error"); return; }

        btn.disabled = true;
        try {
          await data.startEvent({
            name, badgeLabel: badge, durationMinutes: Math.round(amount * perUnit),
          });
          toast("Event gestartet.", "success");
          loadEvent();
        } catch (error) {
          toast(describeError(error), "error");
          btn.disabled = false;
        }
      };

      const stopBtn = body.querySelector("[data-stop-event]");
      if (stopBtn) {
        stopBtn.onclick = async () => {
          stopBtn.disabled = true;
          try {
            await data.stopActiveEvent();
            toast("Event beendet.", "success");
            loadEvent();
          } catch (error) {
            toast(describeError(error), "error");
            stopBtn.disabled = false;
          }
        };
      }
    } catch (error) {
      body.innerHTML = errorState(describeError(error));
      const retry = body.querySelector("[data-retry]");
      if (retry) retry.onclick = loadEvent;
    }
  };

  /* -----------------------------------------------------------------
     Lockdown (nur Admin)
  ----------------------------------------------------------------- */
  const loadLockdown = async () => {
    body.innerHTML = skeletonRows(4);
    try {
      const s = await data.getPlatformSettings();
      body.innerHTML = `
        <div class="card" style="margin-bottom:16px;border-color:${s.lockdown_enabled ? "var(--error)" : "var(--outline)"};">
          <div class="row" style="align-items:center;gap:12px;">
            <div class="notif-icon" style="color:${s.lockdown_enabled ? "var(--error)" : "var(--text-2)"}">${icon("lock")}</div>
            <div class="grow">
              <div style="font-weight:600;">${s.lockdown_enabled ? "Lockdown ist AKTIV" : "Lockdown ist inaktiv"}</div>
              <div class="small muted">${s.lockdown_enabled
                ? "Neue Videos und Kommentare sind derzeit für alle blockiert."
                : "Die Plattform ist normal nutzbar."}</div>
            </div>
          </div>
        </div>

        <form class="stack" data-lockdown-form>
          <label class="switch-row">
            <span><b>Lockdown aktivieren</b>
              <div class="small muted">Blockiert neue Videos <u>und</u> Kommentare für alle Nutzer.</div></span>
            <input type="checkbox" name="enabled" ${s.lockdown_enabled ? "checked" : ""} />
          </label>

          <label class="switch-row">
            <span><b>Uploads deaktivieren</b>
              <div class="small muted">Niemand kann neue Videos hochladen (Kommentare bleiben möglich).</div></span>
            <input type="checkbox" name="uploads" ${s.uploads_disabled ? "checked" : ""} />
          </label>

          <label class="switch-row">
            <span><b>Registrierung deaktivieren</b>
              <div class="small muted">Es können sich keine neuen Nutzer registrieren.</div></span>
            <input type="checkbox" name="signups" ${s.signups_disabled ? "checked" : ""} />
          </label>

          <div class="field">
            <label class="label" for="lock-msg">Hinweistext (wird den Nutzern angezeigt)</label>
            <textarea class="input" id="lock-msg" name="message" maxlength="500"
              placeholder="z. B. Kurze Wartung – wir sind gleich zurück.">${escapeHtml(s.lockdown_message || "")}</textarea>
            <div class="field-hint">Bis zu 500 Zeichen.</div>
          </div>

          <button class="btn btn-primary" type="submit">Einstellungen speichern</button>
        </form>

        <p class="muted small" style="margin-top:12px;">
          Letzte Änderung: ${s.updated_at ? escapeHtml(new Date(s.updated_at).toLocaleString("de-DE")) : "—"}
        </p>`;

      const form = body.querySelector("[data-lockdown-form]");
      form.onsubmit = async (e) => {
        e.preventDefault();
        const btn = form.querySelector("[type='submit']");
        btn.disabled = true;
        const fd = new FormData(form);
        try {
          await data.setLockdown({
            enabled: fd.get("enabled") === "on",
            uploadsDisabled: fd.get("uploads") === "on",
            signupsDisabled: fd.get("signups") === "on",
            message: String(fd.get("message") || ""),
          });
          toast("Einstellungen gespeichert.", "success");
          loadLockdown();
        } catch (error) {
          toast(describeError(error), "error");
          btn.disabled = false;
        }
      };
    } catch (error) {
      body.innerHTML = errorState(describeError(error));
      const retry = body.querySelector("[data-retry]");
      if (retry) retry.onclick = loadLockdown;
    }
  };

  /* -----------------------------------------------------------------
     Tab-Wechsel
  ----------------------------------------------------------------- */
  const LOADERS = {
    overview: loadOverview,
    users: loadUsers,
    videos: loadVideos,
    reports: loadReports,
    comments: loadComments,
    event: loadEvent,
    lockdown: loadLockdown,
  };

  root.querySelectorAll("[data-tab]").forEach((t) => {
    t.onclick = () => {
      root.querySelectorAll("[data-tab]").forEach((x) => x.classList.remove("active"));
      t.classList.add("active");
      (LOADERS[t.dataset.tab] || loadOverview)();
    };
  });

  loadOverview();
}

/* ---------------------------------------------------------------------
   Bausteine fuer das Admin-Panel
--------------------------------------------------------------------- */
function statCard(name, value) {
  return `<div class="stat-card">
    <div class="value">${formatCount(value)}</div>
    <div class="name">${escapeHtml(name)}</div>
  </div>`;
}

function userAdminRow(p, meId) {
  const isMe = p.id === meId;
  return `<div class="admin-row">
    ${avatarHtml(p, "sm")}
    <div class="grow" style="min-width:0;">
      <div class="user-row-name">
        ${escapeHtml(p.display_name || p.username)}${badgeHtml(p)}
        ${p.is_blocked ? '<span class="badge danger">Gesperrt</span>' : ""}
      </div>
      <div class="small muted">@${escapeHtml(p.username)} &middot; ${formatCount(p.follower_count)} Follower</div>
    </div>
    <button class="btn btn-ghost btn-compact" data-open="${escapeHtml(p.id)}">Profil</button>
    ${isMe ? "" : `<button class="btn ${p.is_blocked ? "btn-ghost" : "btn-danger"} btn-compact"
      data-block="${escapeHtml(p.id)}" data-blocked="${p.is_blocked ? "true" : "false"}">
      ${p.is_blocked ? "Entsperren" : "Sperren"}</button>`}
  </div>`;
}

/** Ein Eintrag in der Event-Historie (Admin-Panel). */
function eventHistoryRow(e) {
  const now = Date.now();
  const starts = new Date(e.starts_at).getTime();
  const ends = new Date(e.ends_at).getTime();
  const isActive = starts <= now && ends > now;
  return `<div class="admin-row" style="align-items:flex-start;">
    <span class="badge og">${icon("spark")}${escapeHtml(e.badge_label)}</span>
    <div class="grow" style="min-width:0;">
      <div class="user-row-name">${escapeHtml(e.name)}${isActive ? '<span class="badge accent">aktiv</span>' : ""}</div>
      <div class="small muted">${escapeHtml(new Date(e.starts_at).toLocaleString("de-DE"))}
        &ndash; ${escapeHtml(new Date(e.ends_at).toLocaleString("de-DE"))}</div>
    </div>
  </div>`;
}
