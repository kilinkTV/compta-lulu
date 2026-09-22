import { buildPushPayload } from "@block65/webcrypto-web-push";

const CORS_ORIGIN = "https://kilinktv.github.io";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": CORS_ORIGIN,
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    if (request.method === "POST" && url.pathname === "/subscribe") {
      const sub = await request.json().catch(() => null);
      if (!sub || !sub.endpoint || !sub.keys) {
        return new Response("Abonnement invalide", { status: 400, headers: corsHeaders() });
      }
      await env.SUBS.put(sub.endpoint, JSON.stringify(sub));
      return new Response("ok", { headers: corsHeaders() });
    }

    if (request.method === "POST" && url.pathname === "/unsubscribe") {
      const body = await request.json().catch(() => null);
      if (body && body.endpoint) await env.SUBS.delete(body.endpoint);
      return new Response("ok", { headers: corsHeaders() });
    }

    // Déclenchement manuel pour vérifier l'envoi sans attendre le 28 : /send-test?key=...
    if (request.method === "GET" && url.pathname === "/send-test") {
      if (url.searchParams.get("key") !== env.TEST_KEY) {
        return new Response("interdit", { status: 403, headers: corsHeaders() });
      }
      const sent = await sendReminders(env);
      return new Response(`envoyé à ${sent} abonnement(s)`, { headers: corsHeaders() });
    }

    return new Response("Compta Lulu — service de rappel", { status: 200, headers: corsHeaders() });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(sendReminders(env));
  }
};

async function sendReminders(env) {
  const vapid = {
    subject: env.VAPID_SUBJECT,
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY
  };
  const message = {
    data: JSON.stringify({
      title: "Compta Lulu",
      body: "C'est la fin du mois : pensez à valider vos recettes, dépenses et l'URSSAF."
    }),
    options: { ttl: 60 * 60 * 24 * 3 }
  };

  const list = await env.SUBS.list();
  let sent = 0;
  for (const k of list.keys) {
    const raw = await env.SUBS.get(k.name);
    if (!raw) continue;
    const sub = JSON.parse(raw);
    try {
      const payload = await buildPushPayload(message, sub, vapid);
      const res = await fetch(sub.endpoint, payload);
      if (res.status === 404 || res.status === 410) {
        await env.SUBS.delete(k.name);
      } else if (res.ok) {
        sent++;
      } else {
        console.error("push non-ok", k.name, res.status);
      }
    } catch (e) {
      console.error("push failed", k.name, e);
    }
  }
  return sent;
}
