const fs = require("node:fs");
const path = require("node:path");

const TYPES = {
  ".pdf": { kind: "pdf", mime: "application/pdf" },
  ".png": { kind: "png", mime: "image/png" },
  ".jpg": { kind: "jpeg", mime: "image/jpeg" },
  ".jpeg": { kind: "jpeg", mime: "image/jpeg" },
  ".webp": { kind: "webp", mime: "image/webp" },
  ".gif": { kind: "gif", mime: "image/gif" },
  ".txt": { kind: "text", mime: "text/plain" },
  ".docx": { kind: "zip", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  ".xlsx": { kind: "zip", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  ".pptx": { kind: "zip", mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation" }
};

function detectKind(buffer) {
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString("ascii") === "%PDF-") return "pdf";
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return "png";
  if (buffer.length >= 3 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return "jpeg";
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") return "webp";
  if (buffer.length >= 6 && ["GIF87a", "GIF89a"].includes(buffer.subarray(0, 6).toString("ascii"))) return "gif";
  if (buffer.length >= 4 && buffer[0] === 80 && buffer[1] === 75 && buffer[2] === 3 && buffer[3] === 4) return "zip";
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    if (!text.includes(String.fromCharCode(0)) && !/[\u0001-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) return "text";
  } catch {}
  return "unknown";
}

function validateMaterialFile(file) {
  if (!file || typeof file.path !== "string" || !file.path) return { valid: false, error: "A valid uploaded file is required." };
  const definition = TYPES[path.extname(String(file.originalname || "")).toLowerCase()];
  if (!definition) return { valid: false, error: "Unsupported file type. Upload PDF, PNG, JPG, WEBP, GIF, TXT, DOCX, XLSX or PPTX files." };
  let contents;
  try { contents = fs.readFileSync(file.path); } catch { return { valid: false, error: "The uploaded file could not be verified." }; }
  if (!contents.length) return { valid: false, error: "Empty files cannot be uploaded." };
  if (String(file.mimetype || "").toLowerCase() !== definition.mime) return { valid: false, error: "The file's declared content type does not match its extension." };
  if (detectKind(contents) !== definition.kind) return { valid: false, error: "The file content does not match its extension. Upload a genuine supported document or image." };
  return { valid: true };
}

function validateMaterialUpload(req, res, next) {
  if (!req.file) return next();
  const result = validateMaterialFile(req.file);
  if (result.valid) return next();
  try { fs.unlinkSync(req.file.path); } catch {}
  return res.status(400).json({ error: result.error });
}

module.exports = { detectKind, validateMaterialFile, validateMaterialUpload };
