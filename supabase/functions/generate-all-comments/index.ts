import { SYSTEM_PROMPT } from "../_shared/styleGuide.ts";
import {
  buildDayContextPrompt,
  corsHeadersFor,
  enforceAiDailyLimit,
  jsonResponse,
  MEAL_ORDER,
  requireTrainer,
  safeNumber,
} from "../_shared/http.ts";

const DAILY_AI_LIMIT = Number(Deno.env.get("AI_DAILY_LIMIT") || "300");
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

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
    const { date } = body as Record<string, unknown>;
    if (typeof date !== "string" || !ISO_DATE.test(date)) {
      return jsonResponse({ error: "Invalid date (YYYY-MM-DD)" }, 400, cors);
    }

    const { data: clients } = await admin
      .from("profiles")
      .select("id, display_name, email, goal_kcal, goal_protein")
      .eq("role", "client");

    if (!clients || clients.length === 0) {
      return jsonResponse({ generated: 0, skipped: 0, message: "No clients found" }, 200, cors);
    }

    let generated = 0;
    let skipped = 0;

    for (const client of clients) {
      const { data: dayRow } = await admin
        .from("diary_days")
        .select("id")
        .eq("user_id", client.id)
        .eq("date", date)
        .single();

      if (!dayRow) continue;

      const [entriesRes, commentsRes] = await Promise.all([
        admin
          .from("diary_entries")
          .select("meal_id, name, grams, kcal, protein, carbs, fat, fiber")
          .eq("day_id", dayRow.id)
          .order("sort_order"),
        admin
          .from("trainer_comments")
          .select("meal_id, comment_text")
          .eq("day_id", dayRow.id),
      ]);

      const entries = entriesRes.data || [];
      if (entries.length === 0) continue;

      // Running map of comments (pre-existing + generated in this run).
      // Each subsequent meal sees all earlier comments as context.
      const commentsMap: Record<string, string> = {};
      for (const c of commentsRes.data || []) {
        if (c.comment_text) commentsMap[c.meal_id] = c.comment_text;
      }

      // Which meals in this day have entries?
      const mealsWithEntries = new Set(entries.map((e) => e.meal_id));

      for (const mealId of MEAL_ORDER) {
        if (!mealsWithEntries.has(mealId)) continue;
        if (commentsMap[mealId]) {
          skipped++;
          continue;
        }

        // Re-check rate limit inside loop so bulk runs can't blow past the cap.
        const limitedLoop = await enforceAiDailyLimit(admin, DAILY_AI_LIMIT, cors);
        if (limitedLoop) return limitedLoop;

        const userPrompt = buildDayContextPrompt({
          clientName: client.display_name || "",
          goalKcal: safeNumber(client.goal_kcal, 2000),
          goalProtein: safeNumber(client.goal_protein, 100),
          entries,
          comments: commentsMap,
          currentMealId: mealId,
        });

        try {
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
            continue;
          }

          const aiResult = await response.json();
          const comment = aiResult.content?.[0]?.text?.slice(0, 250) || "";

          if (comment) {
            await admin
              .from("trainer_comments")
              .upsert(
                {
                  day_id: dayRow.id,
                  meal_id: mealId,
                  comment_text: comment,
                  author: "ai",
                  updated_at: new Date().toISOString(),
                },
                { onConflict: "day_id,meal_id" },
              );

            await admin.from("ai_comment_log").insert({
              day_id: dayRow.id,
              meal_id: mealId,
              prompt_tokens: aiResult.usage?.input_tokens,
              completion_tokens: aiResult.usage?.output_tokens,
              model: "claude-sonnet-4-20250514",
              raw_response: JSON.stringify(aiResult),
            });

            // Add to running context so the next meal's prompt sees it
            commentsMap[mealId] = comment;
            generated++;
          }
        } catch (aiErr) {
          console.error(`AI error for client ${client.id} / ${mealId}:`, aiErr);
        }
      }
    }

    return jsonResponse({ generated, skipped }, 200, cors);
  } catch (err) {
    console.error("generate-all-comments error:", err);
    return jsonResponse({ error: "Internal server error" }, 500, cors);
  }
});
