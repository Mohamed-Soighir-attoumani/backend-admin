const mongoose = require("mongoose");
const Admin = require("../models/Admin");

mongoose.connect("mongodb://localhost:27017/backend_admin", {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

const resetPassword = async () => {
  try {
    const admin = await Admin.findOneAndUpdate(
      { username: "admin" },
      { $set: { password: "123456" } },
      { new: true }
    );

    if (!admin) {
      console.log("❌ Utilisateur admin non trouvé.");
    } else {
      console.log("✅ Mot de passe réinitialisé à '123456'");
    }
  } catch (err) {
    console.error("Erreur :", err);
  } finally {
    mongoose.disconnect();
  }
};

resetPassword();
