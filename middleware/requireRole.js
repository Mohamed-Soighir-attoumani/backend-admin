module.exports = function requireRole(minRole = 'admin') {
  const rank = { user: 1, admin: 2, superadmin: 3 };
  const required = rank[minRole] ?? rank.admin;

  return (req, res, next) => {
    const role = req.user?.role;
    if (!role) return res.status(401).json({ message: 'Non connecté' });

    const have = rank[role] ?? 0;
    if (have >= required) return next();

    return res.status(403).json({ message: 'Accès interdit' });
  };
};
