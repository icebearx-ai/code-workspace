const config = require("./core/config");
const doctor = require("./core/doctor");
const init = require("./core/init");
const initializer = require("./core/initializer");
const i18n = require("./i18n");
const language = require("./core/language");
const managedFiles = require("./core/managed-files");
const monitor = require("./monitor");
const monitorPage = require("./monitor/page");
const project = require("./core/project");
const validation = require("./core/validation");
const extensionRuntime = require("./core/extension-runtime");
const extensionRuntimeContract = require("./core/extension-runtime-contract");
const hooks = require("./hooks");
const hookAdapters = require("./hooks/adapters");

module.exports = {
  ...config,
  ...doctor,
  ...init,
  ...initializer,
  ...i18n,
  ...language,
  ...managedFiles,
  ...monitor,
  ...monitorPage,
  ...project,
  ...validation,
  ...extensionRuntime,
  ...extensionRuntimeContract,
  ...hooks,
  ...hookAdapters,
};
