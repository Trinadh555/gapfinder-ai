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

async function docText(docId: string, maxChars: number) {
  const { data, error } = await supabase
    .from("chunks")
    .select("content,page")
    .eq("document_id", docId)
    .order("seq")
    .limit(80);

  if (error) {
    console.error(`[docText] Error fetching chunks for docId ${docId}:`, error);
    throw new Error(`Failed to read document chunks: ${error.message}`);
  }

  if (!data || data.length === 0) return "";

  let out = "";
  let prevPage = -1;
  for (const c of data) {
    if (!c.content) continue;
    const content =
      c.page === prevPage && c.content.length > 200
        ? c.content.slice(200)
        : "\n" + c.content;
    out += content;
    prevPage = c.page;
  }
  return out.trim().slice(0, maxChars);
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

  if (error) {
    console.error("[GET /api/topics] Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ topics: data });
}

export async function POST(req: Request) {
  const user = await getUser(req);
  if (!user) return unauthorized();

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { syllabusDocId, pastPaperDocId } = body;
  if (!syllabusDocId) {
    return NextResponse.json({ error: "syllabusDocId required" }, { status: 400 });
  }

  if (
    !(await ownsDoc(user.id, syllabusDocId)) ||
    (pastPaperDocId && !(await ownsDoc(user.id, pastPaperDocId)))
  ) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const syllabus = await docText(syllabusDocId, 14000);
    if (!syllabus || syllabus.trim().length === 0) {
      return NextResponse.json(
        { error: "Syllabus document text is empty. Please re-upload the document." },
        { status: 400 }
      );
    }

    const parsed = await askJSON({
      system:
        "You extract a topic map from an exam syllabus. Use only what is in the text. Never invent topics.",
      user: `SYLLABUS TEXT:\n${syllabus}\n\nThe syllabus contains numbered chapters or units (e.g. "Unit 1: Functions", "Unit 2: Matrices" or "1. Functions").\n\nReturn JSON: {"topics":[{"name":"<full unit or chapter title, e.g. Unit 1: Functions>","subtopics":["<subtopic text>", ...]}]}\nRules:\n- Each topic name MUST be descriptive and unique. Do NOT output just the word "Unit". Always include the chapter/topic title.\n- One entry per chapter/unit, in syllabus order.\n- subtopics are the sub-items under that chapter. If none, use an empty list.\n- Ignore page numbers and period counts.\n- Fix obvious spelling typos.`,
      schema: TopicSchema,
    });

    const seenNames = new Set<string>();
    const uniqueTopics = parsed.topics.map((t, i) => {
      let name = t.name.trim();
      if (seenNames.has(name.toLowerCase())) {
        name = `${name} (${i + 1})`;
      }
      seenNames.add(name.toLowerCase());
      return {
        syllabus_doc_id: syllabusDocId,
        name,
        subtopics: t.subtopics,
        position: i,
        exam_count: 0,
        exam_questions: [],
      };
    });

    await supabase.from("topics").delete().eq("syllabus_doc_id", syllabusDocId);

    const { data: topics, error: insError } = await supabase
      .from("topics")
      .insert(uniqueTopics)
      .select();

    if (insError || !topics) {
      throw new Error(insError?.message ?? "Failed to insert topics into database");
    }

    if (pastPaperDocId) {
      try {
        const paper = await docText(pastPaperDocId, 14000);
        if (paper && paper.trim().length > 0) {
          const names = topics.map((t) => t.name);
          const mapped = await askJSON({
            system:
              "You map exam questions to syllabus topics. Choose only from the given topic list.",
            user: `TOPICS:\n${names.map((n, i) => `${i + 1}. ${n}`).join("\n")}\n\nQUESTION PAPER TEXT:\n${paper}\n\nList distinct questions found in the paper. Return JSON: {"questions":[{"text":"<question, max 160 chars>","topic":"<copy exactly one name from TOPICS>"}]}`,
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
      } catch (paperErr) {
        console.error("[POST /api/topics] Past-paper mapping warning:", paperErr);
      }
    }

    const { data: final } = await supabase
      .from("topics")
      .select("*")
      .eq("syllabus_doc_id", syllabusDocId)
      .order("position");

    return NextResponse.json({ topics: final });
  } catch (e) {
    console.error("[POST /api/topics] Error:", e);
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}