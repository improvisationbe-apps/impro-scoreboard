import {Component, computed, input, InputSignal, Signal} from '@angular/core';
import {NgStyle, UpperCasePipe} from "@angular/common";
import {find, keyBy} from "lodash-es";
import {ImproDataService} from "@services/impro-data.service";
import {ProjectionMode} from "@enums/projection-mode.enum";
import {TeamNumber} from "@enums/team-number.enum";
import {Team} from "@models/team";
import {TeamMetadata} from "@models/team-metadata";
import {Player} from "@models/player";
import {PlayerMetadata} from "@models/player-metadata";
import {StarPlayer} from "@models/star-player";
import {RoleNamePipe} from "@pipes/role-name.pipe";
import {PlayerMediaComponent} from "@components/projection/player-media/player-media.component";
import {whiteLogoForColor} from "@constants/logo.constants";
import {TeamLayoutComponent} from "@components/projection/team-layout/team-layout.component";

/**
 * Écran "étoiles individuelles" : le joueur sélectionné depuis le video-switcher
 * en plein écran (vidéo, ou photo en fallback) avec son nom, son équipe et son numéro.
 */
@Component({
  selector: 'app-star-player-presentation',
  imports: [
    NgStyle,
    UpperCasePipe,
    RoleNamePipe,
    PlayerMediaComponent,
    TeamLayoutComponent
  ],
  templateUrl: './star-player-presentation.component.html',
  styleUrl: './star-player-presentation.component.scss'
})
export class StarPlayerPresentationComponent {
  protected readonly ProjectionMode = ProjectionMode;
  projectionMode: InputSignal<ProjectionMode> = input.required();

  screenStyle = this._improDataService.screenStyle;
  containerStyle = this._improDataService.containerStyle;

  starPlayer: Signal<StarPlayer> = computed(() => this._improDataService.starPlayer.value() ?? StarPlayer.none());

  /** Équipe (données de match) du joueur sélectionné. */
  team: Signal<Team | undefined> = computed(() => {
    const star = this.starPlayer();
    if (!star.isSet) {
      return undefined;
    }
    const gameData = this._improDataService.gameData.value();
    return star.team === TeamNumber.TEAM_A ? gameData.teamA : gameData.teamB;
  });

  teamMetadata: Signal<TeamMetadata | undefined> = computed(() => {
    const team = this.team();
    return team ? find(this._improDataService.teams.value(), (t: TeamMetadata) => t.name === team.name) : undefined;
  });

  /** Joueur (rôle + numéro) tel qu'aligné pour ce match. */
  player: Signal<Player | undefined> = computed(() => {
    const team = this.team();
    const role = this.starPlayer().role;
    return team && role ? team.players[role] : undefined;
  });

  playerMetadata: Signal<PlayerMetadata | undefined> = computed(() => {
    const code = this.player()?.code;
    return code ? keyBy(this._improDataService.players.value(), 'code')[code] : undefined;
  });

  playerImg: Signal<string | undefined> = computed(() => {
    const metadata = this.playerMetadata();
    const teamMetadata = this.teamMetadata();
    return metadata?.imgSrc(teamMetadata, this.starPlayer().role ?? undefined) ?? teamMetadata?.playerImgFallback;
  });

  /** Logo improvisation.be à la couleur de l'équipe du joueur (mono si aucun joueur). */
  logoSrc: Signal<string> = computed(() => whiteLogoForColor(this.teamMetadata()?.color));



  constructor(private _improDataService: ImproDataService) {
  }

}
