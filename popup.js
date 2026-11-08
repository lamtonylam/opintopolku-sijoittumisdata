// Popup logic: enabled toggle + dataset vintage + dashboard link.
"use strict";

const DASHBOARD_URL = ""; // e.g. "https://example.fi" — set to enable the link.

document.addEventListener("DOMContentLoaded", async () => {
  const enabledInput = document.getElementById("enabled");
  const dashboardLink = document.getElementById("dashboard");
  const metaLine = document.getElementById("meta");

  try {
    const stored = await chrome.storage.local.get({ enabled: true });
    enabledInput.checked = stored.enabled !== false;
  } catch {
    enabledInput.checked = true;
  }
  enabledInput.addEventListener("change", () => {
    chrome.storage.local.set({ enabled: enabledInput.checked })?.catch?.(() => {});
  });

  if (DASHBOARD_URL) {
    dashboardLink.href = DASHBOARD_URL;
  } else {
    dashboardLink.style.display = "none";
    dashboardLink.previousElementSibling.style.display = "none";
    dashboardLink.parentElement.style.display = "none";
  }

  try {
    const response = await fetch(chrome.runtime.getURL("data/degrees.json"));
    const data = await response.json();
    metaLine.textContent =
      `Aineisto: ${data.meta.degreeCount} tutkintoa, ` +
      `valmistuneet ${data.meta.graduationYear}, tulot ${data.meta.incomeYear}.`;
  } catch {
    metaLine.textContent = "Aineistoa ei voitu lukea.";
  }
});
