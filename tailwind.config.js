/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: "#F7ECD9",
        panel: "#FFF8EC",
        border: "#E8D2AA",
        gold: "#CC8352",
        mafia: "#8B3A2E",
        civilian: "#7A8B5F",
        muted: "#8B6F52",
        cream: "#2F1D19",
      },
      fontFamily: {
        display: ["Rakkas", "serif"],
        body: ["Tajawal", "sans-serif"],
      },
    },
  },
  plugins: [],
};
