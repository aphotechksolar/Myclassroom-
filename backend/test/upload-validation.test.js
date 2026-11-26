const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { validateMaterialFile, validateMaterialUpload } = require("../uploads/validation");

function fixture(extension, mimetype, bytes) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "myclassroom-upload-"));
  const filePath = path.join(directory, "sample" + extension);
  fs.writeFileSync(filePath, bytes);
  return { directory, file: { path: filePath, originalname: "sample" + extension, mimetype } };
}

test("accepts supported file signatures with matching declared types", () => {
  const cases = [
    [".pdf", "application/pdf", "%PDF-1.7\nexample"],
    [".png", "image/png", Buffer.from([137,80,78,71,13,10,26,10,0])],
    [".jpg", "image/jpeg", Buffer.from([255,216,255,217])],
    [".webp", "image/webp", Buffer.from("RIFF0000WEBPdata")],
    [".gif", "image/gif", "GIF89a"],
    [".txt", "text/plain", "Lesson notes\nWeek one"],
    [".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", Buffer.from([80,75,3,4,0,0])]
  ];
  for (const [ext, mime, bytes] of cases) {
    const item = fixture(ext, mime, bytes);
    try { assert.deepEqual(validateMaterialFile(item.file), { valid: true }, ext); }
    finally { fs.rmSync(item.directory, { recursive: true, force: true }); }
  }
});

test("rejects unsupported active-content extensions", () => {
  const item = fixture(".html", "text/html", "<script>alert(1)</script>");
  try { assert.equal(validateMaterialFile(item.file).valid, false); }
  finally { fs.rmSync(item.directory, { recursive: true, force: true }); }
});

test("rejects MIME and extension mismatches", () => {
  const item = fixture(".pdf", "image/png", "%PDF-1.7");
  try { assert.match(validateMaterialFile(item.file).error, /declared content type/); }
  finally { fs.rmSync(item.directory, { recursive: true, force: true }); }
});

test("rejects spoofed and empty files", () => {
  const spoofed = fixture(".pdf", "application/pdf", "not a PDF");
  const empty = fixture(".pdf", "application/pdf", "");
  try {
    assert.match(validateMaterialFile(spoofed.file).error, /content does not match/);
    assert.match(validateMaterialFile(empty.file).error, /Empty files/);
  } finally {
    fs.rmSync(spoofed.directory, { recursive: true, force: true });
    fs.rmSync(empty.directory, { recursive: true, force: true });
  }
});

test("removes a rejected file and responds with HTTP 400", () => {
  const item = fixture(".exe", "application/octet-stream", "MZ");
  let response;
  const res = { status(code) { response = { code }; return this; }, json(body) { response.body = body; return response; } };
  try {
    validateMaterialUpload({ file: item.file }, res, () => assert.fail("invalid file must not continue"));
    assert.equal(response.code, 400);
    assert.equal(fs.existsSync(item.file.path), false);
  } finally { fs.rmSync(item.directory, { recursive: true, force: true }); }
});
