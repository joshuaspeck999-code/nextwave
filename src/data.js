// =====================================================================
// NEXTWAVE - Datenzugriffsschicht (Repository Pattern)
// =====================================================================
// Hier liegt JEDER Datenbank-/Storage-Zugriff. Die Oberflaeche kennt
// kein SQL und keine Tabellennamen - sie ruft nur diese Funktionen auf.
//
// Alle Funktionen geben bei Fehlern eine Exception weiter (throw). Die
// aufrufende Ansicht faengt sie und zeigt describeError(error).
// =====================================================================
import { supabase } from "./supabaseClient.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

/* ---------------------------------------------------------------------
   Spaltenlisten (bewusst explizit - keine select("*"))
--------------------------------------------------------------------- */
const PROFILE_COLUMNS = [
  "id", "username", "display_name", "bio", "avatar_path", "banner_path",
  "website_url", "birthdate", "is_private", "role", "is_blocked", "badge",
  "follower_count", "following_count", "video_count", "total_like_count",
  "created_at",
].join(", ");

const VIDEO_COLUMNS = [
  "id", "user_id", "title", "description", "video_path", "thumbnail_path",
  "duration_seconds", "visibility", "moderation_status",
  "view_count", "like_count", "comment_count", "created_at",
].join(", ");

// Eingebettetes Profil (PostgREST-Join ueber den Fremdschluessel)
const VIDEO_WITH_AUTHOR = `${VIDEO_COLUMNS}, profiles!videos_user_id_fkey(${PROFILE_COLUMNS})`;

/* ---------------------------------------------------------------------
   Kleine Helfer
--------------------------------------------------------------------- */

/** Macht aus Nutzereingabe ein sicheres LIKE-Muster (% und _ escapen). */
function likePattern(input) {
  const escaped = String(input || "").replace(/[\\%_]/g, (c) => "\\" + c);
  return `%${escaped}%`;
}

function requireUser(user) {
  if (!user?.id) throw new Error("Nicht angemeldet.");
  return user.id;
}

/* =====================================================================
   PROFILE
===================================================================== */

