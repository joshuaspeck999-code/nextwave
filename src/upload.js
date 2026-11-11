// =====================================================================
// NEXTWAVE - Video hochladen
// =====================================================================
// Echter Upload in den privaten Bucket "videos" mit
//   * Vorschau und Laengenanzeige
//   * Vorschaubild-Erzeugung im Browser (Canvas)
//   * Fortschrittsanzeige und Abbruchmoeglichkeit
// Der Datenbankeintrag entsteht erst nach erfolgreichem Upload.
// =====================================================================
import * as data from "./data.js";
import { escapeHtml, toast, describeError } from "./utils.js";
import { icon, bottomNav } from "./ui.js";

const MAX_VIDEO_BYTES = 50 * 1024 * 1024; // 50 MB (Free-Plan / Bucket-Limit)
const MAX_DURATION_SECONDS = 600;         // 10 Minuten
const ALLOWED = ["video/mp4", "video/quicktime"];

export function renderUpload(root, ctx) {
  // Uploads sind waehrend eines Lockdowns bzw. wenn deaktiviert gesperrt.
  const settings = ctx.settings || {};
  if (settings.lockdown_enabled || settings.uploads_disabled) {
    const message = settings.lockdown_message
      || "Uploads sind vor\u00fcbergehend deaktiviert. Bitte versuche es sp\u00e4ter erneut.";
    root.innerHTML = `
      <div class="screen">
        <div class="topbar"><h2 class="grow" style="margin:0;">Video hochladen</h2></div>
        <div class="empty">
          <div class="emoji">&#128274;</div>
          <div style="color:var(--text);font-weight:600;margin-bottom:6px;">Uploads pausiert</div>
          <div class="small">${escapeHtml(message)}</div>
        </div>
      </div>
      ${bottomNav("upload", ctx.unreadCount)}`;
    return;
  }

  root.innerHTML = `
    <div class="screen">
      <div class="topbar"><h2 class="grow" style="margin:0;">Video hochladen</h2></div>

      <div data-banner></div>

      <form class="stack" novalidate>
        <div class="field">
          <label class="label" for="up-file">Video auswaehlen</label>
          <input class="input" id="up-file" name="file" type="file"
                 accept="video/mp4,video/quicktime" />
          <div class="field-hint">MP4 oder MOV, hoechstens 50 MB und maximal 10 Minuten.</div>
          <div class="field-error" data-error-for="file"></div>
        </div>

        <div class="upload-preview hidden" data-preview-wrap>
          <video class="upload-preview-video" data-preview muted playsinline controls></video>
          <div class="upload-meta">
            <span class="small muted" data-meta-name></span>
            <span class="badge" data-meta-duration></span>
          </div>
        </div>

        <div class="field">
          <label class="label" for="up-desc">Beschreibung</label>
          <textarea class="input" id="up-desc" name="description" maxlength="2200"
            placeholder="Erzaehl etwas zu deinem Video ... #hashtags sind erlaubt"></textarea>
          <div class="field-hint"><span data-char-count>0</span> / 2200 Zeichen</div>
          <div class="field-error" data-error-for="description"></div>
        </div>

        <div class="field">
          <label class="label" for="up-visibility">Sichtbarkeit</label>
          <select class="input" id="up-visibility" name="visibility">
            <option value="public">Oeffentlich - fuer alle sichtbar</option>
            <option value="followers">Nur Follower</option>
            <option value="private">Privat - nur ich</option>
          </select>
        </div>

        <div class="upload-progress hidden" data-progress-wrap>
          <div class="progress-track"><div class="progress-bar" data-progress-bar></div></div>
          <div class="row" style="justify-content:space-between;margin-top:8px;">
            <span class="small muted" data-progress-label>0 %</span>
            <button class="btn-text" type="button" style="color:var(--error)" data-cancel>Abbrechen</button>
          </div>
        </div>

        <button class="btn btn-primary" type="submit" data-submit>
          ${icon("plus")} Veroeffentlichen
        </button>
      </form>

      <p class="muted small" style="margin-top:16px;">
        Dein Video wird sicher in Supabase Storage gespeichert und ist erst
        sichtbar, wenn der Upload vollstaendig abgeschlossen ist.
      </p>
    </div>
    ${bottomNav("upload", ctx.unreadCount)}`;

  const form = root.querySelector("form");
  const fileInput = form.querySelector('[name="file"]');
  const descInput = form.querySelector('[name="description"]');
  const submitBtn = form.querySelector("[data-submit]");
  const cancelBtn = root.querySelector("[data-cancel]");
  const previewWrap = root.querySelector("[data-preview-wrap]");
  const previewVideo = root.querySelector("[data-preview]");
  const progressWrap = root.querySelector("[data-progress-wrap]");
  const progressBar = root.querySelector("[data-progress-bar]");
  const progressLabel = root.querySelector("[data-progress-label]");
  const banner = root.querySelector("[data-banner]");
  const charCount = root.querySelector("[data-char-count]");

  let selected = null;   // { file, durationSeconds, thumbnailBlob, url }
  let controller = null;

  descInput.addEventListener("input", () => {
    charCount.textContent = descInput.value.length;
  });

  fileInput.onchange = async () => {
    clearError("file");
    const file = fileInput.files?.[0];
    if (!file) { resetPreview(); return; }

    const typeError = validateType(file);
    if (typeError) { fieldError("file", typeError); fileInput.value = ""; resetPreview(); return; }

    // Groesse zuerst pruefen (schnell, ohne Datei zu laden)
    if (file.size > MAX_VIDEO_BYTES) {
      fieldError("file", "Das Video ist groesser als 50 MB. Bitte kuerze es.");
      fileInput.value = ""; resetPreview(); return;
    }

    setBanner("Video wird vorbereitet ...");
    try {
      const meta = await readVideoMeta(file);
      if (meta.durationSeconds > MAX_DURATION_SECONDS) {
        fieldError("file", "Das Video ist laenger als 10 Minuten.");
        fileInput.value = ""; resetPreview(); setBanner(""); return;
      }
      selected = { file, ...meta };
      showPreview(file, meta);
      setBanner("");
    } catch (error) {
      fieldError("file", describeError(error));
      fileInput.value = ""; resetPreview(); setBanner("");
    }
  };

  function resetPreview() {
    if (selected?.url) URL.revokeObjectURL(selected.url);
    selected = null;
    previewWrap.classList.add("hidden");
    previewVideo.removeAttribute("src");
  }

  function showPreview(file, meta) {
    previewVideo.src = meta.url;
    root.querySelector("[data-meta-name]").textContent =
      `${file.name} · ${(file.size / (1024 * 1024)).toFixed(1)} MB`;
    root.querySelector("[data-meta-duration]").textContent = formatDuration(meta.durationSeconds);
    previewWrap.classList.remove("hidden");
  }

  cancelBtn.onclick = () => {
    if (controller) controller.abort();
  };

  form.onsubmit = async (event) => {
    event.preventDefault();
    clearError("file");
    clearError("description");
    setBanner("");

    if (!selected) {
      fieldError("file", "Bitte zuerst ein Video auswaehlen.");
      return;
    }
    const description = descInput.value.trim();

    const videoId = crypto.randomUUID();
    controller = new AbortController();
    setSubmitting(true);

    try {
      const video = await data.publishVideo({
        userId: ctx.user.id,
        videoId,
        file: selected.file,
        description,
        visibility: form.querySelector('[name="visibility"]').value,
        durationSeconds: selected.durationSeconds,
        onProgress: (ratio) => setProgress(ratio),
        signal: controller.signal,
      });

      // Vorschaubild und Hashtags sind "nice to have" - sie duerfen den
      // erfolgreichen Upload nicht mehr scheitern lassen.
      setProgress(1, "Fast fertig ...");
      if (selected.thumbnailBlob) {
        try { await data.uploadThumbnail(ctx.user.id, videoId, selected.thumbnailBlob); }
        catch (_) { /* Vorschaubild optional */ }
      }
      await data.attachHashtags(videoId, description);

      toast("Video veroeffentlicht.", "success");
      resetPreview();
      ctx.navigate("profile");
    } catch (error) {
      if (error?.aborted) {
        toast("Upload abgebrochen.", "error");
      } else {
        setBanner(describeError(error));
        toast("Upload fehlgeschlagen.", "error");
      }
    } finally {
      controller = null;
      setSubmitting(false);
    }
  };

  /* ---------- Helfer ---------- */
  function fieldError(name, message) {
    const input = form.querySelector(`[name="${name}"]`);
    const slot = form.querySelector(`[data-error-for="${name}"]`);
    if (input) input.classList.toggle("invalid", Boolean(message));
    if (slot) slot.textContent = message || "";
  }
  function clearError(name) { fieldError(name, ""); }
  function setBanner(message, type = "error") {
    banner.innerHTML = message ? `<div class="banner ${type}">${escapeHtml(message)}</div>` : "";
  }
  function setSubmitting(busy) {
    submitBtn.disabled = busy;
    fileInput.disabled = busy;
    descInput.disabled = busy;
    submitBtn.innerHTML = busy
      ? `<span class="spinner"></span> Wird hochgeladen ...`
      : `${icon("plus")} Veroeffentlichen`;
    progressWrap.classList.toggle("hidden", !busy);
    if (!busy) setProgress(0);
  }
  function setProgress(ratio, label) {
    const percent = Math.round((ratio || 0) * 100);
    progressBar.style.width = `${percent}%`;
    progressLabel.textContent = label || `${percent} %`;
  }
}

