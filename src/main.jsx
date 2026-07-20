import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";

function resolveTheme(pref) {
  if (pref === "light" || pref === "dark") return pref;
  try {
    if (window.matchMedia("(prefers-color-scheme: dark)").matches) return "dark";
    if (window.matchMedia("(prefers-color-scheme: light)").matches) return "light";
  } catch {
    /* ignore */
  }
  const h = new Date().getHours();
  return h >= 7 && h < 19 ? "light" : "dark";
}

// Apply resolved theme before React hydrates (no grey / Chimney Dust)
try {
  let pref = localStorage.getItem("senditto_db_studio_theme") || "auto";
  if (pref === "grey") {
    pref = "auto";
    localStorage.setItem("senditto_db_studio_theme", "auto");
  }
  const resolved = resolveTheme(pref);
  document.documentElement.setAttribute("data-theme", resolved);
  document.documentElement.style.background = resolved === "dark" ? "#12151a" : "#f6f7f9";
  if (document.body) {
    document.body.style.background = resolved === "dark" ? "#12151a" : "#f6f7f9";
  }
} catch {
  document.documentElement.setAttribute("data-theme", "light");
  document.documentElement.style.background = "#f6f7f9";
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
