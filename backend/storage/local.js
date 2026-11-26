const fs = require("node:fs");
const path = require("node:path");
const multer = require("multer");

function safeStoredName(originalName) {
  const basename = path.basename(String(originalName || "upload"));
  return Date.now() + "-" + basename.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function createLocalStorage({ root }) {
  const directory = path.resolve(root);
  fs.mkdirSync(directory, { recursive: true });

  return {
    provider: "local",
    multerStorage() {
      return multer.diskStorage({
        destination: (_req, _file, callback) => callback(null, directory),
        filename: (_req, file, callback) => callback(null, safeStoredName(file.originalname))
      });
    },
    resolveStoredFile(reference) {
      const filename = path.basename(String(reference || ""));
      if (!filename || filename === "." || filename === "..") return null;
      const resolved = path.resolve(directory, filename);
      return path.dirname(resolved) === directory ? resolved : null;
    },
    exists(reference) {
      const resolved = this.resolveStoredFile(reference);
      return Boolean(resolved && fs.existsSync(resolved) && fs.statSync(resolved).isFile());
    }
  };
}

module.exports = { createLocalStorage, safeStoredName };
