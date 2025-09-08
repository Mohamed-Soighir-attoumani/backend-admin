// backend/models/Admin.js
// Alias propre : réutilise exactement le même modèle/collection que User.
// Ainsi, tout code qui importe "Admin" pointe sur la collection "users".

const UserModel = require('./User');
module.exports = UserModel;
