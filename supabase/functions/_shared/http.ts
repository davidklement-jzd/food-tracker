// Shared HTTP helpers: CORS, auth, rate limiting, input sanitization.
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// ===== AI konfigurace — JEDINÝ zdroj pravdy pro model a parametry =====
// Model přes env, ať jde měnit bez deploye kódu (a ať tu není natvrdo na 4
// místech). Když bude model vyřazen, stačí přenastavit AI_MODEL secret.
export const AI_MODEL = Deno.env.get("AI_MODEL") ?? "claude-sonnet-4-6";
// 250 znaků češtiny ≈ 90–130 tokenů; 220 dává rezervu na dokončení věty.
export const AI_MAX_TOKENS = Number(Deno.env.get("AI_MAX_TOKENS") ?? "220");
const AI_TIMEOUT_MS = 30_000;
const AI_MAX_RETRIES = 2; // celkem tedy až 3 pokusy na přechodné chyby

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

// Server-side pojistka: i když model i přes instrukce v promptu „přemýšlí
// nahlas" nebo se uprostřed komentáře opraví, tohle to vyřízne, aby se to
// NIKDY nedostalo ke klientce. Komentář se generuje bez thinkingu, takže
// jakákoliv sebeoprava končí přímo v textu — tady ji odstraníme.
//
// Typický vzor úniku: "<koncept>. Wait — … Opravím. <opravená verze>".
// Když najdeme jasný marker uvažování, vrátíme přednostně opravenou verzi
// (text za závěrečným "Opravím." / "Zkusím znovu."), jinak ořízneme samotnou
// meta-větu a vrátíme zbytek.
export function stripAiReasoning(text: string): string {
  let t = (text || "").trim();
  if (!t) return t;

  // Markery, které se v normálním českém komentáři NIKDY nevyskytují a značí,
  // že model komentuje sám sebe / restartuje. ("přepíšu" / "udělám přepis"
  // jsou legitimní u kalorií, proto je tu ZÁMĚRNĚ nemáme.)
  // POZN.: marker „lépe:" byl odstraněn — „lépe" je běžný český obrat
  // („lépe volit light verzi") a filtr by legitimní komentář ořízl.
  const reasoningSignal =
    /\b(wait|hmm+|oops|actually)\b|po[čc]k[aá]t[,!. ]|to nesm[íi]m|nesm[íi]m (psát|napsat)|zkus[íi]m (to )?znovu|opravuji|oprav[íi]m to\b|\bopravim\b|\bopravím\b|ne tady[.,]?\s*oprav/i;

  if (!reasoningSignal.test(t)) return t;

  // 1) Zkus najít závěr opravy a vrátit text ZA ním (finální čistou verzi).
  const redoEnd =
    /(opravuji|oprav[íi]m(\s+to)?|zkus[íi]m\s+(to\s+)?znovu|p[íi][šs]u\s+znovu)\s*[.!:–—-]+\s*/gi;
  let lastEnd = -1;
  let m: RegExpExecArray | null;
  while ((m = redoEnd.exec(t)) !== null) lastEnd = m.index + m[0].length;
  if (lastEnd > 0 && lastEnd < t.length) {
    const tail = t.slice(lastEnd).trim();
    if (tail.length >= 15) return tail;
  }

  // 2) Fallback: vyřízni meta část od prvního markeru dál a vrať koncept před ním.
  const cut = t.search(/\s*(\bwait\b|po[čc]k[aá]t[,. ]|to nesm[íi]m|nesm[íi]m\s+(psát|napsat))/i);
  if (cut > 20) {
    return t.slice(0, cut).replace(/[\s.,;:–—-]+$/, "").trim();
  }
  return t;
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

// Jídla, ke kterým AI píše komentář. "supplements" (Kalorický dluh) je
// účetní úprava trenéra, ne reálně snědené jídlo – nikdy se nekomentuje.
export const COMMENTABLE_MEAL_ORDER = [
  "breakfast",
  "snack1",
  "lunch",
  "snack2",
  "dinner",
] as const;

export const COMMENTABLE_MEAL_IDS = new Set(COMMENTABLE_MEAL_ORDER);

export const MEAL_LABELS: Record<string, string> = {
  breakfast: "Snídaně",
  snack1: "Dopolední svačina",
  lunch: "Oběd",
  snack2: "Odpolední svačina",
  dinner: "Večeře",
  supplements: "Kalorický dluh",
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
  goalCarbs: number;
  goalFat: number;
  goalFiber: number;
  entries: DayEntry[];
  // meal_id -> comment text of previously written comments for this day
  comments: Record<string, string>;
  currentMealId: string;
  // Textová poznámka klientky ke KOMENTOVANÉMU jídlu (může obsahovat způsob
  // přípravy – olej/tuk/troubu/vodu). Volitelné, prázdné když poznámka není.
  currentMealNote?: string;
}

// Builds the user prompt for generating a comment about a specific meal,
// with full-day context and previously written comments so the AI doesn't
// repeat itself and can reference earlier meals.
export function buildDayContextPrompt(input: BuildDayContextInput): string {
  const { clientName, goalKcal, goalProtein, goalCarbs, goalFat, goalFiber, entries, comments, currentMealId, currentMealNote } = input;

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
      fiber: acc.fiber + safeNumber(e.fiber),
    }),
    { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 },
  );

  const pctOf = (value: number, goal: number) =>
    goal > 0 ? Math.round((value / goal) * 100) : 0;
  // Stejné prahy jako barevná kolečka v UI (DailySummary / MacroRow):
  // 90–110 % = zelené, pod 90 % = oranžové, nad 110 % = červené. Model tak
  // vidí přesně to, co má trenér před očima. Procento ukazuje směr (pod/přes),
  // takže „červené" u 136 % je jasně překročení, ne nedostatek.
  const ringColor = (pct: number) =>
    pct > 110 ? "červené" : pct >= 90 ? "zelené" : "oranžové";
  const kcalPct = pctOf(totals.kcal, goalKcal);
  const proteinPct = pctOf(totals.protein, goalProtein);
  const carbsPct = pctOf(totals.carbs, goalCarbs);
  const fatPct = pctOf(totals.fat, goalFat);
  const fiberPct = pctOf(totals.fiber, goalFiber);

  const safeClient = sanitizePromptField(clientName, 60) || "klientka";

  const sections: string[] = [];
  sections.push(`Klientka: ${safeClient}`);
  sections.push(
    `Denní cíle: ${goalKcal} kcal, ${goalProtein}g B, ${goalCarbs}g S, ${goalFat}g T, ${goalFiber}g vlákniny`,
  );
  sections.push(
    `Denní příjem celkem (% denního cíle a barva kolečka jako v appce):\n` +
      `  - Kalorie: ${Math.round(totals.kcal)} kcal (${kcalPct}% – ${ringColor(kcalPct)})\n` +
      `  - Bílkoviny: ${Math.round(totals.protein)}g (${proteinPct}% – ${ringColor(proteinPct)})\n` +
      `  - Sacharidy: ${Math.round(totals.carbs)}g (${carbsPct}% – ${ringColor(carbsPct)})\n` +
      `  - Tuky: ${Math.round(totals.fat)}g (${fatPct}% – ${ringColor(fatPct)})\n` +
      `  - Vláknina: ${Math.round(totals.fiber)}g (${fiberPct}% – ${ringColor(fiberPct)})`,
  );
  sections.push("");
  sections.push("Přehled celého dne:");

  for (const mealId of MEAL_ORDER) {
    const list = byMeal[mealId];
    if (!list || list.length === 0) continue;

    // Kalorický dluh: účetní úprava trenéra, ne reálně snědené jídlo.
    // Započítá se do denního součtu (výše), ale v přehledu dne ukazujeme
    // jen souhrn bez položek – AI je nesmí komentovat jako jídlo.
    if (mealId === "supplements") {
      const suppKcal = list.reduce((acc, e) => acc + safeNumber(e.kcal), 0);
      sections.push(
        `\n[Kalorický dluh — ruční účetní úprava trenéra, ne reálně snědené jídlo]: +${Math.round(suppKcal)} kcal započteno do celkového denního příjmu.`,
      );
      continue;
    }

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
      // Poznámka klientky k tomuto jídlu – kontext ke ZPŮSOBU PŘÍPRAVY
      // (olej/tuk/troubu/vodu), NE položka jídla ke komentování.
      const note = sanitizePromptField(currentMealNote, 300);
      if (note) {
        sections.push(
          `  [Poznámka klientky k tomuto jídlu – ber ji jen jako kontext ke způsobu přípravy (olej/tuk/úprava), nekomentuj ji jako jídlo]: "${note}"`,
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

const GOAL_KEYS = ["goal_kcal", "goal_protein", "goal_carbs", "goal_fat", "goal_fiber"] as const;

// Vrátí cíle (goal_kcal, _protein, _carbs, _fat, _fiber) platné pro daný den
// pro danou klientku — vezme nejnovější řádek v goal_history s date <= isoDate.
// Klíče, pro které není v history žádný řádek, zůstanou undefined a volající
// si je doplní z requestu nebo profilu.
//
// Vyžaduje admin (service_role) klienta — RLS by jinak vrátila prázdno.
// deno-lint-ignore no-explicit-any
export async function resolveGoalsForDate(admin: any, userId: string, isoDate: string) {
  const { data } = await admin
    .from("goal_history")
    .select("goal_kcal, goal_protein, goal_carbs, goal_fat, goal_fiber, date")
    .eq("user_id", userId)
    .lte("date", isoDate)
    .order("date", { ascending: true });
  const out: Record<string, number | undefined> = {};
  for (const row of (data || [])) {
    for (const key of GOAL_KEYS) {
      if (row[key] != null) out[key] = row[key];
    }
  }
  return out;
}

// ===== Volání Anthropic API + uložení komentáře (sdílené oběma funkcemi) =====

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type AiErrorKind =
  | "permanent" // 404 (vyřazený model), 400 — NEretryovat
  | "transient" // 429/5xx/timeout/síť — vyčerpány retry
  | "refusal" // model odmítl
  | "max_tokens" // odpověď se usekla na limitu
  | "empty" // prázdný text
  | null;

export interface AiOutcome {
  comment: string | null;
  usage: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number } | null;
  stopReason: string | null;
  errorKind: AiErrorKind;
  errorDetail?: string;
}

// Když se text usekl na max_tokens, ořízni zpět k poslední dokončené větě,
// ať klientka nikdy nevidí půlku slova (pravidlo „vždy dokonči větu").
function trimToLastSentence(text: string): string {
  const t = text.trim();
  if (/[.!?)…]$/.test(t)) return t;
  const m = t.match(/^[\s\S]*[.!?…](?=[^.!?…]*$)/);
  return m ? m[0].trim() : t;
}

// Jedno volání Anthropicu s timeoutem. Vrací status + tělo, nebo síťovou chybu.
async function callAnthropicOnce(
  anthropicKey: string,
  systemPrompt: string,
  userPrompt: string,
): Promise<{ status: number; body: any } | { networkError: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: AI_MODEL,
        max_tokens: AI_MAX_TOKENS,
        system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: userPrompt }],
      }),
      signal: controller.signal,
    });
    const text = await res.text();
    let body: any;
    try {
      body = JSON.parse(text);
    } catch {
      body = { rawText: text.slice(0, 300) };
    }
    return { status: res.status, body };
  } catch (e) {
    return { networkError: String(e) };
  } finally {
    clearTimeout(timer);
  }
}

