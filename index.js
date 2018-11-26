#!/usr/bin/env node
const { execSync } = require("child_process");
const concurrently = require("concurrently");
const colors = ["green", "yellow", "blue", "magenta", "cyan"];

const workspaces = JSON.parse(execSync("yarn workspaces info"));
const regex = new RegExp(process.argv[2] || ".*");
const targets = Object.keys(workspaces).filter(package => regex.test(package));

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
