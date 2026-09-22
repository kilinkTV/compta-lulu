# Service de rappel (notification push de fin de mois)

Petit service qui envoie une notification push vers le 28 de chaque mois, même
si l'application est fermée, pour rappeler de valider le bilan du mois
(recettes, dépenses, URSSAF). Il ne stocke que des abonnements de
notification (pas de données comptables).

Hébergé sur Cloudflare Workers (offre gratuite largement suffisante pour un
usage aussi léger : quelques requêtes par mois).

## Déploiement (à faire une fois)

1. Créer un compte gratuit sur [dash.cloudflare.com](https://dash.cloudflare.com) si besoin.
2. Installer les dépendances :
   ```
   cd worker
   npm install
   ```
3. Se connecter à Cloudflare :
   ```
   npx wrangler login
   ```
   (ouvre une fenêtre de navigateur pour autoriser wrangler)
4. Créer le stockage des abonnements :
   ```
   npx wrangler kv namespace create SUBS
   ```
   Copier l'`id` renvoyé dans `wrangler.toml`, à la place de
   `REPLACE_AFTER_KV_CREATE`.
5. Renseigner les secrets (jamais commités dans le dépôt) :
   ```
   npx wrangler secret put VAPID_PRIVATE_KEY
   npx wrangler secret put TEST_KEY
   ```
   La clé privée VAPID a été générée en même temps que la clé publique
   (déjà dans `wrangler.toml` et dans `app.js`) ; `TEST_KEY` est un mot de
   passe de votre choix pour déclencher un envoi de test manuellement.
6. Déployer :
   ```
   npx wrangler deploy
   ```
   La commande affiche l'URL du service, du type
   `https://compta-lulu-push.<votre-compte>.workers.dev`.
7. Copier cette URL dans `PUSH_SERVER_URL` en haut de `../app.js`
   (section "NOTIFICATIONS PUSH"), puis commit + push comme d'habitude.

## Vérifier que ça marche

Après avoir activé les rappels dans l'appli (Réglages → Rappel de fin de
mois), déclencher un envoi de test sans attendre le 28 :

```
https://compta-lulu-push.<votre-compte>.workers.dev/send-test?key=<TEST_KEY choisi à l'étape 5>
```

Une notification doit arriver sur l'appareil abonné.

## Ce que fait le service

- `POST /subscribe` : enregistre un abonnement (envoyé par l'appli quand on
  active les rappels).
- `POST /unsubscribe` : le supprime.
- Le 28 de chaque mois à 8h UTC (cron dans `wrangler.toml`), envoie la même
  notification à tous les abonnements enregistrés.
- Un abonnement expiré ou révoqué (l'appareil ne l'accepte plus) est
  automatiquement supprimé.
