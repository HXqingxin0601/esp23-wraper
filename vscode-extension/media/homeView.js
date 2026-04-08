(function () {
  const vscode = acquireVsCodeApi();

  document.querySelectorAll("[data-command]").forEach((element) => {
    element.addEventListener("click", () => {
      vscode.postMessage({
        type: "runCommand",
        command: element.getAttribute("data-command"),
      });
    });
  });

  document.querySelectorAll("[data-action]").forEach((element) => {
    element.addEventListener("click", () => {
      vscode.postMessage({
        type: element.getAttribute("data-action"),
      });
    });
  });
})();
