import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import { mockFetch, d1Success, makeProject } from "./helpers";

let originalFetch: typeof globalThis.fetch;
let capturedBodies: string[] = [];

beforeEach(() => {
  originalFetch = globalThis.fetch;
  capturedBodies = [];
  process.env.D1_WORKER_URL = "https://test.example.com";
  process.env.D1_WORKER_API_KEY = "test-key";
  spyOn(console, "warn").mockImplementation(() => {});
  spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("listProjects", () => {
  test("executes SELECT query", async () => {
    const proj = makeProject();
    globalThis.fetch = mockFetch(async (_input, init) => {
      capturedBodies.push(init?.body as string);
      return d1Success([proj]);
    });

    const { listProjects } = await import("@/lib/db/projects");
    const result = await listProjects();

    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe(proj.id);
    const body = JSON.parse(capturedBodies[0]!) as { sql: string };
    expect(body.sql).toContain("SELECT * FROM projects");
  });
});

describe("getProject", () => {
  test("returns project when found", async () => {
    const proj = makeProject();
    globalThis.fetch = mockFetch(async () => d1Success([proj]));

    const { getProject } = await import("@/lib/db/projects");
    const result = await getProject(proj.id);
    expect(result?.id).toBe(proj.id);
  });

  test("returns undefined when not found", async () => {
    globalThis.fetch = mockFetch(async () => d1Success([]));

    const { getProject } = await import("@/lib/db/projects");
    const result = await getProject("nonexistent");
    expect(result).toBeUndefined();
  });
});

describe("createProject", () => {
  test("generates ID and webhook token", async () => {
    globalThis.fetch = mockFetch(async (_input, init) => {
      capturedBodies.push(init?.body as string);
      return d1Success([]);
    });

    const { createProject } = await import("@/lib/db/projects");
    const result = await createProject({
      name: "Test",
      email_prefix: "noreply",
      from_name: "Test App",
    });

    expect(result.id).toHaveLength(21);
    expect(result.webhook_token).toHaveLength(48);
    expect(result.name).toBe("Test");
    const body = JSON.parse(capturedBodies[0]!) as { sql: string };
    expect(body.sql).toContain("INSERT INTO projects");
  });

  test("uses custom quotas when provided", async () => {
    globalThis.fetch = mockFetch(async () => d1Success([]));

    const { createProject } = await import("@/lib/db/projects");
    const result = await createProject({
      name: "Test",
      email_prefix: "hello",
      from_name: "Hello",
      quota_daily: 500,
      quota_monthly: 5000,
    });

    expect(result.quota_daily).toBe(500);
    expect(result.quota_monthly).toBe(5000);
  });
});

describe("updateProject", () => {
  test("updates specified fields", async () => {
    const proj = makeProject();
    let callCount = 0;
    globalThis.fetch = mockFetch(async (_input, init) => {
      callCount++;
      capturedBodies.push(init?.body as string);
      if (callCount === 1) return d1Success([proj]); // getProject
      return d1Success([]); // UPDATE
    });

    const { updateProject } = await import("@/lib/db/projects");
    const result = await updateProject(proj.id, { name: "Updated" });

    expect(result?.name).toBe("Updated");
    // First call is getProject, second is UPDATE
    const updateBody = JSON.parse(capturedBodies[1]!) as { sql: string };
    expect(updateBody.sql).toContain("UPDATE projects SET");
  });

  test("returns undefined when project not found", async () => {
    globalThis.fetch = mockFetch(async () => d1Success([]));

    const { updateProject } = await import("@/lib/db/projects");
    const result = await updateProject("nonexistent", { name: "New" });
    expect(result).toBeUndefined();
  });
});

describe("deleteProject", () => {
  test("deletes existing project and returns true", async () => {
    const proj = makeProject();
    let callCount = 0;
    globalThis.fetch = mockFetch(async () => {
      callCount++;
      if (callCount === 1) return d1Success([proj]); // getProject
      return d1Success([]); // DELETE
    });

    const { deleteProject } = await import("@/lib/db/projects");
    const result = await deleteProject("proj_123");
    expect(result).toBe(true);
  });

  test("returns false when project not found", async () => {
    globalThis.fetch = mockFetch(async () => d1Success([]));

    const { deleteProject } = await import("@/lib/db/projects");
    const result = await deleteProject("nonexistent");
    expect(result).toBe(false);
  });
});

describe("regenerateToken", () => {
  test("returns new 48-char token", async () => {
    const proj = makeProject();
    let callCount = 0;
    globalThis.fetch = mockFetch(async () => {
      callCount++;
      if (callCount === 1) return d1Success([proj]); // getProject
      return d1Success([]); // UPDATE
    });

    const { regenerateToken } = await import("@/lib/db/projects");
    const token = await regenerateToken("proj_123");
    expect(token).toHaveLength(48);
  });

  test("returns undefined when project not found", async () => {
    globalThis.fetch = mockFetch(async () => d1Success([]));

    const { regenerateToken } = await import("@/lib/db/projects");
    const token = await regenerateToken("nonexistent");
    expect(token).toBeUndefined();
  });
});
