import {
  corsHeadersFor,
  isUuid,
  jsonResponse,
  requireTrainer,
} from "../_shared/http.ts";

Deno.serve(async (req) => {
  const cors = corsHeadersFor(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, cors);
  }

  try {
    const auth = await requireTrainer(req, cors);
    if (auth instanceof Response) return auth;
    const { admin, userId: callerId } = auth;

    const body = await req.json().catch(() => null);
    const client_id = (body as Record<string, unknown> | null)?.client_id;
    if (!isUuid(client_id)) {
      return jsonResponse({ error: "Invalid client_id" }, 400, cors);
    }
    if (client_id === callerId) {
      console.warn("Trainer tried to delete self:", callerId);
      return jsonResponse({ error: "Cannot delete self" }, 400, cors);
    }

    const { data: targetProfile } = await admin
      .from("profiles")
      .select("role")
      .eq("id", client_id)
      .single();

    if (!targetProfile) {
      return jsonResponse({ error: "Client not found" }, 404, cors);
    }
    if (targetProfile.role === "trainer") {
      console.warn("Attempt to delete trainer by", callerId, "target", client_id);
      return jsonResponse({ error: "Cannot delete trainer" }, 403, cors);
    }

    console.log("delete-client: caller", callerId, "deleting", client_id);
    const { error: delErr } = await admin.auth.admin.deleteUser(client_id as string);
    if (delErr) {
      console.error("deleteUser error:", delErr.message);
      return jsonResponse({ error: "Delete failed" }, 500, cors);
    }

    return jsonResponse({ success: true }, 200, cors);
  } catch (err) {
    console.error("delete-client error:", err);
    return jsonResponse({ error: "Internal server error" }, 500, cors);
  }
});
