// scripts/restoreTest.js
const { execSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

module.exports = function restoreTest() {
  const backupsDir = path.join(__dirname, '..', 'backups');
  const metaPath   = path.join(backupsDir, 'latest.json');
  if (!fs.existsSync(metaPath)) throw new Error('Aucune sauvegarde disponible');

  const dumpFile   = fs.readdirSync(backupsDir)
                       .filter(f => f.endsWith('.gz'))
                       .sort()               // dernier fichier
                       .pop();
  const dumpPath   = path.join(backupsDir, dumpFile);
  const tempDbName = `restore_test_${Date.now()}`;

  const start = Date.now();
  // 1) restaurer vers une base temporaire
  execSync(
    `mongorestore --nsFrom="backend_admin.*" --nsTo="${tempDbName}.*" ` +
    `--gzip --archive="${dumpPath}"`,
    { stdio: 'inherit', shell: true }
  );
  // 2) tester qu’on lit une collection
  execSync(
    `mongo ${tempDbName} --quiet --eval "db.getCollectionNames()[0]"`,
    { stdio: 'inherit', shell: true }
  );
  // 3) drop la base
  execSync(
    `mongo ${tempDbName} --quiet --eval "db.dropDatabase()"`,
    { stdio: 'inherit', shell: true }
  );
  const duration = ((Date.now() - start) / 1000).toFixed(1);
  return { ok: true, duration };
};
