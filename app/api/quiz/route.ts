import { NextResponse } from "next/server";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { askJSON } from "@/lib/llm";
import { getUser, ownsDoc, unauthorized } from "@/lib/auth";

export const maxDuration = 300;

const QuizSchema = z.object({
  questions: z.array(
    z.object({
      subtopic: z.string().default(""),
      question: z.string(),
      options: z.array(z.string()).length(4),
      correct_index: z.number().int().min(0).max(3),
      explanations: z.array(z.string()).length(4),
      source: z.number().int().min(0),
    })
  ),
});

type Topic = { id: string; name: string; subtopics: string[] | null };
type Passage = { id: string; document_id: string; page: number; content: string };

async function generateForTopic(
  topic: Topic,
  materialDocIds: string[],
  docNames: Map<string, string>,
  perTopic: number
): Promise<string | null> {
  const q = [topic.name, ...(topic.subtopics ?? []).slice(0, 6)].join(" ").slice(0, 300);
  
  let list: Passage[] = [];
  try {
    const { data, error } = await supabase.rpc("search_chunks", {
      q,
      doc_ids: materialDocIds,
      k: 3,
    });
    if (!error && data) {
      list = data as Passage[];
    }
  } catch (rpcErr) {
    console.warn("[generateForTopic] RPC search_chunks warning:", rpcErr);
  }

  if (list.length === 0) {
    const { data: fallbackChunks } = await supabase
      .from("chunks")
      .select("id,document_id,page,content")
      .in("document_id", materialDocIds)
      .limit(3);
    list = (fallbackChunks ?? []) as Passage[];
  }

  if (list.length === 0) return "no matching material in uploaded files";

  const context = list
    .map(
      (p, i) =>
        `[${i}] (${docNames.get(p.document_id) || "study material"}, page ${p.page})\n${p.content.slice(0, 1000)}`
    )
    .join("\n\n");

  const out = await askJSON({
    system:
      "You write exam diagnostic questions strictly from supplied study passages. Never use outside knowledge.",
    user: `TOPIC: ${topic.name}
SUBTOPICS: ${(topic.subtopics ?? []).join("; ")}

PASSAGES (text extracted from uploaded documents):
${context}

Task: Write exactly ${perTopic} multiple-choice questions that test understanding of this topic, each answerable ONLY from the passages above.
Rules:
- Questions must be standalone. Never say "the passage" or "according to the text".
- Exactly 4 options per question, only one correct. Plain text math only (x^2, sqrt(x)), no LaTeX.
- explanations: array of 4 strings (one per option). Explain why correct is right and why wrong ones are wrong.
- source: the index number [0], [1], etc. of the passage used.
- subtopic: closest subtopic name.

Return JSON: {"questions":[{"subtopic":"","question":"","options":["","","",""],"correct_index":0,"explanations":["","","",""],"source":0}]}`,
    schema: QuizSchema,
    temperature: 0.4,
    maxTokens: 1800,
  });

  if (!out.questions || out.questions.length === 0) {
    return "uploaded material does not sufficiently cover this topic";
  }

  const rows = out.questions.slice(0, perTopic).map((qn) => {
    const order = [0, 1, 2, 3].sort(() => Math.random() - 0.5);
    const p = list[Math.min(qn.source, list.length - 1)];
    return {
      topic_id: topic.id,
      subtopic: qn.subtopic,
      question: qn.question,
      options: order.map((i) => qn.options[i]),
      correct_index: order.indexOf(qn.correct_index),
      option_explanations: order.map((i) => qn.explanations[i]),
      source_chunk_id: p.id,
      source_page: p.page,
      source_doc_name: docNames.get(p.document_id) ?? null,
    };
  });

  const { error: insErr } = await supabase.from("questions").insert(rows);
  if (insErr) {
    console.error("[generateForTopic] Insert questions error:", insErr);
    throw new Error(insErr.message);
  }
  return null;
}

