/**
 * Variantes de couleur du logo improvisation.be, indexées par la couleur de l'équipe
 * (voir "couleur" dans assets/data/equipes.json).
 *
 * Les teintes de l'app sont volontairement plus vives que celles des SVG de la charte,
 * qui rendent fade sur le scoreboard : les deux sont acceptées ici pour que le logo
 * suive quelle que soit la valeur utilisée dans equipes.json.
 */
const LOGO_COLOR_VARIANTS: Record<string, string> = {
  '#33cc33': 'green',   // charte : #15ab15
  '#15ab15': 'green',
  '#3399ff': 'blue',    // charte : #39c
  '#3399cc': 'blue',
  '#ff4d4d': 'red',     // charte : #f33
  '#ff3333': 'red',
  '#f5c400': 'yellow',  // charte : #fac019
  '#fac019': 'yellow',
};

export type LogoKind = 'principal' | 'secondaire' | 'tertiaire';

/** Le strict nécessaire d'une équipe pour choisir son logo (voir TeamMetadata). */
export interface LogoTeam {
  color?: string;
  logoVariant?: string;
}

/**
 * Logo sur fond sombre d'une équipe : sa variante dédiée si elle en a une (équipes internationales, logo
 * exactement à la couleur du drapeau, généré par `npm run flags:build`), sinon la variante de sa couleur.
 */
export function whiteLogoForTeam(team?: LogoTeam, kind: LogoKind = 'principal'): string {
  if (team?.logoVariant) {
    return `assets/logos/logo_${kind} - white ${team.logoVariant}.svg`;
  }
  return whiteLogoForColor(team?.color, kind);
}

/**
 * Logo sur fond sombre, à la couleur de l'équipe. Retombe sur le mono si la couleur
 * n'a pas de variante dédiée (ou si aucune couleur n'est fournie).
 */
export function whiteLogoForColor(color?: string, kind: LogoKind = 'principal'): string {
  const variant = LOGO_COLOR_VARIANTS[color?.trim().toLowerCase()] || 'mono';

  return `assets/logos/logo_${kind} - white ${variant}.svg`;
}
