// Shared HTTP helpers: CORS, auth, rate limiting, input sanitization.
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:4173",
];

function parseAllowedOrigins(): string[] {
  const raw = Deno.env.get("ALLOWED_ORIGINS") || "";
  const extra = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return [...DEFAULT_ALLOWED_ORIGINS, ...extra];
}

export function corsHeadersFor(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") || "";
  const allowed = parseAllowedOrigins();
  const allowOrigin = allowed.includes(origin) ? origin : allowed[0];
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

export function jsonResponse(
  body: unknown,
  status: number,
  cors: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

export interface AuthContext {
  userId: string;
  admin: SupabaseClient;
}

// Verifies Bearer token via Supabase (getUser), requires trainer role.
// Returns { userId, admin } or a ready-made error Response.
export async function requireTrainer(
  req: Request,
  cors: Record<string, string>,
): Promise<AuthContext | Response> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceKey) {
    console.error("Missing Supabase env vars");
    return jsonResponse({ error: "Server misconfigured" }, 500, cors);
  }

  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return jsonResponse({ error: "Unauthorized" }, 401, cors);
  }

  // Use a scoped client with the caller's JWT to verify via Supabase Auth.
  const scoped = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await scoped.auth.getUser();
  if (userErr || !userData?.user) {
    console.warn("Auth failure:", userErr?.message || "no user");
    return jsonResponse({ error: "Unauthorized" }, 401, cors);
  }

  const admin = createClient(supabaseUrl, serviceKey);
  const { data: profile, error: profErr } = await admin
    .from("profiles")
    .select("role")
    .eq("id", userData.user.id)
    .single();

  if (profErr || !profile) {
    console.warn("Profile lookup failed for", userData.user.id);
    return jsonResponse({ error: "Forbidden" }, 403, cors);
  }
  if (profile.role !== "trainer") {
    console.warn("Non-trainer access attempt:", userData.user.id, profile.role);
    return jsonResponse({ error: "Forbidden" }, 403, cors);
  }

  return { userId: userData.user.id, admin };
}

