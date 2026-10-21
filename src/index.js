const config = require("./core/config");
const doctor = require("./core/doctor");
const init = require("./core/init");
const initializer = require("./core/initializer");
const i18n = require("./i18n");
const language = require("./core/language");
const managedFiles = require("./core/managed-files");
const project = require("./core/project");
const validation = require("./core/validation");

module.exports = {
  ...config,
  ...doctor,
  ...init,
  ...initializer,
  ...i18n,
  ...language,
  ...managedFiles,
  ...project,
  ...validation,
};
