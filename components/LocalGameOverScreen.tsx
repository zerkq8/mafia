"use client";

interface Props {
  winner: "mafia" | "civilians";
}

export default function LocalGameOverScreen({ winner }: Props) {
  const isMafia = winner === "mafia";
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center px-6 gap-3"
      style={{ background: "#0B0E14" }}
    >
      <div className="text-5xl mb-2">🏆</div>
      <p
        className="text-2xl font-extrabold text-center"
        style={{ color: isMafia ? "#E05A4A" : "#3FA37A" }}
      >
        {isMafia ? "فريق المافيا فاز!" : "فريق الشعب فاز!"}
      </p>
      <p className="text-xs text-center max-w-xs" style={{ color: "#8A93A6" }}>
        انتهت اللعبة. الحكم يقدر يغلق الغرفة أو يبدأ غرفة جديدة.
      </p>
    </div>
  );
}
