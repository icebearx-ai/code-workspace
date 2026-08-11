class WorkspaceError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "WorkspaceError";
    this.code = code;
    this.details = details;
  }
}

module.exports = { WorkspaceError };
