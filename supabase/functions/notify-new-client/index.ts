// Called by Supabase Database Webhook on INSERT to profiles table.
// Sends an email notification to the trainer via Resend.
//
// BEZPEČNOST:
//  - Data o klientce se čtou z DB (service role) podle record.id, NE z těla
//    requestu. Payload je nedůvěryhodný (funkci může s platným JWT zavolat
//    kdokoli), takže jménu/e-mailu z něj nevěříme.
//  - Vše, co jde do HTML e-mailu, se escapuje (dřív šel display_name/email
//    nescapovaně do těla → HTML injection do schránky trenéra).
//  - Volitelný sdílený secret: když je nastavený env NOTIFY_WEBHOOK_SECRET,
//    musí request poslat shodnou hlavičku `x-notify-secret` (nastav ji v
//    konfiguraci DB webhooku). Dokud secret nastavený není, kontrola se
//    přeskočí, aby nasazení nerozbilo notifikace.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TRAINER_EMAIL = "dava.klement@gmail.com";

function htmlEscape(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    // Volitelný sdílený secret (fail-open, dokud není nastavený).
    const expectedSecret = Deno.env.get("NOTIFY_WEBHOOK_SECRET");
    if (expectedSecret) {
      const got = req.headers.get("x-notify-secret") || "";
      if (got !== expectedSecret) {
        console.warn("notify-new-client: neplatný nebo chybějící secret");
        return json({ error: "Unauthorized" }, 401);
      }
    }

    const payload = await req.json().catch(() => null);
    const recordId = payload?.record?.id;
    if (!recordId || typeof recordId !== "string") {
      return json({ skipped: true, reason: "no record id" }, 200);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) {
      console.error("Missing Supabase env vars");
      return json({ error: "Server misconfigured" }, 500);
    }

    // Autoritativní data z DB, ne z payloadu.
    const admin = createClient(supabaseUrl, serviceKey);
    const { data: profile, error } = await admin
      .from("profiles")
      .select("display_name, email, role")
      .eq("id", recordId)
      .single();

    if (error || !profile || profile.role === "trainer") {
      return json({ skipped: true }, 200);
    }

    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) {
      console.error("RESEND_API_KEY not set");
      return json({ error: "Missing RESEND_API_KEY" }, 500);
    }

    const clientName = htmlEscape(profile.display_name || "Bez jmena");
    const clientEmail = htmlEscape(profile.email || "neznamy email");
    const now = htmlEscape(new Date().toLocaleString("cs-CZ"));

    const htmlBody = [
      "<h2>Nova registrace v aplikaci</h2>",
      "<p><strong>Jmeno:</strong> " + clientName + "</p>",
      "<p><strong>Email:</strong> " + clientEmail + "</p>",
      "<p><strong>Datum:</strong> " + now + "</p>",
      "<br>",
      '<p style="color: #888; font-size: 13px;">Tento email byl odeslan automaticky z aplikace Jak na zdrave telo.</p>',
    ].join("\n");

    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + resendKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Food Tracker <onboarding@resend.dev>",
        to: [TRAINER_EMAIL],
        subject: "Nova klientka: " + (profile.display_name || "Bez jmena"),
        html: htmlBody,
      }),
    });

    if (!emailRes.ok) {
      const errBody = await emailRes.text();
      console.error("Resend error:", emailRes.status, errBody);
      return json({ error: "Email send failed" }, 500);
    }

    console.log("Notification sent for new client:", recordId);
    return json({ sent: true }, 200);
  } catch (err) {
    console.error("notify-new-client error:", err);
    return json({ error: "Internal server error" }, 500);
  }
});
