// =====================================================================
// NEXTWAVE - Authentifizierung
//   * Registrierung (echter Supabase-Auth-Benutzer + Profilzeile)
//   * Login / Logout
//   * Session-Wiederherstellung (macht supabase-js automatisch)
//   * Passwort vergessen / zuruecksetzen
// =====================================================================
import { supabase } from "./supabaseClient.js";
import { MAX_AVATAR_BYTES, IMAGE_MIME_TYPES } from "./config.js";
import {
  escapeHtml, validators, describeError, toast, debounce,
} from "./utils.js";

/* ---------------------------------------------------------------------
   Kleine Helfer
--------------------------------------------------------------------- */
function setBusy(button, busy, labelWhenBusy = "Bitte warten ...") {
  if (!button) return;
  if (busy) {
    button.dataset.label = button.dataset.label || button.textContent;
    button.disabled = true;
    button.innerHTML = `<span class="spinner"></span> ${escapeHtml(labelWhenBusy)}`;
  } else {
    button.disabled = false;
    button.textContent = button.dataset.label || button.textContent;
  }
}

function showBanner(root, message, type = "error") {
  const host = root.querySelector("[data-banner]");
  if (!host) return;
  host.innerHTML = message ? `<div class="banner ${type}">${escapeHtml(message)}</div>` : "";
}

function fieldError(form, name, message) {
  const input = form.querySelector(`[name="${name}"]`);
  const slot = form.querySelector(`[data-error-for="${name}"]`);
  if (input) input.classList.toggle("invalid", Boolean(message));
  if (slot) slot.textContent = message || "";
}

function readForm(form) {
  const data = {};
  new FormData(form).forEach((v, k) => { data[k] = typeof v === "string" ? v.trim() : v; });
  return data;
}

/* =====================================================================
   Willkommen
===================================================================== */
export function renderWelcome(root, ctx) {
  root.innerHTML = `
    <div class="screen no-nav" style="display:flex;flex-direction:column;justify-content:center;">
      <div class="center" style="margin-bottom:32px;">
        <div class="wordmark">NEXTWAVE</div>
        <p class="muted" style="margin-top:14px;">
          Kurzvideos. Echte Konten. Echte Daten.
        </p>
      </div>

      <div class="card stack">
        <h2>Willkommen</h2>
        <p class="muted small">Erstelle ein Konto oder melde dich an, um zu starten.</p>
        <button class="btn btn-primary" data-action="signup">Konto erstellen</button>
        <button class="btn btn-ghost" data-action="login">Ich habe bereits ein Konto</button>
      </div>

      <p class="muted small center" style="margin-top:24px;">
        Deine Daten werden sicher auf dem Server gespeichert.
      </p>
    </div>`;

  root.querySelector('[data-action="signup"]').onclick = () => ctx.navigate("signup");
  root.querySelector('[data-action="login"]').onclick = () => ctx.navigate("login");
}

