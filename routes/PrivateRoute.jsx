// backend-admin/routes/PrivateRoute.jsx
import React from "react";
import { Navigate, useLocation } from "react-router-dom";

/**
 * Protège une route : exige un token en localStorage.
 * Redirige vers /login si non connecté.
 */
export default function PrivateRoute({ children }) {
  const token = localStorage.getItem("token");
  const location = useLocation();

  if (!token) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return children;
}
