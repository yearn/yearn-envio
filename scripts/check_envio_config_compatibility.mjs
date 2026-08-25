import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import * as Config from "envio/src/Config.res.mjs";
import * as Core from "envio/src/Core.res.mjs";

const indexerDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryDir = indexerDir;
const configPaths = ["config.yaml", "schema.graphql"];

const readArgument = (name) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
};

const baseRef =
  readArgument("--base-ref") ||
  (process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : undefined);

if (!baseRef) {
  console.error(
    "Missing base ref. Pass --base-ref <git-ref> or set GITHUB_BASE_REF.",
  );
  process.exit(2);
}

const git = (...args) =>
  execFileSync("git", args, {
    cwd: repositoryDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trimEnd();

const readFromGit = (ref, path) => git("show", `${ref}:${path}`);

const envioVersionFromPackage = (packageJson) => {
  const rawVersion =
    packageJson.dependencies?.envio ?? packageJson.devDependencies?.envio;
  if (!rawVersion) {
    throw new Error(`No envio dependency found in ${baseRef}:package.json`);
  }

  const match = rawVersion.match(/\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/);
  if (!match) {
    throw new Error(
      `Could not determine the Envio version from dependency value "${rawVersion}"`,
    );
  }
  return match[0];
};

const parseConfig = (directory) =>
  Config.stripSensitiveData(
    JSON.parse(Core.getConfigJson("config.yaml", directory)),
  );

const baseDirectory = mkdtempSync(join(tmpdir(), "envio-config-base-"));

try {
  for (const path of configPaths) {
    const destination = join(baseDirectory, path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, readFromGit(baseRef, path));
  }

  const basePackage = JSON.parse(
    readFromGit(baseRef, "package.json"),
  );
  const baseConfig = parseConfig(baseDirectory);
  // The current Envio parser stamps its own version on every parsed config.
  // Replace the base version with the version that produced the target
  // branch's persisted config, matching what Envio stores in envio_info.
  baseConfig.version = envioVersionFromPackage(basePackage);

  const proposedConfig = parseConfig(indexerDir);
  const changedPaths = Config.diffPaths(baseConfig, proposedConfig);
  const baseSha = git("rev-parse", "--short=12", baseRef);
  const proposedSha = git("rev-parse", "--short=12", "HEAD");

  console.log(
    `Comparing Envio config ${baseRef} (${baseSha}) -> HEAD (${proposedSha})`,
  );

  if (changedPaths.length === 0) {
    console.log("No persisted Envio configuration changes detected.");
  } else {
    console.log("Envio configuration paths changed:");
    for (const path of changedPaths) {
      console.log(`  - ${path}`);
    }
  }

  if (changedPaths.length > 0) {
    const message =
      "Persisted Envio configuration changes are blocked because production has no automatic database-reset path.";
    if (process.env.GITHUB_ACTIONS === "true") {
      console.error(`::error title=Incompatible Envio configuration::${message}`);
    }
    console.error(`\n${message}`);
    process.exitCode = 1;
  }

  if (process.exitCode !== 1) {
    console.log("Envio compatibility check passed.");
  }
} catch (error) {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  if (process.env.GITHUB_ACTIONS === "true") {
    console.error(`::error title=Envio config validation failed::${message}`);
  }
  console.error(message);
  process.exitCode = 1;
} finally {
  rmSync(baseDirectory, { recursive: true, force: true });
}
