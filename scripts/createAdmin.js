const mongoose = require("mongoose");
const Admin = require("../models/Admin");

mongoose.connect("mongodb://localhost:27017/backend_admin", {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

const createAdmin = async () => {
  const existing = await Admin.findOne({ username: "admin" });

  if (existing) {
    console.log("⚠️ L'utilisateur 'admin' existe déjà.");
    mongoose.disconnect();
    return;
  }

  const admin = new Admin({
    username: "admin",
    password: "123456",
  });

  await admin.save();
  console.log("✅ Utilisateur 'admin' créé avec mot de passe '123456'");
  mongoose.disconnect();
};

createAdmin();
