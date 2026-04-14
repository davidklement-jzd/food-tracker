// Called by Supabase Database Webhook on INSERT to profiles table.
// Sends an email notification to the trainer via Resend.

const TRAINER_EMAIL = "dava.klement@gmail.com";

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const payload = await req.json();
    const record = payload.record;

    if (!record || record.role === "trainer") {
      return new Response(JSON.stringify({ skipped: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const clientName = record.display_name || "Bez jmena";
    const clientEmail = record.email || "neznamy email";
    const now = new Date().toLocaleString("cs-CZ");

    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) {
      console.error("RESEND_API_KEY not set");
      return new Response(JSON.stringify({ error: "Missing RESEND_API_KEY" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

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
        subject: "Nova klientka: " + clientName,
        html: htmlBody,
      }),
    });

    if (!emailRes.ok) {
      const errBody = await emailRes.text();
      console.error("Resend error:", emailRes.status, errBody);
      return new Response(JSON.stringify({ error: "Email send failed" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    console.log("Notification sent for new client: " + clientName);
    return new Response(JSON.stringify({ sent: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("notify-new-client error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
