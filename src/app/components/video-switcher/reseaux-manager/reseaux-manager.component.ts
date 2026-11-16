import {Component} from '@angular/core';
import {SelectionManagerComponent} from './selection-manager/selection-manager.component';
import {HappyPhotosManagerComponent} from './happy-photos-manager/happy-photos-manager.component';
import {TeamPhotoManagerComponent} from './team-photo-manager/team-photo-manager.component';

@Component({
  selector: 'app-reseaux-manager',
  imports: [
    HappyPhotosManagerComponent,
    TeamPhotoManagerComponent,
    SelectionManagerComponent,
  ],
  templateUrl: './reseaux-manager.component.html',
  styleUrl: './reseaux-manager.component.scss'
})
export class ReseauxManagerComponent {
}
