// =====================================================================
// NEXTWAVE - Video-Feed, Wiedergabe, Kommentare
// =====================================================================
// Enthaelt:
//   renderFeed  - vertikaler Vollbild-Feed (Home)
//   renderWatch - ein einzelnes Video (z. B. aus dem Profil)
// Der Player ist ein normales <video>-Element; der private Bucket
// "videos" wird ueber zeitlich begrenzte Links (signed URLs) gelesen.
// =====================================================================
import * as data from "./data.js";
import { escapeHtml, formatCount, toast, describeError, el } from "./utils.js";
import {
  icon, avatarHtml, bottomNav, emptyState, errorState, timeAgo,
} from "./ui.js";

/* Signierte Links kurz zwischenspeichern - ein Video wird nicht
   mehrfach pro Sitzung signiert. */
const signedUrlCache = new Map();

async function videoSrc(video) {
  if (signedUrlCache.has(video.video_path)) return signedUrlCache.get(video.video_path);
  const url = await data.signedVideoUrl(video.video_path, 3600);
  if (url) signedUrlCache.set(video.video_path, url);
  return url;
}

/* ---------------------------------------------------------------------
   Texthelfer
--------------------------------------------------------------------- */
function linkify(text) {
  const safe = escapeHtml(text || "");
  return safe
    .replace(/#([a-z0-9_]+)/gi, '<span class="hash" data-hashtag="$1">#$1</span>')
    .replace(/@([a-z0-9._]+)/gi, '<span class="mention">@$1</span>');
}

function statusBadge(video) {
  const badges = [];
  if (video.moderation_status === "pending") badges.push('<span class="badge">In Pruefung</span>');
  if (video.moderation_status === "rejected" || video.moderation_status === "removed")
    badges.push('<span class="badge danger">Entfernt</span>');
  if (video.visibility === "private") badges.push('<span class="badge">Nur du</span>');
  if (video.visibility === "followers") badges.push('<span class="badge">Follower</span>');
  return badges.join("");
}

/* ---------------------------------------------------------------------
   Aufbau einer Video-Karte
--------------------------------------------------------------------- */
function reelCard(video, opts) {
  const author = video.profiles || {};
  const isSelf = author.id === opts.meId;
  return `<section class="reel" data-video-id="${escapeHtml(video.id)}">
    <video class="reel-video" playsinline webkit-playsinline loop muted preload="none"></video>
    <div class="reel-shade"></div>
    <div class="reel-loading"><div class="spinner"></div></div>
    <button class="reel-tap" data-tap aria-label="Wiedergabe umschalten"></button>

    <div class="reel-badges">${statusBadge(video)}</div>

    <div class="reel-info">
      <div class="reel-author-row">
        <button class="reel-avatar-btn" data-open-user="${escapeHtml(author.id)}"
                aria-label="Profil von ${escapeHtml(author.username || "")}">${avatarHtml(author, "sm")}</button>
        <div class="reel-author-text">
          <div class="reel-author-name">@${escapeHtml(author.username || "unbekannt")}</div>
          ${isSelf ? "" : `<button class="btn-pill ${opts.following ? "following" : ""}"
             data-follow="${escapeHtml(author.id)}">${opts.following ? "Folgt" : "Folgen"}</button>`}
        </div>
      </div>
      <div class="reel-desc">${linkify(video.description)}</div>
      <div class="reel-sound">${icon("spark")} Originalton &middot; @${escapeHtml(author.username || "")}</div>
    </div>

    <div class="reel-actions">
      <button class="reel-action ${opts.liked ? "liked" : ""}" data-act="like" aria-label="Gefaellt mir">
        <span class="reel-act-icon">${icon("heart")}</span>
        <span class="reel-act-count" data-like-count>${formatCount(video.like_count)}</span>
      </button>
      <button class="reel-action" data-act="comment" aria-label="Kommentare anzeigen">
        <span class="reel-act-icon">${icon("comment")}</span>
        <span class="reel-act-count" data-comment-count>${formatCount(video.comment_count)}</span>
      </button>
      <button class="reel-action ${opts.saved ? "saved" : ""}" data-act="save" aria-label="Merken">
        <span class="reel-act-icon">${icon("bookmark")}</span>
        <span class="reel-act-count">Merken</span>
      </button>
      <button class="reel-action" data-act="share" aria-label="Teilen">
        <span class="reel-act-icon">${icon("share")}</span>
        <span class="reel-act-count">Teilen</span>
      </button>
      <button class="reel-action" data-act="more" aria-label="Weitere Optionen">
        <span class="reel-act-icon">${icon("more")}</span>
      </button>
    </div>

    <div class="reel-burst" data-burst>${icon("heart")}</div>
    <div class="reel-progress"><div class="reel-progress-bar" data-progress></div></div>
  </section>`;
}

/* ---------------------------------------------------------------------
   Gemeinsamer Zustand einer Feed-Instanz
--------------------------------------------------------------------- */
async function buildState(ctx, videos) {
  const meId = ctx.user.id;
  const [liked, saved, following] = await Promise.all([
    data.listMyLikes(meId).catch(() => new Set()),
    data.listMySaved(meId).catch(() => new Set()),
    data.listMyFollowingIds(meId).catch(() => new Set()),
  ]);
  return { meId, liked, saved, following, muted: true, videos, viewed: new Set() };
}

/* ---------------------------------------------------------------------
   Wiedergabe-Steuerung fuer alle Karten eines Containers
--------------------------------------------------------------------- */
function attachPlayerBehaviour(container, state, ctx, onChange) {
  const cards = () => [...container.querySelectorAll(".reel")];

  function setMuted(muted) {
    state.muted = muted;
    cards().forEach((c) => { const v = c.querySelector("video"); if (v) v.muted = muted; });
    document.querySelectorAll("[data-mute-toggle]").forEach((b) => {
      b.innerHTML = icon(muted ? "mute" : "volume");
      b.setAttribute("aria-label", muted ? "Ton einschalten" : "Ton ausschalten");
    });
  }

  async function activate(card, { autoplay = true } = {}) {
    const video = card.querySelector("video");
    const id = card.dataset.videoId;
    const item = state.videos.find((v) => v.id === id);
    if (!video || !item) return;

    if (!video.src) {
      card.classList.add("is-loading");
      try {
        const url = await videoSrc(item);
        if (!url) throw new Error("Video nicht verfuegbar.");
        video.src = url;
      } catch (error) {
        card.classList.remove("is-loading");
        card.classList.add("is-error");
        card.querySelector(".reel-loading").innerHTML =
          `<span class="small muted">${escapeHtml(describeError(error))}</span>`;
        return;
      }
    }
    video.muted = state.muted;

    // Nachbarn vorladen (begrenzt: nur das naechste Video)
    const idx = cards().indexOf(card);
    const next = cards()[idx + 1];
    if (next) {
      const nextItem = state.videos.find((v) => v.id === next.dataset.videoId);
      const nextVideo = next.querySelector("video");
      if (nextVideo && nextItem && !nextVideo.src) {
        videoSrc(nextItem).then((url) => { if (url) nextVideo.src = url; }).catch(() => {});
      }
    }

    if (autoplay) {
      try { await video.play(); } catch (_) { /* Autoplay blockiert - Nutzer tippt */ }
    }
    if (!state.viewed.has(id)) {
      state.viewed.add(id);
      data.recordView(id, ctx.user?.id, 0);
    }
    // Fortschrittsbalken
    const bar = card.querySelector("[data-progress]");
    video.ontimeupdate = () => {
      if (bar && video.duration) bar.style.width = `${(video.currentTime / video.duration) * 100}%`;
    };
  }

  function deactivate(card) {
    const video = card.querySelector("video");
    if (video && !video.paused) video.pause();
  }

  // Sichtbarkeit ueberwachen: nur das aktive Video spielt.
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      const card = entry.target;
      if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
        cards().forEach((c) => { if (c !== card) deactivate(c); });
        activate(card);
      } else {
        deactivate(card);
      }
    });
  }, { threshold: [0, 0.6, 1] });
  cards().forEach((c) => observer.observe(c));

  // Einzelne Karte verdrahten
  cards().forEach((card) => wireCard(card, state, ctx, setMuted, onChange));

  return { setMuted, observer, cards };
}

