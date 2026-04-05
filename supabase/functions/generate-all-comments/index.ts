import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `Jsi asistent fitness trenéra Davida Klementa. Píšeš krátké komentáře k jídelníčku klientek.

PRAVIDLA:
- Maximálně 250 znaků
- VŽDY vykej (zkuste, přidejte, dejte si, budete, jste)
- Přátelský, přímý tón jako kamarád
- Návrhy s "třeba": "třeba přidat tvaroh"
- Konkrétní pozorování o daném jídle

PRIORITY HODNOCENÍ:
1. Bílkoviny – cíl splnit denní normu. Variovat zdroje dle kontextu.
2. Zelenina – v každém hlavním slaném jídle
3. Kalorická bilance – hodnotit celek za den
4. Stavba jídla – bílkovina + příloha (nejlépe brambory) + zelenina

CO NEKOMENTOVAT: pitný režim, vlákninu, deficit tuků, přebytek sacharidů

POCHVALY:
- Brambory: "nejdietnější příloha"
- Tvarůžky: "jedna z nejefektivnějších surovin"
- Vajíčka (jen ke slaným jídlům): "skvělý zdroj bílkovin"
- Vývar: "plné živin a kolagenu, přitom dietní"
- Luštěniny: zmínit bílkoviny I vlákninu

STYL:
- "Učebnicové jídlo." / "Správně." / "Celé může být."
- "Tady ideálně zeleninu přidat."
- "Stačilo přidat o plátek šunky navíc a kolečko bílkovin by šlo do zelena."
- Ultra krátké komentáře jsou OK: "Ideální kombinace." / "V pořádku."

Napiš POUZE text komentáře, nic jiného.`;

const MEALS = ["breakfast", "snack1", "lunch", "snack2", "dinner", "supplements"];
const MEAL_LABELS: Record<string, string> = {
  breakfast: "Snídaně",
  snack1: "Dopolední svačina",
  lunch: "Oběd",
  snack2: "Odpolední svačina",
  dinner: "Večeře",
  supplements: "Přepisy",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicKey) {
      return new Response(
        JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { date } = await req.json();
    if (!date) {
      return new Response(
        JSON.stringify({ error: "date is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get all clients
    const { data: clients } = await supabase
      .from("profiles")
      .select("id, display_name, email, goal_kcal, goal_protein, goal_carbs, goal_fat, goal_fiber")
      .eq("role", "client");

    if (!clients || clients.length === 0) {
      return new Response(
        JSON.stringify({ generated: 0, skipped: 0, message: "No clients found" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let generated = 0;
    let skipped = 0;

    for (const client of clients) {
      // Get diary day for this client
      const { data: dayRow } = await supabase
        .from("diary_days")
        .select("id")
        .eq("user_id", client.id)
        .eq("date", date)
        .single();

      if (!dayRow) {
        // No diary for this day
        continue;
      }

      // Get entries and existing comments
      const [entriesRes, commentsRes] = await Promise.all([
        supabase
          .from("diary_entries")
          .select("*")
          .eq("day_id", dayRow.id)
          .order("sort_order"),
        supabase
          .from("trainer_comments")
          .select("meal_id")
          .eq("day_id", dayRow.id),
      ]);

      const entries = entriesRes.data || [];
      const existingCommentMeals = new Set(
        (commentsRes.data || []).map((c: any) => c.meal_id)
      );

      // Group entries by meal
      const mealEntries: Record<string, any[]> = {};
      for (const entry of entries) {
        if (!mealEntries[entry.meal_id]) mealEntries[entry.meal_id] = [];
        mealEntries[entry.meal_id].push(entry);
      }

      // Calculate daily totals
      const dailyTotals = entries.reduce(
        (acc: any, e: any) => ({
          kcal: acc.kcal + (e.kcal || 0),
          protein: acc.protein + (e.protein || 0),
          carbs: acc.carbs + (e.carbs || 0),
          fat: acc.fat + (e.fat || 0),
          fiber: acc.fiber + (e.fiber || 0),
        }),
        { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 }
      );

      // Generate comment for each meal that has entries but no comment
      for (const mealId of MEALS) {
        const mEntries = mealEntries[mealId];
        if (!mEntries || mEntries.length === 0) continue;
        if (existingCommentMeals.has(mealId)) {
          skipped++;
          continue;
        }

        const entriesText = mEntries
          .map(
            (e: any) =>
              `- ${e.name}: ${e.grams}g, ${e.kcal} kcal, ${e.protein}g B, ${e.carbs}g S, ${e.fat}g T, ${e.fiber || 0}g V`
          )
          .join("\n");

        const goalKcal = client.goal_kcal || 2000;
        const goalProtein = client.goal_protein || 100;
        const kcalPct = Math.round((dailyTotals.kcal / goalKcal) * 100);
        const proteinPct = Math.round((dailyTotals.protein / goalProtein) * 100);

        const userPrompt = `Klientka: ${client.display_name || "klientka"}
Denní cíle: ${goalKcal} kcal, ${goalProtein}g bílkovin
Denní příjem celkem: ${Math.round(dailyTotals.kcal)} kcal (${kcalPct}%), ${Math.round(dailyTotals.protein)}g B (${proteinPct}%), ${Math.round(dailyTotals.carbs)}g S, ${Math.round(dailyTotals.fat)}g T

Jídlo: ${MEAL_LABELS[mealId] || mealId}
${entriesText}

Napiš komentář k tomuto jídlu (max 250 znaků).`;

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
              system: SYSTEM_PROMPT,
              messages: [{ role: "user", content: userPrompt }],
            }),
          });

          const aiResult = await response.json();
          const comment = aiResult.content?.[0]?.text?.slice(0, 250) || "";

          if (comment) {
            await supabase
              .from("trainer_comments")
              .upsert(
                {
                  day_id: dayRow.id,
                  meal_id: mealId,
                  comment_text: comment,
                  author: "ai",
                  updated_at: new Date().toISOString(),
                },
                { onConflict: "day_id,meal_id" }
              );

            // Log usage
            await supabase.from("ai_comment_log").insert({
              day_id: dayRow.id,
              meal_id: mealId,
              prompt_tokens: aiResult.usage?.input_tokens,
              completion_tokens: aiResult.usage?.output_tokens,
              model: "claude-sonnet-4-20250514",
              raw_response: JSON.stringify(aiResult),
            });

            generated++;
          }
        } catch (aiErr) {
          console.error(`AI error for ${client.email} / ${mealId}:`, aiErr);
        }
      }
    }

    return new Response(
      JSON.stringify({ generated, skipped }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Error:", err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