/* =====================================================================
   Registrierung
===================================================================== */
export function renderSignUp(root, ctx) {
  root.innerHTML = `
    <div class="screen no-nav">
      <div class="topbar">
        <button class="icon-btn" data-back aria-label="Zurueck">&larr;</button>
        <h2 class="grow" style="margin:0;">Konto erstellen</h2>
      </div>

      <div data-banner></div>

      <form class="stack" novalidate>
        <div class="field">
          <label class="label" for="su-username">Benutzername</label>
          <input class="input" id="su-username" name="username" autocomplete="username"
                 placeholder="z. B. max.mustermann" />
          <div class="field-hint" data-hint-for="username">Kleinbuchstaben, Zahlen, Punkt, Unterstrich.</div>
          <div class="field-error" data-error-for="username"></div>
        </div>

        <div class="field">
          <label class="label" for="su-display">Anzeigename</label>
          <input class="input" id="su-display" name="display_name" placeholder="Max Mustermann" />
          <div class="field-error" data-error-for="display_name"></div>
        </div>

        <div class="field">
          <label class="label" for="su-email">E-Mail-Adresse</label>
          <input class="input" id="su-email" name="email" type="email" autocomplete="email"
                 placeholder="name@beispiel.de" />
          <div class="field-error" data-error-for="email"></div>
        </div>

        <div class="field">
          <label class="label" for="su-password">Passwort</label>
          <div class="input-wrap">
            <input class="input" id="su-password" name="password" type="password"
                   autocomplete="new-password" placeholder="Mindestens 8 Zeichen" />
            <button type="button" class="toggle-pw" data-toggle="su-password">anzeigen</button>
          </div>
          <div class="field-error" data-error-for="password"></div>
        </div>

        <div class="field">
          <label class="label" for="su-repeat">Passwort wiederholen</label>
          <input class="input" id="su-repeat" name="password_repeat" type="password"
                 autocomplete="new-password" />
          <div class="field-error" data-error-for="password_repeat"></div>
        </div>

        <div class="field">
          <label class="label" for="su-birth">Geburtsdatum (optional)</label>
          <input class="input" id="su-birth" name="birthdate" type="date" />
          <div class="field-error" data-error-for="birthdate"></div>
        </div>

        <div class="field">
          <label class="label" for="su-avatar">Profilbild (optional)</label>
          <div class="row">
            <div class="avatar md" data-avatar-preview>?</div>
            <div class="grow">
              <input class="input" id="su-avatar" name="avatar" type="file"
                     accept="image/jpeg,image/png,image/webp" />
            </div>
          </div>
          <div class="field-error" data-error-for="avatar"></div>
        </div>

        <button class="btn btn-primary" type="submit" data-submit>Konto erstellen</button>
      </form>

      <p class="center small muted" style="margin-top:18px;">
        Du hast schon ein Konto?
        <button class="btn-text" data-go-login>Anmelden</button>
      </p>
    </div>`;

  const form = root.querySelector("form");
  const submitBtn = root.querySelector("[data-submit]");
  const avatarInput = form.querySelector('[name="avatar"]');
  const preview = root.querySelector("[data-avatar-preview]");

  root.querySelector("[data-back]").onclick = () => ctx.navigate("welcome");
  root.querySelector("[data-go-login]").onclick = () => ctx.navigate("login");
  root.querySelectorAll("[data-toggle]").forEach((b) => {
    b.onclick = () => {
      const input = root.querySelector("#" + b.dataset.toggle);
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      b.textContent = show ? "verbergen" : "anzeigen";
    };
  });

  avatarInput.onchange = () => {
    const file = avatarInput.files?.[0];
    if (!file) { preview.textContent = "?"; preview.style.backgroundImage = ""; return; }
    const err = validateAvatar(file);
    fieldError(form, "avatar", err);
    if (err) { avatarInput.value = ""; return; }
    preview.textContent = "";
    preview.style.backgroundImage = `url(${URL.createObjectURL(file)})`;
  };

  // Live: Benutzername bereits vergeben? (Serverabfrage, entprellt)
  const usernameInput = form.querySelector('[name="username"]');
  const usernameHint = root.querySelector('[data-hint-for="username"]');
  const checkUsername = debounce(async (value) => {
    if (validators.username(value)) return;
    usernameHint.className = "field-hint";
    usernameHint.textContent = "Pruefe Verfuegbarkeit ...";
    const { data, error } = await supabase.rpc("is_username_available", { candidate: value });
    if (error) { usernameHint.textContent = "Kleinbuchstaben, Zahlen, Punkt, Unterstrich."; return; }
    if (data === true) {
      usernameHint.className = "ok-hint";
      usernameHint.textContent = "Benutzername ist verfuegbar.";
    } else {
      usernameHint.className = "field-error";
      usernameHint.textContent = "Dieser Benutzername ist bereits vergeben.";
    }
  }, 450);
  usernameInput.addEventListener("input", (e) => checkUsername(e.target.value));

  form.onsubmit = async (event) => {
    event.preventDefault();
    showBanner(root, "");

    const data = readForm(form);
    const avatarFile = avatarInput.files?.[0] || null;

    // 1. Validieren
    const usernameErr = validators.username(data.username);
    const displayErr = data.display_name ? null : "Bitte einen Anzeigenamen eingeben.";
    const emailErr = validators.email(data.email);
    const pwErr = validators.password(data.password);
    const repeatErr = validators.passwordRepeat(data.password_repeat, data.password);
    const birthErr = validators.birthdate(data.birthdate);
    const avatarErr = avatarFile ? validateAvatar(avatarFile) : null;

    fieldError(form, "username", usernameErr);
    fieldError(form, "display_name", displayErr);
    fieldError(form, "email", emailErr);
    fieldError(form, "password", pwErr);
    fieldError(form, "password_repeat", repeatErr);
    fieldError(form, "birthdate", birthErr);
    fieldError(form, "avatar", avatarErr);
    if (usernameErr || displayErr || emailErr || pwErr || repeatErr || birthErr || avatarErr) {
      showBanner(root, "Bitte pruefe die markierten Felder.");
      return;
    }

    setBusy(submitBtn, true, "Konto wird erstellt ...");
    try {
      // 2. Verfuegbarkeit final serverseitig pruefen
      const { data: available, error: rpcError } =
        await supabase.rpc("is_username_available", { candidate: data.username });
      if (rpcError) throw rpcError;
      if (available !== true) {
        fieldError(form, "username", "Dieser Benutzername ist bereits vergeben.");
        showBanner(root, "Der Benutzername ist leider schon vergeben.");
        return;
      }

      // 3. Echtes Konto anlegen. Der Datenbank-Trigger legt die Profilzeile an.
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email: data.email,
        password: data.password,
        options: {
          data: {
            username: data.username,
            display_name: data.display_name,
            birthdate: data.birthdate || null,
          },
        },
      });
      if (signUpError) throw signUpError;

      // 4. Optionales Profilbild hochladen (Fehler bricht die Registrierung NICHT ab)
      const user = signUpData.user;
      if (user && avatarFile) {
        try {
          const path = `${user.id}/avatar_${Date.now()}.${extOf(avatarFile)}`;
          const { error: upErr } = await supabase.storage
            .from("avatars")
            .upload(path, avatarFile, { contentType: avatarFile.type, upsert: true });
          if (upErr) throw upErr;
          await supabase.from("profiles").update({ avatar_path: path }).eq("id", user.id);
        } catch (uploadError) {
          toast("Profil angelegt. Profilbild konnte nicht geladen werden: " + describeError(uploadError), "error");
        }
      }

      // 5. Kein Session-Objekt => E-Mail-Bestaetigung ist aktiv.
      if (!signUpData.session) {
        showBanner(
          root,
          "Konto erstellt. Bitte bestaetige jetzt deine E-Mail-Adresse, danach kannst du dich anmelden.",
          "success"
        );
        setBusy(submitBtn, false);
        return;
      }

      // Mit Session: app.js wechselt automatisch in die App.
      toast("Konto erstellt. Willkommen bei NEXTWAVE!", "success");
    } catch (error) {
      showBanner(root, describeError(error));
      setBusy(submitBtn, false);
    }
  };
}

