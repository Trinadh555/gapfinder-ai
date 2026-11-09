import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getUser, ownsDoc, unauthorized } from "@/lib/auth";

export async function GET(req: Request) {
  const user = await getUser(req);
  if (!user) return unauthorized();

  const { data, error } = await supabase.rpc("list_documents", { p_user: user.id });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// DELETE a document and all its chunks/topics automatically
export async function DELETE(req: Request) {
  const user = await getUser(req);
  if (!user) return unauthorized();

  const { searchParams } = new URL(req.url);
  const docId = searchParams.get("id");

  if (!docId) {
    return NextResponse.json({ error: "Document ID required" }, { status: 400 });
  }

  if (!(await ownsDoc(user.id, docId))) {
    return NextResponse.json({ error: "Document not found or unauthorized" }, { status: 404 });
  }

  const { error } = await supabase
    .from("documents")
    .delete()
    .eq("id", docId)
    .eq("user_id", user.id);

  if (error) {
    console.error("[DELETE /api/documents] Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, deletedId: docId });
}