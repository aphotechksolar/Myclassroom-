const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const net = require("node:net");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const platformKey = "test-platform-owner-key-that-is-at-least-32-characters";
let server;
let baseUrl;
let dataDir;
let uploadDir;

async function unusedPort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const port = probe.address().port;
      probe.close(error => error ? reject(error) : resolve(port));
    });
  });
}

async function request(route, { method = "GET", body, token, platform = false } = {}) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (token) headers.authorization = `Bearer ${token}`;
  if (platform) headers["x-platform-owner-key"] = platformKey;
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let payload = null;
  const text = await response.text();
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = text; }
  }
  return { status: response.status, body: payload };
}

async function createSchool({ name, slug, adminName, email }) {
  const result = await request("/api/platform/institutions", {
    method: "POST",
    platform: true,
    body: {
      name,
      slug,
      institution_type: "secondary",
      country_code: "NG",
      timezone: "Africa/Lagos",
      currency_code: "NGN",
      admin_name: adminName,
      admin_email: email,
      admin_password: "TestSchoolAdmin!2026"
    }
  });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  return result.body;
}

async function login(email) {
  const result = await request("/api/auth/login", {
    method: "POST",
    body: { email, password: "TestSchoolAdmin!2026" }
  });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return result.body;
}

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "myclassroom-test-data-"));
  uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), "myclassroom-test-uploads-"));
  const port = await unusedPort();
  baseUrl = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ["server.js"], {
    cwd: __dirname.replace(/[\\/]test$/, ""),
    env: {
      ...process.env,
      NODE_ENV: "test",
      PORT: String(port),
      JWT_SECRET: "integration-test-jwt-secret-at-least-32-characters",
      PLATFORM_OWNER_KEY: platformKey,
      MYCLASSROOM_DATA_DIR: dataDir,
      MYCLASSROOM_UPLOADS_DIR: uploadDir,
      SEED_DEMO_DATA: "false"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let output = "";
  server.stdout.on("data", chunk => { output += chunk.toString(); });
  server.stderr.on("data", chunk => { output += chunk.toString(); });
  for (let attempt = 0; attempt < 80; attempt++) {
    if (server.exitCode !== null) throw new Error(`Test server exited early: ${output}`);
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  server.kill("SIGTERM");
  throw new Error(`Test server did not become ready: ${output}`);
});

after(() => {
  if (server && server.exitCode === null) server.kill("SIGTERM");
  for (const directory of [dataDir, uploadDir]) {
    if (directory) fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("platform onboarding, login, tenant isolation and suspension are enforced", async () => {
  const denied = await request("/api/platform/institutions");
  assert.equal(denied.status, 401, "platform-owner endpoints reject requests without the secret");

  const schoolA = await createSchool({
    name: "Northfield Secondary School",
    slug: "northfield-secondary",
    adminName: "Northfield Admin",
    email: "northfield.admin@example.test"
  });
  const schoolB = await createSchool({
    name: "Lakeside College",
    slug: "lakeside-college",
    adminName: "Lakeside Admin",
    email: "lakeside.admin@example.test"
  });

  const adminA = await login("northfield.admin@example.test");
  const adminB = await login("lakeside.admin@example.test");
  assert.equal(adminA.user.institution_id, schoolA.institution.id);
  assert.equal(adminA.user.institution_role, "school_admin");
  assert.equal(adminB.user.institution_id, schoolB.institution.id);

  const createdClass = await request("/api/classes", {
    method: "POST",
    token: adminA.token,
    body: { name: "Northfield SS1", code: "NORTH-SS1", description: "Tenant isolation test" }
  });
  assert.equal(createdClass.status, 200, JSON.stringify(createdClass.body));
  assert.equal(createdClass.body.institution_id, schoolA.institution.id);

  const dashboardA = await request("/api/dashboard", { token: adminA.token });
  assert.equal(dashboardA.status, 200);
  assert.equal(dashboardA.body.role, "admin");
  assert.equal(dashboardA.body.stats.classes, 1);

  const classesB = await request("/api/classes", { token: adminB.token });
  assert.equal(classesB.status, 200);
  assert.deepEqual(classesB.body, [], "a different school's administrator must not see the first school's class");

  const suspended = await request(`/api/platform/institutions/${schoolA.institution.id}/status`, {
    method: "PATCH",
    platform: true,
    body: { status: "suspended" }
  });
  assert.equal(suspended.status, 200);

  const blockedDashboard = await request("/api/dashboard", { token: adminA.token });
  assert.equal(blockedDashboard.status, 403, "suspending a school revokes access for its existing sessions");

  const stillActiveDashboard = await request("/api/dashboard", { token: adminB.token });
  assert.equal(stillActiveDashboard.status, 200, "suspending one school must not affect another school");
});
