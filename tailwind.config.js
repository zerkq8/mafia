/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: "#0B0E14",
        panel: "#141B26",
        border: "#2A3342",
        gold: "#C9A227",
        mafia: "#8B2635",
        civilian: "#2F6F62",
        muted: "#8A93A6",
        cream: "#EDEAE0",
      },
      fontFamily: {
        display: ["Rakkas", "serif"],
        body: ["Tajawal", "sans-serif"],
      },
    },
  },
  plugins: [],
};
