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
  analyser?: AnalyserNode;
  analyserData?: Uint8Array;
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
  private playbackBlocked = false;
  private audioCtx: AudioContext | null = null;
  private localAnalyser?: AnalyserNode;
  private localAnalyserData?: Uint8Array;
  private shouldCall: (otherPeerId: string) => boolean = (other) => this.myPeerId < other;
  private helloTimer: ReturnType<typeof setInterval> | null = null;
  private calledPeers = new Set<string>();

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

    const newPeer: VoicePeer = { peerId: otherPeerId, connection, audioEl };

    connection.ontrack = (e) => {
      audioEl.srcObject = e.streams[0];
      audioEl.muted = this.listeningMuted;
      // تشغيل صريح — الاعتماد على autoplay وحده يفشل بصمت بأغلب متصفحات الجوال
      audioEl.play().catch(() => {
        this.playbackBlocked = true;
      });
      this.setupPeerAnalyser(newPeer, e.streams[0]);
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

    this.peers.set(otherPeerId, newPeer);
    return newPeer;
  }

  /** يبدأ الاتصال — يشترك بقناة الإشارات ويهيّئ الميكروفون
   *  micEnabled=false يخلي الطرف "استماع فقط" (مو مسموح له يتكلم) — للمستمعين
   *  shouldCallFn: قاعدة تحديد "مين يبدأ المكالمة" — افتراضيًا صاحب المعرّف الأصغر
   *  (لبث المتكلم الواحد لعدة مستمعين، مرّر: (other) => true لو أنا المتكلم، وإلا () => false)
   */
  async start(micEnabled: boolean = true, shouldCallFn?: (otherPeerId: string) => boolean) {
    if (shouldCallFn) this.shouldCall = shouldCallFn;

    // فتح إذن تشغيل الصوت بالمتصفح فور الضغطة (أول شي بالدالة، لسا داخل نفس بادرة المستخدم)
    // يمنع فشل التشغيل التلقائي الصامت لاحقًا لما يوصل صوت الطرف الثاني بعد التفاوض
    try {
      const unlock = new Audio();
      unlock.play().catch(() => {});
    } catch {
      // تجاهل
    }

    if (micEnabled) {
      try {
        this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        this.setupLocalAnalyser();
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

    // "hello" — بث تعارف عام (بدون "to" محدد)، يحل مشكلة توقيت الانضمام
    // (مين يشترك أول ما يهم — كل طرف يعلن حضوره، والطرف اللي قاعدته shouldCall صح يبدأ المكالمة)
    this.channel.on("broadcast", { event: "hello" }, ({ payload }) => {
      if (payload.from === this.myPeerId) return;
      if (this.shouldCall(payload.from) && !this.calledPeers.has(payload.from)) {
        this.calledPeers.add(payload.from);
        this.callPeer(payload.from);
      }
    });

    await new Promise<void>((resolve) => {
      this.channel!.subscribe((status) => {
        if (status === "SUBSCRIBED") resolve();
      });
    });

    // أعلن حضوري فورًا، وكرّرها كل ثانيتين لأول 10 ثواني — يضمن وصولها حتى لو الطرف الثاني اشترك متأخر
    const sayHello = () => this.channel?.send({ type: "broadcast", event: "hello", payload: { from: this.myPeerId } });
    sayHello();
    let helloCount = 0;
    this.helloTimer = setInterval(() => {
      sayHello();
      helloCount++;
      if (helloCount >= 5 && this.helloTimer) {
        clearInterval(this.helloTimer);
        this.helloTimer = null;
      }
    }, 2000);
  }

  /** يبدأ اتصال (Offer) باتجاه لاعب ثاني محدد — يُستدعى تلقائيًا عبر آلية hello، أو يدويًا لو احتجت */
  async callPeer(otherPeerId: string) {
    this.calledPeers.add(otherPeerId);
    const peer = this.getOrCreatePeer(otherPeerId);
    const offer = await peer.connection.createOffer();
    await peer.connection.setLocalDescription(offer);
    this.send({ type: "offer", from: this.myPeerId, to: otherPeerId, sdp: offer });
  }

  /** ينهي كل الاتصالات ويطفي الميكروفون */
  stop() {
    if (this.helloTimer) {
      clearInterval(this.helloTimer);
      this.helloTimer = null;
    }
    this.calledPeers.clear();
    this.peers.forEach((p) => {
      p.connection.close();
      p.audioEl.remove();
    });
    this.peers.clear();
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.localStream = null;
    this.audioCtx?.close().catch(() => {});
    this.audioCtx = null;
    this.localAnalyser = undefined;
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

  /** هل انحظر التشغيل التلقائي بأي اتصال؟ (يستخدمه العميل لإظهار زر "فعّل الصوت" احتياطي) */
  isPlaybackBlocked() {
    return this.playbackBlocked;
  }

  /** إعادة محاولة تشغيل كل الأصوات الواردة — استدعِها من داخل ضغطة زر مباشرة */
  retryPlayback() {
    this.playbackBlocked = false;
    this.peers.forEach((p) => {
      p.audioEl.play().catch(() => {
        this.playbackBlocked = true;
      });
    });
  }

  private getAudioContext(): AudioContext {
    if (!this.audioCtx) {
      this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    return this.audioCtx;
  }

  private setupLocalAnalyser() {
    if (!this.localStream) return;
    try {
      const ctx = this.getAudioContext();
      const source = ctx.createMediaStreamSource(this.localStream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      this.localAnalyser = analyser;
      this.localAnalyserData = new Uint8Array(analyser.frequencyBinCount);
    } catch {
      // بعض المتصفحات تحتاج تفاعل مستخدم إضافي — تجاهل بأمان
    }
  }

  private setupPeerAnalyser(peer: VoicePeer, stream: MediaStream) {
    try {
      const ctx = this.getAudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      peer.analyser = analyser;
      peer.analyserData = new Uint8Array(analyser.frequencyBinCount);
    } catch {
      // تجاهل بأمان
    }
  }

  /** مستوى الصوت الحالي (0 إلى 1 تقريبًا) — بدون peerId يرجع مستوى ميكروفوني أنا */
  getAudioLevel(peerId?: string): number {
    const analyser = peerId ? this.peers.get(peerId)?.analyser : this.localAnalyser;
    const data = peerId ? this.peers.get(peerId)?.analyserData : this.localAnalyserData;
    if (!analyser || !data) return 0;
    analyser.getByteFrequencyData(data as Uint8Array<ArrayBuffer>);
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i];
    const avg = sum / data.length; // 0-255
    return Math.min(1, avg / 90); // تطبيع تقريبي لحساسية مريحة
  }
}
