# Service compta-lulu-push

Petit service Cloudflare Worker, deux rôles :

1. **Rappel de fin de mois** : notification push vers le 28 de chaque mois
   (même appli fermée) pour valider le bilan du mois.
2. **Synchronisation multi-appareils** : connexion par lien envoyé par email
   (pas de mot de passe), puis synchronisation automatique des données entre
   les appareils connectés au même compte.

Déjà déployé sur `https://compta-lulu-push.benjmug.workers.dev`. Cette page
sert de référence si on doit le redéployer ailleurs ou le faire évoluer.

## Ce qu'il stocke

- `SUBS` : abonnements de notification push (pas de données comptables).
- `MAGICLINKS` : jetons de connexion à usage unique (expirent en 15 min) +
  compteurs anti-abus (expirent tout seuls).
- `SESSIONS` : jetons de session par email (expirent après 180 jours).
- `SYNCDATA` : la dernière version des données comptables de chaque compte
  (par email), pour les partager entre appareils. **Pas chiffré côté
  serveur** — quiconque a accès au KV Cloudflare peut lire ces données.

## Déploiement (déjà fait, pour référence)

1. Compte Cloudflare, puis `npx wrangler login`.
2. Créer les 4 namespaces KV (`SUBS`, `MAGICLINKS`, `SESSIONS`, `SYNCDATA`) :
   ```
   npx wrangler kv namespace create <NOM>
   ```
   et reporter chaque `id` dans `wrangler.toml`.
3. Secrets (jamais commités) :
   ```
   npx wrangler secret put VAPID_PRIVATE_KEY
   npx wrangler secret put TEST_KEY
   npx wrangler secret put RESEND_API_KEY
   ```
   - `VAPID_PRIVATE_KEY` : générée avec la clé publique (déjà dans
     `wrangler.toml` et `app.js`).
   - `TEST_KEY` : mot de passe choisi pour déclencher un envoi de rappel de
     test manuellement.
   - `RESEND_API_KEY` : clé API d'un compte [resend.com](https://resend.com)
     (gratuit), utilisée pour envoyer les emails de connexion.
     Dashboard Resend → API Keys → Create API Key.
   - `MAIL_FROM` (facultatif, dans `[vars]` de `wrangler.toml`, pas un
     secret) : adresse d'expéditeur si un domaine est vérifié sur Resend,
     par exemple `Compta Lulu <compta@lucile-diet.fr>`. Sans ça, les emails
     partent de l'adresse par défaut de Resend (`onboarding@resend.dev`),
     ce qui fonctionne mais fait moins pro.
4. Déployer :
   ```
   npx wrangler deploy
   ```

## Anti-abus

N'importe quel email peut demander un lien de connexion — il n'y a pas de
liste d'emails autorisés, pour que l'appli reste simple à utiliser (on tape
son email, on reçoit le lien). Comme contrepartie :

- Un email ne peut redemander un lien qu'une fois par minute.
- Une même IP est limitée à 5 demandes par heure.
- L'URL du service n'est pas publiée ailleurs que dans le code de l'appli.

Si l'appli devient publique un jour, il faudra revoir ce point (captcha,
vérification d'email plus stricte, etc.).

## Vérifier que ça marche

Rappel de fin de mois, sans attendre le 28 :
```
https://compta-lulu-push.benjmug.workers.dev/send-test?key=<TEST_KEY>
```

Synchronisation : activer dans Réglages → Compte et synchronisation, entrer
un email, cliquer sur le lien reçu par mail sur un premier appareil, refaire
pareil avec le même email sur un second appareil — les données doivent se
retrouver synchronisées entre les deux en quelques secondes.
