// src/main.jsx
/**
 * Module: React entry point
 *
 * Purpose
 * - Bootstraps the React application with HashRouter routing.
 * - Applies the saved theme immediately before first render.
 * - Initializes native push notifications (Capacitor Android).
 * - Mounts BackHandler to handle native back button presses.
 */

import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App.jsx";
import "./index.css";
import BackHandler from "./BackHandler.jsx";
import { bootstrapTheme } from "@/theme";   
import { initPush } from "@/push/initPush";


bootstrapTheme();                           // apply cached theme immediately
initPush(); // <-- register for native push on Android


ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <HashRouter>
      <BackHandler />
      <App />
    </HashRouter>
  </React.StrictMode>
);
