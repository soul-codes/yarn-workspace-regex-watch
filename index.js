#!/usr/bin/env node
const { execSync } = require("child_process");
const version = require("./package.json").version;
const commander = require("commander");
const chalk = require("chalk");
const path = require("path");
const toposort = require("toposort");
const concurrently = require("concurrently");
const colors = ["green", "yellow", "blue", "magenta", "cyan"];

commander
  .usage("[script] [regexes...]")
  .version(version)
  .option(
    "-d, --downstream",
    "Also invoke the script of the dependent (downstream) packages"
  )
  .option(
    "-u, --upstream",
    "Also invoke the script of the dependency (upstream) packages"
  )
  .option("-p, --parallel", "Invoke the dependencies in parallel")
  .option(
    "-s, --stagger [duration]",
    "Stagger parallel runs by [duration] seconds"
  )
  .option("-c, --cwd [path]", "Specifies the yarn workspace directory")
  .parse(process.argv);

const {
  args: [script, ...regexes],
  upstream,
  downstream,
  parallel,
  cwd,
  stagger
} = commander;

if (!script) {
  console.log(chalk.red(`Script missing.`));
  process.exit(1);
}
if (cwd && typeof cwd !== "string") {
  console.log(chalk.red(`Missing value for --cwd.`));
  process.exit(1);
}
if (stagger && typeof stagger !== "string") {
  console.log(chalk.red(`Missing value for --stagger.`));
  process.exit(1);
}
const normalizedStagger = Number(stagger) || 0;

const normalizedCwd = path.resolve(process.cwd(), cwd || __dirname);
console.log(`Yarn workspace target: ${chalk.cyan(normalizedCwd)}`);

let workspaceInfoJson = "";
try {
  workspaceInfoJson = execSync("yarn --silent workspaces info", {
    cwd: normalizedCwd
  }).toString();
} catch (error) {
  if (error.code) {
    console.error(
      chalk.red(`Could not spawn the child process. ${error.message}`)
    );
    process.exit(1);
  }
  console.error(
    chalk.red(`Could not get yarn workspace information. ${error.message}`)
  );
  process.exit(1);
}

const workspaceInfo = JSON.parse(workspaceInfoJson);
const workspaceNames = Object.keys(workspaceInfo);
const workspaceDependencies = workspaceNames.reduce(
  (dependencies, workspaceName) => {
    workspaceInfo[workspaceName].workspaceDependencies.forEach(dependency => {
      dependencies.push([dependency, workspaceName]);
    });
    return dependencies;
  },
  []
);

workspaceDependencies.forEach(([upstream, downstream]) =>
  (
    workspaceInfo[upstream].dependentWorkspaces ||
    (workspaceInfo[upstream].dependentWorkspaces = [])
  ).push(downstream)
);

let toposortedDependencies;
try {
  toposortedDependencies = toposort(workspaceDependencies);
} catch (error) {
  console.error(
    chalk.red(`Had trouble processing workspace dependencies. ${error.message}`)
  );
  process.exit(1);
}

let regexText;
if (!regexes.length) {
  regexText = ".*";
  console.log(`Running ${chalk.cyan(script)} for all workspace packages`);
} else {
  regexText = regexes.join("|") || ".*";
  console.log(
    `Running ${chalk.cyan(
      script
    )} for workspace packages matching regex ${chalk.cyan(`/${regexText}/`)}`
  );
}
console.log(
  `Upstream propagation ${upstream ? chalk.yellow("ON") : chalk.gray("OFF")}`
);
console.log(
  `Downstream propagation ${
    downstream ? chalk.yellow("ON") : chalk.gray("OFF")
  }`
);
console.log(
  `Parallel mode ${
    parallel
      ? chalk.yellow("ON") +
        ` with ${chalk.yellow(normalizedStagger)}s staggering`
      : chalk.gray("OFF")
  }`
);

const regex = new RegExp(regexText);
const primaryTargets = workspaceNames.filter(package => regex.test(package));
if (!primaryTargets.length) {
  console.error(chalk.red("No workspace package matched. Not doing anything."));
  console.error(chalk.red("These are the package names to check against:"));
  console.error(
    chalk.red(workspaceNames.map(package => "- " + package).join("\n"))
  );
  process.exit(1);
}

