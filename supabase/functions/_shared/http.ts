// Shared HTTP helpers: CORS, auth, rate limiting, input sanitization.
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// ===== AI konfigurace — JEDINÝ zdroj pravdy pro model a parametry =====
// Model přes env, ať jde měnit bez deploye kódu (a ať tu není natvrdo na 4
// místech). Když bude model vyřazen, stačí přenastavit AI_MODEL secret.
// Od 2026-09-06 Opus 5 (slepý A/B test 30 dnů vs. Sonnet 5 a Sonnet 4.6:
// jediný, který drží bilanci bílkovin 1× za den, nepíše výhledy do dalších
// jídel a nedělá tvrdé jazykové chyby). Rollback = secret AI_MODEL=claude-sonnet-4-6.
export const AI_MODEL = Deno.env.get("AI_MODEL") ?? "claude-opus-5";
// 250 znaků češtiny ≈ 110–150 tokenů na tokenizéru Opus 5 (o ~1/4 hustší než
// Sonnet 4.6); 300 dává rezervu na dokončení věty. Tvrdý strop 250 znaků
// zůstává v čištění výstupu.
export const AI_MAX_TOKENS = Number(Deno.env.get("AI_MAX_TOKENS") ?? "300");
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

// Únik vnitřního uvažování, který nemá žádný marker sebeopravy ("Wait",
// "Opravím"), a projde proto přes stripAiReasoning níž. Dva reálné případy:
//
//   a) model nahlas popisuje, JAK si ověřuje pravidlo, a teprve za tím napíše
//      komentář:
//      "Bambus tyčinka - zkontroluju poměr: 15g B na 201 kcal. Pravidlo je 15g
//       B do 200 kcal - těsně nesplňuje. Doporučit Sportness. Tyčinka má lehce
//       slabší poměr bílkovin ke kaloriím. Příště zkuste Sportness z DMka."
//
//   b) model si nahlas plánuje, co a jak dlouze napíše - a to i UPROSTŘED věty
//      a na KONCI komentáře:
//      "Kolagen hezky doplňuje svačinu, jedna věta za zmínku - budu ho vždy
//       chválit. Kokos-rýžový nápoj není problém, ale na bílkoviny toho moc
//       nedá. Mass gainer a kolagen to zachraňují. Přemýšlím, co má smysl
//       zmínit."
//
// Kvůli (b) neořezáváme jen prefix: meta-věty vyhazujeme kdekoliv v textu a
// uvnitř věty ořízneme od první meta-vsuvky dál. Ze druhého případu tak zbyde
// "Kolagen hezky doplňuje svačinu. Kokos-rýžový nápoj není problém, ale na
// bílkoviny toho moc nedá. Mass gainer a kolagen to zachraňují."
//
// Vzory musí být takové, které se v normálním komentáři klientce NEVYSKYTNOU.
// Proto tu ZÁMĚRNĚ není "budu vždy chválit" - to je Davidova hláška u tvarůžků
// a vývaru (viz styleGuide § 12) a filtr by ji vyhodil.
const DELIBERATION_PATTERNS: RegExp[] = [
  // Kontrola v 1. osobě: "zkontroluju poměr", "ověřím si", "spočítám", "porovnám".
  /\b(zkontroluj[iu]|ov[eě][řr][íi]m|spo[čc][íi]t[áa]m|porovn[áa]m|pod[íi]v[áa]m\s+se)\b/i,
  // Přemýšlení nahlas: "Přemýšlím, co zmínit", "zvažuju", "říkám si".
  /\b(p[řr]em[ýy][šs]l[íi]m|zva[žz]uj[iu]|rozm[ýy][šs]l[íi]m|[řr][íi]k[áa]m\s+si)\b/i,
  // Rozvaha, co do komentáře pustit: "co má smysl zmínit", "co ještě řešit".
  /\bco\s+(je[šs]t[ěe]\s+|u[žz]\s+)?(m[áa]|nem[áa])\s+smysl\s+(zm[íi]nit|[řr]e[šs]it|ps[áa]t|komentovat)\b/i,
  // Citace pravidla klientce: "Pravidlo je 15g B do 200 kcal", "nesplňuje pravidlo".
  /\bpravidl[oau]\b/i,
  // Meta o délce vlastního textu: "jedna věta za zmínku", "krátce jednou větou".
  /\b(jedn[au]|jednou|kr[áa]tk[áou]|prvn[íi])\s+v[ěe]t(a|u|ou|ě)\b/i,
  /(?<!stoj[íi]\s)\bza\s+zm[íi]nku\b/i,
  // Model mluví o komentáři jako o objektu: "do komentáře", "tenhle komentář".
  /\bkoment[áa][řr](i|e|em|[ůu]|[íi]ch|[íi]ky?)?\b/i,
  // Poznámka pro sebe v infinitivu jako celý úsek: "Doporučit Sportness."
  /^\s*(doporu[čc]it|upozornit|pochv[áa]lit|nechv[áa]lit|ne[řr]e[šs]it|zm[íi]nit|nezm[íi]nit|nab[íi]dnout|navrhnout|nepsat|napsat|p[řr]ej[íi]t)\b/i,
];

