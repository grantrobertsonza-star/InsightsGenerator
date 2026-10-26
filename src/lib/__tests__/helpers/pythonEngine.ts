import { spawnSync } from "node:child_process";

// Windows commonly installs `python`, whereas CI uses `python3`. A configured interpreter is
// authoritative; otherwise find the installed interpreter with the actual engine prerequisites.
const candidates = process.env.PYTHON_EXECUTABLE ? [process.env.PYTHON_EXECUTABLE] : ["python3", "python"];
export const PYTHON = candidates.find((command) => spawnSync(command, ["-c", "import pandas, openpyxl, pyreadstat"], { encoding: "utf8", timeout: 15000 }).status === 0) ?? candidates[0];
