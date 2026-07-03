# Puzzle Multiplayer — Concept

Un jeu de puzzle collaboratif en temps réel. Plusieurs joueurs assemblent
ensemble un puzzle à partir d'une image choisie. Pas de compte, pas
d'inscription : on rejoint une partie et on joue.

## Principe

- On choisit une **image**, elle est découpée en pièces mélangées.
- Plusieurs joueurs assemblent le puzzle **en même temps**, sur le même plateau
  partagé.
- Chaque joueur voit **en direct** le curseur et les pièces déplacées par les
  autres.
- Le puzzle est terminé quand **toutes les pièces** sont à leur place.

## Objectifs de design

- **Simplicité** : aucune création de compte, aucune configuration lourde.
- **Rejoindre en un clic** : un lien ou un code de partie suffit.
- **Collaboratif** : tout le monde travaille sur le même puzzle, pas de compétition.
- **Temps réel** : les déplacements des autres joueurs sont visibles immédiatement.

## Parcours utilisateur

1. Un joueur ouvre l'app et **crée une partie**.
2. Il **choisit une image** (parmi une sélection ou en important la sienne).
3. Il **choisit un niveau de difficulté** (voir ci-dessous).
4. Un **code / lien de partie** est généré, qu'il partage avec ses amis.
5. Les autres **rejoignent** avec le code — juste un **pseudo**, pas de compte.
6. Tout le monde assemble le puzzle **ensemble** jusqu'à sa complétion.

## Niveaux de difficulté

Trois niveaux, définis par le nombre de pièces :

| Niveau   | Pièces      | Public              |
|----------|-------------|---------------------|
| Facile   | ~25 (5×5)   | Découverte, enfants |
| Moyen    | ~100 (10×10)| Partie classique    |
| Difficile| ~400 (20×20)| Groupe, temps long  |

## Multijoueur en temps réel

- **Pseudo + couleur** : chaque joueur reçoit une couleur pour l'identifier.
- **Curseurs partagés** : on voit la position du curseur des autres joueurs.
- **Pièces en cours de déplacement** : quand quelqu'un attrape une pièce, elle
  apparaît « prise » par lui (contour de sa couleur) pour éviter les conflits.
- **Synchronisation** : chaque pièce posée est répercutée chez tous les joueurs.
- **Présence** : liste des joueurs connectés, arrivées / départs en direct.

## Fonctionnalités minimales (MVP)

- [ ] Créer une partie et obtenir un lien/code partageable.
- [ ] Rejoindre une partie via le code (pseudo uniquement).
- [ ] Sélectionner une image (sélection prédéfinie + import).
- [ ] Choisir un des 3 niveaux de difficulté.
- [ ] Découper l'image en pièces mélangées.
- [ ] Déplacer une pièce (glisser-déposer) et l'ancrer quand elle est bien placée.
- [ ] Diffuser en temps réel les curseurs et déplacements des autres.
- [ ] Détecter la fin du puzzle et l'afficher à tous.

## Idées futures (hors MVP)

- Chat texte ou emojis pour communiquer.
- Rotation des pièces pour plus de difficulté.
- Zoom / déplacement du plateau.
- Chronomètre et statistiques de fin (temps, contribution de chacun).
- Sauvegarde et reprise d'une partie.
- Effet visuel / son quand une pièce est bien placée.

## Pistes techniques

- **Front** : rendu du plateau (Canvas ou SVG), glisser-déposer des pièces.
- **Temps réel** : WebSocket (ex. Socket.IO) pour la synchro des positions,
  curseurs et présence.
- **État de partie** : gardé côté serveur en mémoire (pas de base de données
  nécessaire pour le MVP), identifié par le code de partie.
- **Images** : découpage en grille selon le niveau ; les pièces peuvent être des
  découpes d'une même image affichée par décalage de fond.

## Documentation détaillée

Le concept est développé dans les documents suivants :

- [docs/GAMEPLAY.md](docs/GAMEPLAY.md) — mécaniques, niveaux, collaboration temps
  réel, cas limites.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — stack, modèle de données,
  protocole temps réel, découpe d'image, structure de projet.
- [docs/ROADMAP.md](docs/ROADMAP.md) — phases de développement et définition du
  MVP.
