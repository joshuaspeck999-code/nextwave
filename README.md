# NEXTWAVE — Web (Kurzvideo-Plattform)

Kurzvideo-Plattform im Stil von TikTok / Reels / YouTube Shorts — als
**Web-App** umgesetzt (statt der nativen Android-Variante in `../nextwave`).
Der vollständige MASTERPROMPT (22 Abschnitte) ist verbindlich: echte
Benutzerkonten, echte Datenbank, echte Uploads, echte Likes/Kommentare —
**keine Fake-Funktionen**.

Die App ist bereits **live mit dem Supabase-Projekt verknüpft** und läuft.

---

## 1. Technischer Aufbau

| Ebene | Technologie |
|------|-------------|
| Frontend | Vanilla-JS ES-Module, **kein Build-Schritt** (direkt im Browser lauffähig) |
| Krypto/DB-Client | `supabase-js@2.45.4` (von `esm.sh`) |
| Backend | Supabase (PostgreSQL 17, Auth, Storage, Realtime) |
| Datenzugriff | Repository-Pattern in `src/data.js` — Views kennen kein SQL |
| Video | natives `<video>` + `IntersectionObserver` für Auto-Play |
| Routing | Hash-Routing (`#/page?param=wert`) |

Der Wechsel von der nativen Android-Schicht (`../nextwave/app`) auf Web ist
bewusst so gewählt, dass **dieselbe Datenbank** (identisches Schema, dieselben
RLS-Regeln) verwendet wird.

### Projektstruktur

```
nextwave-web/
├── index.html            # Einstiegspunkt (lädt src/app.js)
├── assets/styles.css     # Design-System (dunkel, #7C5CFF / #22D3EE)
└── src/
    ├── app.js            # Session-Gate, Routing, Bottom-Nav, Kontext
    ├── config.js         # SUPABASE_URL + anon key (öffentlich, NICHT geheim)
    ├── supabaseClient.js # supabase-js Client (pkce, persistSession)
    ├── data.js           # Repository: JEDER DB-/Storage-Zugriff
    ├── utils.js          # Validierung, Formatierung, Fehlermeldungen, Toast
    ├── ui.js             # Icons, Avatar, Bottom-Nav, Empty/Error-States
    ├── auth.js           # Willkommen, Registrierung, Login, Passwort-Reset
    ├── feed.js           # Vertikaler Feed + Einzelvideo + Kommentare
    ├── upload.js         # Upload mit Fortschritt + Abbruch
    ├── profile.js        # Eigenes/fremdes Profil, Bearbeiten, Follower/Following
    └── misc.js           # Entdecken, Aktivitäten, Admin/Moderation
```

---

## 2. Lokal starten

Es ist **kein `npm install` und kein Build nötig** — die Module werden direkt
vom Browser geladen. Wegen der ES-Module muss es über HTTP (nicht `file://`)
ausgeliefert werden:

```bash
cd nextwave-web
python3 -m http.server 8080 --bind 127.0.0.1
# danach im Browser:  http://127.0.0.1:8080
```

Jeder andere statische Server (`npx serve`, `caddy`, nginx …) funktioniert
ebenfalls.

---

## 3. Supabase-Verbindung

| | Wert |
|---|---|
| Projekt-Ref | `ogniyieuprcgckxryosy` |
| Project-URL | `https://ogniyieuprcgckxryosy.supabase.co` |
| Region | (Supabase Cloud, PostgreSQL 17) |

Konfiguration liegt in [src/config.js](src/config.js):

```js
export const SUPABASE_URL = "https://ogniyieuprcgckxryosy.supabase.co";
export const SUPABASE_ANON_KEY = "eyJ…";   // öffentlicher anon key
```

> **Sicherheitshinweis:** Der **anon key ist nicht geheim** und darf im
> Browser sichtbar sein — der Schutz der Daten kommt ausschließlich aus den
> Row-Level-Security-Regeln. Der **`service_role`-Key gehört NIEMALS in den
> Client** (er umgeht RLS und darf nur serverseitig verwendet werden).

---

## 4. Datenbank-Setup

Alle Migrationen liegen in [`../nextwave/supabase/migrations`](../nextwave/supabase/migrations)
und sind im Live-Projekt **bereits angewendet**:

| Datei | Inhalt |
|-------|--------|
| `20260101000001_nextwave_core_schema.sql` | 14 Tabellen, Fremdschlüssel, Constraints, Indizes |
| `20260101000002_nextwave_functions_triggers.sql` | Trigger (Profil-Autocreate, Zähler, Notifications), Hilfsfunktionen |
| `20260101000003_nextwave_rls.sql` | Row Level Security — 43 Policies |
| `20260101000004_nextwave_storage.sql` | 4 Storage-Buckets (avatars, banners, videos, thumbnails) + Regeln |
| `20260101000005_nextwave_moderation_rpc.sql` | Moderations-RPCs (`nextwave_moderate_video`, `…_comment`, `nextwave_resolve_report`, `nextwave_set_user_blocked`) |

