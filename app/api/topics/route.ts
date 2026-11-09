import { NextResponse } from "next/server";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { askJSON } from "@/lib/llm";
import { getUser, ownsDoc, unauthorized } from "@/lib/auth";

export const maxDuration = 60;

const TopicSchema = z.object({
  topics: z
    .array(
      z.object({
        name: z.string().min(1),
        subtopics: z.array(z.string()).default([]),
      })
    )
    .min(1, "At least one topic must be extracted"),
});

const PaperSchema = z.object({
  questions: z.array(
    z.object({
      text: z.string(),
      topic: z.string(),
    })
  ),
});

// Rebuild document text safely from chunks (limit to 40 chunks max for speed)
async function docText(docId: string, maxChars: number) {
  const { data, error } = await supabase
    .from("chunks")
    .select("content,page")
    .eq("document_id", docId)
    .order("seq")
    .limit(40);
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
  const user = await getUser(req);
  if (!user) return unauthorized();

  const id = new URL(req.url).searchParams.get("syllabusDocId");
  if (!id) return NextResponse.json({ error: "syllabusDocId required" }, { status: 400 });
  if (!(await ownsDoc(user.id, id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data, error } = await supabase
    .from("topics")
    .select("*")
    .eq("syllabus_doc_id", id)
    .order("position");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ topics: data ?? [] });
}

export async function POST(req: Request) {
  const user = await getUser(req);
  if (!user) return unauthorized();

  const { syllabusDocId, pastPaperDocId } = await req.json();
  if (!syllabusDocId) {
    return NextResponse.json({ error: "syllabusDocId required" }, { status: 400 });
  }
  if (!(await ownsDoc(user.id, syllabusDocId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    // 1. Fetch syllabus text (6000 chars is plenty for Table of Contents / Index)
    const syllabus = await docText(syllabusDocId, 6000);
    if (!syllabus || syllabus.trim().length === 0) {
      return NextResponse.json(
        { error: "Syllabus document text is empty. Please upload a readable syllabus or notes." },
        { status: 400 }
      );
    }

    // 2. Generate topics via LLM
    const parsed = await askJSON({
      system:
        "You are an academic syllabus parser. Extract 3 to 8 main chapters/topics with their subtopics from the text.\n" +
        "CRITICAL RULES:\n" +
        "- Do NOT strip descriptive titles. Keep distinct titles like 'Unit 1: Kinematics' or 'Chapter 2: Forces'.\n" +
        "- If headings are 'Unit 1', 'Unit 2', append the subject name: e.g. 'Unit 1: Introduction'. Never return just 'Unit'.\n" +
        "- Each topic must have a unique name.",
      user: `SYLLABUS / NOTES TEXT:\n${syllabus}\n\nReturn JSON: {"topics":[{"name":"<distinct chapter title>","subtopics":["<subtopic 1>","<subtopic 2>"]}]}`,
      schema: TopicSchema,
      maxTokens: 1500,
    });

    // Deduplicate topics by name
    const seen = new Set<string>();
    const uniqueTopics = parsed.topics.filter((t) => {
      const lower = t.name.toLowerCase().trim();
      if (seen.has(lower)) return false;
      seen.add(lower);
      return true;
    });

    if (uniqueTopics.length === 0) {
      throw new Error("No unique topics could be extracted from the material.");
    }

    // Delete existing topics for this syllabus
    await supabase.from("topics").delete().eq("syllabus_doc_id", syllabusDocId);

    // Insert new topics
    const { data: insertedTopics, error: insertErr } = await supabase
      .from("topics")
      .insert(
        uniqueTopics.map((t, i) => ({
          syllabus_doc_id: syllabusDocId,
          name: t.name,
          subtopics: t.subtopics,
          position: i,
          exam_count: 0,
        }))
      )
      .select();

    if (insertErr || !insertedTopics) {
      throw new Error(insertErr?.message ?? "Failed to save topics to database.");
    }

    // 3. Map past-paper questions if available (handled safely so topics never fail)
    if (pastPaperDocId && (await ownsDoc(user.id, pastPaperDocId))) {
      try {
        const paper = await docText(pastPaperDocId, 6000);
        if (paper && paper.trim().length > 50) {
          const names = insertedTopics.map((t) => t.name);
          const mapped = await askJSON({
            system:
              "You map exam questions to syllabus topics. Choose only from the given topic list.",
            user: `TOPICS:\n${names.map((n, i) => `${i + 1}. ${n}`).join("\n")}\n\nQUESTION PAPER TEXT:\n${paper}\n\nList questions found. Return JSON: {"questions":[{"text":"<question, max 160 chars>","topic":"<exact name from TOPICS>"}]}`,
            schema: PaperSchema,
            maxTokens: 1500,
          });

          const byName = new Map(insertedTopics.map((t) => [t.name.toLowerCase().trim(), t.id]));
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
      } catch (paperErr) {
        console.warn("[POST /api/topics] Past paper mapping non-fatal error:", paperErr);
      }
    }

    const { data: final } = await supabase
      .from("topics")
      .select("*")
      .eq("syllabus_doc_id", syllabusDocId)
      .order("position");

    return NextResponse.json({ topics: final ?? insertedTopics });
  } catch (e) {
    console.error("[POST /api/topics] Unhandled exception:", e);
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}