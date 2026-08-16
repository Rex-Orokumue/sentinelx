import type { Config } from "tailwindcss"

const config: Config = {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        // --font-body (Inter) is the sitewide body font; --font-geist-sans stays
        // as a fallback for any code paths that haven't been touched yet.
        sans: ["var(--font-body)", "var(--font-geist-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      colors: {
        background:  "hsl(var(--background))",
        foreground:  "hsl(var(--foreground))",
        card: {
          DEFAULT:    "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT:    "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        primary: {
          DEFAULT:    "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT:    "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT:    "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT:    "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        destructive: {
          DEFAULT:    "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        border: "hsl(var(--border))",
        input:  "hsl(var(--input))",
        ring:   "hsl(var(--ring))",
        // ── Sentinel X Phase 1 design system (see docs/superpowers visual-overhaul spec) ──
        sx: {
          bg:      "#0B0B0F", // page background, everywhere
          surface: "#13131F", // cards, panels, sidebars
          border:  "#1E1E30", // subtle card borders
          purple: {
            DEFAULT: "#7C3AED", // primary CTA, active states
            light:   "#9333EA", // hover
            glow:    "rgba(124, 58, 237, 0.25)",
            text:    "#A78BFA", // purple text / accent labels
          },
          green: "#10B981", // LIVE badge, verified, success
          amber: "#F59E0B", // UPCOMING badge
          gray:  "#9CA3AF", // secondary text
          white: "#FFFFFF",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "pulse-dot": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.35" },
        },
        sentinelPulse: {
          '0%, 100%': { filter: 'drop-shadow(0 0 16px rgba(245,158,11,0.75))' },
          '50%':      { filter: 'drop-shadow(0 0 24px rgba(245,158,11,1))' },
        },
        legendGlow: {
          '0%':   { filter: 'drop-shadow(0 0 20px rgba(239,68,68,0.8))' },
          '50%':  { filter: 'drop-shadow(0 0 24px rgba(245,158,11,0.9))' },
          '100%': { filter: 'drop-shadow(0 0 20px rgba(239,68,68,0.8))' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(-50%)' },
          '50%': { transform: 'translateY(calc(-50% - 12px))' },
        },
        idlePulse: {
          '0%, 100%': { filter: 'drop-shadow(0 0 14px rgba(124,58,237,.45))' },
          '50%':      { filter: 'drop-shadow(0 0 34px rgba(124,58,237,.9))' },
        },
      },
      animation: {
        "pulse-dot": "pulse-dot 1.6s ease-in-out infinite",
        'sentinel-pulse': 'sentinelPulse 3s ease-in-out infinite',
        'legend-glow': 'legendGlow 6s linear infinite',
        float: 'float 4s ease-in-out infinite',
        'idle-pulse': 'idlePulse 3.4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
export default config