// Strip characters that could break out of an LLM prompt context.
// Removes newlines, collapses whitespace, hard-caps length.
export function sanitizePromptField(
  value: unknown,
  maxLen = 120,
): string {
  if (value === null || value === undefined) return "";
  const s = String(value)
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[`\u0000-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return s.slice(0, maxLen);
}

export function safeNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// Simple per-caller daily rate limit, using ai_comment_log as the counter.
// Returns null if OK, or an error Response if the cap is hit.
export async function enforceAiDailyLimit(
  admin: SupabaseClient,
  limit: number,
  cors: Record<string, string>,
): Promise<Response | null> {
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  const { count, error } = await admin
    .from("ai_comment_log")
    .select("id", { count: "exact", head: true })
    .gte("created_at", since.toISOString());
  if (error) {
    console.error("Rate limit query failed:", error.message);
    return null; // fail-open rather than block on infra issue
  }
  if ((count ?? 0) >= limit) {
    console.warn(`AI daily limit hit: ${count}/${limit}`);
    return jsonResponse(
      { error: "Daily AI request limit reached" },
      429,
      cors,
    );
  }
  return null;
}

export function isUuid(v: unknown): boolean {
  return typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

export const MEAL_ORDER = [
  "breakfast",
  "snack1",
  "lunch",
  "snack2",
  "dinner",
  "supplements",
] as const;

export const ALLOWED_MEAL_IDS = new Set(MEAL_ORDER);

export const MEAL_LABELS: Record<string, string> = {
  breakfast: "Snídaně",
  snack1: "Dopolední svačina",
  lunch: "Oběd",
  snack2: "Odpolední svačina",
  dinner: "Večeře",
  supplements: "Přepisy",
};

export interface DayEntry {
  meal_id: string;
  name?: unknown;
  grams?: unknown;
  kcal?: unknown;
  protein?: unknown;
  carbs?: unknown;
  fat?: unknown;
  fiber?: unknown;
}

export interface BuildDayContextInput {
  clientName: string;
  goalKcal: number;
  goalProtein: number;
  entries: DayEntry[];
  // meal_id -> comment text of previously written comments for this day
  comments: Record<string, string>;
  currentMealId: string;
}

// Builds the user prompt for generating a comment about a specific meal,
// with full-day context and previously written comments so the AI doesn't
// repeat itself and can reference earlier meals.
export function buildDayContextPrompt(input: BuildDayContextInput): string {
  const { clientName, goalKcal, goalProtein, entries, comments, currentMealId } = input;

  const byMeal: Record<string, DayEntry[]> = {};
  for (const e of entries) {
    const m = e.meal_id;
    if (!byMeal[m]) byMeal[m] = [];
    byMeal[m].push(e);
  }

  const totals = entries.reduce(
    (acc, e) => ({
      kcal: acc.kcal + safeNumber(e.kcal),
      protein: acc.protein + safeNumber(e.protein),
      carbs: acc.carbs + safeNumber(e.carbs),
      fat: acc.fat + safeNumber(e.fat),
    }),
    { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  );

  const kcalPct = goalKcal > 0 ? Math.round((totals.kcal / goalKcal) * 100) : 0;
  const proteinPct = goalProtein > 0 ? Math.round((totals.protein / goalProtein) * 100) : 0;

  const safeClient = sanitizePromptField(clientName, 60) || "klientka";

  const sections: string[] = [];
  sections.push(`Klientka: ${safeClient}`);
  sections.push(`Denní cíle: ${goalKcal} kcal, ${goalProtein}g bílkovin`);
  sections.push(
    `Denní příjem celkem: ${Math.round(totals.kcal)} kcal (${kcalPct}%), ${Math.round(totals.protein)}g B (${proteinPct}%), ${Math.round(totals.carbs)}g S, ${Math.round(totals.fat)}g T`,
  );
  sections.push("");
  sections.push("Přehled celého dne:");

  for (const mealId of MEAL_ORDER) {
    const list = byMeal[mealId];
    if (!list || list.length === 0) continue;

    const label = MEAL_LABELS[mealId] || mealId;
    const mealTotals = list.reduce(
      (acc, e) => ({
        kcal: acc.kcal + safeNumber(e.kcal),
        protein: acc.protein + safeNumber(e.protein),
      }),
      { kcal: 0, protein: 0 },
    );

    const isCurrent = mealId === currentMealId;
    const marker = isCurrent ? "  ← NYNÍ KOMENTUJETE" : "";
    sections.push(
      `\n[${label}] ${Math.round(mealTotals.kcal)} kcal, ${Math.round(mealTotals.protein)}g B${marker}`,
    );

    if (isCurrent) {
      // Detailed list for the meal being commented
      for (const e of list) {
        const name = sanitizePromptField(e.name, 80);
        sections.push(
          `  - ${name}: ${safeNumber(e.grams)}g, ${safeNumber(e.kcal)} kcal, ${safeNumber(e.protein)}g B, ${safeNumber(e.carbs)}g S, ${safeNumber(e.fat)}g T, ${safeNumber(e.fiber)}g V`,
        );
      }
    } else {
      // Brief list (names only) for other meals to save tokens
      const names = list
        .map((e) => sanitizePromptField(e.name, 60))
        .filter(Boolean)
        .join(", ");
      if (names) sections.push(`  ${names}`);
    }

    const prior = comments[mealId];
    if (prior && !isCurrent) {
      const safePrior = sanitizePromptField(prior, 260);
      sections.push(`  → Váš komentář: "${safePrior}"`);
    }
  }

  sections.push("");
  sections.push(
    `Napište komentář k jídlu [${MEAL_LABELS[currentMealId] || currentMealId}] (max 250 znaků). Vezměte v potaz kontext celého dne a neopakujte doporučení, která už zaznívají v předchozích komentářích. Pokud na ně chcete navázat, klidně to udělejte přirozeně.`,
  );

  return sections.join("\n");
}
