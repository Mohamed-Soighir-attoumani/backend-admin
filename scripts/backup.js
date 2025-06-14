// scripts/backup.js
const { execSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

async function runBackup() {
  const filename = `dump-${Date.now()}.gz`;

  /* ------------------------------------------------------------------
     ► VERSION LOCALE  (plus de Docker)
     ------------------------------------------------------------------ */
  const dumpCmd =
    'mongodump --uri="mongodb://localhost:27017/backend_admin" --archive --gzip';

  execSync(`${dumpCmd} > ${filename}`, {
    stdio: 'inherit',
    shell: true,      // sous Windows : redirection ">" gérée par cmd.exe
  });

  /* ------------------------------------------------------------------ */
  /* Déplacement + meta JSON                                            */
  /* ------------------------------------------------------------------ */
  const backupsDir = path.join(__dirname, '..', 'backups');
  if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir);
  const dest = path.join(backupsDir, filename);
  fs.renameSync(filename, dest);

  const meta = {
    date: new Date().toISOString(),
    size: (fs.statSync(dest).size / 1e6).toFixed(1),
  };
  fs.writeFileSync(path.join(backupsDir, 'latest.json'), JSON.stringify(meta));

  return meta;
}

module.exports = runBackup;

/* Exécution directe -------------------------------------------------- */
if (require.main === module) {
  runBackup()
    .then(meta => console.log('Sauvegarde OK :', meta))
    .catch(err  => console.error('Sauvegarde KO :', err));
}
