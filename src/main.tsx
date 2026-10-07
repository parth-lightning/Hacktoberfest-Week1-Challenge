import React from "react";
import ReactDOM from "react-dom/client";
import "@designcodeio/threeui/style.css";
import App from "./site/App";
import "./site/styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
