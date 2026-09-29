import {computed, Injectable, ResourceRef} from "@angular/core";
import {LocalStorageService} from "@services/storage.service";
import {HttpClient} from "@angular/common/http";
import {GameDataDto, ImproDataDto, PlayerMetadataDto, TeamMetadataDto, TimerHandlingDto} from "../dtos";
import {PhotosManifest, PlayerMetadata} from "@models/player-metadata";
import {map} from "rxjs/operators";
import {mapValues} from "lodash-es";
import {forkJoin, Observable, of} from "rxjs";
import {TeamMetadata} from "@models/team-metadata";
import {GameData} from "@models/game-data";
import {StorageKey} from "@enums/storage-key.enum";
import {rxResource} from "@angular/core/rxjs-interop";
import {DisplayedScreen} from "@enums/displayed-screen.enum";
import {ImproData} from "@models/impro-data";
import {TimerHandling} from "@models/timer-handling";
import {TimerAction} from "@enums/timer-action.enum";
import {MediaHandling} from "@models/media-handling";
import {MediaHandlingDto} from "../dtos";
import {ProjectionData} from "@models/projection-data";
import {ProjectionDataDto} from "../dtos/projection-data.dto";
import {whiteLogoForColor, whiteLogoForTeam} from "@constants/logo.constants";
import {find} from "lodash-es";
import {Team} from "@models/team";
import {StarPlayer} from "@models/star-player";
import {StarPlayerDto} from "../dtos/star-player.dto";

@Injectable({
  providedIn: 'root'
})
export class ImproDataService {
  constructor(private _storageService: LocalStorageService,
              private _httpClient: HttpClient
  ) {

    window.addEventListener('storage', (event: StorageEvent) => {
      if (event.storageArea !== localStorage || !event.key) return;

      switch (event.key) {
        case StorageKey.GAME_DATA.toString(): {
          const dto = JSON.parse(event.newValue || '{}') as GameDataDto;
          this.gameData.set(new GameData(dto));
          break;
        }
        case StorageKey.DISPLAYED_SCREEN.toString(): {
          const screen = JSON.parse(event.newValue || 'null') as DisplayedScreen;
          this.displayedScreen.set(screen);
          break;
        }
        case StorageKey.IMPRO_DATA.toString(): {
          const improDataDto = JSON.parse(event.newValue || '{}') as ImproDataDto;
          this.improData.set(new ImproData(improDataDto));
          break;
        }
        case StorageKey.ROUND_TIMER.toString(): {
          const timerDto = JSON.parse(event.newValue || '{}') as TimerHandlingDto;
          this.roundTimerHandling.set(new TimerHandling(timerDto));
          break;
        }
        case StorageKey.IMPRO_TIMER.toString(): {
          const timerDto = JSON.parse(event.newValue || '{}') as TimerHandlingDto;
          this.improTimerHandling.set(new TimerHandling(timerDto));
          break;
        }
        case StorageKey.WATCHED_VIDEO.toString(): {
          const videoDto = JSON.parse(event.newValue || '{}') as MediaHandlingDto;
          this.mediaHandling.set(new MediaHandling(videoDto));
          break;
        }
        case StorageKey.ANTHEM.toString(): {
          const line = JSON.parse(event.newValue || '') as string;
          this.anthemLine.set(line);
          break;
        }
        case StorageKey.PROJECTION_DATA.toString(): {
          const dto = JSON.parse(event.newValue || '{}') as ProjectionDataDto;
          this.projectionData.set(new ProjectionData(dto));
          break;
        }
        case StorageKey.STAR_PLAYER.toString(): {
          const dto = JSON.parse(event.newValue || '{}') as StarPlayerDto;
          this.starPlayer.set(new StarPlayer(dto));
          break;
        }
      }
    });
  }

  screenStyle = computed(() => {
    const projectionData = this.projectionData.value();
    return {
      paddingTop: `${projectionData.bottom}vh`,
      paddingBottom: `${projectionData.top}vh`,
      paddingLeft: `${projectionData.right}vw`,
      paddingRight: `${projectionData.left}vw`,
    }
  })

  containerStyle = computed(() => {
    const projectionData = this.projectionData.value();
    return {
      width:`${100 - projectionData.right - projectionData.left}vw`,
      height:`${100 - projectionData.bottom - projectionData.top}vh`,
    }
  })

