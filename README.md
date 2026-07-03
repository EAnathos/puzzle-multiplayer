# 🧩 Puzzle Multiplayer

Un puzzle **collaboratif en temps réel**. Plusieurs joueurs assemblent ensemble
un puzzle à partir d'une image choisie. Pas de compte : on rejoint une partie
avec un code et un pseudo, et on voit les curseurs et les pièces bouger en direct.

- **Concept** : [CONCEPT.md](CONCEPT.md)
- **Gameplay** : [docs/GAMEPLAY.md](docs/GAMEPLAY.md)
- **Architecture** : [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- **Feuille de route** : [docs/ROADMAP.md](docs/ROADMAP.md)

## Stack

- **Client** : React + TypeScript (Vite), rendu DOM des pièces, glisser-déposer.
- **Serveur** : Node.js + Express + Socket.IO, état de partie en mémoire (source
  de vérité, pas de base de données).
- **Partagé** : types et géométrie communs dans [`shared/`](shared/types.ts).

## Démarrage

```bash
npm install        # installe client + serveur (workspaces)
npm run serve      # build le client puis lance le serveur
```

Puis ouvre **http://localhost:3000**.

Pour tester à plusieurs : ouvre l'URL dans **plusieurs onglets/fenêtres**. Crée
une partie dans le premier, copie le **code**, et rejoins-le depuis les autres.

### Mode développement (rechargement à chaud)

Dans deux terminaux :

```bash
npm run dev:server   # serveur Socket.IO sur :3000
npm run dev:client   # client Vite sur :5173 (proxy /socket.io -> :3000)
```

Puis ouvre **http://localhost:5173**.

## Comment jouer

1. Saisis un **pseudo** et **crée une partie** (ou rejoins avec un code).
2. L'hôte choisit une **image** et un **niveau** (Facile 25 / Moyen 100 /
   Difficile 400 pièces), puis démarre.
3. **Glisse** les pièces : une pièce bien placée s'**aimante** et se verrouille.
4. Vous voyez en temps réel les **curseurs** des autres et les **pièces**
   qu'ils déplacent (entourées de leur couleur).
5. Quand toutes les pièces sont posées, l'**écran de fin** s'affiche pour tous.

## Périmètre

Le MVP couvre les phases 0 à 3 de la [feuille de route](docs/ROADMAP.md) :
lobby, puzzle jouable, temps réel complet et finitions. Les idées « hors MVP »
(pièces jigsaw, rotation, chat, zoom, persistance…) ne sont pas incluses.