function wireCard(card, state, ctx, setMuted, onChange) {
  if (card.dataset.wired === "1") return;
  card.dataset.wired = "1";
  const video = card.querySelector("video");
  const item = state.videos.find((v) => v.id === card.dataset.videoId);
  const burst = card.querySelector("[data-burst]");

  video.addEventListener("loadeddata", () => card.classList.remove("is-loading"));
  video.addEventListener("waiting", () => card.classList.add("is-loading"));
  video.addEventListener("playing", () => card.classList.remove("is-loading"));
  video.addEventListener("click", () => {});

  // Tippen: einfach = Pause/Play, doppelt = Like
  let lastTap = 0;
  let singleTimer = null;
  card.querySelector("[data-tap]").addEventListener("click", () => {
    const now = Date.now();
    if (now - lastTap < 280) {
      clearTimeout(singleTimer);
      lastTap = 0;
      triggerLike(card, item, state, ctx, onChange, burst, true);
    } else {
      lastTap = now;
      singleTimer = setTimeout(() => {
        if (video.paused) { video.play().catch(() => {}); } else { video.pause(); }
      }, 280);
    }
  });

  card.querySelector('[data-act="like"]').addEventListener("click", (e) => {
    e.stopPropagation();
    triggerLike(card, item, state, ctx, onChange, burst, false);
  });
  card.querySelector('[data-act="comment"]').addEventListener("click", (e) => {
    e.stopPropagation();
    video.pause();
    openComments(item, ctx, (delta) => {
      const el = card.querySelector("[data-comment-count]");
      if (el) el.textContent = formatCount(Math.max(0, (item.comment_count || 0) + delta));
    });
  });
  card.querySelector('[data-act="save"]').addEventListener("click", async (e) => {
    e.stopPropagation();
    const btn = e.currentTarget;
    try {
      if (state.saved.has(item.id)) {
        await data.unsaveVideo(ctx.user.id, item.id);
        state.saved.delete(item.id);
        btn.classList.remove("saved");
        toast("Aus den Lesezeichen entfernt.");
      } else {
        await data.saveVideo(ctx.user.id, item.id);
        state.saved.add(item.id);
        btn.classList.add("saved");
        toast("Zu den Lesezeichen hinzugefuegt.", "success");
      }
    } catch (error) { toast(describeError(error), "error"); }
  });
  card.querySelector('[data-act="share"]').addEventListener("click", (e) => {
    e.stopPropagation();
    shareVideo(item);
  });
  card.querySelector('[data-act="more"]').addEventListener("click", (e) => {
    e.stopPropagation();
    openMoreSheet(item, ctx, state, card, onChange);
  });

  // Hashtag antippen
  card.querySelectorAll("[data-hashtag]").forEach((h) => {
    h.addEventListener("click", (ev) => {
      ev.stopPropagation();
      ctx.navigate("discover", { q: "#" + h.dataset.hashtag });
    });
  });
}

