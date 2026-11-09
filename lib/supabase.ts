import { createClient } from "@supabase/supabase-js";

// Server-only client (secret key). Never import this in client components.
export const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } }
);