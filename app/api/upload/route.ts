import { NextResponse } from "next/server";
import { extractText, getDocumentProxy } from "unpdf";
import { supabase } from "@/lib/supabase";
import { chunkPages } from "@/lib/chunk";
import { getUser, unauthorized } from "@/lib/auth";

export async function POST(req: Request) {
  const user = await getUser(req);
  if (!user) return unauthorized();

  const form = await req.formData();
  const file = form.get("file") as File | null;
  const kind = form.get("kind") as string;

  if (!file || !["syllabus", "notes", "past_paper"].includes(kind)) {
    return NextResponse.json({ error: "file and valid kind required" }, { status: 400 });
  }

  let pages: string[];
  if (file.name.toLowerCase().endsWith(".pdf")) {
    const pdf = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()));
    const { text } = await extractText(pdf, { mergePages: false });
    pages = text;
  } else {
    pages = [await file.text()];
  }

  const chunks = chunkPages(pages);
  if (chunks.length === 0) {
    return NextResponse.json(
      { error: "No text found. Scanned PDFs are not supported." },
      { status: 422 }
    );
  }

  const { data: doc, error } = await supabase
    .from("documents")
    .insert({ name: file.name, kind, user_id: user.id })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = chunks.map((c, i) => ({ document_id: doc.id, seq: i, ...c }));
  const { error: cErr } = await supabase.from("chunks").insert(rows);
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });

  return NextResponse.json({ documentId: doc.id, chunks: rows.length });
}