/** Eigenes Profil (oder null, falls der Trigger es noch nicht angelegt hat). */
export async function getMyProfile(userId) {
  const { data, error } = await supabase
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Profil ueber die eindeutige ID. */
export async function getProfileById(id) {
  const { data, error } = await supabase
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Profil ueber den Benutzernamen (exakt, ohne Gross-/Kleinschreibung). */
export async function getProfileByUsername(username) {
  const { data, error } = await supabase
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .eq("username", String(username).trim().toLowerCase())
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Profildaten aendern. RLS + Spaltenrechte erlauben nur die eigenen Felder. */
export async function updateProfile(userId, patch) {
  const { data, error } = await supabase
    .from("profiles")
    .update(patch)
    .eq("id", userId)
    .select(PROFILE_COLUMNS)
    .single();
  if (error) throw error;
  return data;
}

/** Ist ein Benutzername noch frei? (Serverabfrage, auch ohne Session) */
export async function isUsernameAvailable(candidate) {
  const { data, error } = await supabase.rpc("is_username_available", {
    candidate: String(candidate || "").trim().toLowerCase(),
  });
  if (error) throw error;
  return data === true;
}

/** Benutzersuche (Phase 2/5). Leere Suche => die neuesten Profile. */
export async function searchProfiles(query, limit = 20) {
  const term = String(query || "").trim();
  let request = supabase.from("profiles").select(PROFILE_COLUMNS).limit(limit);
  if (term) {
    request = request.or(
      `username.ilike.${likePattern(term)},display_name.ilike.${likePattern(term)}`
    );
  } else {
    request = request.order("created_at", { ascending: false });
  }
  const { data, error } = await request;
  if (error) throw error;
  return data || [];
}

/* =====================================================================
   STORAGE (Avatare, Banner, Videos)
===================================================================== */

/** Laedt ein Bild hoch und liefert den gespeicherten PFAD zurueck. */
export async function uploadImage(bucket, userId, file, prefix) {
  requireUser({ id: userId });
  const ext = pickExt(file);
  const path = `${userId}/${prefix}_${Date.now()}.${ext}`;
  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, file, { contentType: file.type || "image/jpeg", upsert: true });
  if (error) throw error;
  return path;
}

export async function removeObject(bucket, path) {
  if (!path) return;
  await supabase.storage.from(bucket).remove([path]);
}

/** Zeitlich begrenzter Link fuer ein privates Video. */
export async function signedVideoUrl(path, expiresInSeconds = 3600) {
  const { data, error } = await supabase.storage
    .from("videos")
    .createSignedUrl(path, expiresInSeconds);
  if (error) throw error;
  return data?.signedUrl || null;
}

function pickExt(file, allowed = ["jpg", "jpeg", "png", "webp"]) {
  const fromName = (file.name.split(".").pop() || "").toLowerCase();
  if (allowed.includes(fromName)) return fromName;
  if (file.type === "image/png") return "png";
  if (file.type === "image/webp") return "webp";
  if (file.type === "video/quicktime") return "mov";
  return allowed[0];
}

/* =====================================================================
   VIDEOS
===================================================================== */

/**
 * Feed-Seite: sichtbare Videos, neueste zuerst.
 * Welche Videos sichtbar sind, entscheidet ausschliesslich die RLS-Policy
 * (eigene immer, sonst nur freigegeben + oeffentlich/Follower).
 */
export async function listVideos({ userId = null, limit = 8, before = null } = {}) {
  let request = supabase
    .from("videos")
    .select(VIDEO_WITH_AUTHOR)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (userId) request = request.eq("user_id", userId);
  if (before) request = request.lt("created_at", before);
  const { data, error } = await request;
  if (error) throw error;
  return data || [];
}

export async function getVideoById(id) {
  const { data, error } = await supabase
    .from("videos")
    .select(VIDEO_WITH_AUTHOR)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Videosuche ueber die Beschreibung (Phase 5). */
export async function searchVideos(query, limit = 20) {
  const term = String(query || "").trim();
  if (!term) return [];
  const { data, error } = await supabase
    .from("videos")
    .select(VIDEO_WITH_AUTHOR)
    .ilike("description", likePattern(term))
    .order("view_count", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

/** Hashtag-Suche (Phase 5). */
export async function searchHashtags(query, limit = 20) {
  const term = String(query || "").trim();
  if (!term) return [];
  const { data, error } = await supabase
    .from("hashtags")
    .select("id, tag")
    .ilike("tag", likePattern(term))
    .limit(limit);
  if (error) throw error;
  return data || [];
}

/** Videos zu einem Hashtag: Suche im Beschreibungstext nach "#tag". */
export async function listVideosByHashtag(tag, limit = 20) {
  return searchVideos("#" + String(tag).replace(/^#/, ""), limit);
}

/**
 * Video veroeffentlichen.
 * Reihenfolge ist bewusst: erst Datei hochladen, dann den Datenbankeintrag.
 * Scheitert der Eintrag, wird die Datei wieder entfernt - es entsteht kein
 * "kaputter" Videoeintrag ohne Datei.
 *
 * Der Upload laeuft ueber XMLHttpRequest, damit ein echter Fortschritt
 * angezeigt und der Vorgang abgebrochen werden kann.
 */
export async function publishVideo({
  userId, videoId, file, description, visibility, durationSeconds, onProgress, signal,
}) {
  requireUser({ id: userId });

  // 1. Datei hochladen (mit Fortschritt / Abbbruchmoeglichkeit)
  const path = await uploadVideoWithProgress({ userId, videoId, file, onProgress, signal });

  // 2. Datenbankeintrag anlegen
  const { data, error } = await supabase
    .from("videos")
    .insert({
      id: videoId,
      user_id: userId,
      title: "",
      description: description || "",
      video_path: path,
      duration_seconds: Math.max(0, Math.round(durationSeconds || 0)),
      file_size_bytes: file.size,
      visibility: visibility || "public",
    })
    .select(VIDEO_COLUMNS)
    .single();

  if (error) {
    // Aufraeumen: keine halbfertige Datei im Storage zuruecklassen.
    await removeObject("videos", path);
    throw error;
  }

  return data;
}

/**
 * Upload in den privaten Bucket "videos" mit Fortschrittsangabe.
 * Nutzt bewusst XHR statt des supabase-js-Helfers, weil nur XHR
 * onprogress-Ereignisse liefert.
 */
function uploadVideoWithProgress({ userId, videoId, file, onProgress, signal }) {
  return new Promise((resolve, reject) => {
    (async () => {
      try {
        const ext = pickExt(file, ["mp4", "mov"]);
        const path = `${userId}/${videoId}.${ext}`;
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) { reject(new Error("Sitzung abgelaufen. Bitte neu anmelden.")); return; }

        const xhr = new XMLHttpRequest();
        xhr.open("POST", `${SUPABASE_URL}/storage/v1/object/videos/${path}`, true);
        xhr.setRequestHeader("Authorization", `Bearer ${session.access_token}`);
        xhr.setRequestHeader("apikey", SUPABASE_ANON_KEY);
        xhr.setRequestHeader("x-upsert", "false");
        xhr.setRequestHeader("Content-Type", file.type || "video/mp4");

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) { resolve(path); return; }
          let msg = "Upload fehlgeschlagen.";
          try { msg = JSON.parse(xhr.responseText).message || msg; } catch (_) {}
          reject(new Error(msg));
        };
        xhr.onerror = () => reject(new Error("Netzwerkfehler waehrend des Uploads."));
        xhr.onabort = () => { const e = new Error("Upload abgebrochen."); e.aborted = true; reject(e); };
        signal?.addEventListener("abort", () => xhr.abort(), { once: true });
        xhr.send(file);
      } catch (error) {
        reject(error);
      }
    })();
  });
}

/** Vorschaubild zu einem Video hochladen und in der Datenbank verknuepfen. */
export async function uploadThumbnail(userId, videoId, blob) {
  const path = `${userId}/${videoId}.jpg`;
  const { error } = await supabase.storage
    .from("thumbnails")
    .upload(path, blob, { contentType: "image/jpeg", upsert: true });
  if (error) throw error;
  const { error: dbError } = await supabase
    .from("videos").update({ thumbnail_path: path }).eq("id", videoId);
  if (dbError) throw dbError;
  return path;
}

export async function deleteVideo(video) {
  const { error } = await supabase.from("videos").delete().eq("id", video.id);
  if (error) throw error;
  await removeObject("videos", video.video_path);
  if (video.thumbnail_path) await removeObject("thumbnails", video.thumbnail_path);
}

/**
 * Hashtags aus dem Beschreibungstext dauerhaft speichern.
 * Best-effort: schlaegt es fehl, bleibt die Beschreibung trotzdem gueltig.
 */
export async function attachHashtags(videoId, description) {
  const tags = [...new Set(
    (String(description || "").toLowerCase().match(/#([a-z0-9_]{1,50})/g) || [])
      .map((t) => t.slice(1))
  )];
  if (!tags.length) return;

  for (const tag of tags) {
    try {
      let { data: existing } = await supabase
        .from("hashtags").select("id").eq("tag", tag).maybeSingle();
      if (!existing) {
        const { data: created } = await supabase
          .from("hashtags").insert({ tag }).select("id").single();
        existing = created;
      }
      if (existing?.id) {
        await supabase.from("video_hashtags")
          .insert({ video_id: videoId, hashtag_id: existing.id });
      }
    } catch (_) {
      // Einzelne Hashtags duerfen den Upload nicht scheitern lassen.
    }
  }
}

/* =====================================================================
   VIEWS (Aufrufe)
===================================================================== */
export async function recordView(videoId, userId, watchSeconds = 0) {
  try {
    await supabase.from("views").insert({
      video_id: videoId,
      user_id: userId || null,
      watch_duration_seconds: Math.max(0, Math.round(watchSeconds || 0)),
    });
  } catch (_) {
    // Aufrufzaehlung ist nicht kritisch - niemals die Wiedergabe stoeren.
  }
}

/* =====================================================================
   LIKES
===================================================================== */
export async function listMyLikes(userId) {
  const { data, error } = await supabase
    .from("likes").select("video_id").eq("user_id", userId);
  if (error) throw error;
  return new Set((data || []).map((r) => r.video_id));
}

export async function likeVideo(userId, videoId) {
  const { error } = await supabase.from("likes").insert({ user_id: userId, video_id: videoId });
  // 23505 = bereits geliked: kein Fehler, das Ergebnis ist bereits erreicht.
  if (error && error.code !== "23505") throw error;
}

export async function unlikeVideo(userId, videoId) {
  const { error } = await supabase.from("likes").delete()
    .eq("user_id", userId).eq("video_id", videoId);
  if (error) throw error;
}

/* =====================================================================
   SAVED_VIDEOS (Lesezeichen)
===================================================================== */
export async function listMySaved(userId) {
  const { data, error } = await supabase
    .from("saved_videos").select("video_id").eq("user_id", userId);
  if (error) throw error;
  return new Set((data || []).map((r) => r.video_id));
}

export async function saveVideo(userId, videoId) {
  const { error } = await supabase.from("saved_videos").insert({ user_id: userId, video_id: videoId });
  if (error && error.code !== "23505") throw error;
}

export async function unsaveVideo(userId, videoId) {
  const { error } = await supabase.from("saved_videos").delete()
    .eq("user_id", userId).eq("video_id", videoId);
  if (error) throw error;
}

export async function listSavedVideos(userId, limit = 24) {
  const { data, error } = await supabase
    .from("saved_videos")
    .select(`created_at, videos!saved_videos_video_id_fkey(${VIDEO_WITH_AUTHOR})`)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data || []).map((r) => r.videos).filter(Boolean);
}

export async function listLikedVideos(userId, limit = 24) {
  const { data, error } = await supabase
    .from("likes")
    .select(`created_at, videos!likes_video_id_fkey(${VIDEO_WITH_AUTHOR})`)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data || []).map((r) => r.videos).filter(Boolean);
}

/* =====================================================================
   COMMENTS
===================================================================== */
export async function listComments(videoId) {
  const { data, error } = await supabase
    .from("comments")
    .select(`id, video_id, user_id, parent_comment_id, content, like_count, created_at,
             profiles!comments_user_id_fkey(${PROFILE_COLUMNS})`)
    .eq("video_id", videoId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function addComment({ userId, videoId, content, parentCommentId = null }) {
  const { data, error } = await supabase
    .from("comments")
    .insert({
      user_id: userId,
      video_id: videoId,
      content: content,
      parent_comment_id: parentCommentId,
    })
    .select(`id, video_id, user_id, parent_comment_id, content, like_count, created_at,
             profiles!comments_user_id_fkey(${PROFILE_COLUMNS})`)
    .single();
  if (error) throw error;
  return data;
}

export async function deleteComment(commentId) {
  const { error } = await supabase.from("comments").delete().eq("id", commentId);
  if (error) throw error;
}

export async function listMyCommentLikes(userId) {
  const { data, error } = await supabase
    .from("comment_likes").select("comment_id").eq("user_id", userId);
  if (error) throw error;
  return new Set((data || []).map((r) => r.comment_id));
}

export async function likeComment(userId, commentId) {
  const { error } = await supabase.from("comment_likes").insert({ user_id: userId, comment_id: commentId });
  if (error && error.code !== "23505") throw error;
}

export async function unlikeComment(userId, commentId) {
  const { error } = await supabase.from("comment_likes").delete()
    .eq("user_id", userId).eq("comment_id", commentId);
  if (error) throw error;
}

/* =====================================================================
   FOLLOWS
===================================================================== */
/** Alle IDs, denen ich folge (fuer die "Folgen"-Buttons im Feed). */
export async function listMyFollowingIds(userId) {
  const { data, error } = await supabase
    .from("follows").select("following_id").eq("follower_id", userId);
  if (error) throw error;
  return new Set((data || []).map((r) => r.following_id));
}

export async function isFollowing(followerId, followingId) {
  const { data, error } = await supabase
    .from("follows")
    .select("follower_id")
    .eq("follower_id", followerId)
    .eq("following_id", followingId)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

export async function follow(followerId, followingId) {
  const { error } = await supabase.from("follows").insert({
    follower_id: followerId, following_id: followingId,
  });
  if (error && error.code !== "23505") throw error;
}

export async function unfollow(followerId, followingId) {
  const { error } = await supabase.from("follows").delete()
    .eq("follower_id", followerId).eq("following_id", followingId);
  if (error) throw error;
}

/** Wer folgt diesem Nutzer? */
export async function listFollowers(userId, limit = 50) {
  const { data, error } = await supabase
    .from("follows")
    .select(`created_at, profiles!follows_follower_id_fkey(${PROFILE_COLUMNS})`)
    .eq("following_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data || []).map((r) => r.profiles).filter(Boolean);
}

/** Wem folgt dieser Nutzer? */
export async function listFollowing(userId, limit = 50) {
  const { data, error } = await supabase
    .from("follows")
    .select(`created_at, profiles!follows_following_id_fkey(${PROFILE_COLUMNS})`)
    .eq("follower_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data || []).map((r) => r.profiles).filter(Boolean);
}

/* =====================================================================
   NOTIFICATIONS
===================================================================== */
export async function listNotifications(userId, limit = 50) {
  const { data, error } = await supabase
    .from("notifications")
    .select(`id, recipient_id, sender_id, type, video_id, comment_id, is_read, created_at,
             sender:profiles!notifications_sender_id_fkey(${PROFILE_COLUMNS})`)
    .eq("recipient_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

export async function countUnreadNotifications(userId) {
  const { count, error } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("recipient_id", userId)
    .eq("is_read", false);
  if (error) throw error;
  return count || 0;
}

export async function markAllNotificationsRead(userId) {
  const { error } = await supabase
    .from("notifications").update({ is_read: true })
    .eq("recipient_id", userId).eq("is_read", false);
  if (error) throw error;
}

/* =====================================================================
   REPORTS (Meldesystem)
===================================================================== */
export async function reportContent({ reporterId, targetType, targetId, reason, details = "" }) {
  const { error } = await supabase.from("reports").insert({
    reporter_id: reporterId,
    target_type: targetType,
    target_id: targetId,
    reason: reason,
    details: details,
  });
  // 23505 = schon einmal gemeldet
  if (error && error.code !== "23505") throw error;
}

/* =====================================================================
   MODERATION (nur fuer moderator/admin - RPC prueft die Rolle serverseitig)
===================================================================== */
export async function listPendingVideos(limit = 50) {
  const { data, error } = await supabase
    .from("videos")
    .select(VIDEO_WITH_AUTHOR)
    .eq("moderation_status", "pending")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

export async function listOpenReports(limit = 50) {
  const { data, error } = await supabase
    .from("reports")
    .select(`id, reporter_id, target_type, target_id, reason, details, status, created_at,
             reporter:profiles!reports_reporter_id_fkey(${PROFILE_COLUMNS})`)
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

export async function moderateVideo(videoId, newStatus, notes = "") {
  const { error } = await supabase.rpc("nextwave_moderate_video", {
    p_video: videoId, p_status: newStatus, p_notes: notes,
  });
  if (error) throw error;
}

export async function moderateComment(commentId, newStatus, notes = "") {
  const { error } = await supabase.rpc("nextwave_moderate_comment", {
    p_comment: commentId, p_status: newStatus, p_notes: notes,
  });
  if (error) throw error;
}

export async function resolveReport(reportId, status, note = "") {
  const { error } = await supabase.rpc("nextwave_resolve_report", {
    p_report: reportId, p_status: status, p_note: note,
  });
  if (error) throw error;
}

export async function setUserBlocked(targetUserId, blocked) {
  const { error } = await supabase.rpc("nextwave_set_user_blocked", {
    p_user: targetUserId, p_blocked: blocked,
  });
  if (error) throw error;
}

/* =====================================================================
   ADMIN PANEL
===================================================================== */

/** Schnellzahlen für die Übersicht (Parallelabfragen mit Kopfzählung). */
export async function getAdminStats() {
  const head = { count: "exact", head: true };
  const [users, videos, pending, reports, blocked, comments] = await Promise.all([
    supabase.from("profiles").select("id", head),
    supabase.from("videos").select("id", head),
    supabase.from("videos").select("id", head).eq("moderation_status", "pending"),
    supabase.from("reports").select("id", head).eq("status", "open"),
    supabase.from("profiles").select("id", head).eq("is_blocked", true),
    supabase.from("comments").select("id", head),
  ]);
  return {
    users: users.count || 0,
    videos: videos.count || 0,
    pending: pending.count || 0,
    reports: reports.count || 0,
    blocked: blocked.count || 0,
    comments: comments.count || 0,
  };
}

/** Videos für die Moderation, optional auf einen Status gefiltert. */
export async function listVideosForModeration({ status = "pending", limit = 50 } = {}) {
  let request = supabase
    .from("videos")
    .select(VIDEO_WITH_AUTHOR)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (status && status !== "all") request = request.eq("moderation_status", status);
  const { data, error } = await request;
  if (error) throw error;
  return data || [];
}

/** Die neuesten Kommentare (inkl. Autor) für die Kommentar-Moderation. */
export async function listRecentComments(limit = 50) {
  const { data, error } = await supabase
    .from("comments")
    .select(`id, video_id, user_id, content, moderation_status, like_count, created_at,
             profiles!comments_user_id_fkey(${PROFILE_COLUMNS})`)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

/** Globale Plattform-Einstellungen (Lockdown & Schalter). */
export async function getPlatformSettings() {
  const { data, error } = await supabase
    .from("platform_settings")
    .select("lockdown_enabled, lockdown_message, signups_disabled, uploads_disabled, updated_at")
    .eq("id", 1)
    .maybeSingle();
  if (error) throw error;
  return data || {
    lockdown_enabled: false, lockdown_message: "",
    signups_disabled: false, uploads_disabled: false, updated_at: null,
  };
}

/** Lockdown und Schalter setzen (nur Admin - serverseitig geprüft). */
export async function setLockdown({
  enabled, message = "", signupsDisabled = false, uploadsDisabled = false,
}) {
  const { error } = await supabase.rpc("nextwave_set_lockdown", {
    p_enabled: !!enabled,
    p_message: message || "",
    p_signups_disabled: !!signupsDisabled,
    p_uploads_disabled: !!uploadsDisabled,
  });
  if (error) throw error;
}

/** Nutzerliste fuer das Admin-Panel (Suche + optionale Filter). */
export async function adminListProfiles({ query = "", filter = "all", limit = 100 } = {}) {
  let request = supabase.from("profiles").select(PROFILE_COLUMNS).limit(limit);
  const term = String(query || "").trim();
  if (term) {
    request = request.or(
      `username.ilike.${likePattern(term)},display_name.ilike.${likePattern(term)}`
    );
  }
  if (filter === "blocked") request = request.eq("is_blocked", true);
  if (filter === "moderators") request = request.in("role", ["moderator", "admin"]);
  const { data, error } = await request.order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

/* =====================================================================
   EVENTS (zeitlich begrenzte Aktionen mit Badge)
===================================================================== */
const EVENT_COLUMNS = "id, name, badge_label, starts_at, ends_at, created_at";

/** Das gerade laufende Event (oder null). */
export async function getActiveEvent() {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("platform_events")
    .select(EVENT_COLUMNS)
    .lte("starts_at", now)
    .gt("ends_at", now)
    .order("starts_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

/** Alle Events (neueste zuerst) fuer die Admin-Uebersicht. */
export async function listEvents(limit = 20) {
  const { data, error } = await supabase
    .from("platform_events")
    .select(EVENT_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

/** Wie viele Konten tragen aktuell dieses Badge? */
export async function countBadgeHolders(badgeLabel) {
  if (!badgeLabel) return 0;
  const { count, error } = await supabase
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("badge", badgeLabel);
  if (error) throw error;
  return count || 0;
}

/** Neues Event starten (nur Admin - serverseitig geprueft). */
export async function startEvent({ name, badgeLabel, durationMinutes }) {
  const { error } = await supabase.rpc("nextwave_start_event", {
    p_name: name,
    p_badge_label: badgeLabel,
    p_duration_minutes: Math.round(durationMinutes),
  });
  if (error) throw error;
}

/** Das laufende Event vorzeitig beenden (nur Admin). */
export async function stopActiveEvent() {
  const { error } = await supabase.rpc("nextwave_stop_active_event");
  if (error) throw error;
}
