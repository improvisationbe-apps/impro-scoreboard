import {PlayerMetadataDto} from "../dtos";
import {TeamMetadata} from "./team-metadata";
import {Role} from "@enums/role.enum";

/** Suffixe de la photo "t-shirt improvisation.be" utilisée pour les coachs (ex. "gab-de-pat-tshirt-happy"). */
export const COACH_IMG_SUFFIX = '-tshirt-happy';

/** Manifeste des photos (assets/data/photos.json, généré par scripts/photos-manifest.js) : nom sans extension → chemin. */
export type PhotosManifest = Record<string, string>;

export class PlayerMetadata {
  constructor(private _dto: PlayerMetadataDto = {}, private _photos: PhotosManifest = {}) {
    this._dto = _dto ? _dto : {};
  }

  get code(): string {
    return this.firstName + (this.name ?? '');
  }

  get firstName(): string {
    return this._dto.prenom;
  }

  get name(): string {
    return this._dto.nom;
  }

  get alias(): string {
    return this._dto.alias;
  }

  /** For projection: alias if exists, otherwise firstName */
  get displayName(): string {
    return this._dto.alias || this._dto.prenom || '';
  }

  /** For social media: alias if exists, otherwise prénom */
  get socialName(): string {
    return this._dto.alias || this._dto.prenom || '';
  }

  get img(): string {
    return this._dto.img;
  }

  /**
   * Clé de la photo du joueur dans une équipe : chemin de base + suffixe d'équipe, sans extension
   * (ex. "assets/joueurs/polo-lions"). Sert aussi de clé dans face-positions.json.
   * Un coach utilise sa photo "t-shirt" (suffixe -tshirt-happy) quand elle existe, sinon celle de l'équipe.
   */
  imgKey(teamMetadata?: TeamMetadata, role?: string): string | undefined {
    if (!this._dto.img) return undefined;
    if (role === Role.COACH && this.photoSrcForKey(this._dto.img + COACH_IMG_SUFFIX)) {
      return this._dto.img + COACH_IMG_SUFFIX;
    }
    return this._dto.img + (teamMetadata?.playerImgSuffix ?? '');
  }

  /**
   * Chemin de la photo du joueur dans une équipe, quelle que soit son extension (jpg, png, webp…),
   * résolu via le manifeste des photos. Sans photo, on retombe sur la photo générique de l'équipe.
   */
  imgSrc(teamMetadata?: TeamMetadata, role?: string): string | undefined {
    return this.photoSrc(teamMetadata, role) || teamMetadata?.playerImgFallback;
  }

  /** Vrai si le joueur a sa propre photo dans cette équipe (sinon on affiche la mascotte ou la photo générique). */
  hasPhoto(teamMetadata?: TeamMetadata, role?: string): boolean {
    return !!this.photoSrc(teamMetadata, role);
  }

  /** Chemin de la photo du joueur dans l'équipe d'après le manifeste, sans repli. */
  private photoSrc(teamMetadata?: TeamMetadata, role?: string): string | undefined {
    return this.photoSrcForKey(this.imgKey(teamMetadata, role));
  }

  /** Chemin d'une photo d'après sa clé (chemin sans extension) dans le manifeste. */
  private photoSrcForKey(key?: string): string | undefined {
    const stem = key?.substring(key.lastIndexOf('/') + 1);
    return stem ? this._photos[stem] : undefined;
  }

  /** Vidéo du joueur : même chemin que l'image de base, avec l'extension .mp4. */
  get videoSrc(): string | undefined {
    return this._dto.img ? `${this._dto.img}.mp4` : undefined;
  }

  get isFemale(): boolean {
    return this._dto.femme || false;
  }

  /** Smart label for dropdowns: alias, or firstName if unique, or firstName + nom if duplicate */
  static smartLabels(players: PlayerMetadata[]): Map<string, string> {
    const firstNameCounts = new Map<string, number>();
    for (const p of players) {
      const fn = p.alias || p.firstName;
      firstNameCounts.set(fn, (firstNameCounts.get(fn) || 0) + 1);
    }
    const labels = new Map<string, string>();
    for (const p of players) {
      const display = p.alias || p.firstName;
      if ((firstNameCounts.get(display) || 0) > 1) {
        labels.set(p.code, `${p.firstName} ${p.name}`);
      } else {
        labels.set(p.code, display);
      }
    }
    return labels;
  }
}
