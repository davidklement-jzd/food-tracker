import { SYSTEM_PROMPT } from "../_shared/styleGuide.ts";
import {
  ALLOWED_MEAL_IDS,
  buildDayContextPrompt,
  corsHeadersFor,
  enforceAiDailyLimit,
  isUuid,
  jsonResponse,
  requireTrainer,
  safeNumber,
} from "../_shared/http.ts";

const DAILY_AI_LIMIT = Number(Deno.env.get("AI_DAILY_LIMIT") || "300");

Deno.serve(async (req) => {
  const cors = corsHeadersFor(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, cors);
  }

  try {
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicKey) {
      console.error("ANTHROPIC_API_KEY not configured");
      return jsonResponse({ error: "Server misconfigured" }, 500, cors);
    }

    const auth = await requireTrainer(req, cors);
    if (auth instanceof Response) return auth;
    const { admin } = auth;

    const limited = await enforceAiDailyLimit(admin, DAILY_AI_LIMIT, cors);
    if (limited) return limited;

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return jsonResponse({ error: "Invalid JSON body" }, 400, cors);
    }

    const { day_id, meal_id, client_name, client_goals } =
      body as Record<string, unknown>;

    if (!isUuid(day_id)) {
      return jsonResponse({ error: "Invalid day_id" }, 400, cors);
    }
    if (typeof meal_id !== "string" || !ALLOWED_MEAL_IDS.has(meal_id)) {
      return jsonResponse({ error: "Invalid meal_id" }, 400, cors);
    }

    // Fetch authoritative day state from DB (all entries + existing comments)
    const [dayRes, entriesRes, commentsRes] = await Promise.all([
      admin.from("diary_days").select("id, user_id").eq("id", day_id).single(),
      admin
        .from("diary_entries")
        .select("meal_id, name, grams, kcal, protein, carbs, fat, fiber")
        .eq("day_id", day_id)
        .order("sort_order"),
      admin
        .from("trainer_comments")
        .select("meal_id, comment_text")
        .eq("day_id", day_id),
    ]);

    if (dayRes.error || !dayRes.data) {
      return jsonResponse({ error: "Diary day not found" }, 404, cors);
    }

    const entries = entriesRes.data || [];
    const currentMealEntries = entries.filter((e) => e.meal_id === meal_id);
    if (currentMealEntries.length === 0) {
      return jsonResponse({ error: "No entries for this meal" }, 400, cors);
    }

    const commentsMap: Record<string, string> = {};
    for (const c of commentsRes.data || []) {
      if (c.comment_text) commentsMap[c.meal_id] = c.comment_text;
    }

    const goals = (client_goals && typeof client_goals === "object")
      ? client_goals as Record<string, unknown>
      : {};

    const userPrompt = buildDayContextPrompt({
      clientName: typeof client_name === "string" ? client_name : "",
      goalKcal: safeNumber(goals.kcal, 2000),
      goalProtein: safeNumber(goals.protein, 100),
      entries,
      comments: commentsMap,
      currentMealId: meal_id,
    });

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 150,
        system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!response.ok) {
      console.error("Anthropic API error:", response.status);
      return jsonResponse({ error: "AI service unavailable" }, 502, cors);
    }

    const aiResult = await response.json();
    const comment = aiResult.content?.[0]?.text?.slice(0, 250) || "";
    if (!comment) {
      return jsonResponse({ error: "Empty AI response" }, 502, cors);
    }

    const { data: commentData, error: dbError } = await admin
      .from("trainer_comments")
      .upsert(
        {
          day_id,
          meal_id,
          comment_text: comment,
          author: "ai",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "day_id,meal_id" },
      )
      .select()
      .single();

    if (dbError) {
      console.error("DB error saving comment:", dbError.message);
    }

    await admin.from("ai_comment_log").insert({
      day_id,
      meal_id,
      prompt_tokens: aiResult.usage?.input_tokens,
      completion_tokens: aiResult.usage?.output_tokens,
      model: "claude-sonnet-4-20250514",
      raw_response: JSON.stringify(aiResult),
    });

    return jsonResponse(
      {
        comment,
        id: commentData?.id,
        tokens: {
          input: aiResult.usage?.input_tokens,
          output: aiResult.usage?.output_tokens,
        },
      },
      200,
      cors,
    );
  } catch (err) {
    console.error("generate-comment error:", err);
    return jsonResponse({ error: "Internal server error" }, 500, cors);
  }
});
