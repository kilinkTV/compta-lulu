import { buildPushPayload } from "@block65/webcrypto-web-push";

const CORS_ORIGIN = "https://kilinktv.github.io";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": CORS_ORIGIN,
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
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

    if (request.method === "POST" && url.pathname === "/auth/request-link") {
      return handleRequestLink(request, env);
    }

    if (request.method === "POST" && url.pathname === "/auth/verify") {
      return handleVerify(request, env);
    }

    if (request.method === "POST" && url.pathname === "/sync") {
      return handleSync(request, env);
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

/* ---- Authentification par lien magique + synchronisation ---- */

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() }
  });
}

function text(msg, status = 200) {
  return new Response(msg, { status, headers: corsHeaders() });
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

// Compteur simple (pas atomique, suffisant pour dissuader un abus grossier de ce service à faible trafic).
async function checkRateLimit(env, key, max, ttlSeconds) {
  const raw = await env.MAGICLINKS.get(key);
  const count = raw ? parseInt(raw, 10) : 0;
  if (count >= max) return false;
  await env.MAGICLINKS.put(key, String(count + 1), { expirationTtl: ttlSeconds });
  return true;
}

function randomToken() {
  return crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
}

async function sendMagicLinkEmail(env, email, link) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: env.MAIL_FROM || "Compta Lulu <onboarding@resend.dev>",
      to: [email],
      subject: "Connexion à Compta Lulu",
      html: `
        <p>Bonjour,</p>
        <p>Voici votre lien de connexion à Compta Lulu, valable 15 minutes :</p>
        <p><a href="${link}">Se connecter à Compta Lulu</a></p>
        <p>Si vous n'avez rien demandé, ignorez cet email.</p>
      `
    })
  });
  if (!res.ok) {
    console.error("resend error", res.status, await res.text());
    throw new Error("Envoi d'email impossible");
  }
}

async function handleRequestLink(request, env) {
  const body = await request.json().catch(() => null);
  const email = normalizeEmail(body && body.email);
  if (!email || !email.includes("@")) return text("Email invalide", 400);

  // Anti-abus : ce service n'est pas destiné à un usage public, mais son URL pourrait être découverte.
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  if (!(await checkRateLimit(env, `rateip:${ip}`, 10, 3600))) {
    return text("Trop de demandes, réessayez plus tard", 429);
  }
  const rateKey = `rate:${email}`;
  if (await env.MAGICLINKS.get(rateKey)) return json({ status: "wait" });
  await env.MAGICLINKS.put(rateKey, "1", { expirationTtl: 60 });

  const token = randomToken();
  await env.MAGICLINKS.put(`token:${token}`, email, { expirationTtl: 900 }); // 15 minutes

  const base = (body && body.appUrl) || "https://kilinktv.github.io/compta-lulu/";
  const link = `${base}${base.includes("?") ? "&" : "?"}magic=${token}`;
  await sendMagicLinkEmail(env, email, link);
  return json({ status: "sent" });
}

async function handleVerify(request, env) {
  const body = await request.json().catch(() => null);
  const token = body && body.token;
  if (!token) return text("Jeton manquant", 400);

  const key = `token:${token}`;
  const email = await env.MAGICLINKS.get(key);
  if (!email) return text("Lien invalide ou expiré", 401);
  await env.MAGICLINKS.delete(key); // usage unique

  const sessionToken = randomToken();
  await env.SESSIONS.put(`session:${sessionToken}`, email, { expirationTtl: 60 * 60 * 24 * 180 }); // 180 jours
  return json({ email, sessionToken });
}

async function requireSession(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return null;
  return env.SESSIONS.get(`session:${token}`);
}

async function handleSync(request, env) {
  const email = await requireSession(request, env);
  if (!email) return text("Non authentifié", 401);

  const body = await request.json().catch(() => null);
  if (!body || !body.data) return text("Requête invalide", 400);
  const clientUpdatedAt = body.updatedAt || "";

  const storedRaw = await env.SYNCDATA.get(`data:${email}`);
  const stored = storedRaw ? JSON.parse(storedRaw) : null;

  if (!stored || clientUpdatedAt > stored.updatedAt) {
    await env.SYNCDATA.put(`data:${email}`, JSON.stringify({ updatedAt: clientUpdatedAt, data: body.data }));
    return json({ newer: false });
  }
  if (stored.updatedAt > clientUpdatedAt) {
    return json({ newer: true, updatedAt: stored.updatedAt, data: stored.data });
  }
  return json({ newer: false });
}

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