async function triggerLike(card, item, state, ctx, onChange, burst, fromDoubleTap) {
  const btn = card.querySelector('[data-act="like"]');
  const countEl = card.querySelector("[data-like-count]");
  const liked = state.liked.has(item.id);
  const nextLiked = !liked;

  // Sofortiges UI-Feedback (optimistisch)
  state.liked[nextLiked ? "add" : "delete"](item.id);
  item.like_count = Math.max(0, (item.like_count || 0) + (nextLiked ? 1 : -1));
  btn.classList.toggle("liked", nextLiked);
  if (countEl) countEl.textContent = formatCount(item.like_count);
  if (nextLiked && fromDoubleTap && burst) {
    burst.classList.remove("bursting");
    void burst.offsetWidth;
    burst.classList.add("bursting");
  }
  if (navigator.vibrate) navigator.vibrate(12);

  try {
    if (nextLiked) await data.likeVideo(ctx.user.id, item.id);
    else await data.unlikeVideo(ctx.user.id, item.id);
  } catch (error) {
    // Rollback bei echtem Fehler
    state.liked[liked ? "add" : "delete"](item.id);
    item.like_count = Math.max(0, (item.like_count || 0) + (nextLiked ? -1 : 1));
    btn.classList.toggle("liked", liked);
    if (countEl) countEl.textContent = formatCount(item.like_count);
    toast(describeError(error), "error");
  }
  onChange?.();
}

