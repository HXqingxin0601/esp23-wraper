import * as path from "node:path";

export const CHIP_OPTIONS = [
  "esp32",
  "esp32c2",
  "esp32c3",
  "esp32c6",
  "esp32h2",
  "esp32s2",
  "esp32s3",
] as const;

export type EspChip = (typeof CHIP_OPTIONS)[number];

export const PRESET_OPTIONS = [
  "recommended",
  "minimal",
  "embassy",
  "connectivity",
  "debug",
  "custom",
] as const;

export type ProjectPreset = (typeof PRESET_OPTIONS)[number];

export const BLE_OPTIONS = ["none", "bleps", "trouble"] as const;

export type BleMode = (typeof BLE_OPTIONS)[number];

export interface NewProjectFormState {
  name: string;
  outputPath: string;
  chip: EspChip;
  preset: ProjectPreset;
  probeRs: boolean;
  embassy: boolean;
  alloc: boolean;
  wifi: boolean;
  bleMode: BleMode;
  defmt: boolean;
  log: boolean;
  espBacktrace: boolean;
  unstableHal: boolean;
  panicRttTarget: boolean;
  embeddedTest: boolean;
  wokwi: boolean;
  ci: boolean;
  installMissing: boolean;
  espGenerateBin: string;
  extraEspwrapArgs: string;
  extraGenerateArgs: string;
}

export interface ToggleField {
  key:
    | "probeRs"
    | "embassy"
    | "alloc"
    | "wifi"
    | "defmt"
    | "log"
    | "espBacktrace"
    | "unstableHal"
    | "panicRttTarget"
    | "embeddedTest"
    | "wokwi"
    | "ci"
    | "installMissing";
  label: string;
  description: string;
  advanced?: boolean;
}

export interface PresetDefinition {
  id: ProjectPreset;
  label: string;
  description: string;
}

export interface BuildCommandResult {
  args: string[];
  preview: string;
  projectDir: string;
}

export interface BuildCommandOptions {
  resolveOutputPathAgainst?: string;
}

export interface PatchCommandInput {
  projectPath: string;
  chip?: string;
  bin?: string;
  dryRun?: boolean;
  backup?: boolean;
}

export const PRESET_DEFINITIONS: PresetDefinition[] = [
  {
    id: "recommended",
    label: "Recommended",
    description: "Balanced defaults for VS Code, probe-rs, and day-to-day development.",
  },
  {
    id: "minimal",
    label: "Minimal",
    description: "Keep the template lean and only generate the essentials.",
  },
  {
    id: "embassy",
    label: "Embassy Async",
    description: "Start from an async-friendly template with Embassy enabled.",
  },
  {
    id: "connectivity",
    label: "Connectivity",
    description: "Bias the template toward Wi-Fi and heap-backed features.",
  },
  {
    id: "debug",
    label: "Debug Friendly",
    description: "Turn on the options most helpful when bringing hardware up.",
  },
  {
    id: "custom",
    label: "Custom",
    description: "Keep your current selections and fine-tune them manually.",
  },
];

export const TOGGLE_FIELDS: ToggleField[] = [
  {
    key: "probeRs",
    label: "probe-rs",
    description: "Generate VS Code flash/debug integration for probe-rs.",
  },
  {
    key: "embassy",
    label: "Embassy",
    description: "Enable the async runtime and related template wiring.",
  },
  {
    key: "alloc",
    label: "alloc",
    description: "Enable heap allocation support for templates that need it.",
  },
  {
    key: "wifi",
    label: "Wi-Fi",
    description: "Add Wi-Fi dependencies and template glue where supported.",
  },
  {
    key: "defmt",
    label: "defmt",
    description: "Use compact embedded logging optimized for constrained devices.",
  },
  {
    key: "log",
    label: "log",
    description: "Enable the standard Rust logging facade in the generated template.",
  },
  {
    key: "espBacktrace",
    label: "esp-backtrace",
    description: "Print richer panic and crash traces to help diagnose failures.",
  },
  {
    key: "unstableHal",
    label: "unstable-hal",
    description: "Enable experimental HAL capabilities that may change over time.",
    advanced: true,
  },
  {
    key: "panicRttTarget",
    label: "panic-rtt-target",
    description: "Route panic output over RTT instead of the usual console path.",
    advanced: true,
  },
  {
    key: "embeddedTest",
    label: "embedded-test",
    description: "Prepare the project for device-side integration tests.",
    advanced: true,
  },
  {
    key: "wokwi",
    label: "Wokwi",
    description: "Add files that make simulation workflows easier to start.",
    advanced: true,
  },
  {
    key: "ci",
    label: "CI",
    description: "Add CI scaffolding to help validate the project in automation.",
    advanced: true,
  },
  {
    key: "installMissing",
    label: "Install Missing Tools",
    description: "Pass --install-missing so espwrap can auto-install supported CLI tools.",
    advanced: true,
  },
];

