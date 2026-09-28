import { createClient } from "@supabase/supabase-js";

// Server-only client using the secret key, which bypasses Row Level Security
// entirely. This file must never be imported into a client component, or the
// secret key would end up shipped to the browser.
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
);
