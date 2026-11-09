import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getUser, unauthorized } from "@/lib/auth";

export async function GET(req: Request) {
  const user = await getUser(req);
  if (!user) return unauthorized();

  const { data, error } = await supabase.rpc("list_documents", { p_user: user.id });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}