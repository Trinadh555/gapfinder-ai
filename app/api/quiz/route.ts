import { NextResponse } from "next/server";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { askJSON } from "@/lib/llm";

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

// RETRIEVAL: find passages for the topic. GENERATION: write questions only from them.
async function generateForTopic(
  topic: Topic,
  noteDocIds: string[],
  docNames: Map<string, string>,
  perTopic: number
): Promise<string | null> {
  const q = [topic.name, ...(topic.subtopics ?? []).slice(0, 6)].join(" ").slice(0, 300);
  const { data, error } = await supabase.rpc("search_chunks", {
    q,
    doc_ids: noteDocIds,
    k: 4,
  });
  if (error) throw new Error(error.message);
  const list = (data ?? []) as Passage[];
  if (list.length === 0) return "no matching material in uploaded notes";

  const context = list
    .map((p, i) => `[${i}] (${docNames.get(p.document_id)}, page ${p.page})\n${p.content}`)
    .join("\n\n");

  const out = await askJSON({
    system:
      "You write exam diagnostic questions strictly from supplied study passages. Never use outside knowledge.",
    user: `TOPIC: ${topic.name}
SUBTOPICS: ${(topic.subtopics ?? []).join("; ")}

PASSAGES (text extracted from a PDF; formulas may be garbled):
${context}

Task: Write exactly ${perTopic} multiple-choice questions that test understanding of this topic, each answerable ONLY from the passages above.
Rules:
- If the passages do not actually teach this topic, return {"questions":[]}.
- Exactly 4 options per question, only one correct. Write math in plain text (x^2, sqrt(x), a/b), no LaTeX.
- explanations: array of 4 strings, one per option in the same order. For the correct option say why it is right; for each wrong option say why it is wrong (one sentence each).
- source: the number in [] of the passage the question is based on.
- subtopic: the closest subtopic name from the list.

Return JSON: {"questions":[{"subtopic":"","question":"","options":["","","",""],"correct_index":0,"explanations":["","","",""],"source":0}]}`,
    schema: QuizSchema,
    temperature: 0.4,
  });

  if (out.questions.length === 0) return "uploaded material does not cover this topic";

  const rows = out.questions.slice(0, perTopic).map((qn) => {
    const order = [0, 1, 2, 3].sort(() => Math.random() - 0.5); // shuffle options
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
  if (insErr) throw new Error(insErr.message);
  return null;
}

export async function POST(req: Request) {
  const body = (await req.json()) as {
    syllabusDocId: string;
    topicIds?: string[];
    perTopic?: number;
    regenerate?: boolean;
  };
  const { syllabusDocId, topicIds, regenerate = false } = body;
  const perTopic = body.perTopic ?? 3;
  if (!syllabusDocId) {
    return NextResponse.json({ error: "syllabusDocId required" }, { status: 400 });
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

    const { data: noteDocs } = await supabase
      .from("documents")
      .select("id,name")
      .eq("kind", "notes");
    if (!noteDocs || noteDocs.length === 0) {
      return NextResponse.json(
        { error: "Upload at least one Notes / Textbook file first" },
        { status: 400 }
      );
    }
    const docNames = new Map<string, string>(noteDocs.map((d) => [d.id, d.name]));
    const noteDocIds = noteDocs.map((d) => d.id);

    // Reuse cached questions unless regenerate
    const { data: existing } = await supabase
      .from("questions")
      .select("topic_id")
      .in("topic_id", topics.map((t) => t.id));
    const have = new Map<string, number>();
    for (const r of existing ?? []) have.set(r.topic_id, (have.get(r.topic_id) ?? 0) + 1);

    const todo = topics.filter((t) => regenerate || (have.get(t.id) ?? 0) < perTopic);
    if (todo.length > 0) {
      await supabase.from("questions").delete().in("topic_id", todo.map((t) => t.id));
    }

    const skipped: { topic: string; reason: string }[] = [];
    for (let i = 0; i < todo.length; i += 4) {
      await Promise.all(
        todo.slice(i, i + 4).map(async (t) => {
          try {
            const reason = await generateForTopic(t, noteDocIds, docNames, perTopic);
            if (reason) skipped.push({ topic: t.name, reason });
          } catch (e) {
            skipped.push({ topic: t.name, reason: e instanceof Error ? e.message : String(e) });
          }
        })
      );
    }

    // Return questions WITHOUT answers (answers stay on the server)
    const { data: qs } = await supabase
      .from("questions")
      .select("id,topic_id,subtopic,question,options,source_page,source_doc_name,created_at")
      .in("topic_id", topics.map((t) => t.id))
      .order("created_at");

    const topicIndex = new Map(topics.map((t, i) => [t.id, i]));
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
    questions.sort((a, b) => (topicIndex.get(a.topic_id) ?? 0) - (topicIndex.get(b.topic_id) ?? 0));

    return NextResponse.json({ questions, skipped });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}