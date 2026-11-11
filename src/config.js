// =====================================================================
// NEXTWAVE - Oeffentliche Konfiguration des Web-Clients
// =====================================================================
// WICHTIG zur Sicherheit:
//   Der "anon"-Key ist fuer Web-Clients gedacht und ist NICHT geheim.
//   Er darf im Browser sichtbar sein - der Schutz der Daten kommt
//   ausschliesslich aus den Row-Level-Security-Regeln in der Datenbank.
//
//   Hier NIEMALS den "service_role"-Key eintragen! Der umgeht RLS und
//   gehoert nur auf einen Server.
// =====================================================================

export const SUPABASE_URL = "https://ogniyieuprcgckxryosy.supabase.co";

export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
  "eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9nbml5aWV1cHJjZ2NreHJ5b3N5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ0MTY3NjgsImV4cCI6MjEwOTk5Mjc2OH0." +
  "H73JAwsk0-Lms1FQUQRckFze5eZBV5SyTF497w-xwjc";

// Buckets (siehe Migration 0004)
export const AVATAR_BUCKET = "avatars";
export const BANNER_BUCKET = "banners";

// Grenzen (Passend zu den Storage-Regeln)
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;   // 5 MB
export const MAX_BANNER_BYTES = 10 * 1024 * 1024;  // 10 MB
export const IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];

// Ist die Konfiguration gesetzt? (App zeigt sonst einen klaren Hinweis)
export const IS_CONFIGURED =
  SUPABASE_URL.startsWith("https://") && SUPABASE_ANON_KEY.startsWith("eyJ");
