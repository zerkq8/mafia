"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ensureAnonymousSession, getSupabaseBrowserClient } from "@/lib/supabase/client";

export default function JoinPage() {
  const params = useParams();
  const router = useRouter();
  const code = String(params.code || "").toUpperCase();

  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleJoin() {
    setError("");
    setLoading(true);
    try {
      await ensureAnonymousSession();
      const supabase = getSupabaseBrowserClient();
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      const res = await fetch("/api/rooms/join", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ roomCode: code, playerName: name }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "تعذّر الانضمام.");
      router.push(`/room/${code}`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main
      className="min-h-screen flex flex-col items-center justify-center px-6 py-4"
      style={{ background: "#0B0E14" }}
    >
      <h1 className="font-display text-4xl mb-2" style={{ color: "#C9A227" }}>لعبة المافيا</h1>
      <div className="w-32 h-px mb-8" style={{ background: "#C9A22766" }} />

      <div className="w-full max-w-xs flex flex-col gap-4">
        <div className="text-center mb-2">
          <p className="text-xs mb-1" style={{ color: "#8A93A6" }}>تمت دعوتك لغرفة</p>
          <p dir="ltr" className="text-2xl font-display tracking-widest" style={{ color: "#C9A227" }}>
            {code}
          </p>
        </div>

        <div>
          <label className="block text-xs mb-1" style={{ color: "#8A93A6" }}>أدخل اسمك</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={20}
            className="w-full rounded-xl px-4 py-3 text-sm outline-none"
            style={{ background: "#141B26", border: "1px solid #2A3342", color: "#EDEAE0" }}
            placeholder="مثال: محمد"
          />
        </div>

        {error && <p className="text-xs text-center" style={{ color: "#E05A4A" }}>{error}</p>}

        <button
          disabled={loading || name.trim().length < 2}
          onClick={handleJoin}
          className="rounded-xl py-3 font-bold disabled:opacity-50"
          style={{ background: "#C9A227", color: "#0B0E14" }}
        >
          {loading ? "جارٍ الدخول..." : "دخول الغرفة"}
        </button>
      </div>
    </main>
  );
}