const isDeliberation = (s: string) => DELIBERATION_PATTERNS.some((re) => re.test(s));

// Nejkratší text, který ještě pustíme ke klientce. Když po odstranění meta-vět
// zbyde míň, vrátíme prázdno - komentář se pak zaloguje jako "empty" a David ho
// vygeneruje znovu. Ukázat klientce, jak model přemýšlí, je horší než chybějící
// komentář.
const MIN_KEPT_LENGTH = 20;

// Zbytek věty před meta-vsuvkou musí dávat smysl sám o sobě. Z "Bambus tyčinka
// - zkontroluju poměr..." nechceme nechat holé "Bambus tyčinka." - kratší
// útržek zahodíme celý.
const MIN_KEPT_CLAUSE_LENGTH = 15;

// Ořízne větu od první meta-vsuvky dál. Vrací "" (celá věta je meta),
// nebo její čistý začátek zakončený tečkou.
function stripDeliberationFromSentence(sentence: string): string {
  // Rozpad na vsuvky: čárka nebo pomlčka mezi myšlenkami. Oddělovače držíme
  // v poli (liché indexy), ať zachovaná část vypadá přesně jako v originále.
  const parts = sentence.split(/(,\s*|\s+[-–—]\s+)/);
  let cut = -1;
  for (let i = 0; i < parts.length; i += 2) {
    if (isDeliberation(parts[i])) {
      cut = i;
      break;
    }
  }
  if (cut === -1) return sentence.trim();
  if (cut === 0) return "";

  const kept = parts.slice(0, cut).join("").replace(/[\s,;:–—-]+$/, "").trim();
  if (kept.length < MIN_KEPT_CLAUSE_LENGTH) return "";
  return /[.!?…]$/.test(kept) ? kept : `${kept}.`;
}