async function followAuthor(authorId, state, ctx, button) {
  const following = state.following.has(authorId);
  try {
    if (following) {
      await data.unfollow(ctx.user.id, authorId);
      state.following.delete(authorId);
    } else {
      await data.follow(ctx.user.id, authorId);
      state.following.add(authorId);
    }
    document.querySelectorAll(`[data-follow="${authorId}"]`).forEach((b) => {
      const now = state.following.has(authorId);
      b.classList.toggle("following", now);
      b.textContent = now ? "Folgt" : "Folgen";
    });
  } catch (error) {
    toast(describeError(error), "error");
  }
}

function shareVideo(video) {
  const url = `${location.origin}${location.pathname}?v=${video.id}`;
  const shareData = { title: "NEXTWAVE", text: video.description || "Schau dir dieses Video an", url };
  if (navigator.share) {
    navigator.share(shareData).catch(() => {});
    return;
  }
  navigator.clipboard?.writeText(url)
    .then(() => toast("Link kopiert.", "success"))
    .catch(() => toast(url));
}

/* ---------------------------------------------------------------------
   Kommentare (Bottom-Sheet)
--------------------------------------------------------------------- */
function openSheet(root, contentHtml) {
  const sheet = document.createElement("div");
  sheet.className = "sheet-backdrop";
  sheet.innerHTML = `<div class="sheet">${contentHtml}</div>`;
  root.appendChild(sheet);
  requestAnimationFrame(() => sheet.classList.add("open"));
  const close = () => {
    sheet.classList.remove("open");
    setTimeout(() => sheet.remove(), 220);
  };
  sheet.addEventListener("click", (e) => { if (e.target === sheet) close(); });
  return { sheet, close };
}

async function openComments(video, ctx, onCountChange) {
  const root = document.getElementById("app");
  const { sheet, close } = openSheet(root, `
    <div class="sheet-handle"></div>
    <div class="sheet-head">
      <h3 style="margin:0;">Kommentare <span class="muted small" data-total></span></h3>
      <button class="icon-btn" data-close aria-label="Schliessen">${icon("close")}</button>
    </div>
    <div class="sheet-body" data-list>${emptyListSkeleton()}</div>
    <form class="sheet-input" data-form>
      <input class="input" name="content" placeholder="Kommentar hinzufuegen ..."
             maxlength="1000" autocomplete="off" />
      <button class="btn btn-primary" type="submit" data-send>Senden</button>
    </form>`);

  sheet.querySelector("[data-close]").onclick = close;
  const listEl = sheet.querySelector("[data-list]");
  const form = sheet.querySelector("[data-form]");
  const input = form.querySelector('[name="content"]');
  const sendBtn = form.querySelector("[data-send]");

  let comments = [];
  let likedComments = new Set();
  let replyTo = null;

  async function load() {
    try {
      [comments, likedComments] = await Promise.all([
        data.listComments(video.id),
        data.listMyCommentLikes(ctx.user.id).catch(() => new Set()),
      ]);
      render();
    } catch (error) {
      listEl.innerHTML = errorState(describeError(error));
      const retry = listEl.querySelector("[data-retry]");
      if (retry) retry.onclick = load;
    }
  }

  function render() {
    sheet.querySelector("[data-total]").textContent = comments.length ? `(${comments.length})` : "";
    if (!comments.length) {
      listEl.innerHTML = emptyState("&#128172;", "Noch keine Kommentare", "Sei der Erste, der etwas schreibt.");
      return;
    }
    const top = comments.filter((c) => !c.parent_comment_id);
    listEl.innerHTML = top.map((c) => commentHtml(c, comments, likedComments, ctx)).join("");
    wireCommentActions();
  }

  function wireCommentActions() {
    listEl.querySelectorAll("[data-reply]").forEach((b) => {
      b.onclick = () => {
        const c = comments.find((x) => x.id === b.dataset.reply);
        replyTo = c;
        input.placeholder = `Antwort an @${c.profiles?.username || "Nutzer"} ...`;
        input.focus();
        renderReplyHint();
      };
    });
    listEl.querySelectorAll("[data-del-comment]").forEach((b) => {
      b.onclick = async () => {
        try {
          await data.deleteComment(b.dataset.delComment);
          toast("Kommentar geloescht.", "success");
          onCountChange(-1);
          await load();
        } catch (error) { toast(describeError(error), "error"); }
      };
    });
    listEl.querySelectorAll("[data-like-comment]").forEach((b) => {
      const id = b.dataset.likeComment;
      b.onclick = async () => {
        const liked = likedComments.has(id);
        try {
          if (liked) { await data.unlikeComment(ctx.user.id, id); likedComments.delete(id); }
          else { await data.likeComment(ctx.user.id, id); likedComments.add(id); }
          await load();
        } catch (error) { toast(describeError(error), "error"); }
      };
    });
    listEl.querySelectorAll("[data-open-user]").forEach((b) => {
      b.onclick = () => { close(); ctx.navigate("user", { id: b.dataset.openUser }); };
    });
  }

  function renderReplyHint() {
    let hint = form.querySelector("[data-reply-hint]");
    if (!replyTo) { hint?.remove(); return; }
    if (!hint) {
      hint = document.createElement("div");
      hint.className = "reply-hint";
      hint.setAttribute("data-reply-hint", "");
      form.parentElement.insertBefore(hint, form);
    }
    hint.innerHTML = `Antwort an <b>@${escapeHtml(replyTo.profiles?.username || "")}</b>
      <button class="btn-text" type="button" data-cancel-reply>abbrechen</button>`;
    hint.querySelector("[data-cancel-reply]").onclick = () => {
      replyTo = null; input.placeholder = "Kommentar hinzufuegen ..."; renderReplyHint();
    };
  }

  form.onsubmit = async (e) => {
    e.preventDefault();
    const content = input.value.trim();
    if (!content) return;
    sendBtn.disabled = true;
    try {
      await data.addComment({
        userId: ctx.user.id, videoId: video.id,
        content, parentCommentId: replyTo?.id || null,
      });
      input.value = "";
      replyTo = null;
      input.placeholder = "Kommentar hinzufuegen ...";
      renderReplyHint();
      onCountChange(1);
      await load();
      listEl.scrollTop = listEl.scrollHeight;
    } catch (error) {
      toast(describeError(error), "error");
    } finally {
      sendBtn.disabled = false;
    }
  };

  load();
}