  /**
   * Logo improvisation.be à la couleur de l'équipe qui mène, mono en cas d'égalité.
   */
  leaderLogo = computed(() => {
    const gameData = this.gameData.value();
    const teamA = gameData.teamA;
    const teamB = gameData.teamB;

    if (teamA.score === teamB.score) {
      return whiteLogoForColor();
    }

    const leader: Team = teamA.score > teamB.score ? teamA : teamB;
    const metadata: TeamMetadata = find(this.teams.value(), (t: TeamMetadata) => t.name === leader.name);

    return whiteLogoForTeam(metadata);
  });

  public players: ResourceRef<PlayerMetadata[]> = rxResource({
    loader: () => this.getPlayers(),
    defaultValue: [],
  });

  public teams: ResourceRef<Record<string, TeamMetadata>> = rxResource({
    loader: () => this.getTeams(),
    defaultValue: {}
  });

  public gameData: ResourceRef<GameData> = rxResource({
    loader: () => this.getGameData(),
    defaultValue: new GameData({})
  });

  public improData: ResourceRef<ImproData> = rxResource({
    loader: () => this.getImproData(),
    defaultValue: ImproData.newInstance()
  });

  public anthemLine: ResourceRef<string> = rxResource({
    loader: () => this.getAnthemLine(),
    defaultValue: ''
  });

  public roundTimerHandling: ResourceRef<TimerHandling> = rxResource({
    loader: () => this.getRoundTimer(),
    defaultValue: new TimerHandling({
      action: TimerAction.STOP
    }) // Default to 180 seconds
  });

  public mediaHandling: ResourceRef<MediaHandling> = rxResource({
    loader: () => this.getMediaWatched(),
    defaultValue: new MediaHandling({})
  });

  public projectionData: ResourceRef<ProjectionData> = rxResource({
    loader: () => this.getProjectionData(),
    defaultValue: new ProjectionData({})
  });

  public improTimerHandling: ResourceRef<TimerHandling> = rxResource({
    loader: () => this.getImproTimer(),
    defaultValue: new TimerHandling({
      action: TimerAction.STOP
    })
  });

  public displayedScreen: ResourceRef<DisplayedScreen> = rxResource({
    loader: () => this.getDisplayedScreen(),
    defaultValue: DisplayedScreen.MATCH
  });

  /** Joueur mis à l'honneur sur l'écran "étoiles individuelles". */
  public starPlayer: ResourceRef<StarPlayer> = rxResource({
    loader: () => this.getStarPlayer(),
    defaultValue: StarPlayer.none()
  });

  getTeams(): Observable<Record<string, TeamMetadata>> {
    return this._httpClient.get<Record<string, TeamMetadataDto>>('assets/data/equipes.json').pipe(
      map(dtoRecord =>
        mapValues(dtoRecord, (playerMetadataDto, code: string) => new TeamMetadata(playerMetadataDto, code))
      )
    );
  }

  getGameData(): Observable<GameData> {
    return of(this._storageService.read<GameDataDto>(StorageKey.GAME_DATA)).pipe(
      map((dto) => {
        return new GameData(dto)
      })
    );
  }


  getImproData(): Observable<ImproData> {
    return of(this._storageService.read<ImproDataDto>(StorageKey.IMPRO_DATA)).pipe(
      map((dto) => {
        return new ImproData(dto)
      })
    );
  }


  getDisplayedScreen(): Observable<DisplayedScreen> {
    return of(this._storageService.read<DisplayedScreen>(StorageKey.DISPLAYED_SCREEN));
  }

  /** Joueurs + manifeste des photos (généré par scripts/photos-manifest.js), pour résoudre l'extension des photos. */
  getPlayers(): Observable<PlayerMetadata[]> {
    return forkJoin({
      players: this._httpClient.get<PlayerMetadataDto[]>('assets/data/joueurs.json'),
      photos: this._httpClient.get<PhotosManifest>('assets/data/photos.json'),
    }).pipe(
      map(({players, photos}) => players.map(dto => new PlayerMetadata(dto, photos)))
    );
  }

