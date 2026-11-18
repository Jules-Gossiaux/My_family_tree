/**
 * Ce que l'application sait et doit dire à l'écran.
 *
 * Une sauvegarde qui échoue ou un fichier de réglages abîmé ne doivent pas rester dans la
 * console : personne ne lit une console, et le silence se prend pour « tout va bien ».
 */
const notices = new Set<string>();

export function notify(message: string): void {
  notices.add(message);
}

export function listNotices(): string[] {
  return [...notices];
}
