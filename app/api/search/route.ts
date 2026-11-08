import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") ?? "";
  const docIds = (searchParams.get("docIds") ?? "").split(",").filter(Boolean);

  const { data, error } = await supabase.rpc("search_chunks", {
    q,
    doc_ids: docIds,
    k: 5,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}