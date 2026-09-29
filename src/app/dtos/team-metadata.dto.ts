export interface TeamMetadataDto {
  nom?: string;
  img?: string;
  couleur?: string;
  /**
   * Bandes du drapeau, de haut en bas, pour une équipe internationale : `npm run flags:build` en dérive
   * les décors de coin (assets/layout) et un logo improvisation.be à la teinte exacte de "couleur" (assets/logos).
   */
  couleurs?: string[];
  /** Les points du logo improvisation.be reprennent les bandes de "couleurs" au lieu de la couleur principale. */
  pointsDrapeau?: boolean;
  vareuses?: number[];
  groupe?: string;
  icone?: string;
  playerImgFallback?: string;
  /** Suffixe ajouté au chemin de base des joueurs, sans extension (ex. "-lions"). */
  playerImgSuffix?: string;
  shortName?: string;
}