const downstreamTargets = [];
const upstreamTargets = [];
const allTargets = new Set(primaryTargets);

if (upstream) {
  let last = primaryTargets;
  while (last.length) {
    const dependencies = [];
    last.map(package =>
      workspaceInfo[package].workspaceDependencies.forEach(dependency => {
        if (!allTargets.has(dependency)) {
          dependencies.push(dependency);
          upstreamTargets.push(dependency);
          allTargets.add(dependency);
        }
      })
    );
    last = dependencies;
  }
}

if (downstream) {
  let last = primaryTargets;
  while (last.length) {
    const dependents = [];
    last.map(package =>
      (workspaceInfo[package].dependentWorkspaces || []).forEach(dependent => {
        if (!allTargets.has(dependent)) {
          dependents.push(dependent);
          downstreamTargets.push(dependent);
          allTargets.add(dependent);
        }
      })
    );
    last = dependents;
  }
}

const allTargetsWithScript = new Set();
let hasTargetWithoutScript = false;
allTargets.forEach(target => {
  const packageJSONPath = path.resolve(
    normalizedCwd,
    workspaceInfo[target].location,
    "package.json"
  );
  const package = require(packageJSONPath);
  const hasScript = Object.prototype.hasOwnProperty.call(
    (package && package.scripts) || {},
    script
  );
  if (hasScript) {
    allTargetsWithScript.add(target);
  } else {
    hasTargetWithoutScript = true;
  }
});

console.log(`Targets are resolved to:`);
primaryTargets
  .filter(package => allTargetsWithScript.has(package))
  .forEach(package =>
    console.log(
      "- " +
        chalk.green(package) +
        (regexes.length ? " " + chalk.yellow("(matched by regex)") : "")
    )
  );
upstreamTargets
  .filter(package => allTargetsWithScript.has(package))
  .forEach(package =>
    console.log("- " + chalk.green(package) + " " + chalk.gray("(upstream)"))
  );
downstreamTargets
  .filter(package => allTargetsWithScript.has(package))
  .forEach(package =>
    console.log("- " + chalk.green(package) + " " + chalk.gray("(downstream)"))
  );

if (hasTargetWithoutScript) {
  console.log(`Targets without the ${chalk.cyan(script)} will be ignored:`);
  primaryTargets
    .filter(package => !allTargetsWithScript.has(package))
    .forEach(package =>
      console.log(
        "- " +
          chalk.gray(package) +
          (regexes.length ? " " + chalk.grey("(matched by regex)") : "")
      )
    );
  upstreamTargets
    .filter(package => !allTargetsWithScript.has(package))
    .forEach(package =>
      console.log("- " + chalk.gray(package) + " " + chalk.grey("(upstream)"))
    );
  downstreamTargets
    .filter(package => !allTargetsWithScript.has(package))
    .forEach(package =>
      console.log("- " + chalk.gray(package) + " " + chalk.grey("(downstream)"))
    );
}

const targetsInOrder = toposortedDependencies.filter(dependency =>
  allTargetsWithScript.has(dependency)
);

if (parallel) {
  const sleepPath = path.resolve(__dirname, "sleep.js");
  concurrently(
    targetsInOrder.map((package, index) => {
      const staggerTotal = index * normalizedStagger * 1000;
      return {
        command: JSON.stringify(
          `node ${sleepPath} ${staggerTotal} && cd ${normalizedCwd} && yarn workspace ${package} run ${script}`
        ),
        name: package,
        prefixColor: colors[index % colors.length]
      };
    }),
    {
      killOthers: ["failure"]
    }
  );
} else {
  targetsInOrder.map((package, index) => {
    console.log(
      chalk.bold(
        `Executing ${chalk.yellow(script)} on package ${chalk.yellow(package)}`
      )
    );
    try {
      execSync(`yarn workspace ${package} ${script}`, {
        cwd: normalizedCwd,
        stdio: "inherit"
      });
    } catch (error) {
      console.error(chalk.bold.red(`Encountered error at package ${package}.`));

      const remaining = targetsInOrder.slice(index);
      if (remaining.length) {
        console.error(
          chalk.bold.red(
            `The "${script}" script was not run on the remaining packages:`
          )
        );
        remaining.forEach(package => console.error(chalk.red("- " + package)));
      }
      process.exit(1);
    }
  });
}
