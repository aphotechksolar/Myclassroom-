const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createStorage } = require("../storage");

test("local storage adapter resolves only files inside its configured root", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "myclassroom-storage-"));
  try {
    const storage = createStorage({ provider: "local", root });
    assert.equal(storage.provider, "local");
    const stored = storage.resolveStoredFile("lesson.pdf");
    assert.equal(stored, path.join(root, "lesson.pdf"));
    assert.equal(storage.resolveStoredFile("../outside.txt"), path.join(root, "outside.txt"));
    fs.writeFileSync(stored, "test");
    assert.equal(storage.exists("lesson.pdf"), true);
    assert.equal(storage.exists("missing.pdf"), false);
    assert.equal(storage.exists("../outside.txt"), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("storage adapter rejects unsupported providers rather than falling back", () => {
  assert.throws(
    () => createStorage({ provider: "supabase", root: "/tmp/not-used" }),
    /Only "local" is available/
  );
});
