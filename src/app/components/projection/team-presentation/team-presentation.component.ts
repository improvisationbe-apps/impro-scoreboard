import {Component, computed, input, InputSignal, Signal} from '@angular/core';
import {Team} from "@models/team";
import {TeamMetadata} from "@models/team-metadata";
import {find, keyBy} from "lodash-es";
import {ImproDataService} from "@services/impro-data.service";
import {NgIf, NgStyle, UpperCasePipe} from "@angular/common";
import {PlayerMetadata} from "@models/player-metadata";
import {KeyValueNoSortPipe} from "@pipes/key-value-no-sort.pipe";
import {RoleNamePipe} from "@pipes/role-name.pipe";
import {Player} from "@models/player";
import {whiteLogoForTeam} from "@constants/logo.constants";
import {TeamLayoutComponent} from "@components/projection/team-layout/team-layout.component";
import {TeamMascotComponent} from "@components/projection/team-mascot/team-mascot.component";

@Component({
  selector: 'app-team-presentation',
  imports: [
    NgIf,
    KeyValueNoSortPipe,
    UpperCasePipe,
    RoleNamePipe,
    NgStyle,
    TeamLayoutComponent,
    TeamMascotComponent
  ],
  templateUrl: './team-presentation.component.html',
  styleUrl: './team-presentation.component.scss'
})
export class TeamPresentationComponent {
  screenStyle = this._improDataService.screenStyle;
  containerStyle = this._improDataService.containerStyle;

  team: InputSignal<Team> = input.required();

  teamMetadata: Signal<TeamMetadata> = computed(() => {
    return find(this._improDataService.teams.value(), (team: TeamMetadata) => {
      return team.name === this.team().name;
    });
  })

  /** Logo improvisation.be à la couleur de l'équipe, affiché à droite de la mascotte. */
  logoSrc: Signal<string> = computed(() => whiteLogoForTeam(this.teamMetadata()));

  displayedPlayers: Signal<Record<string, Player>> = computed(() => {
    const players = this.team().players;
    return Object.fromEntries(
      Object.entries(players).filter(([key, player]) => player.displayed)
    );
  });

  hiddenPlayers: Signal<Record<string, Player>> = computed(() => {
    const players = this.team().players;
    return Object.fromEntries(
      Object.entries(players).filter(([key, player]) => !player.displayed)
    );
  });


  playersByCode: Signal<{ [name: string]: PlayerMetadata }> = computed(() => {
    const players: PlayerMetadata[] = this.players.value();
    // Crée un objet indexé par player.name, avec la valeur = player
    return keyBy(players, 'code');
  });


  players = this._improDataService.players;


  constructor(private _improDataService: ImproDataService) {
  }
}
