import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/globals.css";

function App() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-foreground">Dove</h1>
        <p className="mt-2 text-muted-foreground">Email relay service</p>
      </div>
    </div>
  );
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
