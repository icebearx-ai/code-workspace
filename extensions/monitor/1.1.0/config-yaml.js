const fs = require("node:fs");

function scalar(value) {
  if (value === null) return "null";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  return JSON.stringify(String(value));
}

function dumpYaml(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Monitor configuration must be a mapping");
  const lines = [];
  const write = (mapping, indent) => {
    for (const [key, item] of Object.entries(mapping)) {
      const prefix = `${" ".repeat(indent)}${key}:`;
      if (item && typeof item === "object" && !Array.isArray(item)) {
        lines.push(prefix);
        write(item, indent + 2);
      } else {
        lines.push(`${prefix} ${scalar(item)}`);
      }
    }
  };
  write(value, 0);
  return `${lines.join("\n")}\n`;
}

function parseScalar(value) {
  const text = value.trim();
  if (text === "null" || text === "~") return null;
  if (text === "true") return true;
  if (text === "false") return false;
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text)) return Number(text);
  if ((text.startsWith("\"") && text.endsWith("\"")) || (text.startsWith("'") && text.endsWith("'"))) {
    if (text.startsWith("\"")) return JSON.parse(text);
    return text.slice(1, -1).replace(/''/g, "'");
  }
  return text;
}

function loadYaml(text) {
  const root = {};
  const stack = [{ indent: -1, value: root }];
  for (const [index, rawLine] of String(text).split(/\r?\n/).entries()) {
    if (!rawLine.trim() || rawLine.trimStart().startsWith("#")) continue;
    if (/\t/.test(rawLine)) throw new Error(`Invalid YAML indentation on line ${index + 1}`);
    const indent = rawLine.length - rawLine.trimStart().length;
    if (indent % 2 !== 0) throw new Error(`Invalid YAML indentation on line ${index + 1}`);
    const match = rawLine.trim().match(/^([A-Za-z_][A-Za-z0-9_-]*):(?:\s+(.*))?$/);
    if (!match) throw new Error(`Invalid YAML mapping on line ${index + 1}`);
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    if (indent > stack[stack.length - 1].indent + 2) throw new Error(`Invalid YAML indentation on line ${index + 1}`);
    const parent = stack[stack.length - 1].value;
    const key = match[1];
    if (Object.prototype.hasOwnProperty.call(parent, key)) throw new Error(`Duplicate YAML key on line ${index + 1}: ${key}`);
    if (match[2] === undefined || match[2] === "") {
      parent[key] = {};
      stack.push({ indent, value: parent[key] });
    } else {
      parent[key] = parseScalar(match[2]);
    }
  }
  return root;
}

function loadYamlFile(file) {
  return loadYaml(fs.readFileSync(file, "utf8"));
}

module.exports = { dumpYaml, loadYaml, loadYamlFile };
