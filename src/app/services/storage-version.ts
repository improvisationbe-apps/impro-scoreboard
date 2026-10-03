import packageJson from '../../../package.json';

const version = packageJson.version;

const STORAGE_VERSION_KEY = 'storageVersion';

/**
 * Vide le localStorage quand l'app a changé de version (package.json) depuis la dernière ouverture :
 * des données écrites par une ancienne version peuvent casser l'affichage (ex. sélection d'équipe vide).
 * À appeler avant le démarrage d'Angular, pour qu'aucun service n'ait encore lu le stockage.
 */
export function resetStorageOnVersionChange(): void {
  try {
    if (localStorage.getItem(STORAGE_VERSION_KEY) === version) return;
    localStorage.clear();
    localStorage.setItem(STORAGE_VERSION_KEY, version);
  } catch {
    // Stockage inaccessible : l'app démarre quand même.
  }
}
