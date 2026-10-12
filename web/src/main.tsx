import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { UiProvider } from "./components/ui";
import { start } from "./lib/store";
import "./styles/tokens.css";
import "./styles/app.css";
import "./styles/landing.css";

start();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <UiProvider>
        <App />
      </UiProvider>
    </BrowserRouter>
  </StrictMode>,
);
