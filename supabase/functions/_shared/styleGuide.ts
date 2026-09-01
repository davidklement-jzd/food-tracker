// Přepínač verze systémového promptu pro AI komentáře.
//
// Načítají si ho `generate-comment` i `generate-all-comments` - obě importují
// jen SYSTEM_PROMPT a o verzích nevědí.
//
//   STYLE_GUIDE=new  (výchozí) -> styleGuide.v2.ts     — aktivní, tady se edituje
//   STYLE_GUIDE=old             -> styleGuide.legacy.ts — baseline 2026-09-01, needitovat
//
// Rollback bez deploye kódu:
//   supabase secrets set STYLE_GUIDE=old
// Zpátky na novou verzi:
//   supabase secrets set STYLE_GUIDE=new
//
// Verze se loguje při startu funkce, ať je v logu vidět, co reálně běželo.

import { SYSTEM_PROMPT_V2 } from "./styleGuide.v2.ts";
import { SYSTEM_PROMPT_LEGACY } from "./styleGuide.legacy.ts";

const raw = (Deno.env.get("STYLE_GUIDE") ?? "new").trim().toLowerCase();

// Neznámou hodnotu bereme jako "new" - překlep v secretu nesmí shodit generování.
export const STYLE_GUIDE_VERSION: "new" | "old" = raw === "old" ? "old" : "new";

if (raw !== STYLE_GUIDE_VERSION) {
  console.warn(`STYLE_GUIDE="${raw}" není známá hodnota (new|old), používám "new".`);
}
console.log(`Style guide: ${STYLE_GUIDE_VERSION}`);

export const SYSTEM_PROMPT = STYLE_GUIDE_VERSION === "old"
  ? SYSTEM_PROMPT_LEGACY
  : SYSTEM_PROMPT_V2;
