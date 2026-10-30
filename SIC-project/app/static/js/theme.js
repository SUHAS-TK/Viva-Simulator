/* ═══════════════════════════════════════════════════════
   theme.js – Global Light / Dark Theme Manager
   ═══════════════════════════════════════════════════════ */
"use strict";

(function () {
  function getPreferredTheme() {
    const saved = localStorage.getItem("viva_theme");
    if (saved) return saved;
    // Default to dark theme
    return "dark";
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("viva_theme", theme);

    const toggleBtns = document.querySelectorAll(".theme-toggle-btn");
    toggleBtns.forEach(btn => {
      const isDark = theme === "dark";
      btn.setAttribute("title", isDark ? "Switch to Light Mode" : "Switch to Dark Mode");
      const icon = btn.querySelector(".theme-icon");
      const label = btn.querySelector(".theme-label");
      if (icon) icon.textContent = isDark ? "☀️" : "🌙";
      if (label) label.textContent = isDark ? "Light" : "Dark";
    });
  }

  // Apply immediately to prevent flash
  const initialTheme = getPreferredTheme();
  document.documentElement.setAttribute("data-theme", initialTheme);

  // Initialize event listeners when DOM is ready
  function initThemeControls() {
    applyTheme(getPreferredTheme());

    document.querySelectorAll(".theme-toggle-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const current = document.documentElement.getAttribute("data-theme") || "dark";
        const next = current === "dark" ? "light" : "dark";
        applyTheme(next);
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initThemeControls);
  } else {
    initThemeControls();
  }
})();