function emptyListSkeleton() {
  return `<div style="padding:8px 0;">
    <div class="skeleton" style="height:14px;width:60%;margin-bottom:10px;"></div>
    <div class="skeleton" style="height:14px;width:80%;margin-bottom:10px;"></div>
    <div class="skeleton" style="height:14px;width:50%;"></div>
  </div>`;
}

function commentHtml(comment, all, likedSet, ctx) {
  const author = comment.profiles || {};
  const isMine = author.id === ctx.user.id;
  const liked = likedSet.has(comment.id);
  const replies = all.filter((c) => c.parent_comment_id === comment.id);
  const replyHtml = replies.map((r) => commentHtml(r, [], likedSet, ctx)).join("");
  return `<div class="comment" data-comment-id="${comment.id}">
    <div class="comment-main">
      <button class="comment-avatar" data-open-user="${escapeHtml(author.id)}">${avatarHtml(author, "sm")}</button>
      <div class="grow" style="min-width:0;">
        <div class="comment-name">${escapeHtml(author.display_name || author.username)}</div>
        <div class="comment-text">${escapeHtml(comment.content)}</div>
        <div class="comment-meta">
          <span class="small muted">${timeAgo(comment.created_at)}</span>
          <button class="btn-text small" data-reply="${comment.id}">Antworten</button>
          ${isMine ? `<button class="btn-text small" style="color:var(--error)" data-del-comment="${comment.id}">Loeschen</button>` : ""}
        </div>
      </div>
      <button class="comment-like ${liked ? "liked" : ""}" data-like-comment="${comment.id}" aria-label="Kommentar gefaellt mir">
        ${icon("heart")}<span class="small">${formatCount(comment.like_count)}</span>
      </button>
    </div>
    ${replyHtml ? `<div class="comment-replies">${replyHtml}</div>` : ""}
  </div>`;
}

