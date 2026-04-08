(function () {
  const vscode = acquireVsCodeApi();
  const payload = JSON.parse(document.getElementById("espwrap-data").textContent);
  const presetLookup = Object.fromEntries(payload.metadata.presets.map((preset) => [preset.id, preset]));
  const presetStates = payload.metadata.presetStates || {};
  const featureKeys = [
    "probeRs",
    "embassy",
    "alloc",
    "wifi",
    "defmt",
    "log",
    "espBacktrace",
    "unstableHal",
    "panicRttTarget",
    "embeddedTest",
    "wokwi",
    "ci",
    "installMissing",
  ];

  const controls = {
    name: document.getElementById("name"),
    outputPath: document.getElementById("outputPath"),
    chip: document.getElementById("chip"),
    preset: document.getElementById("preset"),
    bleMode: document.getElementById("bleMode"),
    espGenerateBin: document.getElementById("espGenerateBin"),
    extraEspwrapArgs: document.getElementById("extraEspwrapArgs"),
    extraGenerateArgs: document.getElementById("extraGenerateArgs"),
    pickOutputPath: document.getElementById("pickOutputPath"),
    copyCommand: document.getElementById("copyCommand"),
    submitButton: document.getElementById("submitButton"),
    commandPreview: document.getElementById("commandPreview"),
    errors: document.getElementById("errors"),
    presetDescription: document.getElementById("presetDescription"),
  };
  let isSubmitting = false;

  function getToggle(key) {
    return document.querySelector(`[data-toggle="${key}"]`);
  }

  function collectState() {
    const state = {
      name: controls.name.value,
      outputPath: controls.outputPath.value,
      chip: controls.chip.value,
      preset: controls.preset.value,
      bleMode: controls.bleMode.value,
      espGenerateBin: controls.espGenerateBin.value,
      extraEspwrapArgs: controls.extraEspwrapArgs.value,
      extraGenerateArgs: controls.extraGenerateArgs.value,
    };

    for (const key of featureKeys) {
      state[key] = Boolean(getToggle(key)?.checked);
    }

    return state;
  }

  function applyPreset(presetId) {
    if (presetId === "custom") {
      updatePresetDescription(presetId);
      requestPreview();
      return;
    }

    const presetState = presetStates[presetId];
    if (!presetState) {
      updatePresetDescription(presetId);
      requestPreview();
      return;
    }

    for (const key of featureKeys) {
      const control = getToggle(key);
      if (control && key in presetState) {
        control.checked = Boolean(presetState[key]);
      }
    }
    if ("bleMode" in presetState) {
      controls.bleMode.value = presetState.bleMode;
    }

    updatePresetDescription(presetId);
    requestPreview();
  }

  function updatePresetDescription(presetId) {
    const preset = presetLookup[presetId];
    controls.presetDescription.textContent = preset ? preset.description : "";
  }

  function requestPreview() {
    vscode.postMessage({
      type: "requestPreview",
      state: collectState(),
    });
  }

  function setSubmitting(busy) {
    isSubmitting = Boolean(busy);
    controls.submitButton.disabled = isSubmitting;
    controls.submitButton.textContent = isSubmitting ? "Generating..." : "Generate Project";
  }

  function setErrors(errors) {
    if (!errors || errors.length === 0) {
      controls.errors.hidden = true;
      controls.errors.innerHTML = "";
      return;
    }

    controls.errors.hidden = false;
    controls.errors.innerHTML = errors.map((error) => `<div>${escapeHtml(error)}</div>`).join("");
  }

  function escapeHtml(value) {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  controls.pickOutputPath.addEventListener("click", () => {
    vscode.postMessage({
      type: "pickOutputPath",
      currentValue: controls.outputPath.value,
    });
  });

  controls.copyCommand.addEventListener("click", async () => {
    const text = controls.commandPreview.textContent || "";
    if (!text) {
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
    } catch {
      vscode.postMessage({
        type: "requestPreview",
        state: collectState(),
      });
    }
  });

  controls.submitButton.addEventListener("click", () => {
    if (isSubmitting) {
      return;
    }
    setSubmitting(true);
    vscode.postMessage({
      type: "submit",
      state: collectState(),
    });
  });

  document.querySelectorAll("input, select, textarea").forEach((element) => {
    element.addEventListener("input", () => {
      if (element === controls.preset) {
        applyPreset(controls.preset.value);
      } else {
        requestPreview();
      }
    });
    element.addEventListener("change", () => {
      if (element === controls.preset) {
        applyPreset(controls.preset.value);
      } else {
        requestPreview();
      }
    });
  });

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (!message || typeof message.type !== "string") {
      return;
    }

    if (message.type === "pickedOutputPath" && typeof message.value === "string") {
      controls.outputPath.value = message.value;
      requestPreview();
      return;
    }

    if (message.type === "preview") {
      controls.commandPreview.textContent = message.preview || "";
      setErrors(Array.isArray(message.errors) ? message.errors : []);
      return;
    }

    if (message.type === "submitState") {
      setSubmitting(Boolean(message.busy));
    }
  });

  updatePresetDescription(controls.preset.value);
  setSubmitting(false);
  requestPreview();
})();
