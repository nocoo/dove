import { LinkProvider, ThemeProvider, Toaster, TooltipProvider } from "@nocoo/basalt";
import { AccentProvider } from "@nocoo/basalt/providers/accent";
import type { ReactNode } from "react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Link, Route, Routes } from "react-router";
import "./styles/globals.css";
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

function AppLink({
	href,
	className,
	children,
}: {
	href: string;
	className?: string;
	children?: ReactNode;
}) {
	if (/^(?:https?:|mailto:|tel:)/.test(href)) {
		return (
			<a href={href} className={className}>
				{children}
			</a>
		);
	}
	return (
		<Link to={href} className={className}>
			{children}
		</Link>
	);
}

function App() {
	return (
		<ThemeProvider>
			<AccentProvider
				defaultAccent="primary"
				paletteOverrides={{
					primary: { light: "342.8 46.5% 57.5%", dark: "340 40% 48%" },
				}}
			>
				<LinkProvider render={AppLink}>
					<TooltipProvider>
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
					</TooltipProvider>
				</LinkProvider>
			</AccentProvider>
		</ThemeProvider>
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