/* ---------------------------------------------------------------------
   "Mehr"-Menue: loeschen (eigenes) oder melden
--------------------------------------------------------------------- */
function openMoreSheet(video, ctx, state, card, onChange) {
  const root = document.getElementById("app");
  const isSelf = video.user_id === ctx.user.id;
  const { sheet, close } = openSheet(root, `
    <div class="sheet-handle"></div>
    <div class="stack" style="padding:8px 4px 4px;">
      ${isSelf
        ? `<button class="btn btn-danger" data-do="delete">Video loeschen</button>`
        : `<button class="btn btn-ghost" data-do="report">Video melden</button>`}
      <button class="btn btn-ghost" data-do="cancel">Abbrechen</button>
    </div>`);

  sheet.querySelector('[data-do="cancel"]').onclick = close;

  const delBtn = sheet.querySelector('[data-do="delete"]');
  if (delBtn) delBtn.onclick = async () => {
    if (!confirm("Dieses Video wirklich loeschen? Das kann nicht rueckgaengig gemacht werden.")) return;
    try {
      await data.deleteVideo(video);
      close();
      card.remove();
      state.videos = state.videos.filter((v) => v.id !== video.id);
      toast("Video geloescht.", "success");
      onChange?.();
    } catch (error) { toast(describeError(error), "error"); }
  };

  const repBtn = sheet.querySelector('[data-do="report"]');
  if (repBtn) repBtn.onclick = () => { close(); openReportSheet(video, ctx); };
}

function openReportSheet(video, ctx) {
  const root = document.getElementById("app");
  const reasons = [
    ["harassment", "Belaestigung"],
    ["insult", "Beleidigung"],
    ["spam", "Spam"],
    ["violence", "Gewalt"],
    ["inappropriate", "Unangemessene Inhalte"],
    ["copyright", "Urheberrechtsverletzung"],
    ["other", "Sonstiges"],
  ];
  const { sheet, close } = openSheet(root, `
    <div class="sheet-handle"></div>
    <div class="sheet-head"><h3 style="margin:0;">Video melden</h3>
      <button class="icon-btn" data-close>${icon("close")}</button></div>
    <form class="stack" data-form style="padding:0 4px 8px;">
      <div class="field">
        <label class="label">Grund</label>
        <select class="input" name="reason">
          ${reasons.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}
        </select>
      </div>
      <div class="field">
        <label class="label">Details (optional)</label>
        <textarea class="input" name="details" maxlength="1000"
          placeholder="Was ist an diesem Video problematisch?"></textarea>
      </div>
      <button class="btn btn-primary" type="submit">Meldung senden</button>
    </form>`);
  sheet.querySelector("[data-close]").onclick = close;
  sheet.querySelector("form").onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await data.reportContent({
        reporterId: ctx.user.id,
        targetType: "video",
        targetId: video.id,
        reason: fd.get("reason"),
        details: String(fd.get("details") || "").trim(),
      });
      close();
      toast("Danke. Deine Meldung wurde gespeichert.", "success");
    } catch (error) { toast(describeError(error), "error"); }
  };
}

