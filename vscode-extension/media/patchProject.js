(function () {
  const vscode = acquireVsCodeApi();
  const payload = JSON.parse(document.getElementById("espwrap-patch-data").textContent);
  let isSubmitting = false;

  const controls = {
    projectPath: document.getElementById("projectPath"),
    chip: document.getElementById("chip"),
    bin: document.getElementById("bin"),
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
      dryRun: Boolean(getToggle("dryRun")?.checked),
      backup: Boolean(getToggle("backup")?.checked),
    };
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

  document.querySelectorAll("input, select").forEach((element) => {
    element.addEventListener("input", requestPreview);
    element.addEventListener("change", requestPreview);
  });

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (!message || typeof message.type !== "string") {
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

  if (payload?.initialState) {
    controls.projectPath.value = payload.initialState.projectPath || controls.projectPath.value;
  }

  setSubmitting(false);
  requestPreview();
})();
