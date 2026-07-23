import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: "var(--ink)",
        "ink-muted": "var(--ink-muted)",
        "ink-faint": "var(--ink-faint)",
        surface: "var(--surface)",
        raised: "var(--surface-raised)",
        wash: "var(--wash)",
        line: "var(--line)",
        "line-strong": "var(--line-strong)",
        ring: "var(--ring)",
        btn: "var(--btn)",
        "btn-ink": "var(--btn-ink)",
        accent: "var(--accent)",
        "accent-soft": "var(--accent-soft)",
        danger: "var(--danger)",
        "danger-soft": "var(--danger-soft)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "Georgia", "serif"],
        pixel: ["var(--font-pixel)", "monospace"],
      },
    },
  },
  plugins: [],
};
export default config;
