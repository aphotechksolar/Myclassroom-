const { createLocalStorage } = require("./local");

/**
 * Storage provider boundary. Local disk remains the supported provider for
 * development and backwards compatibility. Private object storage is added
 * only after its authorization and signed-download contract is tested.
 */
function createStorage(options = {}) {
  const provider = options.provider || process.env.STORAGE_DRIVER || "local";
  if (provider === "local") {
    if (!options.root) throw new Error("A local storage root is required");
    return createLocalStorage({ root: options.root });
  }
  throw new Error(`Unsupported STORAGE_DRIVER "${provider}". Only "local" is available in this release.`);
}

module.exports = { createStorage };