### Tabellen

`profiles`, `videos`, `likes`, `comments`, `comment_likes`, `follows`,
`saved_videos`, `notifications`, `views`, `hashtags`, `video_hashtags`,
`reports`, `moderation_actions`, `app_config`.

### Auf eine *neue* Supabase-Instanz anwenden

Variante A — Cloud (SQL Editor): Datei
[`../nextwave/supabase/SETUP_ALL_IN_ONE.sql`](../nextwave/supabase/SETUP_ALL_IN_ONE.sql)
in den SQL-Editor einfügen und ausführen.

Variante B — Management API (automatisiert):

```bash
PAT="<dein-personal-access-token>"
jq -Rs '{query: .}' migration.sql > payload.json
curl -X POST "https://api.supabase.com/v1/projects/<ref>/database/query" \
  -H "Authorization: Bearer $PAT" -H "Content-Type: application/json" \
  --data @payload.json
```

Variante C — lokal mit Supabase CLI: `supabase db reset` spielt alle
Migrationen in Reihenfolge neu ein.

---

## 5. Auth-Konfiguration (Live-Projekt)

| Einstellung | Wert | Zweck |
|---|---|---|
| `mailer_autoconfirm` | `true` | Registrierung liefert direkt eine Session (kein Mail-Zwang) |
| `disable_signup` | `false` | Registrierung erlaubt |
| `site_url` | `http://localhost:8080` | Basis für Auth-Redirects |
| `uri_allow_list` | `nextwave://auth-callback`, `http://localhost:3000`, `http://localhost:8080`, `http://127.0.0.1:8080`, `https://localhost:8080` | Erlaubte Redirect-Ziele (u. a. Passwort-Reset) |

Für **Produktivbetrieb** `mailer_autoconfirm` auf `false` setzen, damit die
E-Mail-Bestätigung greift (Abschnitt 3 des MASTERPROMPTS).

---

## 6. Sicherheitsmodell (RLS)

Die Datenbank erzwingt alle Regeln serverseitig — der Client kann sie nicht
umgehen:

- Jeder Benutzer kann **nur sein eigenes Profil** ändern (`auth.uid() = id`).
- Videos, Kommentare, Likes, Saves, Follows sind an `auth.uid()` gebunden.
- **Die Rolle (`user`/`moderator`/`admin`) kann sich niemand selbst setzen** —
  Änderungen an `role` werden von den Policies abgelehnt (Fehler `42501`).
- Moderation läuft ausschließlich über `SECURITY DEFINER`-RPCs, die die Rolle
  serverseitig prüfen (kein Service-Key im Client).
- Private Profile und deren Inhalte sind über `can_view_profile()` geschützt.
- Storage-Uploads prüfen MIME-Typ, Größe und Berechtigung.

---

## 7. Funktionsumfang

Umgesetzt und getestet gegen die Live-Datenbank:

- **Auth:** Registrierung (Benutzername, E-Mail, Passwort, Geburtsdatum,
  optionales Profilbild), Login, „angemeldet bleiben", Session-Wiederherstellung,
  Passwort vergessen/zurücksetzen, Logout, E-Mail-/Benutzernamen-Prüfung.
- **Profil:** eigenes/fremdes Profil, Bearbeiten (Anzeigename, Bio, Website,
  Profilbild, Banner, Privatsphäre), Zähler (Follower, Following, Videos, Likes).
- **Feed:** vertikaler Vollbild-Feed, Auto-Play nur des sichtbaren Videos,
  Doppeltipp-Like, Vorladen, signierte Video-URLs (privater Bucket).
- **Upload:** Datei-Prüfung (MP4/MOV, Limits), Vorschau, Beschreibung,
  Hashtags, Sichtbarkeit, echter Fortschritt (XHR), Abbruch.
- **Interaktion:** Likes (eindeutig), Kommentare + Antworten, Kommentar-Likes,
  Gespeicherte Videos, Folgen/Entfolgen.
- **Weiteres:** Suche (Nutzer/Videos/Hashtags), Aktivitäten/Benachrichtigungen
  (gelesen/ungelesen), Entdecken, Admin-/Moderationsbereich (Meldungen,
  Video-/Kommentar-Moderation, Sperren).

---

## 8. Konten & dauerhafte Speicherung

Alle Konten liegen dauerhaft in `auth.users` + `public.profiles` auf dem
Server — **nicht** nur lokal im Browser. Nach Neuinstallation oder auf einem
anderen Gerät genügt die Anmeldung mit E-Mail + Passwort; das vollständige
Profil und alle Inhalte werden wiederhergestellt. Der Browser speichert
lediglich die Sitzung (`localStorage`) zur Bequemlichkeit.
