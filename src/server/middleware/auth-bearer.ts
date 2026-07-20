import { createMiddleware } from "hono/factory";
import type { Env } from "../env";
import { constantTimeEqual } from "../lib/constant-time";
import { getProject, type Project } from "../lib/db/projects";

type BearerEnv = {
	Bindings: Env;
	Variables: { project: Project };
};

export const authBearer = createMiddleware<BearerEnv>(async (c, next) => {
	const authHeader = c.req.header("authorization");
	if (!authHeader?.startsWith("Bearer ")) {
		return c.json(
			{ error: { code: "auth_missing", message: "Missing Authorization header" } },
			401,
		);
	}

	const token = authHeader.slice(7);
	const projectId = c.req.param("projectId");
	if (!projectId) {
		return c.json({ error: { code: "invalid_request", message: "Missing projectId" } }, 400);
	}

	const project = await getProject(c.env.DB, projectId);
	if (!project) {
		return c.json({ error: { code: "project_not_found", message: "Project not found" } }, 404);
	}

	if (!constantTimeEqual(project.webhook_token, token)) {
		return c.json({ error: { code: "auth_invalid", message: "Invalid token" } }, 403);
	}

	c.set("project", project);
	return next();
});
