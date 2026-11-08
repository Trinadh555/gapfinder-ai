import { NextResponse } from "next/server";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { askJSON } from "@/lib/llm";

export const maxDuration = 60;

const TopicSchema = z.object({
  topics: z
    .array(z.object({ name: z.string(), subtopics: z.array(z.string()).default([]) }))
    .min(1),
});

const PaperSchema = z.object({
  questions: z.array(z.object({ text: z.string(), topic: z.string() })),
});

// Rebuild document text from chunks (removes the 200-char overlap used in chunk.ts)
async function docText(docId: string, maxChars: number) {
  const { data, error } = await supabase
    .from("chunks")
    .select("content,page")
    .eq("document_id", docId)
    .order("seq")
    .limit(80);
  if (error) throw new Error(error.message);
  let out = "";
  let prevPage = -1;
  for (const c of data ?? []) {
    out += c.page === prevPage ? c.content.slice(200) : "\n" + c.content;
    prevPage = c.page;
  }
  return out.slice(0, maxChars);
}

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("syllabusDocId");
  if (!id) return NextResponse.json({ error: "syllabusDocId required" }, { status: 400 });
  const { data, error } = await supabase
    .from("topics")
    .select("*")
    .eq("syllabus_doc_id", id)
    .order("position");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ topics: data });
}

export async function POST(req: Request) {
  const { syllabusDocId, pastPaperDocId } = await req.json();
  if (!syllabusDocId) {
    return NextResponse.json({ error: "syllabusDocId required" }, { status: 400 });
  }

  try {
    // 1. Topic map from syllabus (generation over retrieved syllabus text)
    const syllabus = await docText(syllabusDocId, 14000);
    const parsed = await askJSON({
      system:
        "You extract a topic map from an exam syllabus. Use only what is in the text. Never invent topics.",
      user: `SYLLABUS TEXT:\n${syllabus}\n\nThe syllabus has numbered chapters (like "1. Functions", "3. Matrices"), and each chapter has numbered subtopics (like "1.1 Types of functions"). Big headings such as "ALGEBRA", "VECTOR ALGEBRA", "TRIGONOMETRY" are only groups, NOT topics.\n\nReturn JSON: {"topics":[{"name":"<chapter name without its number>","subtopics":["<subtopic text without its number>", ...]}]}\nRules:\n- One entry per numbered chapter, in syllabus order, including every chapter you can find.\n- subtopics are the numbered lines under that chapter. If a chapter has none, use an empty list.\n- Ignore period counts and page numbers.\n- Fix obvious spelling typos in names.`,
      schema: TopicSchema,
    });

    await supabase.from("topics").delete().eq("syllabus_doc_id", syllabusDocId);
    const { data: topics, error } = await supabase
      .from("topics")
      .insert(
        parsed.topics.map((t, i) => ({
          syllabus_doc_id: syllabusDocId,
          name: t.name,
          subtopics: t.subtopics,
          position: i,
        }))
      )
      .select();
    if (error || !topics) throw new Error(error?.message ?? "insert failed");

    // 2. Map past-paper questions to topics, count exam frequency
    if (pastPaperDocId) {
      const paper = await docText(pastPaperDocId, 14000);
      const names = topics.map((t) => t.name);
      const mapped = await askJSON({
        system:
          "You map exam questions to syllabus topics. Choose only from the given topic list.",
        user: `TOPICS:\n${names.map((n, i) => `${i + 1}. ${n}`).join("\n")}\n\nQUESTION PAPER TEXT (formulas may be garbled; some text may repeat):\n${paper}\n\nList every distinct question in the paper. Return JSON: {"questions":[{"text":"<question, max 160 chars>","topic":"<copy exactly one name from TOPICS>"}]}`,
        schema: PaperSchema,
      });

      const byName = new Map(topics.map((t) => [t.name.toLowerCase().trim(), t.id]));
      const buckets = new Map<string, string[]>();
      for (const q of mapped.questions) {
        const id = byName.get(q.topic.toLowerCase().trim());
        if (!id) continue;
        buckets.set(id, [...(buckets.get(id) ?? []), q.text]);
      }
      for (const [id, qs] of buckets) {
        await supabase
          .from("topics")
          .update({ exam_count: qs.length, exam_questions: qs })
          .eq("id", id);
      }
    }

    const { data: final } = await supabase
      .from("topics")
      .select("*")
      .eq("syllabus_doc_id", syllabusDocId)
      .order("position");
    return NextResponse.json({ topics: final });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}