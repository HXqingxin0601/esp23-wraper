(function () {
  const vscode = acquireVsCodeApi();
  const payload = JSON.parse(document.getElementById("espwrap-data").textContent);
  const presetLookup = Object.fromEntries(payload.metadata.presets.map((preset) => [preset.id, preset]));
  const presetStates = payload.metadata.presetStates || {};
  const featureKeys = [
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
    debugBackend: document.getElementById("debugBackend"),
    bleMode: document.getElementById("bleMode"),
    espGenerateBin: document.getElementById("espGenerateBin"),
    extraEspwrapArgs: document.getElementById("extraEspwrapArgs"),
    openocdConfigs: document.getElementById("openocdConfigs"),
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
      debugBackend: controls.debugBackend.value,
      bleMode: controls.bleMode.value,
      espGenerateBin: controls.espGenerateBin.value,
      extraEspwrapArgs: controls.extraEspwrapArgs.value,
      openocdConfigs: controls.openocdConfigs.value,
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
    if ("debugBackend" in presetState && controls.debugBackend) {
      controls.debugBackend.value = presetState.debugBackend;
    }
    if ("bleMode" in presetState) {
      controls.bleMode.value = presetState.bleMode;
    }

    syncBackendFields();
    updatePresetDescription(presetId);
    requestPreview();
  }

  function updatePresetDescription(presetId) {
    const preset = presetLookup[presetId];
    controls.presetDescription.textContent = preset ? preset.description : "";
  }

  function syncBackendFields() {
    const isOpenOcd = controls.debugBackend.value === "openocd";
    controls.openocdConfigs.disabled = !isOpenOcd;
    controls.openocdConfigs.placeholder = isOpenOcd
      ? "board/esp32c3-builtin.cfg\ninterface/ftdi/esp32_devkitj_v1.cfg"
      : "Switch Debug Backend to OpenOCD + GDB to use custom config files.";
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

  function setPreviewText(preview, errors) {
    if (preview) {
      controls.commandPreview.textContent = preview;
      return;
    }

    if (errors && errors.length > 0) {
      controls.commandPreview.textContent = "# Fix the validation errors above to render the full command preview.";
      return;
    }

    controls.commandPreview.textContent = "# Preview will appear here.";
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
        if (element === controls.debugBackend) {
          syncBackendFields();
        }
        requestPreview();
      }
    });
    element.addEventListener("change", () => {
      if (element === controls.preset) {
        applyPreset(controls.preset.value);
      } else {
        if (element === controls.debugBackend) {
          syncBackendFields();
        }
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
      const errors = Array.isArray(message.errors) ? message.errors : [];
      setPreviewText(message.preview || "", errors);
      setErrors(errors);
      return;
    }

    if (message.type === "submitState") {
      setSubmitting(Boolean(message.busy));
    }
  });

  updatePresetDescription(controls.preset.value);
  syncBackendFields();
  setSubmitting(false);
  requestPreview();
})();
