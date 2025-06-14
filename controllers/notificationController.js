// controllers/notificationController.js
let notifications = [];

exports.getNotifications = (req, res) => {
  res.json({ notifications });
};

exports.createNotification = (req, res) => {
  const { title, message } = req.body;
  if (!title || !message) {
    return res.status(400).json({ error: 'Champ requis manquant' });
  }
  const newNotification = { id: Date.now().toString(), title, message };
  notifications.push(newNotification);
  res.json({ message: 'Notification créée', notification: newNotification });
};
