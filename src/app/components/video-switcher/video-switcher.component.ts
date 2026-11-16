import {Component} from '@angular/core';
import {RouterLink, RouterLinkActive, RouterOutlet} from "@angular/router";
import {ImproDataService} from "@services/impro-data.service";
import {ImproCsvService} from "@services/impro-csv.service";
import {APP_CONFIG} from "../../../environments/environment";

@Component({
  selector: 'app-video-switcher',
  imports: [
    RouterLinkActive,
    RouterLink,
    RouterOutlet
  ],
  templateUrl: './video-switcher.component.html',
  styleUrl: './video-switcher.component.scss'
})
export class VideoSwitcherComponent {
  /** Mode debug (npm run start, environnement non production) : affiche le menu Réseaux sociaux. */
  readonly debug = !APP_CONFIG.production;

  constructor(private improDataService: ImproDataService,
              private improCsvService: ImproCsvService
  ) {
  }

  downloadMatchReport() {
    if (this.improCsvService.count === 0
      && !confirm('Aucune impro terminée dans ce match : le rapport sera vide. Télécharger quand même ?')) return;
    this.improCsvService.downloadCsv();
  }

  resetMatch() {
    if (!confirm('Voulez-vous vraiment démarrer un nouveau match ? Les scores et les équipes seront effacés.')) return;

    this.improDataService.clearGameData();
    this.improCsvService.resetCsv();
  }
}
