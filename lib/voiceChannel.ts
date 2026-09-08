"use client";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * قناة صوت WebRTC بسيطة تستخدم Supabase Realtime Broadcast للتفاوض (Signaling) بس —
 * الصوت نفسه ينتقل مباشرة بين الأجهزة (P2P)، ما يمر عبر سيرفرنا إطلاقًا.
 *
 * ⚠️ يعتمد حاليًا على STUN عام مجاني بدون TURN — يشتغل تمام على أغلب الشبكات،
 * لكن بعض شبكات الجوال المقيّدة (NAT صارم) ممكن تفشل بالاتصال المباشر.
 * لو صار كذا كثير، الحل يحتاج سيرفر TURN مدفوع بسيط لاحقًا.
 */

const ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];

export interface VoicePeer {
  peerId: string;
  connection: RTCPeerConnection;
  audioEl: HTMLAudioElement;
}

export class VoiceChannel {
  private roomId: string;
  private myPeerId: string;
  private channel: ReturnType<ReturnType<typeof getSupabaseBrowserClient>["channel"]> | null =
    null;
  private localStream: MediaStream | null = null;
  private peers = new Map<string, VoicePeer>();
  private onError: (msg: string) => void;
  private micMuted = false;
  private listeningMuted = false;

  constructor(roomId: string, myPeerId: string, onError: (msg: string) => void) {
    this.roomId = roomId;
    this.myPeerId = myPeerId;
    this.onError = onError;
  }

  private send(payload: any) {
    this.channel?.send({ type: "broadcast", event: "signal", payload });
  }

  private getOrCreatePeer(otherPeerId: string): VoicePeer {
    let peer = this.peers.get(otherPeerId);
    if (peer) return peer;

    const connection = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const audioEl = document.createElement("audio");
    audioEl.autoplay = true;
    (audioEl as any).playsInline = true;
    document.body.appendChild(audioEl);

    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => connection.addTrack(t, this.localStream!));
    }

    connection.ontrack = (e) => {
      audioEl.srcObject = e.streams[0];
      audioEl.muted = this.listeningMuted;
    };

    connection.onicecandidate = (e) => {
      if (e.candidate) {
        this.send({
          type: "ice-candidate",
          from: this.myPeerId,
          to: otherPeerId,
          candidate: e.candidate,
        });
      }
    };

    peer = { peerId: otherPeerId, connection, audioEl };
    this.peers.set(otherPeerId, peer);
    return peer;
  }

  /** يبدأ الاتصال — يشترك بقناة الإشارات ويهيّئ الميكروفون
   *  micEnabled=false يخلي الطرف "استماع فقط" (مو مسموح له يتكلم) — للمستمعين
   */
  async start(micEnabled: boolean = true) {
    if (micEnabled) {
      try {
        this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        this.onError("تعذّر الوصول للميكروفون — تأكد إنك سمحت للموقع باستخدامه.");
      }
    }

    const supabase = getSupabaseBrowserClient();
    this.channel = supabase.channel(`voice-${this.roomId}`, {
      config: { broadcast: { self: false } },
    });

    this.channel.on("broadcast", { event: "signal" }, async ({ payload }) => {
      if (payload.to !== this.myPeerId) return;

      const peer = this.getOrCreatePeer(payload.from);

      if (payload.type === "offer") {
        await peer.connection.setRemoteDescription(payload.sdp);
        const answer = await peer.connection.createAnswer();
        await peer.connection.setLocalDescription(answer);
        this.send({ type: "answer", from: this.myPeerId, to: payload.from, sdp: answer });
      } else if (payload.type === "answer") {
        await peer.connection.setRemoteDescription(payload.sdp);
      } else if (payload.type === "ice-candidate") {
        try {
          await peer.connection.addIceCandidate(payload.candidate);
        } catch {
          // تجاهل مرشحات وصلت متأخرة
        }
      }
    });

    await new Promise<void>((resolve) => {
      this.channel!.subscribe((status) => {
        if (status === "SUBSCRIBED") resolve();
      });
    });
  }

  /** يبدأ اتصال (Offer) باتجاه لاعب ثاني محدد — يُستدعى من الطرف اللي يبدأ المكالمة */
  async callPeer(otherPeerId: string) {
    const peer = this.getOrCreatePeer(otherPeerId);
    const offer = await peer.connection.createOffer();
    await peer.connection.setLocalDescription(offer);
    this.send({ type: "offer", from: this.myPeerId, to: otherPeerId, sdp: offer });
  }

  /** ينهي كل الاتصالات ويطفي الميكروفون */
  stop() {
    this.peers.forEach((p) => {
      p.connection.close();
      p.audioEl.remove();
    });
    this.peers.clear();
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.localStream = null;
    if (this.channel) {
      const supabase = getSupabaseBrowserClient();
      supabase.removeChannel(this.channel);
      this.channel = null;
    }
  }

  /** كتم/تشغيل صوتك أنت (الميكروفون الصادر) */
  setMicMuted(muted: boolean) {
    this.micMuted = muted;
    this.localStream?.getAudioTracks().forEach((t) => {
      t.enabled = !muted;
    });
  }

  /** كتم/تشغيل سماع الآخرين (الصوت الوارد) */
  setListeningMuted(muted: boolean) {
    this.listeningMuted = muted;
    this.peers.forEach((p) => {
      p.audioEl.muted = muted;
    });
  }
}
