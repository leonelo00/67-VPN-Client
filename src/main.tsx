import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

// Disable browser context menu and browser shortcuts for a native app feel
window.addEventListener("contextmenu", (e) => {
  const target = e.target as HTMLElement | null;
  if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) {
    return;
  }
  e.preventDefault();
});

window.addEventListener("keydown", (e) => {
  const key = e.key.toLowerCase();
  if (
    e.key === "F5" ||
    e.key === "F12" ||
    e.key === "F3" ||
    (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) ||
    ((e.ctrlKey || e.metaKey) &&
      ["r", "p", "s", "u", "f", "g", "h", "j", "w", "+", "-", "=", "0"].includes(key)) ||
    ((e.ctrlKey || e.metaKey) && e.shiftKey && ["i", "j", "c"].includes(key))
  ) {
    e.preventDefault();
  }
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
