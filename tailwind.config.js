/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: "#FBF6EC",
        panel: "#FFFFFF",
        border: "#E6DFC8",
        gold: "#C9A227",
        mafia: "#C0392B",
        civilian: "#2F8F6F",
        muted: "#8B7F68",
        cream: "#2B2117",
      },
      fontFamily: {
        display: ["Rakkas", "serif"],
        body: ["Tajawal", "sans-serif"],
      },
    },
  },
  plugins: [],
};
