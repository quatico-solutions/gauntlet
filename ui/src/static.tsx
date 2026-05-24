import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./app.css";
import { StaticRunPage } from "./components/StaticRunPage";

// BrowserRouter is required — TranscriptView and RunDetail both use router
// hooks (useParams, Link) and will throw without a router context.
const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <BrowserRouter>
        <StaticRunPage />
      </BrowserRouter>
    </StrictMode>
  );
}
