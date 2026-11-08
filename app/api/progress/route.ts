import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("syllabusDocId");
  if (!id) return NextResponse.json({ error: "syllabusDocId required" }, { status: 400 });

  const { data: attempts, error } = await supabase
    .from("attempts")
    .select("id,score_pct,created_at")
    .eq("syllabus_doc_id", id)
    .order("created_at");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!attempts || attempts.length === 0) {
    return NextResponse.json({ attempts: [], topics: [] });
  }

  const { data: ans } = await supabase
    .from("attempt_answers")
    .select("attempt_id,topic_id,is_correct")
    .in("attempt_id", attempts.map((a) => a.id));

  const { data: topics } = await supabase
    .from("topics")
    .select("id,name,position")
    .eq("syllabus_doc_id", id)
    .order("position");

  const attemptIndex = new Map(attempts.map((a, i) => [a.id as string, i]));

  // topic -> attempt index -> {total, correct}
  const acc = new Map<string, Map<number, { t: number; c: number }>>();
  for (const r of ans ?? []) {
    const idx = attemptIndex.get(r.attempt_id);
    if (idx === undefined) continue;
    const byAttempt = acc.get(r.topic_id) ?? new Map<number, { t: number; c: number }>();
    const cell = byAttempt.get(idx) ?? { t: 0, c: 0 };
    cell.t += 1;
    if (r.is_correct) cell.c += 1;
    byAttempt.set(idx, cell);
    acc.set(r.topic_id, byAttempt);
  }

  const out = (topics ?? [])
    .filter((t) => acc.has(t.id))
    .map((t) => {
      const byAttempt = acc.get(t.id)!;
      const scores = attempts.map((_, i) => {
        const cell = byAttempt.get(i);
        return cell ? Math.round((100 * cell.c) / cell.t) : null;
      });
      return { name: t.name as string, scores };
    });

  return NextResponse.json({
    attempts: attempts.map((a, i) => ({
      n: i + 1,
      scorePct: a.score_pct as number,
      createdAt: a.created_at as string,
    })),
    topics: out,
  });
}