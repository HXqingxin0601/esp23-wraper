import * as path from "node:path";

import { describe, expect, it } from "vitest";

import {
  applyPreset,
  buildNewProjectCommand,
  buildPatchCommand,
  createDefaultState,
  parseArgString,
  validateNewProjectState,
} from "./formModel";

describe("formModel", () => {
  it("applies the embassy preset", () => {
    const state = createDefaultState("esp32c3", false, "D:/work");
    const next = applyPreset(state, "embassy");

    expect(next.embassy).toBe(true);
    expect(next.probeRs).toBe(true);
    expect(next.log).toBe(true);
    expect(next.espBacktrace).toBe(true);
  });

  it("builds a new project command with selected options", () => {
    const state = {
      ...createDefaultState("esp32s3", true, "D:/esp"),
      name: "demo",
      embassy: true,
      alloc: true,
      wifi: true,
      bleMode: "trouble" as const,
      extraEspwrapArgs: "--bin app",
      extraGenerateArgs: "--toolchain nightly",
    };

    const built = buildNewProjectCommand("espwrap", state);

    expect(built.args).toEqual([
      "new",
      "--install-missing",
      "--name",
      "demo",
      "--bin",
      "app",
      "--",
      "--headless",
      "--chip",
      "esp32s3",
      "--output-path",
      path.normalize("D:/esp"),
      "-o",
      "embassy",
      "-o",
      "alloc",
      "-o",
      "wifi",
      "-o",
      "ble-trouble",
      "-o",
      "log",
      "-o",
      "esp-backtrace",
      "-o",
      "probe-rs",
      "--toolchain",
      "nightly",
    ]);
    expect(built.projectDir).toBe("D:\\esp\\demo");
  });

  it("builds a patch command with optional flags", () => {
    const built = buildPatchCommand("espwrap", {
      projectPath: "D:/esp/demo",
      chip: "esp32c3",
      bin: "firmware",
      backup: true,
      dryRun: true,
    });

    expect(built.args).toEqual([
      "patch",
      "D:/esp/demo",
      "--chip",
      "esp32c3",
      "--bin",
      "firmware",
      "--dry-run",
      "--backup",
    ]);
  });

  it("parses quoted extra args", () => {
    expect(parseArgString("--foo bar --name \"hello world\" 'abc def'")).toEqual([
      "--foo",
      "bar",
      "--name",
      "hello world",
      "abc def",
    ]);
  });

  it("rejects conflicting extra args that duplicate form-managed fields", () => {
    const state = {
      ...createDefaultState("esp32c3", false, "D:/esp"),
      name: "demo",
      extraEspwrapArgs: "--name other --install-missing",
      extraGenerateArgs: "--chip esp32s3 --output-path elsewhere",
    };

    expect(validateNewProjectState(state)).toEqual([
      "Extra espwrap args cannot include `--name`. Project Name is already controlled by the form.",
      "Extra espwrap args cannot include `--install-missing`. Install Missing Tools is already controlled by the checkbox.",
      "Extra esp-generate args cannot include `--chip`. Chip is already selected above.",
      "Extra esp-generate args cannot include `--output-path`. Output Directory is already selected above.",
    ]);
  });

  it("resolves relative output paths against the provided base directory", () => {
    const state = {
      ...createDefaultState("esp32c3", false, "generated"),
      name: "demo",
    };

    const built = buildNewProjectCommand("espwrap", state, {
      resolveOutputPathAgainst: "D:/workspace",
    });

    expect(built.args).toContain(path.resolve("D:/workspace", "generated"));
    expect(built.projectDir).toBe(path.resolve("D:/workspace", "generated", "demo"));
  });
});
