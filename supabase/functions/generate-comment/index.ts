import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SYSTEM_PROMPT } from "../_shared/styleGuide.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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

    const { day_id, meal_id, meal_label, meal_entries, daily_totals, client_name, client_goals } =
      await req.json();

    if (!meal_entries || meal_entries.length === 0) {
      return new Response(
        JSON.stringify({ error: "No entries for this meal" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build user prompt
    const entriesText = meal_entries
      .map(
        (e: any) =>
          `- ${e.name}: ${e.grams}g, ${e.kcal} kcal, ${e.protein}g B, ${e.carbs}g S, ${e.fat}g T, ${e.fiber || 0}g V`
      )
      .join("\n");

    const goalKcal = client_goals?.kcal || 2000;
    const goalProtein = client_goals?.protein || 100;
    const kcalPct = Math.round((daily_totals.kcal / goalKcal) * 100);
    const proteinPct = Math.round((daily_totals.protein / goalProtein) * 100);

    const userPrompt = `Klientka: ${client_name || "klientka"}
Denní cíle: ${goalKcal} kcal, ${goalProtein}g bílkovin
Denní příjem dosud: ${Math.round(daily_totals.kcal)} kcal (${kcalPct}%), ${Math.round(daily_totals.protein)}g B (${proteinPct}%), ${Math.round(daily_totals.carbs)}g S, ${Math.round(daily_totals.fat)}g T

Jídlo: ${meal_label}
${entriesText}

Napiš komentář k tomuto jídlu (max 250 znaků).`;

    // Call Claude API
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

    const aiResult = await response.json();
    const comment = aiResult.content?.[0]?.text?.slice(0, 250) || "";

    if (!comment) {
      return new Response(
        JSON.stringify({ error: "Empty AI response" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Save comment to database using service role
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: commentData, error: dbError } = await supabase
      .from("trainer_comments")
      .upsert(
        {
          day_id,
          meal_id,
          comment_text: comment,
          author: "ai",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "day_id,meal_id" }
      )
      .select()
      .single();

    if (dbError) {
      console.error("DB error:", dbError);
    }

    // Log usage
    await supabase.from("ai_comment_log").insert({
      day_id,
      meal_id,
      prompt_tokens: aiResult.usage?.input_tokens,
      completion_tokens: aiResult.usage?.output_tokens,
      model: "claude-sonnet-4-20250514",
      raw_response: JSON.stringify(aiResult),
    });

    return new Response(
      JSON.stringify({
        comment,
        id: commentData?.id,
        tokens: {
          input: aiResult.usage?.input_tokens,
          output: aiResult.usage?.output_tokens,
        },
      }),
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