  clearGameData() {
    this._storageService.clear(StorageKey.GAME_DATA);
    this.gameData.set(new GameData({}));

    this._storageService.clear(StorageKey.IMPRO_DATA);
    this.improData.set(ImproData.newInstance());

    this._storageService.clear(StorageKey.DISPLAYED_SCREEN);
    this.displayedScreen.set(null);

    this._storageService.clear(StorageKey.ROUND_TIMER);
    this.roundTimerHandling.set(null);

    this._storageService.clear(StorageKey.IMPRO_TIMER);
    this.improTimerHandling.set(null);

    this._storageService.clear(StorageKey.WATCHED_VIDEO);
    this.mediaHandling.set(null);

    this._storageService.clear(StorageKey.ANTHEM);
    this.anthemLine.set('');

    this._storageService.clear(StorageKey.STAR_PLAYER);
    this.starPlayer.set(StarPlayer.none());
  }

  saveGameData(gameData: GameData): Observable<GameData> {
    return of(this._storageService.save<GameDataDto>(StorageKey.GAME_DATA, gameData.toDto()))
      .pipe(
        map((dto) => new GameData(dto))
      );
  }

  saveImproData(improData: ImproData): Observable<ImproData> {
    return of(this._storageService.save<ImproDataDto>(StorageKey.IMPRO_DATA, improData.toDto()))
      .pipe(
        map((dto) => new ImproData(dto))
      );
  }

  saveDisplayedScreen(screen: DisplayedScreen): Observable<DisplayedScreen> {
    return of(this._storageService.save<DisplayedScreen>(StorageKey.DISPLAYED_SCREEN, screen))
      .pipe(
        map((dto) => dto)
      );
  }

  getRoundTimer(): Observable<TimerHandling> {
    return of(this._storageService.read<TimerHandlingDto>(StorageKey.ROUND_TIMER))
      .pipe(
        map((dto: TimerHandlingDto) => new TimerHandling(dto))
      );
  }

  getMediaWatched(): Observable<MediaHandling> {
    return of(this._storageService.read<MediaHandlingDto>(StorageKey.WATCHED_VIDEO))
      .pipe(
        map((dto: MediaHandlingDto) => new MediaHandling(dto))
      );
  }

  getProjectionData(): Observable<ProjectionData> {
    return of(this._storageService.read<ProjectionDataDto>(StorageKey.PROJECTION_DATA))
      .pipe(
        map((dto: ProjectionDataDto) => new ProjectionData(dto))
      );
  }

  saveProjectionData(data: ProjectionData): Observable<ProjectionData> {
    return of(this._storageService.save<ProjectionDataDto>(StorageKey.PROJECTION_DATA, data.toDto()))
      .pipe(
        map((dto) => new ProjectionData(dto))
      );
  }

  saveVideoWatched(video: MediaHandling): Observable<MediaHandling> {
    return of(this._storageService.save<MediaHandlingDto>(StorageKey.WATCHED_VIDEO, video.toDto()))
      .pipe(
        map((dto) => new MediaHandling(dto))
      );
  }

  saveRoundTimer(timer: TimerHandling): Observable<TimerHandling> {
    return of(this._storageService.save<TimerHandlingDto>(StorageKey.ROUND_TIMER, timer.toDto()))
      .pipe(
        map((dto) => new TimerHandling(dto))
      );
  }

  getStarPlayer(): Observable<StarPlayer> {
    return of(this._storageService.read<StarPlayerDto>(StorageKey.STAR_PLAYER))
      .pipe(
        map((dto: StarPlayerDto) => new StarPlayer(dto))
      );
  }

  saveStarPlayer(starPlayer: StarPlayer): Observable<StarPlayer> {
    return of(this._storageService.save<StarPlayerDto>(StorageKey.STAR_PLAYER, starPlayer.toDto()))
      .pipe(
        map((dto) => new StarPlayer(dto))
      );
  }

  getAnthemLine(): Observable<string> {
    return of(this._storageService.read<string>(StorageKey.ANTHEM) || '');
  }

  saveAnthemLine(line: string): Observable<string> {
    return of(this._storageService.save<string>(StorageKey.ANTHEM, line))
  }

  getImproTimer(): Observable<TimerHandling> {
  return of(this._storageService.read<TimerHandlingDto>(StorageKey.IMPRO_TIMER))
    .pipe(
      map((dto: TimerHandlingDto) => new TimerHandling(dto))
    );
  }

  saveImproTimer(timer: TimerHandling): Observable<TimerHandling> {
    return of(this._storageService.save<TimerHandlingDto>(StorageKey.IMPRO_TIMER, timer.toDto()))
      .pipe(
        map((dto) => new TimerHandling(dto))
      );
  }


}