function extOf(file) {
  const fromName = (file.name.split(".").pop() || "").toLowerCase();
  if (["jpg", "jpeg", "png", "webp"].includes(fromName)) return fromName;
  if (file.type === "image/png") return "png";
  if (file.type === "image/webp") return "webp";
  return "jpg";
}

function validateAvatar(file) {
  if (!IMAGE_MIME_TYPES.includes(file.type)) return "Nur JPG, PNG oder WebP erlaubt.";
  if (file.size > MAX_AVATAR_BYTES) return "Das Bild darf hoechstens 5 MB gross sein.";
  return null;
}

/* =====================================================================
   Login
===================================================================== */
export function renderLogin(root, ctx) {
  root.innerHTML = `
    <div class="screen no-nav">
      <div class="topbar">
        <button class="icon-btn" data-back aria-label="Zurueck">&larr;</button>
        <h2 class="grow" style="margin:0;">Anmelden</h2>
      </div>

      <div data-banner></div>

      <form class="stack" novalidate>
        <div class="field">
          <label class="label" for="li-email">E-Mail-Adresse</label>
          <input class="input" id="li-email" name="email" type="email"
                 autocomplete="email" placeholder="name@beispiel.de" />
          <div class="field-error" data-error-for="email"></div>
        </div>

        <div class="field">
          <label class="label" for="li-password">Passwort</label>
          <div class="input-wrap">
            <input class="input" id="li-password" name="password" type="password"
                   autocomplete="current-password" />
            <button type="button" class="toggle-pw" data-toggle="li-password">anzeigen</button>
          </div>
          <div class="field-error" data-error-for="password"></div>
        </div>

        <button class="btn btn-primary" type="submit" data-submit>Anmelden</button>
      </form>

      <div class="center" style="margin-top:14px;">
        <button class="btn-text" data-go-forgot>Passwort vergessen?</button>
      </div>

      <p class="center small muted" style="margin-top:8px;">
        Noch kein Konto?
        <button class="btn-text" data-go-signup>Konto erstellen</button>
      </p>
    </div>`;

  const form = root.querySelector("form");
  const submitBtn = root.querySelector("[data-submit]");

  root.querySelector("[data-back]").onclick = () => ctx.navigate("welcome");
  root.querySelector("[data-go-forgot]").onclick = () => ctx.navigate("forgot");
  root.querySelector("[data-go-signup]").onclick = () => ctx.navigate("signup");
  root.querySelectorAll("[data-toggle]").forEach((b) => {
    b.onclick = () => {
      const input = root.querySelector("#" + b.dataset.toggle);
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      b.textContent = show ? "verbergen" : "anzeigen";
    };
  });

  form.onsubmit = async (event) => {
    event.preventDefault();
    showBanner(root, "");
    const data = readForm(form);

    const emailErr = validators.email(data.email);
    const pwErr = data.password ? null : "Bitte das Passwort eingeben.";
    fieldError(form, "email", emailErr);
    fieldError(form, "password", pwErr);
    if (emailErr || pwErr) return;

    setBusy(submitBtn, true, "Anmeldung laeuft ...");
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: data.email,
        password: data.password,
      });
      if (error) throw error;
      // Erfolg: app.js reagiert auf den Auth-Status und zeigt die App.
    } catch (error) {
      showBanner(root, describeError(error));
      setBusy(submitBtn, false);
    }
  };
}

