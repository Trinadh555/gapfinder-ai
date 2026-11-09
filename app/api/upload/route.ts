import { NextResponse } from "next/server";
import { extractText, getDocumentProxy } from "unpdf";
import { supabase } from "@/lib/supabase";
import { chunkPages } from "@/lib/chunk";
import { getUser, unauthorized } from "@/lib/auth";

export const maxDuration = 60;

export async function POST(req: Request) {
  const user = await getUser(req);
  if (!user) return unauthorized();

  let fileName = "";
  let kind = "";
  let pages: string[] = [];

  const contentType = req.headers.get("content-type") || "";

  // 1. Client-side extracted text (JSON) - Bypasses Vercel 4.5MB limit completely!
  if (contentType.includes("application/json")) {
    try {
      const body = await req.json();
      fileName = body.name;
      kind = body.kind;
      pages = body.pages || [];
    } catch {
      return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
    }
  } else {
    // 2. Standard FormData fallback
    const form = await req.formData();
    const file = form.get("file") as File | null;
    kind = form.get("kind") as string;

    if (!file) {
      return NextResponse.json({ error: "file required" }, { status: 400 });
    }
    fileName = file.name;

    if (file.name.toLowerCase().endsWith(".pdf")) {
      const pdf = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()));
      const { text } = await extractText(pdf, { mergePages: false });
      pages = text;
    } else {
      pages = [await file.text()];
    }
  }

  if (!fileName || !["syllabus", "notes", "past_paper"].includes(kind)) {
    return NextResponse.json({ error: "Valid file and kind required" }, { status: 400 });
  }

  const chunks = chunkPages(pages);
  if (chunks.length === 0) {
    return NextResponse.json(
      { error: "No readable text found in document. Please upload a PDF with selectable text." },
      { status: 422 }
    );
  }

  const { data: doc, error } = await supabase
    .from("documents")
    .insert({ name: fileName, kind, user_id: user.id })
    .select()
    .single();

  if (error) {
    console.error("[POST /api/upload] Document insert error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = chunks.map((c, i) => ({ document_id: doc.id, seq: i, ...c }));
  const { error: cErr } = await supabase.from("chunks").insert(rows);
  if (cErr) {
    console.error("[POST /api/upload] Chunks insert error:", cErr);
    return NextResponse.json({ error: cErr.message }, { status: 500 });
  }

  return NextResponse.json({ documentId: doc.id, chunks: rows.length });
}