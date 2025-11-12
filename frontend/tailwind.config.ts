import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx,js,jsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: "#2563eb",
        "primary-foreground": "#ffffff",
        secondary: "#f1f5f9",
        "secondary-foreground": "#0f172a",
        accent: "#eff6ff",
        "accent-foreground": "#1e293b",
        muted: "#e2e8f0",
        "muted-foreground": "#64748b",
        destructive: "#ef4444",
        background: "#f8fafc",
        foreground: "#0f172a",
        border: "#e2e8f0",
        input: "#e2e8f0",
        ring: "#93c5fd",
      },
      borderRadius: {
        xl: "1rem",
      },
      boxShadow: {
        panel: "0 20px 40px rgba(15, 23, 42, 0.12)",
      },
    },
  },
  plugins: [],
};

export default config;

