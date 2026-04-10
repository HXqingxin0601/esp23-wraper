(function () {
  const vscode = acquireVsCodeApi();
  const payload = JSON.parse(document.getElementById("espwrap-patch-data").textContent);
  let isSubmitting = false;

  const controls = {
    projectPath: document.getElementById("projectPath"),
    chip: document.getElementById("chip"),
    bin: document.getElementById("bin"),
    debugBackend: document.getElementById("debugBackend"),
    openocdConfigs: document.getElementById("openocdConfigs"),
    copyCommand: document.getElementById("copyCommand"),
    submitButton: document.getElementById("submitButton"),
    commandPreview: document.getElementById("commandPreview"),
    errors: document.getElementById("errors"),
  };

  function getToggle(key) {
    return document.querySelector(`[data-toggle="${key}"]`);
  }

  function collectState() {
    return {
      projectPath: controls.projectPath.value,
      chip: controls.chip.value,
      bin: controls.bin.value,
      debugBackend: controls.debugBackend.value,
      openocdConfigs: controls.openocdConfigs.value,
      dryRun: Boolean(getToggle("dryRun")?.checked),
      backup: Boolean(getToggle("backup")?.checked),
    };
  }

  function syncBackendFields() {
    const isOpenOcd = controls.debugBackend.value === "openocd";
    controls.openocdConfigs.disabled = !isOpenOcd;
    controls.openocdConfigs.placeholder = isOpenOcd
      ? "board/esp32c3-builtin.cfg\ninterface/ftdi/esp32_devkitj_v1.cfg"
      : "Switch Debug Backend to OpenOCD + GDB to use custom config files.";
  }

  function setSubmitting(busy) {
    isSubmitting = Boolean(busy);
    controls.submitButton.disabled = isSubmitting;
    controls.submitButton.textContent = isSubmitting ? "Running..." : "Run Patch";
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

  function requestPreview() {
    vscode.postMessage({
      type: "requestPreview",
      state: collectState(),
    });
  }

  function escapeHtml(value) {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  controls.copyCommand.addEventListener("click", async () => {
    const text = controls.commandPreview.textContent || "";
    if (!text) {
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      requestPreview();
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
      if (element === controls.debugBackend) {
        syncBackendFields();
      }
      requestPreview();
    });
    element.addEventListener("change", () => {
      if (element === controls.debugBackend) {
        syncBackendFields();
      }
      requestPreview();
    });
  });

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (!message || typeof message.type !== "string") {
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

  if (payload?.initialState) {
    controls.projectPath.value = payload.initialState.projectPath || controls.projectPath.value;
    controls.debugBackend.value = payload.initialState.debugBackend || controls.debugBackend.value;
    controls.openocdConfigs.value = payload.initialState.openocdConfigs || controls.openocdConfigs.value;
  }

  syncBackendFields();
  setSubmitting(false);
  requestPreview();
})();
