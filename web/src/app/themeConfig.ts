export type ThemeName = "light" | "dark";

export const themeConfig: Record<ThemeName, Record<string, string>> = {
  dark: {
    // Core
    "--bg": "#0F1115",
    "--text": "#E7E4DD",
    "--text-rgb": "231, 228, 221",
    "--muted": "#9AA3B2",
    "--accent": "#4AC7FF",
    "--title-accent": "#F1C47A",
    "--title-glow": "rgba(241, 196, 122, 0.55)",

    // Surfaces
    "--surface-panel": "#141922",
    "--surface-hero": "#1A1F27",
    "--surface-control": "#1F2633",
    "--surface-control-hover": "#202835",

    // Borders
    "--border-panel": "#283142",
    "--border-hero": "#2B3442",
    "--border-control": "#3B465B",

    // Visualizer
    "--viz-bg": "radial-gradient(circle at 50% 50%, #232B3D 0%, #0F1115 70%)",
    "--viz-shadow": "rgba(74, 199, 255, 0.14)",
    "--viz-overlay": "rgba(10, 12, 16, 0.6)",

    // Graph/Beat
    "--edge-stroke": "rgba(74, 199, 255, 0.5)",
    "--edge-selected": "#B48CFF",
    "--beat-fill": "#FFD46A",
    "--beat-highlight": "#FFD46A",
  },
  light: {
    // Core
    "--bg": "#5F9EA0",
    "--text": "#1B2A24",
    "--text-rgb": "27, 42, 36",
    "--muted": "#1B2A24",
    "--accent": "#317873",
    "--title-accent": "#5F9EA0",
    "--title-glow": "rgba(95, 158, 160, 0.35)",

    // Surfaces
    "--surface-panel": "#F4FAF7",
    "--surface-hero": "#DDEBE3",
    "--surface-control": "#D8EADB",
    "--surface-control-hover": "#CCE2D3",

    // Borders
    "--border-panel": "rgba(27, 42, 36, 0.14)",
    "--border-hero": "rgba(49, 120, 115, 0.20)",
    "--border-control": "rgba(49, 120, 115, 0.26)",

    // Visualizer
    "--viz-bg":
      "radial-gradient(900px circle at 18% 25%, rgba(160, 214, 180, 0.75), transparent 58%), " +
      "radial-gradient(900px circle at 82% 20%, rgba(95, 158, 160, 0.55), transparent 62%), " +
      "radial-gradient(1100px circle at 50% 88%, rgba(163, 193, 173, 0.55), transparent 60%), " +
      "linear-gradient(180deg, #CFE5DA 0%, #F4FAF7 100%), " +
      "radial-gradient(1200px circle at 50% 55%, rgba(255, 255, 255, 0.28) 0%, rgba(27, 42, 36, 0.10) 72%, rgba(27, 42, 36, 0.18) 100%)",
    "--viz-shadow": "rgba(49, 120, 115, 0.18)",
    "--viz-overlay": "rgba(244, 250, 247, 0.66)",

    // Graph/Beat
    "--edge-stroke": "rgba(27, 42, 36, .5)",
    "--edge-selected": "#317873",
    "--beat-fill": "#5F9EA0",
    "--beat-highlight": "#F4FAF7",
  },
};
