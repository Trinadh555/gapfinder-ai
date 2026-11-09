import { streamText } from "ai";
import { groq } from "@ai-sdk/groq";
import { supabase } from "@/lib/supabase";
import { getUser, unauthorized } from "@/lib/auth";

export const maxDuration = 60;

const MODEL = process.env.GROQ_MODEL_CHAT || "openai/gpt-oss-120b";

type Msg = { role: "user" | "assistant"; content: string };
type Passage = { document_id: string; page: number; content: string };
type TopicRow = {
  name: string;
  exam_count: number | null;
  exam_questions: string[] | null;
};

const WANT_IMPORTANT =
  /\b(imp|import\w*|expect\w*|frequent\w*|previous|past|model|exam\w*|board)\b/i;
const WANT_QUESTIONS = /\b(que\w*|quest\w*|qns?|qs|problems?|paper)\b/i;
const isPastPaperAsk = (t: string) => WANT_IMPORTANT.test(t) && WANT_QUESTIONS.test(t);

function textResponse(text: string, headers: Record<string, string>) {
  return new Response(text, {
    headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" },
  });
}

async function pastPaperAnswer(
  userId: string,
  question: string,
  topicName?: string
): Promise<string> {
  const { data: syl } = await supabase
    .from("documents")
    .select("id")
    .eq("kind", "syllabus")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1);
  const { data: paper } = await supabase
    .from("documents")
    .select("name")
    .eq("kind", "past_paper")
    .eq("user_id", userId)
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
  const user = await getUser(req);
  if (!user) return unauthorized();

  const { topic, messages } = (await req.json()) as { topic?: string; messages: Msg[] };
  if (!Array.isArray(messages) || messages.length === 0) {
    return Response.json({ error: "messages required" }, { status: 400 });
  }

  const userMsgs = messages.filter((m) => m.role === "user");
  const lastUserMsg = userMsgs[userMsgs.length - 1]?.content ?? "";

  if (isPastPaperAsk(lastUserMsg)) {
    const answer = await pastPaperAnswer(user.id, lastUserMsg, topic || undefined);
    return textResponse(answer, { "X-Sources": encodeURIComponent("[]") });
  }

  const recent = messages.slice(-8);
  const shortFollowUp = lastUserMsg.trim().split(/\s+/).length < 4;
  const prevUser = userMsgs.length > 1 ? userMsgs[userMsgs.length - 2].content : "";
  const query = [topic, shortFollowUp ? prevUser : "", lastUserMsg]
    .filter(Boolean)
    .join(" ")
    .slice(0, 400);

  const { data: noteDocs } = await supabase
    .from("documents")
    .select("id,name")
    .neq("kind", "syllabus")
    .eq("user_id", user.id);

  if (!noteDocs || noteDocs.length === 0) {
    return Response.json({ error: "Upload notes / textbook files first" }, { status: 400 });
  }
  const names = new Map<string, string>(noteDocs.map((d) => [d.id, d.name]));

  const { data, error } = await supabase.rpc("search_chunks", {
    q: query,
    doc_ids: noteDocs.map((d) => d.id),
    k: 4,
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
    return textResponse("This isn't covered in your uploaded material. Please upload notes covering this topic.", {
      "X-Sources": encodeURIComponent("[]"),
    });
  }

  const context = passages
    .map(
      (p, i) =>
        `[${i + 1}] (${sources[i].doc}, page ${p.page})\n${p.content.slice(0, 1000)}`
    )
    .join("\n\n");

  const result = streamText({
    model: groq(MODEL),
    system: `You are an expert, friendly AI study tutor for a student.
Your goal is to explain concepts clearly, accurately, and helpfully using the student's uploaded material.

CRITICAL FORMULA & MATH RULES:
- NEVER use LaTeX syntax like \\[, \\], \\(, \\), \\frac, \\sigma, \\alpha, \\cdot, \\times.
- Write ALL mathematical formulas in clean, natural, readable plain text!
  Example:
  - DO NOT WRITE: \\[ \\sigma (x) = \\frac{1}{1+e^{-x}} \\]
  - INSTEAD WRITE: σ(x) = 1 / (1 + e^-x)  OR  sigmoid(x) = 1 / (1 + e^-x)
  - DO NOT WRITE: \\( \\sigma'(x) = \\sigma(x)\\,[1-\\sigma(x)] \\)
  - INSTEAD WRITE: σ'(x) = σ(x) * (1 - σ(x))

OTHER RULES:
1. Handle common typos and misspellings automatically (e.g. "manchine learning" means "machine learning").
2. Primarily ground your answer in the numbered passages below and cite them using plain brackets like [1] or [2].
3. If a basic definition or bridge concept is helpful, provide it intuitively and link it back to the passages.
4. ONLY if the question is completely unrelated to study material, reply with: "This isn't covered in your uploaded material."
5. Use bullet points and clean structure.

PASSAGES:
${context}`,
    messages: recent,
    maxOutputTokens: 900,
    providerOptions: { groq: { reasoningEffort: "low" } },
  });

  return result.toTextStreamResponse({ headers });
}