"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ensureAnonymousSession, getSupabaseBrowserClient } from "@/lib/supabase/client";

export default function OnlineJoinPage() {
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

      const res = await fetch("/api/online/rooms/join", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ roomCode: code, playerName: name }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "تعذّر الانضمام.");
      router.push(`/online/room/${code}`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6 py-4">
      <h1 className="font-display text-4xl text-gold mb-2">لعبة المافيا</h1>
      <p className="text-xs text-muted mb-6">دعوة لغرفة أونلاين</p>

      <div className="w-full max-w-xs flex flex-col gap-4">
        <div className="text-center mb-2">
          <p dir="ltr" className="text-2xl font-display text-gold tracking-widest">
            {code}
          </p>
        </div>

        <div>
          <label className="block text-xs text-muted mb-1">أدخل اسمك</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={20}
            className="w-full rounded-xl px-4 py-3 text-sm bg-panel border border-border outline-none focus:border-gold"
            placeholder="مثال: محمد"
          />
        </div>

        {error && <p className="text-mafia text-xs text-center">{error}</p>}

        <button
          disabled={loading || name.trim().length < 2}
          onClick={handleJoin}
          className="rounded-xl py-3 font-bold bg-gold text-ink disabled:opacity-50"
        >
          {loading ? "جارٍ الدخول..." : "دخول الغرفة"}
        </button>
        <p className="text-[11px] text-center" style={{ color: "#8B7F68" }}>
          لو الغرفة اكتملت أو بدأت اللعبة، بتنضم كمستمع تلقائيًا.
        </p>
      </div>
    </main>
  );
}