// Zavolá Anthropic s retry na přechodné chyby (429/5xx/timeout), rozliší
// trvalé selhání (404 vyřazený model — NEretryuje) a ošetří stop_reason.
export async function callAnthropic(
  anthropicKey: string,
  systemPrompt: string,
  userPrompt: string,
): Promise<AiOutcome> {
  let lastDetail = "";
  for (let attempt = 0; attempt <= AI_MAX_RETRIES; attempt++) {
    const r = await callAnthropicOnce(anthropicKey, systemPrompt, userPrompt);

    if ("networkError" in r) {
      lastDetail = `network: ${r.networkError}`;
      if (attempt < AI_MAX_RETRIES) await sleep(500 * 2 ** attempt);
      continue;
    }

    const { status, body } = r;

    if (status === 200) {
      const stopReason: string | null = body?.stop_reason ?? null;
      const usage = body?.usage
        ? {
          input: body.usage.input_tokens,
          output: body.usage.output_tokens,
          cacheRead: body.usage.cache_read_input_tokens,
          cacheWrite: body.usage.cache_creation_input_tokens,
        }
        : null;

      if (stopReason === "refusal") {
        return { comment: null, usage, stopReason, errorKind: "refusal" };
      }

      let rawText = "";
      for (const block of body?.content ?? []) {
        if (block?.type === "text" && typeof block.text === "string") rawText += block.text;
      }
      let cleaned = stripAiReasoning(rawText).slice(0, 250);
      if (stopReason === "max_tokens" && cleaned) cleaned = trimToLastSentence(cleaned);

      if (!cleaned) {
        return { comment: null, usage, stopReason, errorKind: "empty" };
      }
      return {
        comment: cleaned,
        usage,
        stopReason,
        errorKind: stopReason === "max_tokens" ? "max_tokens" : null,
      };
    }

    // 404 = vyřazený/špatný model, 400 = špatný request → trvalé, NEretryovat.
    if (status === 404 || status === 400 || status === 401 || status === 403) {
      return {
        comment: null,
        usage: null,
        stopReason: null,
        errorKind: "permanent",
        errorDetail: `HTTP ${status}: ${JSON.stringify(body).slice(0, 300)}`,
      };
    }

    // 429 / 5xx → přechodné, retryovat s backoffem.
    lastDetail = `HTTP ${status}: ${JSON.stringify(body).slice(0, 300)}`;
    if (attempt < AI_MAX_RETRIES) await sleep(500 * 2 ** attempt);
  }

  return { comment: null, usage: null, stopReason: null, errorKind: "transient", errorDetail: lastDetail };
}