export async function POST(req: Request) {
  const user = await getUser(req);
  if (!user) return unauthorized();

  const body = (await req.json()) as {
    syllabusDocId: string;
    topicIds?: string[];
    perTopic?: number;
    regenerate?: boolean;
    docIds?: string[];
  };

  const { syllabusDocId, topicIds, regenerate = false, docIds } = body;
  const perTopic = Math.min(Math.max(Number(body.perTopic) || 2, 1), 10);

  if (!syllabusDocId) {
    return NextResponse.json({ error: "syllabusDocId required" }, { status: 400 });
  }
  if (!(await ownsDoc(user.id, syllabusDocId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const { data: allTopics } = await supabase
      .from("topics")
      .select("id,name,subtopics,position")
      .eq("syllabus_doc_id", syllabusDocId)
      .order("position");

    const topics: Topic[] = (allTopics ?? []).filter(
      (t) => !topicIds || topicIds.includes(t.id)
    );

    if (topics.length === 0) {
      return NextResponse.json({ error: "Build the topic map first" }, { status: 400 });
    }

    let notesQuery = supabase
      .from("documents")
      .select("id,name,kind")
      .eq("user_id", user.id)
      .eq("kind", "notes");

    if (docIds && docIds.length > 0) {
      notesQuery = notesQuery.in("id", docIds);
    }
    const { data: noteDocs } = await notesQuery;
    let targetDocs = noteDocs ?? [];

    if (targetDocs.length === 0) {
      let fallbackQuery = supabase
        .from("documents")
        .select("id,name,kind")
        .eq("user_id", user.id)
        .neq("kind", "syllabus");

      if (docIds && docIds.length > 0) {
        fallbackQuery = fallbackQuery.in("id", docIds);
      }
      const { data: fallbackDocs } = await fallbackQuery;
      targetDocs = fallbackDocs ?? [];
    }

    if (targetDocs.length === 0) {
      return NextResponse.json(
        { error: "Upload study material (Notes / Textbook or Past paper) first to generate a quiz." },
        { status: 400 }
      );
    }

    const docNames = new Map<string, string>(targetDocs.map((d) => [d.id, d.name]));
    const materialDocIds = targetDocs.map((d) => d.id);

    // If regenerating, clear old questions for these topics
    if (regenerate) {
      await supabase.from("questions").delete().in("topic_id", topics.map((t) => t.id));
    }

    const { data: existing } = await supabase
      .from("questions")
      .select("topic_id")
      .in("topic_id", topics.map((t) => t.id));

    const have = new Map<string, number>();
    for (const r of existing ?? []) have.set(r.topic_id, (have.get(r.topic_id) ?? 0) + 1);

    const todo = topics.filter((t) => regenerate || (have.get(t.id) ?? 0) < perTopic);

    const skipped: { topic: string; reason: string }[] = [];
    for (let i = 0; i < todo.length; i += 2) {
      await Promise.all(
        todo.slice(i, i + 2).map(async (t) => {
          try {
            const need = perTopic - (have.get(t.id) ?? 0);
            if (need > 0) {
              const reason = await generateForTopic(t, materialDocIds, docNames, need);
              if (reason) skipped.push({ topic: t.name, reason });
            }
          } catch (e) {
            skipped.push({ topic: t.name, reason: e instanceof Error ? e.message : String(e) });
          }
        })
      );
    }

    const { data: qs } = await supabase
      .from("questions")
      .select("id,topic_id,subtopic,question,options,source_page,source_doc_name,created_at")
      .in("topic_id", topics.map((t) => t.id))
      .order("created_at");

    const topicName = new Map(topics.map((t) => [t.id, t.name]));
    const counts = new Map<string, number>();
    const questions = [];

    for (const q of qs ?? []) {
      const n = counts.get(q.topic_id) ?? 0;
      if (n >= perTopic) continue;
      counts.set(q.topic_id, n + 1);
      questions.push({
        id: q.id,
        topic_id: q.topic_id,
        topic: topicName.get(q.topic_id) ?? "",
        subtopic: q.subtopic,
        question: q.question,
        options: q.options,
        citation: { doc: q.source_doc_name, page: q.source_page },
      });
    }

    // SHUFFLE QUESTIONS: Mixes all topics together like a real exam!
    questions.sort(() => Math.random() - 0.5);

    return NextResponse.json({ questions, skipped });
  } catch (e) {
    console.error("[POST /api/quiz] Error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}