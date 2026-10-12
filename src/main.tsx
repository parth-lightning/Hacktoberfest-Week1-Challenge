import React from "react";
import ReactDOM from "react-dom/client";
import App from "./site/App";
import LandingPage from "./site/LandingPage";
import "./site/styles.css";

const RootPage = window.location.pathname === "/app" ? App : LandingPage;

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch((error: unknown) => {
      console.error("WildPack service worker registration failed.", error);
    });
  });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RootPage />
  </React.StrictMode>,
);
