import {Component, computed, DestroyRef, inject, Signal} from '@angular/core';
import {UpperCasePipe} from "@angular/common";
import {takeUntilDestroyed} from "@angular/core/rxjs-interop";
import {find, keyBy} from "lodash-es";
import {ImproDataService} from "@services/impro-data.service";
import {KeyValueNoSortPipe} from "@pipes/key-value-no-sort.pipe";
import {RoleNamePipe} from "@pipes/role-name.pipe";
import {TeamNumber} from "@enums/team-number.enum";
import {Team} from "@models/team";
import {TeamMetadata} from "@models/team-metadata";
import {PlayerMetadata} from "@models/player-metadata";
import {StarPlayer} from "@models/star-player";
import {TeamLayoutComponent} from "@components/projection/team-layout/team-layout.component";

/**
 * Panneau de l'écran "étoiles individuelles" : un clic sur un joueur le projette en grand,
 * un second clic sur le même joueur revient à l'écran d'attente.
 */
@Component({
  selector: 'app-display-star-player-manager',
  imports: [
    KeyValueNoSortPipe,
    RoleNamePipe,
    UpperCasePipe,
    TeamLayoutComponent
  ],
  templateUrl: './display-star-player-manager.component.html',
  styleUrl: './display-star-player-manager.component.scss'
})
export class DisplayStarPlayerManagerComponent {
  protected readonly TeamNumber = TeamNumber;

  gameData = this._improDataService.gameData;
  starPlayer: Signal<StarPlayer> = computed(() => this._improDataService.starPlayer.value() ?? StarPlayer.none());

  playersByCode: Signal<{ [code: string]: PlayerMetadata }> = computed(() => {
    return keyBy(this._improDataService.players.value(), 'code');
  });

  teamsByName: Signal<{ [name: string]: TeamMetadata }> = computed(() => {
    return keyBy(Object.values(this._improDataService.teams.value()), 'name');
  });

  private _destroyRef = inject(DestroyRef);

  constructor(private _improDataService: ImproDataService) {
  }

  teamMetadata(team: Team): TeamMetadata | undefined {
    return this.teamsByName()[team.name];
  }

  playerImg(team: Team, code: string, role?: string): string {
    const metadata = this.teamMetadata(team);
    const playerMetadata = this.playersByCode()[code];
    return playerMetadata?.imgSrc(metadata, role) ?? metadata?.playerImgFallback;
  }

  hasVideo(code: string): boolean {
    return !!this.playersByCode()[code]?.videoSrc;
  }

  onSelectPlayer(teamNumber: TeamNumber, role: string) {
    const next = this.starPlayer().is(teamNumber, role) ? StarPlayer.none() : StarPlayer.of(teamNumber, role);
    this._save(next);
  }

  clear() {
    this._save(StarPlayer.none());
  }

  private _save(starPlayer: StarPlayer) {
    this._improDataService.saveStarPlayer(starPlayer)
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe((saved) => this._improDataService.starPlayer.set(saved));
  }
}