/* =====================================================================
   Home-Feed
===================================================================== */
export async function renderFeed(root, ctx) {
  root.innerHTML = `
    <div class="screen feed-screen">
      <div class="reels" data-reels></div>
      <button class="reel-mute" data-mute-toggle aria-label="Ton ausschalten">${icon("mute")}</button>
      <div class="feed-status" data-status><div class="spinner"></div></div>
    </div>
    ${bottomNav("home", ctx.unreadCount)}`;

  const reelsEl = root.querySelector("[data-reels]");
  const statusEl = root.querySelector("[data-status]");

  let state = null;
  let player = null;
  let loading = false;
  let exhausted = false;

  try {
    const videos = await data.listVideos({ limit: 6 });
    state = await buildState(ctx, videos);
  } catch (error) {
    statusEl.innerHTML = errorState(describeError(error));
    statusEl.querySelector("[data-retry]").onclick = () => renderFeed(root, ctx);
    return;
  }

  if (!state.videos.length) {
    statusEl.innerHTML = emptyState("&#127916;", "Noch keine Videos",
      "Sobald jemand ein Video hochlaedt, erscheint es hier.");
    root.querySelector("[data-mute-toggle]").style.display = "none";
    return;
  }

  statusEl.remove();
  reelsEl.innerHTML = state.videos.map((v) => reelCard(v, {
    meId: state.meId,
    following: state.following.has(v.profiles?.id),
    liked: state.liked.has(v.id),
    saved: state.saved.has(v.id),
  })).join("");

  player = attachPlayerBehaviour(reelsEl, state, ctx, null);
  root.querySelector("[data-mute-toggle]").onclick = () => player.setMuted(!state.muted);

  // Unendliches Nachladen beim Scrollen
  const sentinel = document.createElement("div");
  sentinel.className = "feed-sentinel";
  reelsEl.appendChild(sentinel);
  const loadMoreObserver = new IntersectionObserver(async (entries) => {
    if (!entries[0].isIntersecting || loading || exhausted) return;
    loading = true;
    try {
      const last = state.videos[state.videos.length - 1];
      const more = await data.listVideos({ limit: 6, before: last.created_at });
      if (!more.length) { exhausted = true; return; }
      more.forEach((v) => {
        state.videos.push(v);
        const node = el(reelCard(v, {
          meId: state.meId,
          following: state.following.has(v.profiles?.id),
          liked: state.liked.has(v.id),
          saved: state.saved.has(v.id),
        }));
        sentinel.insertAdjacentElement("beforebegin", node);
      });
      rebindAll(reelsEl, state, ctx, player);
    } catch (_) {
      exhausted = true;
    } finally {
      loading = false;
    }
  }, { root: reelsEl, rootMargin: "0px 0px 600px 0px" });
  loadMoreObserver.observe(sentinel);

  // Profil-/Follow-Aktionen delegiert
  bindDelegatedActions(reelsEl, state, ctx, null);
}

/** Nach dem Nachladen alle Karten (erneut) mit Verhalten ausstatten. */
function rebindAll(container, state, ctx, player) {
  player.observer.disconnect();
  container.querySelectorAll(".reel").forEach((c) => player.observer.observe(c));
  container.querySelectorAll(".reel").forEach((c) => wireCard(c, state, ctx, player.setMuted, null));
}

/** Klick auf Avatar und Folgen-Button (delegiert, ueberlebt Nachladen). */
function bindDelegatedActions(container, state, ctx, onChange) {
  container.addEventListener("click", (e) => {
    const av = e.target.closest("[data-open-user]");
    if (av) { e.stopPropagation(); ctx.navigate("user", { id: av.dataset.openUser }); return; }
    const fo = e.target.closest("[data-follow]");
    if (fo) { e.stopPropagation(); followAuthor(fo.dataset.follow, state, ctx, fo); return; }
  });
}

/* =====================================================================
   Einzelnes Video (aus dem Profil)
===================================================================== */
export async function renderWatch(root, ctx, params) {
  const id = params?.id;
  root.innerHTML = `<div class="screen feed-screen">
      <div class="reels" data-reels></div>
      <div class="feed-status" data-status><div class="spinner"></div></div>
    </div>`;

  const reelsEl = root.querySelector("[data-reels]");
  const statusEl = root.querySelector("[data-status]");
  let video;
  try {
    video = await data.getVideoById(id);
  } catch (error) {
    statusEl.innerHTML = errorState(describeError(error));
    return;
  }
  if (!video) {
    statusEl.innerHTML = emptyState("&#128683;", "Video nicht gefunden",
      "Es wurde geloescht oder ist nicht oeffentlich.");
    return;
  }
  const state = await buildState(ctx, [video]);
  statusEl.remove();

  const topbar = document.createElement("div");
  topbar.className = "watch-topbar";
  topbar.innerHTML = `<button class="icon-btn" data-back>${icon("back")}</button>
    <span class="grow"></span>
    <button class="icon-btn" data-mute-toggle>${icon("mute")}</button>`;
  reelsEl.insertAdjacentElement("beforebegin", topbar);
  topbar.querySelector("[data-back]").onclick = () => history.back();

  reelsEl.innerHTML = reelCard(video, {
    meId: state.meId,
    following: state.following.has(video.profiles?.id),
    liked: state.liked.has(video.id),
    saved: state.saved.has(video.id),
  });

  const player = attachPlayerBehaviour(reelsEl, state, ctx, null);
  topbar.querySelector("[data-mute-toggle]").onclick = () => player.setMuted(!state.muted);
  bindDelegatedActions(reelsEl, state, ctx, null);
}
