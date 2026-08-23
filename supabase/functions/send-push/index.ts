import "jsr:@supabase/functions-js@2.4.4/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import webpush from "npm:web-push@3.6.7";

const cors = {
  "Access-Control-Allow-Origin": "https://ahmadok12.github.io",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Cache-Control": "no-store"
};

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

async function pushConfig() {
  let { data, error } = await admin.rpc("get_push_config");
  if (error) throw error;
  let config = data?.[0];
  if (!config) {
    const generated = webpush.generateVAPIDKeys();
    const saved = await admin.rpc("set_push_config", { p_public_key: generated.publicKey, p_private_key: generated.privateKey });
    if (saved.error) throw saved.error;
    ({ data, error } = await admin.rpc("get_push_config"));
    if (error) throw error;
    config = data?.[0];
  }
  if (!config) throw new Error("Push configuration is unavailable");
  return config;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  try {
    const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: { user }, error: authError } = await admin.auth.getUser(token);
    if (authError || !user) return json({ error: "Sign in is required" }, 401);
    const config = await pushConfig();
    if (request.method === "GET") return json({ publicKey: config.public_key });
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const input = await request.json().catch(() => ({}));
    const inquiryId = String(input.inquiry_id || ""), kind = String(input.kind || "");
    const allowedKinds = new Set(["new_inquiry", "comment", "task_done", "task_assigned"]);
    if (!/^[0-9a-f-]{36}$/i.test(inquiryId) || !allowedKinds.has(kind)) return json({ error: "Invalid notification event" }, 400);
    const cutoff = new Date(Date.now() - 120000).toISOString();
    const { data: pending, error: pendingError } = await admin.from("notifications").select("id").eq("actor_id", user.id).eq("inquiry_id", inquiryId).eq("kind", kind).is("push_sent_at", null).gte("created_at", cutoff).limit(100);
    if (pendingError) throw pendingError;

    webpush.setVapidDetails("https://ahmadok12.github.io/SCS-Task-Manager/", config.public_key, config.private_key);
    let delivered = 0;
    for (const pendingNotification of pending || []) {
      const { data: claim, error } = await admin.rpc("claim_push_notification", { p_notification_id: pendingNotification.id });
      if (error) throw error;
      if (!claim) continue;
      const payload = JSON.stringify({ title: claim.notification.title, body: claim.notification.message, icon: "https://ahmadok12.github.io/SCS-Task-Manager/assets/icon-192.png", badge: "https://ahmadok12.github.io/SCS-Task-Manager/assets/icon-192.png", url: `https://ahmadok12.github.io/SCS-Task-Manager/?inquiry=${claim.notification.inquiry_id}`, inquiryId: claim.notification.inquiry_id, tag: claim.notification.id });
      await Promise.all((claim.subscriptions || []).map(async (subscription: { id: string; endpoint: string; keys: { p256dh: string; auth: string } }) => {
        try { await webpush.sendNotification({ endpoint: subscription.endpoint, keys: subscription.keys }, payload, { TTL: 3600 }); delivered += 1; }
        catch (pushError) { const status = Number((pushError as { statusCode?: number }).statusCode || 0); if (status === 404 || status === 410) await admin.rpc("remove_push_subscription", { p_subscription_id: subscription.id }); }
      }));
    }
    return json({ delivered });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Push delivery failed" }, 500);
  }
});

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8" } });
}