export function stripDeliberation(text: string): string {
  const t = (text || "").trim();
  if (!t) return t;

  // Dělíme po větách. Tečka uvnitř čísla ("201.5 kcal") se nedělí, protože
  // vyžadujeme mezeru za interpunkcí.
  const sentences = t.split(/(?<=[.!?])\s+/);
  const kept = sentences.map(stripDeliberationFromSentence).filter(Boolean);
  const out = kept.join(" ").trim();

  if (out === t) return t;

  console.warn("[ai] uvažování v komentáři, ořezáno:", JSON.stringify(t.slice(0, 200)));
  // Když ze zbytku zbyl jen útržek, radši nic než půlka věty nebo meta text.
  return out.length >= MIN_KEPT_LENGTH ? out : "";
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

  // Nejdřív pryč s „přemýšlením nahlas" bez markeru sebeopravy (viz výš).
  t = stripDeliberation(t);
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

// Server-side pojistka na dlouhou pomlčku. Em dash „—" i en dash „–" jsou
// typický znak strojově psaného textu a prozrazují klientce, že komentář psala
// AI. StyleGuide to modelu zakazuje, ale ne vždy poslechne — tady to natvrdo
// přepíšeme na obyčejný spojovník „-". Kolabujeme i případné mezery kolem, ať
// z „ — " nevznikne „ - " s dvojitou mezerou.
export function normalizeDashes(text: string): string {
  return (text || "")
    // Rozsah mezi číslicemi „90–110" → „90-110" (bez mezer).
    .replace(/(\d)\s*[—–]\s*(\d)/g, "$1-$2")
    // Ostatní dlouhé pomlčky (vsuvka mezi myšlenkami) → „ - " s mezerami.
    .replace(/\s*[—–]\s*/g, " - ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// Server-side pojistka na cizí písmo. Model občas uprostřed českého slova
// „přepne skript" a napíše pár písmen azbukou („100 g eидamu" místo
// „eidamu"). Klientce to připadá jako rozbitá aplikace, takže to tady
// přepíšeme zpátky na latinku.
//
// Mapujeme FONETICKY (и→i, д→d, ч→č), NE podle vzhledu (и nevypadá jako „i").
// Model totiž sáhne po znaku se stejnou hláskou, ne se stejným tvarem —
// proto с→s a ne c, р→r a ne p, х→ch a ne x.
const FOREIGN_LETTER_MAP: Record<string, string> = {
  // Azbuka — malá písmena
  "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "e",
  "ж": "ž", "з": "z", "и": "i", "і": "i", "ї": "i", "й": "j", "к": "k",
  "л": "l", "м": "m", "н": "n", "о": "o", "п": "p", "р": "r", "с": "s",
  "т": "t", "у": "u", "ф": "f", "х": "ch", "ц": "c", "ч": "č", "ш": "š",
  "щ": "š", "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "u", "я": "a",
  "є": "e", "ґ": "g",
  // Azbuka — velká písmena
  "А": "A", "Б": "B", "В": "V", "Г": "G", "Д": "D", "Е": "E", "Ё": "E",
  "Ж": "Ž", "З": "Z", "И": "I", "І": "I", "Ї": "I", "Й": "J", "К": "K",
  "Л": "L", "М": "M", "Н": "N", "О": "O", "П": "P", "Р": "R", "С": "S",
  "Т": "T", "У": "U", "Ф": "F", "Х": "Ch", "Ц": "C", "Ч": "Č", "Ш": "Š",
  "Щ": "Š", "Ы": "Y", "Э": "E", "Ю": "U", "Я": "A", "Є": "E", "Ґ": "G",
  // Řečtina (vzácnější, ale stejný typ přepnutí písma)
  "α": "a", "β": "b", "γ": "g", "δ": "d", "ε": "e", "ζ": "z", "η": "e",
  "θ": "t", "ι": "i", "κ": "k", "λ": "l", "μ": "m", "ν": "n", "ξ": "x",
  "ο": "o", "π": "p", "ρ": "r", "σ": "s", "ς": "s", "τ": "t", "υ": "u",
  "φ": "f", "χ": "ch", "ψ": "ps", "ω": "o",
  "Α": "A", "Β": "B", "Γ": "G", "Δ": "D", "Ε": "E", "Ζ": "Z", "Η": "E",
  "Θ": "T", "Ι": "I", "Κ": "K", "Λ": "L", "Μ": "M", "Ν": "N", "Ξ": "X",
  "Ο": "O", "Π": "P", "Ρ": "R", "Σ": "S", "Τ": "T", "Υ": "U", "Φ": "F",
  "Χ": "Ch", "Ψ": "Ps", "Ω": "O",
};

// Latinka + Common (číslice, interpunkce, emoji) + Inherited (háčky a čárky)
// je všechno, co v českém komentáři smí být. Cokoliv jiného je průšvih.
const NON_LATIN_RE = /[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u;

export function normalizeForeignScript(text: string): string {
  const t = text || "";
  if (!t || !NON_LATIN_RE.test(t)) return t;

  let out = "";
  for (const ch of t) {
    const mapped = FOREIGN_LETTER_MAP[ch];
    if (mapped !== undefined) {
      out += mapped;
      continue;
    }
    // Písmeno jiného písma, které neumíme přepsat (čínština, arabština…):
    // zahodit. Díra ve slově je pořád lepší než „中" v komentáři klientce.
    if (/\p{L}/u.test(ch) && !/\p{Script=Latin}/u.test(ch)) continue;
    out += ch;
  }
  out = out.replace(/\s{2,}/g, " ").trim();

  if (out !== t) {
    console.warn("[ai] cizí písmo v komentáři, opraveno:", JSON.stringify(t.slice(0, 120)));
  }
  return out;
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
  // Uložené jídlo: řádky se stejným group_id patří k jednomu jídlu (group_name).
  group_id?: unknown;
  group_name?: unknown;
}

// Komentář z dřívějšího dne téže klientky - jen text, ať model neopakuje
// doslova stejné věty a rady napříč dny (jídla z těch dnů nevidí, nemá je hodnotit).
export interface PriorComment {
  date: string; // ISO YYYY-MM-DD
  mealId: string;
  text: string;
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
  // Komentáře z předchozích dnů (viz fetchPriorDayComments). Volitelné.
  priorComments?: PriorComment[];
}

// Deterministická detekce alkoholu v položkách jídla. Slouží jen jako pojistka
// k pravidlu „když jsou kalorie v červeném, alkohol nechválit" — proto je
// seznam radši širší a výjimky (hroznové víno = ovoce, nealko pivo, vinný ocet)
// se odfiltrují dopředu.
const ALCOHOL_EXCLUDE_RE =
  /nealko|nealkoholi|bez alkoholu|0[,.]0\s*%|hroznov\S*\s+v[íi]n|vinn\S*\s+oc(et|ta|tem)|rumov\S*\s+(esence|aroma)|pivn\S*\s+kvasnice|pivovarsk/i;
const ALCOHOL_RE =
  /prosecc?o|prosekko|šampa[ňn]|champagne|sekt\b|cava\b|v[íi]n(o|a|em|u)\b|v[íi]nn[ýá] st[řr]ik|pivo\b|piva\b|pivem\b|radler|cider|cidre|medovina|sva[řr][áa]k|sva[řr]en[ée]|pun[čc]\b|rum\b|whisk|vodka|gin\b|tequil|liké?r\b|aperol|spritz|mojito|becherovka|slivovice|fernet|ko[ňn]ak|brandy|absint|martini\b|campari|portsk|sangria/i;

function hasAlcohol(list: DayEntry[]): boolean {
  return list.some((e) => {
    const text = `${String(e.name ?? "")} ${String(e.group_name ?? "")}`;
    if (!text.trim()) return false;
    if (ALCOHOL_EXCLUDE_RE.test(text)) return false;
    return ALCOHOL_RE.test(text);
  });
}

// Builds the user prompt for generating a comment about a specific meal,
// with full-day context and previously written comments so the AI doesn't
// repeat itself and can reference earlier meals.
export function buildDayContextPrompt(input: BuildDayContextInput): string {
  const { clientName, goalKcal, goalProtein, goalCarbs, goalFat, goalFiber, entries, comments, currentMealId, currentMealNote, priorComments } = input;

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
      // Detailed list for the meal being commented. Uložená jídla (řádky se
      // stejným group_id) vypíšeme jako jednu položku (název + celkové makra) a
      // pod ní odsazené suroviny, ať AI pozná, že jde o jedno jídlo z více
      // surovin, a umí se dostat k jeho složení.
      const units: Array<{ group: boolean; name?: string; items: DayEntry[] }> = [];
      const groupIdx = new Map<string, number>();
      for (const e of list) {
        const gid = typeof e.group_id === "string" ? e.group_id : null;
        if (gid) {
          if (groupIdx.has(gid)) {
            units[groupIdx.get(gid) as number].items.push(e);
          } else {
            groupIdx.set(gid, units.length);
            units.push({
              group: true,
              name: sanitizePromptField(e.group_name, 80) || "Uložené jídlo",
              items: [e],
            });
          }
        } else {
          units.push({ group: false, items: [e] });
        }
      }
      for (const u of units) {
        if (u.group) {
          const gt = u.items.reduce(
            (acc, e) => ({
              grams: acc.grams + safeNumber(e.grams),
              kcal: acc.kcal + safeNumber(e.kcal),
              protein: acc.protein + safeNumber(e.protein),
              carbs: acc.carbs + safeNumber(e.carbs),
              fat: acc.fat + safeNumber(e.fat),
              fiber: acc.fiber + safeNumber(e.fiber),
            }),
            { grams: 0, kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 },
          );
          sections.push(
            `  - [Uložené jídlo klientky: "${u.name}"] celkem ${Math.round(gt.grams)}g, ${Math.round(gt.kcal)} kcal, ${Math.round(gt.protein)}g B, ${Math.round(gt.carbs)}g S, ${Math.round(gt.fat)}g T, ${Math.round(gt.fiber)}g V — složeno ze surovin:`,
          );
          for (const e of u.items) {
            const name = sanitizePromptField(e.name, 80);
            sections.push(
              `      · ${name}: ${safeNumber(e.grams)}g, ${safeNumber(e.kcal)} kcal, ${safeNumber(e.protein)}g B, ${safeNumber(e.carbs)}g S, ${safeNumber(e.fat)}g T, ${safeNumber(e.fiber)}g V`,
            );
          }
        } else {
          const e = u.items[0];
          const name = sanitizePromptField(e.name, 80);
          sections.push(
            `  - ${name}: ${safeNumber(e.grams)}g, ${safeNumber(e.kcal)} kcal, ${safeNumber(e.protein)}g B, ${safeNumber(e.carbs)}g S, ${safeNumber(e.fat)}g T, ${safeNumber(e.fiber)}g V`,
          );
        }
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

  // Komentáře z předchozích dnů: model jinak nevidí, co klientce psal včera,
  // a stejnou hlášku („Tvarůžky jsou naprostá jednička") jí pošle tři dny po
  // sobě. Jen texty - jídla těch dnů sem nepatří, nemá je hodnotit.
  if (priorComments && priorComments.length > 0) {
    const fmtDate = (iso: string) => {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
      return m ? `${Number(m[3])}. ${Number(m[2])}.` : iso;
    };
    sections.push(
      `Vaše komentáře této klientce z předchozích dnů (jen pro kontext - ty dny jsou vyřízené, nehodnoťte je):`,
    );
    for (const pc of priorComments.slice(0, 12)) {
      const text = sanitizePromptField(pc.text, 220);
      if (!text) continue;
      sections.push(`  - ${fmtDate(pc.date)}, ${MEAL_LABELS[pc.mealId] || pc.mealId}: "${text}"`);
    }
    sections.push(
      `⚠️ Nepoužijte doslova stejnou větu ani stejnou hlášku, která výše už padla (tvarůžky, vývar, vajíčka, ovoce, brambory apod.), a neopakujte stejnou radu. Řekněte to jinými slovy, nebo u dnešního jídla vyberte jinou myšlenku.`,
    );
    sections.push("");
  }

  // Deterministická pojistka na „přepis jen jednou za den": pokud už některý
  // dřívější komentář dne o přepisu psal, model se na to nesmí spolehnout, že si
  // toho sám všimne — dostane tvrdý zákaz. „Přepis" je vyhrazen výhradně pro
  // kalorický nadbytek, takže výskyt slova v jiném komentáři = přepis už padl.
  const rewriteAlreadyMentioned = Object.entries(comments).some(
    ([mealId, text]) =>
      mealId !== currentMealId && /přepis|přeps|přepíš/i.test(text || ""),
  );
  if (rewriteAlreadyMentioned) {
    sections.push(
      `⚠️ POZOR: Zmínka o kalorickém PŘEPISU už dnes v dřívějším komentáři zazněla. V TOMTO komentáři ji NEOPAKUJ — žádné „udělám přepis" / „musím přepsat" / „kalorie jsou přes". O přepisu se píše POUZE JEDNOU za den. Drž se samotného jídla a kalorie už dál nehodnoť.`,
    );
    sections.push("");
  }

  // Deterministická pojistka: „přepis" je VÝHRADNĚ reakce na nadbytek CELKOVÝCH
  // kalorií (kcal v červeném, > 110 %). Model občas napíše přepis i tehdy, když
  // jsou přes jen sacharidy nebo tuky, ale celkové kcal jsou v zeleném. Když
  // tedy kalorie NEJSOU v červeném, dostane tvrdý zákaz o přepisu psát —
  // barvy sacharidů/tuků/bílkovin na to nemají žádný vliv.
  if (kcalPct <= 110) {
    sections.push(
      `⚠️ POZOR: Celkové kalorie dnes NEJSOU v červeném (${kcalPct} % cíle). V TOMTO komentáři proto NESMÍ padnout ani slovo o přepisu — žádné „udělám přepis" / „musím přepsat" / „kalorie jsou přes". Přepis se píše VÝHRADNĚ při nadbytku CELKOVÝCH kalorií (> 110 %). To, že jsou přes sacharidy nebo tuky (červené kolečko u makra), přepis NESPOUŠTÍ — pokud je to relevantní, jen to věcně konstatuj, bez přepisu.`,
    );
    sections.push("");
  }

  // Deterministická pojistka na alkohol. Style guide dovoluje alkohol pochválit
  // („za odměnu v pohodě") jen tehdy, když platí OBĚ podmínky zároveň: kalorie
  // v zeleném (≤ 110 %) A denní bílkoviny splněné (≥ 100 %). Model si sám hlídal
  // jen kalorie, takže chválil i dny, kde bílkoviny nedošly (Prosecco při 95 %
  // bílkovin, pivo při 55 %). Když kterákoliv podmínka padne, dostane tvrdý zákaz.
  if (hasAlcohol(byMeal[currentMealId] || []) && (kcalPct > 110 || proteinPct < 100)) {
    const duvod = kcalPct > 110 && proteinPct < 100
      ? `celkové kalorie jsou v ČERVENÉM (${kcalPct} % cíle) a bílkoviny za den nedošly (${proteinPct} %)`
      : kcalPct > 110
      ? `celkové kalorie jsou v ČERVENÉM (${kcalPct} % cíle)`
      : `bílkoviny za den nedošly (${proteinPct} % cíle, pochvala alkoholu vyžaduje 100 % a víc)`;
    sections.push(
      `⚠️ POZOR: V tomto jídle je alkohol a ${duvod}. Alkohol proto NECHVÁLIT a NEPREZENTOVAT jako odměnu — zakázané formulace: „vlezlo se", „vešlo se", „v pohodě", „za odměnu", „zasloužená", „na místě", „užijte si", „příjemný večer". Zároveň žádné kázání ani moralizování, alkohol není terč: buď ho zmiň věcně, nebo o něm nepiš vůbec a zhodnoť zbytek jídla.`,
    );
    sections.push("");
  }

  sections.push(
    `Napište komentář k jídlu [${MEAL_LABELS[currentMealId] || currentMealId}] (max 250 znaků). Vezměte v potaz kontext celého dne a neopakujte doporučení, která už zaznívají v předchozích komentářích. Pokud na ně chcete navázat, klidně to udělejte přirozeně.`,
  );

  return sections.join("\n");
}

// Načte komentáře (AI i trenérovy) téže klientky z posledních `days`
// zapsaných dnů PŘED isoDate. Vrací je chronologicky (nejstarší první),
// v pořadí jídel. Chyba dotazu = prázdné pole - kontext z minulých dnů je
// bonus, nesmí shodit generování. Vyžaduje admin (service_role) klienta.
export async function fetchPriorDayComments(
  admin: any,
  userId: string,
  isoDate: string,
  days = 2,
): Promise<PriorComment[]> {
  try {
    const { data: prevDays, error: e1 } = await admin
      .from("diary_days")
      .select("id, date")
      .eq("user_id", userId)
      .lt("date", isoDate)
      .order("date", { ascending: false })
      .limit(days);
    if (e1 || !prevDays || prevDays.length === 0) return [];
    const dateById: Record<string, string> = {};
    for (const d of prevDays) dateById[d.id] = d.date;
    const { data: rows, error: e2 } = await admin
      .from("trainer_comments")
      .select("day_id, meal_id, comment_text")
      .in("day_id", prevDays.map((d: { id: string }) => d.id));
    if (e2 || !rows) return [];
    const mealIdx = (m: string) => {
      const i = MEAL_ORDER.indexOf(m as (typeof MEAL_ORDER)[number]);
      return i === -1 ? 99 : i;
    };
    return rows
      .filter((r: { comment_text?: string }) => typeof r.comment_text === "string" && r.comment_text.trim())
      .map((r: { day_id: string; meal_id: string; comment_text: string }) => ({
        date: dateById[r.day_id],
        mealId: r.meal_id,
        text: r.comment_text,
      }))
      .sort((a: PriorComment, b: PriorComment) =>
        a.date === b.date ? mealIdx(a.mealId) - mealIdx(b.mealId) : a.date.localeCompare(b.date)
      );
  } catch (err) {
    console.warn("fetchPriorDayComments failed, continuing without prior context:", err);
    return [];
  }
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
        // Opus 5 / Sonnet 5 mají přemýšlení zapnuté ve výchozím stavu. Pro
        // 250znakový komentář ho nechceme: tokeny přemýšlení se účtují jako
        // výstup a počítají se do max_tokens, takže by komentář ani nevznikl.
        // Sonnet 4.6 hodnotu "disabled" přijme taky (rollback bez změny kódu).
        thinking: { type: "disabled" },
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
      // S vypnutým přemýšlením může Opus 5 výjimečně propustit <thinking> tagy
      // do textu - vyhodit i s obsahem, klientka nesmí vidět postup.
      rawText = rawText.replace(/<thinking>[\s\S]*?(<\/thinking>|$)/gi, "").replace(/<\/?thinking>/gi, "").trim();
      let cleaned = normalizeDashes(stripAiReasoning(normalizeForeignScript(rawText))).slice(0, 250);
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
