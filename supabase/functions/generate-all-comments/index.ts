import { SYSTEM_PROMPT } from "../_shared/styleGuide.ts";
import {
  buildDayContextPrompt,
  COMMENTABLE_MEAL_ORDER,
  corsHeadersFor,
  enforceAiDailyLimit,
  generateAndSaveComment,
  jsonResponse,
  requireTrainer,
  resolveGoalsForDate,
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
    const { date, client_ids } = body as Record<string, unknown>;
    if (typeof date !== "string" || !ISO_DATE.test(date)) {
      return jsonResponse({ error: "Invalid date (YYYY-MM-DD)" }, 400, cors);
    }

    let clientsQuery = admin
      .from("profiles")
      .select("id, display_name, email, goal_kcal, goal_protein, goal_carbs, goal_fat, goal_fiber")
      .eq("role", "client");

    if (Array.isArray(client_ids) && client_ids.length > 0) {
      const ids = client_ids.filter((id): id is string => typeof id === "string");
      if (ids.length === 0) {
        return jsonResponse({ error: "Invalid client_ids" }, 400, cors);
      }
      clientsQuery = clientsQuery.in("id", ids);
    }

    const { data: clients } = await clientsQuery;

    if (!clients || clients.length === 0) {
      return jsonResponse({ generated: 0, skipped: 0, message: "No clients found" }, 200, cors);
    }

    let generated = 0;
    let skipped = 0;
    let failed = 0;
    let firstError: { status: number; body: string } | null = null;

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

      // Cíle pro daný DEN — historizovaně z goal_history; fallback profile.
      const historyGoals = await resolveGoalsForDate(admin, client.id, date);
      const dayGoalKcal = safeNumber(historyGoals.goal_kcal ?? client.goal_kcal, 2000);
      const dayGoalProtein = safeNumber(historyGoals.goal_protein ?? client.goal_protein, 100);
      const dayGoalCarbs = safeNumber(historyGoals.goal_carbs ?? client.goal_carbs, 220);
      const dayGoalFat = safeNumber(historyGoals.goal_fat ?? client.goal_fat, 80);
      const dayGoalFiber = safeNumber(historyGoals.goal_fiber ?? client.goal_fiber, 30);

      // Which meals in this day have entries?
      const mealsWithEntries = new Set(entries.map((e) => e.meal_id));

      for (const mealId of COMMENTABLE_MEAL_ORDER) {
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
          goalKcal: dayGoalKcal,
          goalProtein: dayGoalProtein,
          goalCarbs: dayGoalCarbs,
          goalFat: dayGoalFat,
          goalFiber: dayGoalFiber,
          entries,
          comments: commentsMap,
          currentMealId: mealId,
        });

        const result = await generateAndSaveComment({
          admin,
          anthropicKey,
          dayId: dayRow.id,
          mealId,
          systemPrompt: SYSTEM_PROMPT,
          userPrompt,
        });

        if (result.comment) {
          // Add to running context so the next meal's prompt sees it
          commentsMap[mealId] = result.comment;
          generated++;
        } else {
          console.error(`AI error for client ${client.id} / ${mealId}:`, result.errorKind, result.errorDetail);
          failed++;
          if (!firstError) firstError = { status: 0, body: `${result.errorKind}: ${result.errorDetail ?? ""}`.slice(0, 300) };
        }
      }
    }

    // Pokud se nic nevygenerovalo, nic nepřeskočilo, ale volání AI selhala,
    // vrať to jako chybu — ať trenér nevidí zavádějící „0 komentářů".
    if (generated === 0 && skipped === 0 && failed > 0) {
      return jsonResponse(
        { error: "AI generation failed", failed, detail: firstError },
        502,
        cors,
      );
    }

    return jsonResponse({ generated, skipped, failed, detail: firstError }, 200, cors);
  } catch (err) {
    console.error("generate-all-comments error:", err);
    return jsonResponse({ error: "Internal server error" }, 500, cors);
  }
});
