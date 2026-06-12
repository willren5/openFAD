const path = require("node:path");

const USER_DATA_DIR_ENV = "OPENFAD_MOTION_USER_DATA_DIR";

function applyUserDataDirOverride({
  app,
  env = process.env
} = {}) {
  const override = normalizeUserDataDir(env[USER_DATA_DIR_ENV]);
  if (!override) return null;
  app.setPath("userData", override);
  return override;
}

function normalizeUserDataDir(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return null;
  return path.resolve(raw);
}

module.exports = {
  USER_DATA_DIR_ENV,
  applyUserDataDirOverride,
  normalizeUserDataDir
};
