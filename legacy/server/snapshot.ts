import path from 'node:path';
import { forceBackup } from './backup';
import { db } from './db';
import { DATA_DIR } from './config';

/** Archive une sauvegarde sans démarrer le serveur : à lancer avant de toucher à la base. */
const info = await forceBackup('avant-cloud');

console.log('');
console.log('  Archive :', path.join(DATA_DIR, 'sauvegardes', info.name));
console.log('  Taille  :', (info.size / 1048576).toFixed(1), 'Mo');
console.log('');

db.close();
