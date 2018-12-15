#!/usr/bin/env node
const { execSync } = require("child_process");
const concurrently = require("concurrently");
const colors = ["green", "yellow", "blue", "magenta", "cyan"];

const workspaces = Object.keys(JSON.parse(execSync("yarn workspaces info")));
const regexText = process.argv.slice(2).join("|") || ".*";
console.log(
  `Launching watch scripts for workspace packages matching regex /${regexText}/`
);

const regex = new RegExp(process.argv[2] || ".*");
const targets = workspaces.filter(package => regex.test(package));
if (!targets.length) {
  console.error("No workspace package matched. Not doing anything.");
  console.error("These are the package names to check against:");
  console.error(workspaces);
  process.exit(1);
}

console.log(
  `Running watch scripts for:\n${targets
    .map(package => "-  " + package)
    .join("\n")}`
);

concurrently(
  targets.map((package, index) => ({
    command: JSON.stringify(`yarn workspace ${package} run watch`),
    name: targets[index],
    prefixColor: colors[index % colors.length]
  }))
);
