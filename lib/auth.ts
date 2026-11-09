import { supabase } from "@/lib/supabase";

// Returns the logged-in user from the Authorization header, or null
export async function getUser(req: Request) {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return null;
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}

// True if this document belongs to this user
export async function ownsDoc(userId: string, docId: string) {
  const { data } = await supabase
    .from("documents")
    .select("id")
    .eq("id", docId)
    .eq("user_id", userId)
    .maybeSingle();
  return !!data;
}

export function unauthorized() {
  return Response.json({ error: "Please log in." }, { status: 401 });
}