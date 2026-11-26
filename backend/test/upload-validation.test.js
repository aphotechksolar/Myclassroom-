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
  return {
    directory,
    file: { path: filePath, originalname: "sample" + extension, mimetype, size: Buffer.byteLength(bytes) }
  };
}

test("accepts supported files when declared type and file signature agree", () => {
  const cases = [
    [".pdf", "application/pdf", "%PDF-1.7\nexample"],
    [".png", "image/png", Buffer.from([137,80,78,71,13,10,26,10,0])],
    [".jpg", "image/jpeg", Buffer.from([0xff,0xd8,0xff,0xd9])],
    [".webp", "image/webp", Buffer.from("RIFF0000WEBPdata")],
    [".gif", "image/gif", "GIF89a"],
    [".txt", "text/plain", "Lesson notes\nWeek one"],
    [".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", Buffer.from([0x50,0x4b,0x03,0x04,0,0])]
  ];
  for (const [extension, mime, bytes] of cases) {
    const item = fixture(extension, mime, bytes);
    try { assert.deepEqual(validateMaterialFile(item.file), { valid: true }, extension); }
    finally { fs.rmSync(item.directory, { recursive: true, force: true }); }
  }
});

test("rejects executable, HTML and unsupported extensions", () => {
  const item = fixture(".html", "text/html", "<script>alert(1)</script>");
  try { assert.equal(validateMaterialFile(item.file).valid, false); }
  finally { fs.rmSync(item.directory, { recursive: true, force: true }); }
});

test("rejects extension and declared MIME mismatches", () => {
  const item = fixture(".pdf", "image/png", "%PDF-1.7");
  try { assert.match(validateMaterialFile(item.file).error, /declared content type/); }
  finally { fs.rmSync(item.directory, { recursive: true, force: true }); }
});

test("rejects files whose content does not match the extension", () => {
  const item = fixture(".pdf", "application/pdf", "not a PDF");
  try { assert.match(validateMaterialFile(item.file).error, /content does not match/); }
  finally { fs.rmSync(item.directory, { recursive: true, force: true }); }
});

test("rejects empty files", () => {
  const item = fixture(".pdf", "application/pdf", "");
  try { assert.match(validateMaterialFile(item.file).error, /Empty files/); }
  finally { fs.rmSync(item.directory, { recursive: true, force: true }); }
});

test("upload middleware removes rejected files before returning a client error", () => {
  const item = fixture(".exe", "application/octet-stream", "MZ\x00\x00");
  let response;
  const res = { status(code) { response = { code }; return this; }, json(body) { response.body = body; return response; } };
  try {
    validateMaterialUpload({ file: item.file }, res, () => assert.fail("invalid file must not continue"));
    assert.equal(response.code, 400);
    assert.equal(fs.existsSync(item.file.path), false);
  } finally { fs.rmSync(item.directory, { recursive: true, force: true }); }
});
