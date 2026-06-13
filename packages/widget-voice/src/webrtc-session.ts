import type { SignalingChannel, SignalingHandlers } from './signaling.ts';
import type {
  VoiceSession,
  VoiceSessionEvent,
  VoiceSessionListener,
  VoiceSessionState,
  WebRtcVoiceDescriptor,
} from './types.ts';

/**
 * Vendor-agnostic in-browser voice session over WebRTC. Owns the peer
 * connection, microphone capture, and remote audio playback; delegates the
 * vendor's signaling framing to a SignalingChannel. Reused by any SDK-less
 * vendor — only the SignalingChannel differs.
 */
export class WebRtcVoiceSession implements VoiceSession {
  private pc: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private audioEl: HTMLAudioElement | null = null;
  private listeners = new Set<VoiceSessionListener>();
  private muted = false;
  private currentState: VoiceSessionState = 'idle';

  constructor(
    private readonly descriptor: WebRtcVoiceDescriptor,
    private readonly channel: SignalingChannel,
  ) {}

  get state(): VoiceSessionState {
    return this.currentState;
  }

  subscribe(listener: VoiceSessionListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async start(): Promise<void> {
    if (this.pc) throw new Error('voice_session_already_started');
    this.setState('connecting');
    try {
      const pc = new RTCPeerConnection({ iceServers: this.descriptor.iceServers });
      this.pc = pc;

      pc.ontrack = (event) => {
        const [stream] = event.streams;
        if (stream) this.playRemote(stream);
      };
      pc.onicecandidate = (event) => {
        if (event.candidate) this.channel.sendCandidate(event.candidate.toJSON());
        else this.channel.sendEndOfCandidates();
      };
      pc.onconnectionstatechange = () => {
        switch (pc.connectionState) {
          case 'connected':
            this.setState('listening');
            break;
          case 'failed':
            this.emit({ type: 'error', error: new Error('webrtc_connection_failed') });
            this.setState('error');
            break;
          case 'disconnected':
          case 'closed':
            this.setState('ended');
            break;
        }
      };

      this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      for (const track of this.localStream.getAudioTracks()) {
        track.enabled = !this.muted;
        pc.addTrack(track, this.localStream);
      }

      await this.channel.open(this.signalingHandlers(pc));

      const offer = await pc.createOffer({ offerToReceiveAudio: true });
      await pc.setLocalDescription(offer);
      this.channel.sendOffer(offer.sdp ?? '');
    } catch (err) {
      this.emit({ type: 'error', error: toError(err) });
      this.setState('error');
      await this.end();
      throw err;
    }
  }

  end(): Promise<void> {
    try {
      this.channel.close();
    } catch {
      // ignore channel close errors
    }
    if (this.localStream) {
      for (const track of this.localStream.getTracks()) track.stop();
      this.localStream = null;
    }
    if (this.pc) {
      try {
        this.pc.close();
      } finally {
        this.pc = null;
      }
    }
    if (this.audioEl) {
      this.audioEl.srcObject = null;
      this.audioEl.remove();
      this.audioEl = null;
    }
    this.setState('ended');
    return Promise.resolve();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.localStream) {
      for (const track of this.localStream.getAudioTracks()) track.enabled = !muted;
    }
  }

  isMuted(): boolean {
    return this.muted;
  }

  private signalingHandlers(pc: RTCPeerConnection): SignalingHandlers {
    return {
      onAnswer: (sdp) => {
        void pc
          .setRemoteDescription({ type: 'answer', sdp })
          .catch((err) => this.emit({ type: 'error', error: toError(err) }));
      },
      onRemoteCandidate: (candidate) => {
        void pc.addIceCandidate(candidate).catch(() => {
          // a failed trickle candidate is non-fatal
        });
      },
      onTranscript: (payload) => {
        if (!payload.text) return;
        this.emit({ type: 'transcript', payload });
      },
      onRemoteState: (state) => {
        if (state === 'speaking') this.setState('speaking');
        else if (state === 'listening') this.setState('listening');
      },
      onClosed: () => {
        if (this.currentState !== 'error') this.setState('ended');
      },
      onError: (error) => {
        this.emit({ type: 'error', error });
        this.setState('error');
      },
    };
  }

  private playRemote(stream: MediaStream): void {
    if (typeof document === 'undefined') return;
    if (!this.audioEl) {
      this.audioEl = document.createElement('audio');
      this.audioEl.autoplay = true;
      this.audioEl.style.display = 'none';
      document.body.appendChild(this.audioEl);
    }
    this.audioEl.srcObject = stream;
    void this.audioEl.play().catch(() => {
      // autoplay may be blocked until a user gesture; the widget triggers start on a click
    });
  }

  private setState(next: VoiceSessionState): void {
    if (this.currentState === next) return;
    if ((this.currentState === 'ended' || this.currentState === 'error') && next !== 'idle') {
      return;
    }
    this.currentState = next;
    this.emit({ type: 'state', state: next });
  }

  private emit(event: VoiceSessionEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // listener errors are swallowed to keep the session loop running
      }
    }
  }
}

function toError(err: unknown): Error {
  if (err instanceof Error) return err;
  if (typeof err === 'string') return new Error(err);
  try {
    return new Error(JSON.stringify(err));
  } catch {
    return new Error('unknown_voice_error');
  }
}