const RESERVED_ESPWRAP_ARGS: Record<string, string> = {
  "--name": "Project Name is already controlled by the form.",
  "--esp-generate-bin": "esp-generate Binary is already controlled by the form.",
  "--install-missing": "Install Missing Tools is already controlled by the checkbox.",
};

const RESERVED_GENERATE_ARGS: Record<string, string> = {
  "--chip": "Chip is already selected above.",
  "--output-path": "Output Directory is already selected above.",
  "--headless": "The extension always runs esp-generate in headless mode.",
};

export function createDefaultState(defaultChip: EspChip, defaultInstallMissing: boolean, outputPath = ""): NewProjectFormState {
  return {
    name: "",
    outputPath,
    chip: defaultChip,
    preset: "recommended",
    probeRs: true,
    embassy: false,
    alloc: false,
    wifi: false,
    bleMode: "none",
    defmt: false,
    log: true,
    espBacktrace: true,
    unstableHal: false,
    panicRttTarget: false,
    embeddedTest: false,
    wokwi: false,
    ci: false,
    installMissing: defaultInstallMissing,
    espGenerateBin: "esp-generate",
    extraEspwrapArgs: "",
    extraGenerateArgs: "",
  };
}

export function applyPreset(state: NewProjectFormState, preset: ProjectPreset): NewProjectFormState {
  if (preset === "custom") {
    return { ...state, preset };
  }

  const featureState = createDefaultFeatureState();

  switch (preset) {
    case "recommended":
      featureState.probeRs = true;
      featureState.log = true;
      featureState.espBacktrace = true;
      break;
    case "minimal":
      break;
    case "embassy":
      featureState.probeRs = true;
      featureState.embassy = true;
      featureState.log = true;
      featureState.espBacktrace = true;
      break;
    case "connectivity":
      featureState.probeRs = true;
      featureState.alloc = true;
      featureState.wifi = true;
      featureState.log = true;
      featureState.espBacktrace = true;
      break;
    case "debug":
      featureState.probeRs = true;
      featureState.log = true;
      featureState.defmt = true;
      featureState.espBacktrace = true;
      break;
    default:
      break;
  }

  return {
    ...state,
    ...featureState,
    preset,
  };
}

export function validateNewProjectState(state: NewProjectFormState): string[] {
  const errors: string[] = [];
  if (!state.name.trim()) {
    errors.push("Project name is required.");
  }
  if (!state.outputPath.trim()) {
    errors.push("Output directory is required.");
  }
  errors.push(
    ...findReservedArgErrors("Extra espwrap args", parseArgString(state.extraEspwrapArgs), RESERVED_ESPWRAP_ARGS)
  );
  errors.push(
    ...findReservedArgErrors("Extra esp-generate args", parseArgString(state.extraGenerateArgs), RESERVED_GENERATE_ARGS)
  );
  return errors;
}

