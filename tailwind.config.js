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
        mafia: "#E05A4A",
        civilian: "#3FA37A",
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
