import { spawnSync } from "node:child_process";

import type { CommandExecution, CommandRunner } from "./model.ts";

export const runCommand: CommandRunner = (command, args, cwd): CommandExecution => {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    shell: process.platform === "win32",
  });

  return {
    exitCode: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error?.message,
  };
};
