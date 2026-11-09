import { NextResponse } from "next/server";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { askJSON } from "@/lib/llm";
import { getUser, ownsDoc, unauthorized } from "@/lib/auth";

export const maxDuration = 60;

const ReasonSchema = z.object({
  reasons: z.array(z.object({ topic: z.string(), reason: z.string() })),
});

type Status = "weak" | "medium" | "strong";
// Gap analysis is plain math in code, NOT the LLM
function statusOf(pct: number): Status {
  return pct < 40 ? "weak" : pct < 70 ? "medium" : "strong";
}

export async function POST(req: Request) {
  const user = await getUser(req);
  if (!user) return unauthorized();

  const { syllabusDocId, answers } = (await req.json()) as {
    syllabusDocId: string;
    answers: { questionId: string; chosenIndex: number | null }[];
  };
  if (!syllabusDocId || !Array.isArray(answers) || answers.length === 0) {
    return NextResponse.json({ error: "syllabusDocId and answers required" }, { status: 400 });
  }
  if (!(await ownsDoc(user.id, syllabusDocId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const { data: topics } = await supabase
      .from("topics")
      .select("id,name,exam_count")
      .eq("syllabus_doc_id", syllabusDocId);
    const tMap = new Map((topics ?? []).map((t) => [t.id, t]));

    const { data: qs, error } = await supabase
      .from("questions")
      .select("*")
      .in("id", answers.map((a) => a.questionId));
    if (error) throw new Error(error.message);
    // Only questions that belong to this user's syllabus topics
    const qMap = new Map(
      (qs ?? []).filter((q) => tMap.has(q.topic_id)).map((q) => [q.id, q])
    );

    type Acc = { total: number; correct: number; wrong: { question: string; subtopic: string }[] };
    const acc = new Map<string, Acc>();
    const results = [];

    for (const a of answers) {
      const q = qMap.get(a.questionId);
      if (!q) continue;
      const isCorrect = a.chosenIndex === q.correct_index;
      const expl: string[] = q.option_explanations ?? [];

      results.push({
        questionId: q.id,
        topicId: q.topic_id,
        topic: tMap.get(q.topic_id)?.name ?? "",
        question: q.question,
        options: q.options,
        chosenIndex: a.chosenIndex,
        correctIndex: q.correct_index,
        isCorrect,
        explanation:
          a.chosenIndex !== null ? expl[a.chosenIndex] ?? "" : "You did not answer this question.",
        correctExplanation: expl[q.correct_index] ?? "",
        citation: { doc: q.source_doc_name, page: q.source_page },
      });

      const t = acc.get(q.topic_id) ?? { total: 0, correct: 0, wrong: [] };
      t.total += 1;
      if (isCorrect) t.correct += 1;
      else t.wrong.push({ question: q.question, subtopic: q.subtopic ?? "" });
      acc.set(q.topic_id, t);
    }

    if (results.length === 0) {
      return NextResponse.json({ error: "No valid answers submitted" }, { status: 400 });
    }

    const topicReports = Array.from(acc.entries()).map(([topicId, t]) => {
      const pct = Math.round((100 * t.correct) / t.total);
      return {
        topicId,
        name: tMap.get(topicId)?.name ?? "",
        total: t.total,
        correct: t.correct,
        pct,
        status: statusOf(pct),
        reason: "",
        examCount: tMap.get(topicId)?.exam_count ?? 0,
      };
    });

    // LLM only PHRASES the reason for weak/medium topics
    const need = topicReports.filter((t) => t.status !== "strong");
    const reasonMap = new Map<string, string>();
    if (need.length > 0) {
      try {
        const payload = need.map((t) => ({
          topic: t.name,
          correct: t.correct,
          total: t.total,
          wrongQuestions: (acc.get(t.topicId)?.wrong ?? []).map(
            (w) => `${w.subtopic || "general"}: ${w.question}`
          ),
        }));
        const out = await askJSON({
          system: "You are a study coach. Explain weak areas using only the data given.",
          user: `Quiz results per topic:\n${JSON.stringify(payload)}\n\nFor each topic write ONE short sentence (max 30 words) that starts with the score (e.g. "You got 1 of 3 right"), then names the specific subtopic or concept that was missed, based only on the wrong questions.\nReturn JSON: {"reasons":[{"topic":"<exact topic name>","reason":"..."}]}`,
          schema: ReasonSchema,
        });
        for (const r of out.reasons) reasonMap.set(r.topic, r.reason);
      } catch {
        // fall back to template reasons below
      }
    }
    for (const t of topicReports) {
      t.reason =
        reasonMap.get(t.name) ??
        (t.status === "strong"
          ? `You got ${t.correct} of ${t.total} right. Looks solid.`
          : `You got ${t.correct} of ${t.total} right. Revise the questions you missed in this topic.`);
    }

    const order: Record<Status, number> = { weak: 0, medium: 1, strong: 2 };
    topicReports.sort((a, b) => order[a.status] - order[b.status] || b.examCount - a.examCount);

    const correctQ = results.filter((r) => r.isCorrect).length;
    const scorePct = Math.round((100 * correctQ) / results.length);

    const { data: attempt, error: aErr } = await supabase
      .from("attempts")
      .insert({ syllabus_doc_id: syllabusDocId, user_id: user.id, score_pct: scorePct })
      .select()
      .single();
    if (aErr || !attempt) throw new Error(aErr?.message ?? "could not save attempt");

    await supabase.from("attempt_answers").insert(
      results.map((r) => ({
        attempt_id: attempt.id,
        question_id: r.questionId,
        topic_id: r.topicId,
        chosen_index: r.chosenIndex,
        is_correct: r.isCorrect,
      }))
    );

    return NextResponse.json({ attemptId: attempt.id, scorePct, results, topics: topicReports });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}