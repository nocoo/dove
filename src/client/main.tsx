import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router";
import "./styles/globals.css";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "./components/auth-provider";
import { Layout } from "./routes/_layout";
import { Dashboard } from "./routes/index";
import { ProjectDetailPage } from "./routes/projects/$id";
import { ProjectsPage } from "./routes/projects/index";
import { NewProjectPage } from "./routes/projects/new";
import { ProviderDetailPage } from "./routes/providers/$id";
import { ProvidersPage } from "./routes/providers/index";
import { NewProviderPage } from "./routes/providers/new";
import { SendLogsPage } from "./routes/send-logs";
import { TemplateDetailPage } from "./routes/templates/$id";
import { TemplatesPage } from "./routes/templates/index";
import { NewTemplatePage } from "./routes/templates/new";
import { WebhookLogsPage } from "./routes/webhook-logs";

function App() {
	return (
		<BrowserRouter>
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
				<Toaster />
			</AuthProvider>
		</BrowserRouter>
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
