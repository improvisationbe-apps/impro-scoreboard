import {TeamMetadataDto} from "../dtos";

export class TeamMetadata {
  constructor(private _dto: TeamMetadataDto = {}, private _code: string) {
    this._dto = _dto ? _dto : {};
  }

  get code(): string {
    return this._code;
  }

  get name(): string {
    return this._dto.nom;
  }

  get img(): string {
    return this._dto.img;
  }

  get color(): string {
    return this._dto.couleur;
  }

  /** Variante dédiée du logo improvisation.be (générée au code de l'équipe), sinon celle de sa couleur. */
  get logoVariant(): string | undefined {
    return this._dto.couleurs?.length ? this._code : undefined;
  }

  get jerseys(): number[] {
    return this._dto.vareuses || [];
  }

  get group(): string {
    return this._dto.groupe;
  }

  get icon(): string {
    return this._dto.icone;
  }

  get playerImgFallback(): string {
    return this._dto.playerImgFallback;
  }

  get playerImgSuffix(): string {
    return this._dto.playerImgSuffix;
  }

  get shortName(): string {
    return this._dto.shortName || this._dto.nom || '';
  }

}
