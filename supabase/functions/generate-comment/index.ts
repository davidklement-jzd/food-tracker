import { SYSTEM_PROMPT } from "../_shared/styleGuide.ts";
import {
  COMMENTABLE_MEAL_IDS,
  buildDayContextPrompt,
  corsHeadersFor,
  enforceAiDailyLimit,
  generateAndSaveComment,
  isUuid,
  jsonResponse,
  requireTrainer,
  resolveGoalsForDate,
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
    if (typeof meal_id !== "string" || !COMMENTABLE_MEAL_IDS.has(meal_id)) {
      // Kalorický dluh (supplements) je ruční úprava trenéra, nekomentuje se.
      return jsonResponse({ error: "Invalid or non-commentable meal_id" }, 400, cors);
    }

    // Fetch authoritative day state from DB (all entries + existing comments)
    const [dayRes, entriesRes, commentsRes] = await Promise.all([
      admin.from("diary_days").select("id, user_id, date").eq("id", day_id).single(),
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

    // Cíle pro daný DEN: nejdřív zkusit goal_history (poslední řádek <= date),
    // teprve když selže, fallback na client_goals z requestu.
    const requestGoals = (client_goals && typeof client_goals === "object")
      ? client_goals as Record<string, unknown>
      : {};
    const historyGoals = await resolveGoalsForDate(admin, dayRes.data.user_id, dayRes.data.date);

    const userPrompt = buildDayContextPrompt({
      clientName: typeof client_name === "string" ? client_name : "",
      goalKcal: safeNumber(historyGoals.goal_kcal ?? requestGoals.kcal, 2000),
      goalProtein: safeNumber(historyGoals.goal_protein ?? requestGoals.protein, 100),
      goalCarbs: safeNumber(historyGoals.goal_carbs ?? requestGoals.carbs, 220),
      goalFat: safeNumber(historyGoals.goal_fat ?? requestGoals.fat, 80),
      goalFiber: safeNumber(historyGoals.goal_fiber ?? requestGoals.fiber, 30),
      entries,
      comments: commentsMap,
      currentMealId: meal_id,
    });

    const result = await generateAndSaveComment({
      admin,
      anthropicKey,
      dayId: day_id,
      mealId: meal_id,
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
    });

    if (!result.comment) {
      console.error("AI generation failed:", result.errorKind, result.errorDetail);
      return jsonResponse(
        { error: "AI generation failed", kind: result.errorKind, detail: result.errorDetail },
        502,
        cors,
      );
    }

    return jsonResponse(
      {
        comment: result.comment,
        id: result.commentId,
        tokens: { input: result.usage?.input, output: result.usage?.output },
      },
      200,
      cors,
    );
  } catch (err) {
    console.error("generate-comment error:", err);
    return jsonResponse({ error: "Internal server error" }, 500, cors);
  }
});