/* ---------------------------------------------------------------------
   Datei pruefen, Laenge lesen, Vorschaubild erzeugen
--------------------------------------------------------------------- */
function validateType(file) {
  const name = (file.name.split(".").pop() || "").toLowerCase();
  if (ALLOWED.includes(file.type) || ["mp4", "mov"].includes(name)) return null;
  return "Nur MP4 oder MOV werden unterstuetzt.";
}

function formatDuration(seconds) {
  const s = Math.max(0, Math.round(seconds || 0));
  const m = Math.floor(s / 60);
  const rest = String(s % 60).padStart(2, "0");
  return `${m}:${rest}`;
}

function readVideoMeta(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    video.src = url;

    const cleanup = () => { video.removeAttribute("src"); video.load?.(); };
    const timer = setTimeout(() => { cleanup(); reject(new Error("Das Video konnte nicht gelesen werden.")); }, 15000);

    video.onloadedmetadata = () => {
      if (!Number.isFinite(video.duration)) return; // manche Dateien liefern erst nach seek
      video.currentTime = Math.min(1, video.duration / 10);
    };

    video.onseeked = () => {
      clearTimeout(timer);
      let blob = null;
      try {
        const width = 480;
        const scale = video.videoWidth ? width / video.videoWidth : 1;
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = Math.max(1, Math.round((video.videoHeight || width) * scale));
        canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
        blob = canvas.toDataURL("image/jpeg", 0.82);
      } catch (_) { blob = null; }

      const dataUrl = blob;
      // dataURL -> Blob (synchron, ohne weiteren await)
      const thumbnailBlob = dataUrlToBlob(dataUrl);
      cleanup();
      resolve({ durationSeconds: video.duration || 0, thumbnailBlob, url });
    };

    video.onerror = () => {
      clearTimeout(timer); cleanup();
      reject(new Error("Das Video konnte nicht gelesen werden. Bitte ein anderes waehlen."));
    };
  });
}

function dataUrlToBlob(dataUrl) {
  if (!dataUrl) return null;
  try {
    const [head, body] = dataUrl.split(",");
    const mime = head.match(/:(.*?);/)?.[1] || "image/jpeg";
    const binary = atob(body);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  } catch (_) {
    return null;
  }
}
