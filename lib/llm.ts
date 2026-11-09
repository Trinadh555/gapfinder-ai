import { z } from "zod";

const MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-20b";

export async function askJSON<T>(opts: {
  system: string;
  user: string;
  schema: z.ZodType<T>;
  temperature?: number;
  maxTokens?: number;
}): Promise<T> {
  let lastErr = "";

  for (let attempt = 0; attempt < 2; attempt++) {
    const body: Record<string, unknown> = {
      model: MODEL,
      temperature: opts.temperature ?? 0.3,
      max_completion_tokens: opts.maxTokens ?? 4000,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: opts.system + "\nRespond with a single valid JSON object only.",
        },
        {
          role: "user",
          content:
            opts.user +
            (lastErr ? `\n\nYour previous reply was invalid (${lastErr}). Fix it.` : ""),
        },
      ],
    };
    if (MODEL.startsWith("openai/gpt-oss")) body.reasoning_effort = "low";

    // Free tier = 8K tokens/minute per model. On 429, wait as Groq asks, then retry.
    let res = await callGroq(body);
    for (let i = 0; i < 4 && res.status === 429; i++) {
      const wait = Math.min(Number(res.headers.get("retry-after")) || 10, 30);
      await new Promise((r) => setTimeout(r, wait * 1000));
      res = await callGroq(body);
    }
    if (!res.ok) {
      throw new Error(`Groq error ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }

    const data = await res.json();
    const text: string = data.choices?.[0]?.message?.content ?? "";
    try {
      const parsed = opts.schema.safeParse(JSON.parse(text));
      if (parsed.success) return parsed.data;
      lastErr = parsed.error.message.slice(0, 300);
    } catch {
      lastErr = "not valid JSON";
    }
  }
  throw new Error("LLM returned invalid output: " + lastErr);
}

function callGroq(body: Record<string, unknown>) {
  return fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify(body),
  });
}