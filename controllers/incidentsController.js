// Exemple de contrôleur pour obtenir tous les incidents
const incidents = [
  { id: 1, title: 'Vol dans le parc', description: 'Un téléphone volé dans le parc central.' },
  { id: 2, title: 'Accident de voiture', description: 'Un accident sur la rue principale.' }
];

module.exports.getAllIncidents = (req, res) => {
  res.json({ incidents });
};
