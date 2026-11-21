import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/global.css";

try {
  const stored = window.localStorage.getItem("control.theme");
  const dark =
    stored === "dark" ||
    (stored !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
} catch {
  document.documentElement.style.colorScheme = "light";
}

if (import.meta.env.PROD) {
  const blockDevtools = (event: KeyboardEvent) => {
    const devtools =
      event.key === "F12" ||
      ((event.ctrlKey || event.metaKey) &&
        event.shiftKey &&
        ["i", "j", "c"].includes(event.key.toLowerCase()));
    if (devtools) {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  window.addEventListener("keydown", blockDevtools, true);
  window.addEventListener("contextmenu", (event) => event.preventDefault());
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
