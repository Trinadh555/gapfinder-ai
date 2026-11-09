import { z } from "zod";

// High-speed, high-quota Groq models
const PRIMARY_MODEL = "llama-3.3-70b-versatile";
const FALLBACK_MODEL = "llama-3.1-8b-instant";

function getActiveModel(): string {
  const envModel = process.env.GROQ_MODEL;
  // If env specifies the exhausted gpt-oss-20b or is missing, use llama-3.3
  if (!envModel || envModel.includes("gpt-oss-20b")) {
    return PRIMARY_MODEL;
  }
  return envModel;
}

export async function askJSON<T>(opts: {
  system: string;
  user: string;
  schema: z.ZodType<T>;
  temperature?: number;
  maxTokens?: number;
}): Promise<T> {
  let lastErr = "";
  let currentModel = getActiveModel();

  for (let attempt = 0; attempt < 2; attempt++) {
    const makeBody = (model: string): Record<string, unknown> => ({
      model,
      temperature: opts.temperature ?? 0.2,
      max_completion_tokens: opts.maxTokens ?? 2000,
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
    });

    let res = await callGroq(makeBody(currentModel));

    // 1. If 429 Rate limit hit, immediately switch to the high-quota fallback model
    if (res.status === 429 && currentModel !== FALLBACK_MODEL) {
      console.warn(`[Groq] Rate limit hit on ${currentModel}. Switching to fallback: ${FALLBACK_MODEL}`);
      currentModel = FALLBACK_MODEL;
      res = await callGroq(makeBody(currentModel));
    }

    // 2. If still waiting for tokens, sleep max 2 seconds
    if (res.status === 429) {
      const wait = Math.min(Number(res.headers.get("retry-after")) || 2, 3);
      await new Promise((r) => setTimeout(r, wait * 1000));
      res = await callGroq(makeBody(currentModel));
    }

    if (!res.ok) {
      const errText = await res.text();
      // If error text mentions tokens per day and fallback hasn't been tried yet
      if (currentModel !== FALLBACK_MODEL) {
        currentModel = FALLBACK_MODEL;
        res = await callGroq(makeBody(currentModel));
      }
      if (!res.ok) {
        throw new Error(`Groq error ${res.status}: ${errText.slice(0, 300)}`);
      }
    }

    const data = await res.json();
    const text: string = data.choices?.[0]?.message?.content ?? "";
    try {
      const parsed = opts.schema.safeParse(JSON.parse(text));
      if (parsed.success) return parsed.data;
      lastErr = parsed.error.message.slice(0, 300);
    } catch {
      lastErr = "not valid JSON: " + text.slice(0, 100);
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