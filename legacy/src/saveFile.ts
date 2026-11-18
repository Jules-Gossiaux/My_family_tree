interface Writable {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
}

interface Handle {
  createWritable(): Promise<Writable>;
}

/** L'API n'est pas encore dans les types de TypeScript, et elle manque dans beaucoup de navigateurs. */
interface WindowWithPicker extends Window {
  showSaveFilePicker?: (options: {
    suggestedName?: string;
    types?: { description: string; accept: Record<string, string[]> }[];
  }) => Promise<Handle>;
}

function suggestedName(header: string | null): string | null {
  const match = /filename="?([^";]+)"?/.exec(header ?? '');
  return match ? match[1] : null;
}

function extension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot) : '';
}

async function messageOf(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    if (body.error) return body.error;
  } catch {
    /* une archive ne répond pas en JSON */
  }
  return `Erreur ${response.status}`;
}

/**
 * Ranger un fichier produit par le serveur là où l'utilisateur le veut.
 *
 * Chrome et Edge ouvrent la fenêtre d'enregistrement native ; les autres navigateurs retombent sur
 * le téléchargement, qui range dans le dossier Téléchargements. Une copie qui sort du disque existe
 * dans les deux cas — c'est tout ce qu'on demande à ce bouton.
 *
 * Renvoie `false` quand la fenêtre s'est fermée sur Annuler : l'écran ne doit pas annoncer une
 * copie qui n'a pas eu lieu.
 */
export async function saveFromServer(url: string, fallbackName: string): Promise<boolean> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(await messageOf(response));

  const name = suggestedName(response.headers.get('Content-Disposition')) ?? fallbackName;
  const blob = await response.blob();
  const suffix = extension(name);
  const mime = blob.type.split(';')[0] || 'application/octet-stream';

  const picker = (window as WindowWithPicker).showSaveFilePicker;
  if (picker) {
    try {
      const handle = await picker({
        suggestedName: name,
        types: [
          {
            description: `Fichier ${suffix.replace('.', '').toUpperCase() || 'archive'}`,
            accept: { [mime]: [suffix || '*/*'] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return true;
    } catch (error) {
      if ((error as DOMException).name === 'AbortError') return false;
      // Le sélecteur est refusé (contexte bridé, emplacement protégé) : on télécharge.
    }
  }

  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = name;
  anchor.click();
  // L'adresse doit rester vivante jusqu'au démarrage du téléchargement : rendue trop tôt,
  // certains navigateurs annulent la copie.
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
  return true;
}
