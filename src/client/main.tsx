import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router";
import "./styles/globals.css";
import { AuthProvider } from "./components/auth-provider";
import { Layout } from "./routes/_layout";
import { LoginPage } from "./routes/login";
import { Dashboard } from "./routes/index";
import { ProjectsPage } from "./routes/projects/index";
import { ProjectDetailPage } from "./routes/projects/$id";
import { NewProjectPage } from "./routes/projects/new";
import { TemplatesPage } from "./routes/templates/index";
import { TemplateDetailPage } from "./routes/templates/$id";
import { NewTemplatePage } from "./routes/templates/new";
import { ProvidersPage } from "./routes/providers/index";
import { ProviderDetailPage } from "./routes/providers/$id";
import { NewProviderPage } from "./routes/providers/new";
import { SendLogsPage } from "./routes/send-logs";
import { WebhookLogsPage } from "./routes/webhook-logs";
import { Toaster } from "@/components/ui/sonner";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="*"
          element={
            <AuthProvider>
              <Layout>
                <Routes>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/projects" element={<ProjectsPage />} />
                  <Route path="/projects/new" element={<NewProjectPage />} />
                  <Route path="/projects/:id" element={<ProjectDetailPage />} />
                  <Route path="/templates" element={<TemplatesPage />} />
                  <Route path="/templates/new" element={<NewTemplatePage />} />
                  <Route path="/templates/:id" element={<TemplateDetailPage />} />
                  <Route path="/providers" element={<ProvidersPage />} />
                  <Route path="/providers/new" element={<NewProviderPage />} />
                  <Route path="/providers/:id" element={<ProviderDetailPage />} />
                  <Route path="/send-logs" element={<SendLogsPage />} />
                  <Route path="/webhook-logs" element={<WebhookLogsPage />} />
                </Routes>
              </Layout>
            </AuthProvider>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
      <Toaster />
    </StrictMode>,
  );
}
