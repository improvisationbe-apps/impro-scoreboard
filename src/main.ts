import { enableProdMode } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { provideRouter } from '@angular/router';

import { AppComponent } from './app/app.component';
import { APP_CONFIG } from './environments/environment';

import { TranslateHttpLoader } from '@ngx-translate/http-loader';
import { HttpClient } from '@angular/common/http';

import { PageNotFoundComponent} from "./app/components";
import {HashLocationStrategy, LocationStrategy} from "@angular/common";
import {resetStorageOnVersionChange} from './app/services/storage-version';

// AoT requires an exported function for factories
export function httpLoaderFactory(http: HttpClient): TranslateHttpLoader {
  return new TranslateHttpLoader(http, './assets/i18n/', '.json');
}

if (APP_CONFIG.production) {
  enableProdMode();
}

resetStorageOnVersionChange();

bootstrapApplication(AppComponent, {
  providers: [
    provideHttpClient(withInterceptorsFromDi()),
    ...(APP_CONFIG.production ? [{ provide: LocationStrategy, useClass: HashLocationStrategy }] : []),
    provideRouter([
      {
        path: 'projection',
        loadComponent: () => import('./app/components/projection/projection.component').then(m => m.ProjectionComponent),
      },
      {
        path: 'control',
        loadComponent: () => import('./app/components/video-switcher/video-switcher.component').then(m => m.VideoSwitcherComponent),
        children: [
          {
            path: 'match',
            loadComponent: () => import('./app/components/video-switcher/match-manager/match-manager.component').then(m => m.MatchManagerComponent)
          },
          {
            path: 'projectionHandling',
            loadComponent: () => import('./app/components/projection-handling/projection-handling.component').then(m => m.ProjectionHandlingComponent)
          },
          {
            path: 'parameters',
            loadComponent: () => import('./app/components/video-switcher/match-parameters/match-parameters.component').then(m => m.MatchParametersComponent)
          },
          {
            path: 'reseaux',
            loadComponent: () => import('./app/components/video-switcher/reseaux-manager/reseaux-manager.component').then(m => m.ReseauxManagerComponent)
          },
          {
            path: '**',
            redirectTo: 'parameters',
            pathMatch: 'full'
          }
        ]
      },
      {
        path: '**',
        component: PageNotFoundComponent
      },

    ])
  ]
}).catch(err => console.error(err));