export function buildNewProjectCommand(
  binaryPath: string,
  state: NewProjectFormState,
  options: BuildCommandOptions = {}
): BuildCommandResult {
  const args = ["new"];
  const outputPath = resolveOutputPath(state.outputPath, options);

  if (state.espGenerateBin.trim() && state.espGenerateBin.trim() !== "esp-generate") {
    args.push("--esp-generate-bin", state.espGenerateBin.trim());
  }
  if (state.installMissing) {
    args.push("--install-missing");
  }

  args.push("--name", state.name.trim());

  const extraEspwrapArgs = parseArgString(state.extraEspwrapArgs);
  args.push(...extraEspwrapArgs);

  args.push("--");
  args.push("--headless", "--chip", state.chip, "--output-path", outputPath);

  if (state.embassy) {
    args.push("-o", "embassy");
  }
  if (state.alloc) {
    args.push("-o", "alloc");
  }
  if (state.wifi) {
    args.push("-o", "wifi");
  }
  if (state.bleMode === "bleps") {
    args.push("-o", "ble-bleps");
  } else if (state.bleMode === "trouble") {
    args.push("-o", "ble-trouble");
  }
  if (state.defmt) {
    args.push("-o", "defmt");
  }
  if (state.log) {
    args.push("-o", "log");
  }
  if (state.espBacktrace) {
    args.push("-o", "esp-backtrace");
  }
  if (state.unstableHal) {
    args.push("-o", "unstable-hal");
  }
  if (state.panicRttTarget) {
    args.push("-o", "panic-rtt-target");
  }
  if (state.embeddedTest) {
    args.push("-o", "embedded-test");
  }
  if (state.wokwi) {
    args.push("-o", "wokwi");
  }
  if (state.ci) {
    args.push("-o", "ci");
  }
  if (state.probeRs) {
    args.push("-o", "probe-rs");
  }

  args.push(...parseArgString(state.extraGenerateArgs));

  return {
    args,
    preview: formatCommand(binaryPath, args),
    projectDir: path.join(outputPath, state.name.trim()),
  };
}

export function buildPatchCommand(binaryPath: string, input: PatchCommandInput): BuildCommandResult {
  const args = ["patch", input.projectPath];

  if (input.chip?.trim()) {
    args.push("--chip", input.chip.trim());
  }
  if (input.bin?.trim()) {
    args.push("--bin", input.bin.trim());
  }
  if (input.dryRun) {
    args.push("--dry-run");
  }
  if (input.backup) {
    args.push("--backup");
  }

  return {
    args,
    preview: formatCommand(binaryPath, args),
    projectDir: input.projectPath,
  };
}

export function parseArgString(input: string): string[] {
  const args: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaping = false;

  for (const char of input) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }

    if (char === "\\") {
      escaping = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === "'" || char === "\"") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        args.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current) {
    args.push(current);
  }
  return args;
}

export function resolveOutputPath(outputPath: string, options: BuildCommandOptions = {}): string {
  const trimmed = outputPath.trim();
  if (!trimmed) {
    return "";
  }
  if (path.isAbsolute(trimmed) || !options.resolveOutputPathAgainst?.trim()) {
    return path.normalize(trimmed);
  }
  return path.resolve(options.resolveOutputPathAgainst, trimmed);
}

export function formatCommand(binaryPath: string, args: readonly string[]): string {
  return [binaryPath, ...args].map(quoteArg).join(" ");
}

function quoteArg(arg: string): string {
  if (!arg) {
    return "\"\"";
  }
  if (/^[A-Za-z0-9_./:=+-]+$/.test(arg)) {
    return arg;
  }
  return `"${arg.replace(/(["\\])/g, "\\$1")}"`;
}

function findReservedArgErrors(
  label: string,
  args: readonly string[],
  reserved: Record<string, string>
): string[] {
  const errors = new Set<string>();

  for (const arg of args) {
    if (arg === "--") {
      errors.add(`${label} should not include \`--\`; the extension inserts it automatically.`);
      continue;
    }

    for (const [flag, detail] of Object.entries(reserved)) {
      if (arg === flag || arg.startsWith(`${flag}=`)) {
        errors.add(`${label} cannot include \`${flag}\`. ${detail}`);
      }
    }
  }

  return [...errors];
}

function createDefaultFeatureState() {
  return {
    probeRs: false,
    embassy: false,
    alloc: false,
    wifi: false,
    bleMode: "none" as BleMode,
    defmt: false,
    log: false,
    espBacktrace: false,
    unstableHal: false,
    panicRttTarget: false,
    embeddedTest: false,
    wokwi: false,
    ci: false,
  };
}
