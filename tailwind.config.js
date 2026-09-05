/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: "#F4EEE0",
        panel: "#FDFBF6",
        border: "#DED4B8",
        gold: "#B6963F",
        mafia: "#B2564C",
        civilian: "#5C8E7B",
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
