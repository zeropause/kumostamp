import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { UiProvider } from "./components/ui";
import { loadAccount } from "./lib/account";
import { start } from "./lib/store";
import { startSync } from "./lib/sync";
import "./styles/tokens.css";
import "./styles/app.css";
import "./styles/landing.css";

start();
loadAccount();
startSync();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <UiProvider>
        <App />
      </UiProvider>
    </BrowserRouter>
  </StrictMode>,
);
