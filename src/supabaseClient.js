// =====================================================================
// NEXTWAVE - Supabase-Client (eine einzige Instanz fuer die ganze App)
// =====================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    // "Angemeldet bleiben" + automatische Wiederherstellung der Sitzung.
    persistSession: true,
    autoRefreshToken: true,
    // Verarbeitet Wiederherstellungs-Links (Passwort-Reset) automatisch.
    detectSessionInUrl: true,
    flowType: "pkce",
  },
});
