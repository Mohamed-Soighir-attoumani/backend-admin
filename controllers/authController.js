// controllers/authController.js
const jwt = require('jsonwebtoken');

const login = (req, res) => {
  const { username, password } = req.body;

  // Admin fictif (à remplacer par une base de données plus tard)
  const admin = {
    username: 'admin',
    password: 'admin123'
  };

  if (username === admin.username && password === admin.password) {
    const token = jwt.sign({ role: 'admin', username }, process.env.JWT_SECRET, {
      expiresIn: '1h'
    });
    return res.json({ token });
  }

  res.status(401).json({ message: 'Identifiants invalides' });
};

module.exports = { login };