/* =====================================================================
   Passwort vergessen
===================================================================== */
export function renderForgotPassword(root, ctx) {
  root.innerHTML = `
    <div class="screen no-nav">
      <div class="topbar">
        <button class="icon-btn" data-back aria-label="Zurueck">&larr;</button>
        <h2 class="grow" style="margin:0;">Passwort vergessen</h2>
      </div>

      <div data-banner></div>

      <p class="muted small">Wir senden dir einen Link, mit dem du dein Passwort neu setzen kannst.</p>

      <form class="stack" novalidate>
        <div class="field">
          <label class="label" for="fp-email">E-Mail-Adresse</label>
          <input class="input" id="fp-email" name="email" type="email"
                 autocomplete="email" placeholder="name@beispiel.de" />
          <div class="field-error" data-error-for="email"></div>
        </div>
        <button class="btn btn-primary" type="submit" data-submit>Link senden</button>
      </form>

      <div class="center" style="margin-top:14px;">
        <button class="btn-text" data-go-login>Zurueck zur Anmeldung</button>
      </div>
    </div>`;

  const form = root.querySelector("form");
  const submitBtn = root.querySelector("[data-submit]");

  root.querySelector("[data-back]").onclick = () => ctx.navigate("login");
  root.querySelector("[data-go-login]").onclick = () => ctx.navigate("login");

  form.onsubmit = async (event) => {
    event.preventDefault();
    showBanner(root, "");
    const data = readForm(form);
    const emailErr = validators.email(data.email);
    fieldError(form, "email", emailErr);
    if (emailErr) return;

    setBusy(submitBtn, true, "Wird gesendet ...");
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(data.email, {
        redirectTo: location.origin + location.pathname,
      });
      if (error) throw error;
      showBanner(
        root,
        "Falls ein Konto existiert, ist die E-Mail unterwegs. Bitte pruefe deinen Posteingang.",
        "success"
      );
    } catch (error) {
      showBanner(root, describeError(error));
    } finally {
      setBusy(submitBtn, false);
    }
  };
}

/* =====================================================================
   Neues Passwort setzen (nach Klick auf den Wiederherstellungs-Link)
===================================================================== */
export function renderResetPassword(root, ctx) {
  root.innerHTML = `
    <div class="screen no-nav">
      <div class="topbar">
        <h2 class="grow" style="margin:0;">Neues Passwort</h2>
      </div>

      <div data-banner></div>

      <form class="stack" novalidate>
        <div class="field">
          <label class="label" for="rp-password">Neues Passwort</label>
          <div class="input-wrap">
            <input class="input" id="rp-password" name="password" type="password"
                   autocomplete="new-password" />
            <button type="button" class="toggle-pw" data-toggle="rp-password">anzeigen</button>
          </div>
          <div class="field-error" data-error-for="password"></div>
        </div>
        <div class="field">
          <label class="label" for="rp-repeat">Passwort wiederholen</label>
          <input class="input" id="rp-repeat" name="password_repeat" type="password"
                 autocomplete="new-password" />
          <div class="field-error" data-error-for="password_repeat"></div>
        </div>
        <button class="btn btn-primary" type="submit" data-submit>Passwort speichern</button>
      </form>

      <div class="center" style="margin-top:14px;">
        <button class="btn-text" data-go-login>Zur Anmeldung</button>
      </div>
    </div>`;

  const form = root.querySelector("form");
  const submitBtn = root.querySelector("[data-submit]");

  root.querySelector("[data-go-login]").onclick = () => ctx.navigate("login");
  root.querySelectorAll("[data-toggle]").forEach((b) => {
    b.onclick = () => {
      const input = root.querySelector("#" + b.dataset.toggle);
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      b.textContent = show ? "verbergen" : "anzeigen";
    };
  });

  form.onsubmit = async (event) => {
    event.preventDefault();
    showBanner(root, "");
    const data = readForm(form);
    const pwErr = validators.password(data.password);
    const repeatErr = validators.passwordRepeat(data.password_repeat, data.password);
    fieldError(form, "password", pwErr);
    fieldError(form, "password_repeat", repeatErr);
    if (pwErr || repeatErr) return;

    setBusy(submitBtn, true, "Wird gespeichert ...");
    try {
      const { error } = await supabase.auth.updateUser({ password: data.password });
      if (error) throw error;
      toast("Passwort geaendert.", "success");
      ctx.navigate("home");
    } catch (error) {
      showBanner(root, describeError(error));
    } finally {
      setBusy(submitBtn, false);
    }
  };
}
