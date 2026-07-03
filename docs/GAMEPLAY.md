# Gameplay

Détail des mécaniques de jeu, de la difficulté et de la collaboration en temps
réel. Pour la vision d'ensemble voir [CONCEPT.md](../CONCEPT.md), pour la
technique voir [ARCHITECTURE.md](./ARCHITECTURE.md).

## Boucle de jeu

```
Créer / Rejoindre  →  Choisir image + niveau  →  Assembler ensemble  →  Fin
      (lobby)              (hôte uniquement)         (temps réel)       (écran final)
```

1. **Lobby** — l'hôte crée la partie, les autres rejoignent via un code.
2. **Configuration** — l'hôte choisit l'image et le niveau ; les pièces sont
   découpées et mélangées.
3. **Assemblage** — tous les joueurs déplacent des pièces simultanément.
4. **Fin** — quand toutes les pièces sont placées, un écran de fin s'affiche
   pour tout le monde.

## Le plateau

- Une **zone de résolution** (là où le puzzle final se forme).
- Une **zone de vrac** autour, où les pièces mélangées sont dispersées.
- Chaque pièce a une **position courante** (x, y) partagée par tous.
- Le fond peut afficher une **image fantôme** (aperçu très atténué) — activable,
  utile en Facile, désactivable en Difficile.

## Niveaux de difficulté

Trois niveaux, définis par la découpe de la grille :

| Niveau     | Grille | Pièces | Joueurs conseillés | Durée estimée | Image fantôme |
|------------|--------|--------|--------------------|---------------|---------------|
| Facile     | 5×5    | 25     | 1–3                | 3–8 min       | activée       |
| Moyen      | 10×10  | 100    | 2–5                | 15–30 min     | optionnelle   |
| Difficile  | 20×20  | 400    | 3–8                | 45 min +      | désactivée    |

> Le nombre de pièces est indicatif : la grille peut s'adapter au ratio de
> l'image (ex. 16×9) pour éviter des pièces déformées.

## Anatomie d'une pièce

Pour le MVP, les pièces sont des **carrés** (découpe en grille) — simple à
découper et à aligner.

```
Piece
├── id              identifiant unique
├── row, col        position correcte dans la grille
├── x, y            position courante sur le plateau (partagée)
├── placed          true quand elle est verrouillée à sa place
└── heldBy          id du joueur qui la tient, ou null
```

> Évolution possible : pièces à **tenons/mortaises** (forme jigsaw classique)
> via des masques SVG, et **rotation** des pièces (angle 0/90/180/270).

## Placement et magnétisme (snapping)

- On **glisse** une pièce sur le plateau.
- Au relâchement, si son centre est à moins d'un **seuil** (ex. la moitié d'une
  pièce) de sa position correcte, elle **s'aimante** et se **verrouille**.
- Une pièce verrouillée ne peut plus être déplacée (elle passe en arrière-plan).
- C'est le **serveur qui décide** du verrouillage, pour que tout le monde voie
  le même résultat (source de vérité unique).

> Évolution : verrouiller aussi quand deux pièces **voisines** sont accolées
> (assemblage de groupes de pièces qu'on déplace ensemble).

## Collaboration en temps réel

### Identité légère

- À l'arrivée, chaque joueur choisit un **pseudo** (pas de compte).
- Le serveur lui attribue une **couleur** unique (palette prédéfinie) qui sert à
  l'identifier partout : curseur, pièces prises, liste de présence.

### Curseurs partagés

- La position du curseur de chaque joueur est diffusée aux autres.
- On envoie les mouvements de curseur à une **fréquence limitée** (throttle,
  ~20–30 msg/s max) pour ne pas saturer le réseau.
- Le rendu chez les autres est **interpolé** pour rester fluide malgré la
  fréquence réduite.

### Verrouillage d'une pièce (anti-conflit)

Pour éviter que deux joueurs déplacent la même pièce :

1. Joueur A **attrape** une pièce → le serveur la marque `heldBy = A`.
2. Les autres voient la pièce **entourée de la couleur de A** et ne peuvent pas
   l'attraper.
3. A déplace la pièce → position diffusée en direct à tous.
4. A **relâche** → la pièce se verrouille (si bien placée) ou redevient libre.

Si A se déconnecte en tenant une pièce, le serveur la **libère
automatiquement**.

### Présence

- Liste des joueurs connectés, avec leur couleur et pseudo.
- Notifications discrètes d'**arrivée** et de **départ**.
- Indicateur du **nombre de pièces déjà placées** / total (progression commune).

## Fin de partie

- La partie est **terminée** quand `pièces placées == total`.
- Écran de fin partagé : image complète révélée, **temps total**, et
  éventuellement la **contribution de chaque joueur** (nb de pièces posées).
- Boutons : **rejouer** (même groupe, nouvelle image/niveau) ou **quitter**.

## Cas limites à gérer

| Situation                                   | Comportement attendu                         |
|---------------------------------------------|----------------------------------------------|
| Joueur se déconnecte en tenant une pièce    | La pièce est libérée automatiquement.        |
| Joueur revient (reconnexion)                | Il reçoit l'**état complet** et reprend.     |
| L'hôte quitte                               | La partie continue ; un autre joueur devient hôte, ou la partie reste ouverte. |
| Tous les joueurs partent                    | La partie est conservée un temps (TTL) puis nettoyée. |
| Deux joueurs attrapent « en même temps »    | Le serveur tranche : premier arrivé gagne, l'autre reçoit un refus. |
| Image très grande / lourde                  | Redimensionnement côté serveur avant découpe. |
