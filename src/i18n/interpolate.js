function interpolate(template, values = {}) {
  return String(template).replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (match, key) => (
    Object.hasOwn(values, key) ? String(values[key]) : match
  ));
}

module.exports = { interpolate };
