# Feuille de route

Découpage en phases, de la maquette au jeu complet. Chaque phase est jouable ou
démontrable à la fin. Voir [ARCHITECTURE.md](./ARCHITECTURE.md) pour les détails
techniques.

## Phase 0 — Fondations

Mettre en place le squelette sans encore de temps réel.

- [ ] Monorepo `client/` + `server/` + `shared/`.
- [ ] Types partagés (modèle de données + messages).
- [ ] Serveur Express qui sert le client.
- [ ] Écran Lobby : créer une partie / rejoindre par code (pseudo).

## Phase 1 — Puzzle solo (boucle de base)

Valider la mécanique de puzzle avant le multijoueur.

- [ ] Sélection d'une image (2–3 images prédéfinies).
- [ ] Choix du niveau (Facile / Moyen / Difficile).
- [ ] Découpe en grille + mélange des pièces sur le plateau.
- [ ] Glisser-déposer d'une pièce.
- [ ] Magnétisme + verrouillage quand bien placée.
- [ ] Détection de fin + écran de fin.

## Phase 2 — Temps réel

Rendre le plateau partagé et vivant.

- [ ] Connexion Socket.IO + rooms par code de partie.
- [ ] État de partie autoritatif côté serveur.
- [ ] Envoi de l'état complet à l'arrivée / reconnexion.
- [ ] Curseurs partagés (throttle + interpolation).
- [ ] Verrouillage de pièce (`heldBy`) et anti-conflit.
- [ ] Diffusion des déplacements et placements.
- [ ] Présence : liste des joueurs, arrivées / départs.
- [ ] Progression commune (placées / total) + fin partagée.

## Phase 3 — Finitions

Rendre l'expérience agréable et robuste.

- [ ] Couleurs et pseudos affichés partout (curseur, pièces, présence).
- [ ] Image fantôme optionnelle (aperçu atténué).
- [ ] Gestion des cas limites (déconnexion en tenant une pièce, hôte quitte).
- [ ] Import d'image par le joueur (avec redimensionnement).
- [ ] Écran de fin enrichi (temps, contribution par joueur).
- [ ] TTL / nettoyage des parties inactives.

## Phase 4 — Bonus (hors MVP)

Idées pour aller plus loin.

- [ ] Pièces à tenons/mortaises (forme jigsaw) et rotation.
- [ ] Assemblage de groupes de pièces déplacés ensemble.
- [ ] Chat texte / emojis.
- [ ] Zoom et déplacement du plateau.
- [ ] Sons et effets visuels au placement.
- [ ] Sauvegarde / reprise d'une partie (persistance).
- [ ] Mise à l'échelle multi-serveurs (Redis).

## Définition de « terminé » pour le MVP

Le MVP est atteint à la fin de la **Phase 2** :

> Plusieurs joueurs rejoignent une partie via un code, choisissent une image et
> un niveau, assemblent le puzzle ensemble en voyant les curseurs et les
> déplacements des autres en temps réel, jusqu'à la complétion.