// Vygeneruje komentář k jednomu jídlu, uloží ho do trainer_comments a zaloguje
// do ai_comment_log (i selhání — ať jde dohledat, proč komentář chybí).
// raw_response je zeštíhlené (usage + stop_reason), ne celé tělo odpovědi.
export async function generateAndSaveComment(opts: {
  admin: SupabaseClient;
  anthropicKey: string;
  dayId: string;
  mealId: string;
  systemPrompt: string;
  userPrompt: string;
}): Promise<{ comment: string | null; commentId?: string; usage: AiOutcome["usage"]; errorKind: AiErrorKind; errorDetail?: string }> {
  const outcome = await callAnthropic(opts.anthropicKey, opts.systemPrompt, opts.userPrompt);

  if (!outcome.comment) {
    // Zaloguj i selhání (dřív se logoval jen úspěch → mezera v auditu i limitu).
    await opts.admin.from("ai_comment_log").insert({
      day_id: opts.dayId,
      meal_id: opts.mealId,
      model: AI_MODEL,
      raw_response: JSON.stringify({
        error: outcome.errorKind,
        detail: outcome.errorDetail?.slice(0, 300),
        stop_reason: outcome.stopReason,
      }),
    });
    return { comment: null, usage: outcome.usage, errorKind: outcome.errorKind, errorDetail: outcome.errorDetail };
  }

  const { data: commentData, error: dbError } = await opts.admin
    .from("trainer_comments")
    .upsert(
      {
        day_id: opts.dayId,
        meal_id: opts.mealId,
        comment_text: outcome.comment,
        author: "ai",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "day_id,meal_id" },
    )
    .select()
    .single();

  if (dbError) console.error("DB error saving comment:", dbError.message);

  await opts.admin.from("ai_comment_log").insert({
    day_id: opts.dayId,
    meal_id: opts.mealId,
    prompt_tokens: outcome.usage?.input,
    completion_tokens: outcome.usage?.output,
    model: AI_MODEL,
    raw_response: JSON.stringify({ usage: outcome.usage, stop_reason: outcome.stopReason }),
  });

  return { comment: outcome.comment, commentId: commentData?.id, usage: outcome.usage, errorKind: null };
}
