import { supabaseBrowser } from "@/lib/supabaseBrowser";

// fetch() that sends the logged-in user's token to our API routes
export async function authFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const { data } = await supabaseBrowser.auth.getSession();
  const headers = new Headers(init.headers);
  if (data.session) headers.set("Authorization", `Bearer ${data.session.access_token}`);
  return fetch(input, { ...init, headers });
}