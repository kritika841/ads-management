import { createClient } from "@supabase/supabase-js";
import { requiredEnv } from "@/lib/utils";
import { resilientFetch } from "@/lib/supabase/resilient-fetch";

export function createSupabaseAdminClient() {
  return createClient(
    requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    {
      global: { fetch: resilientFetch },
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    }
  );
}
