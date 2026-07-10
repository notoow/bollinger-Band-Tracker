import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BandDashboard } from "./BandDashboard";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BandDashboard />
  </StrictMode>,
);
