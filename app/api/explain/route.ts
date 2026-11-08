import { streamText } from "ai";
import { groq } from "@ai-sdk/groq";
import { supabase } from "@/lib/supabase";

export const maxDuration = 60;

const MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-120b";

type Msg = { role: "user" | "assistant"; content: string };
type Passage = { document_id: string; page: number; content: string };
type TopicRow = {
  name: string;
  exam_count: number | null;
  exam_questions: string[] | null;
};

// "important questions on matrices", "past paper questions", "expected questions"...
const IMPORTANT_RE =
  /\b(important|expected|frequently asked|previous year|past paper|model paper|exam)\b.*\b(questions?|problems?|paper)\b|\b(questions?|problems?)\b.*\b(important|expected|exam|past paper|model paper|previous)\b/i;

function textResponse(text: string, headers: Record<string, string>) {
  return new Response(text, {
    headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" },
  });
}

// Pure RETRIEVAL from the student's uploaded past paper. No LLM involved.
async function pastPaperAnswer(question: string, topicName?: string): Promise<string> {
  const { data: syl } = await supabase
    .from("documents")
    .select("id")
    .eq("kind", "syllabus")
    .order("created_at", { ascending: false })
    .limit(1);
  const { data: paper } = await supabase
    .from("documents")
    .select("name")
    .eq("kind", "past_paper")
    .order("created_at", { ascending: false })
    .limit(1);

  if (!syl?.[0]) return "Upload a syllabus and build the topic map first.";
  if (!paper?.[0]) return "Upload a past paper first, then I can list its questions by topic.";

  const { data } = await supabase
    .from("topics")
    .select("name,exam_count,exam_questions")
    .eq("syllabus_doc_id", syl[0].id)
    .order("position");
  const topics = (data ?? []) as TopicRow[];
  const text = question.toLowerCase();

  // Which topics is the student asking about?
  let picked: TopicRow[] = [];
  if (topicName) picked = topics.filter((t) => t.name === topicName);
  if (picked.length === 0) {
    const scored = topics.map((t) => {
      const words = t.name
        .toLowerCase()
        .split(/[^a-z]+/)
        .filter((w) => w.length >= 5);
      return { t, score: words.filter((w) => text.includes(w.slice(0, 5))).length };
    });
    const max = Math.max(0, ...scored.map((s) => s.score));
    picked =
      max > 0
        ? scored.filter((s) => s.score === max).map((s) => s.t)
        : [...topics].sort((a, b) => (b.exam_count ?? 0) - (a.exam_count ?? 0));
  }

  const withQs = picked.filter((t) => (t.exam_questions?.length ?? 0) > 0);
  if (withQs.length === 0) {
    return `Your uploaded past paper (${paper[0].name}) has no questions on ${picked
      .map((t) => t.name)
      .join(", ")}.`;
  }

  const blocks = withQs.map((t) => {
    const qs = t.exam_questions ?? [];
    return (
      `${t.name} (${qs.length} question${qs.length === 1 ? "" : "s"} in your past paper)\n` +
      qs.map((q, i) => `  ${i + 1}. ${q}`).join("\n")
    );
  });

  return `Questions from your uploaded past paper (${paper[0].name}):\n\n${blocks.join(
    "\n\n"
  )}\n\nTip: ask me to explain any concept from these questions.`;
}

export async function POST(req: Request) {
  const { topic, messages } = (await req.json()) as { topic?: string; messages: Msg[] };
  if (!Array.isArray(messages) || messages.length === 0) {
    return Response.json({ error: "messages required" }, { status: 400 });
  }

  const lastUserMsg = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";

  // Past-paper questions: answered from stored retrieval results
  if (IMPORTANT_RE.test(lastUserMsg)) {
    const answer = await pastPaperAnswer(lastUserMsg, topic || undefined);
    return textResponse(answer, { "X-Sources": encodeURIComponent("[]") });
  }

  const recent = messages.slice(-8);
  const lastUser = recent.filter((m) => m.role === "user").slice(-2);
  const query = [topic, ...lastUser.map((m) => m.content)]
    .filter(Boolean)
    .join(" ")
    .slice(0, 400);

  const { data: noteDocs } = await supabase
    .from("documents")
    .select("id,name")
    .eq("kind", "notes");
  if (!noteDocs || noteDocs.length === 0) {
    return Response.json({ error: "Upload notes / textbook files first" }, { status: 400 });
  }
  const names = new Map<string, string>(noteDocs.map((d) => [d.id, d.name]));

  // RETRIEVAL: find passages in the student's own material
  const { data, error } = await supabase.rpc("search_chunks", {
    q: query,
    doc_ids: noteDocs.map((d) => d.id),
    k: 5,
  });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const passages = (data ?? []) as Passage[];
  const sources = passages.map((p, i) => ({
    n: i + 1,
    doc: names.get(p.document_id) ?? "notes",
    page: p.page,
  }));
  const headers = { "X-Sources": encodeURIComponent(JSON.stringify(sources)) };

  if (passages.length === 0) {
    return textResponse("This isn't covered in your uploaded material.", headers);
  }

  const context = passages
    .map((p, i) => `[${i + 1}] (${sources[i].doc}, page ${p.page})\n${p.content}`)
    .join("\n\n");

  // GENERATION: explain using ONLY the retrieved passages
  const result = streamText({
    model: groq(MODEL),
    system: `You are a friendly study tutor for a school student.
Answer ONLY using the numbered passages below. They are text extracted from the student's own PDFs (formulas may be garbled).
Rules:
- Add citations like [1] or [2] after the claims they support.
- If the passages do not contain the answer, reply with exactly this sentence and nothing else: "This isn't covered in your uploaded material." Never use outside knowledge.
- Explain simply, step by step. Write math in plain text (x^2, sqrt(x), a/b), no LaTeX.

PASSAGES:
${context}`,
    messages: recent,
    providerOptions: { groq: { reasoningEffort: "low" } },
  });

  return result.toTextStreamResponse({ headers });
}