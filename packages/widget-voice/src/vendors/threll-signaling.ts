import {
  registerSignalingProtocol,
  type SignalingChannel,
  type SignalingChannelOptions,
  type SignalingHandlers,
} from '../signaling.ts';

interface ThrellAnswer {
  type: 'answer';
  sdp: string;
}

interface ThrellEvent {
  type: 'event';
  event: 'state' | 'transcript';
  state?: string;
  speaker?: 'user' | 'agent';
  text?: string;
  isFinal?: boolean;
}

/**
 * Signaling adapter for Threll's web-call WebSocket.
 *
 * Protocol (threll-voice-server `/ws/sessions/{sessionId}`):
 *   - client → server first frame: { event: 'offer', sdp, sessionId }
 *   - server → client: { type: 'answer', sdp }  (server ICE embedded in the answer)
 *   - client → server (optional trickle): { type: 'candidate', candidate, sdpMid, sdpMLineIndex }
 *     and { type: 'ice-complete' }
 *   - server → client events: { type: 'event', event: 'state'|'transcript', ... }
 */
class ThrellSignalingChannel implements SignalingChannel {
  private ws: WebSocket | null = null;

  constructor(private readonly opts: SignalingChannelOptions) {}

  open(handlers: SignalingHandlers): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let opened = false;
      const sep = this.opts.url.includes('?') ? '&' : '?';
      const ws = new WebSocket(`${this.opts.url}${sep}token=${encodeURIComponent(this.opts.token)}`);
      this.ws = ws;

      ws.onopen = () => {
        opened = true;
        resolve();
      };
      ws.onerror = () => {
        const err = new Error('threll_signaling_error');
        if (!opened) reject(err);
        else handlers.onError(err);
      };
      ws.onclose = () => handlers.onClosed();
      ws.onmessage = (event) => {
        let msg: ThrellAnswer | ThrellEvent;
        try {
          msg = JSON.parse(typeof event.data === 'string' ? event.data : '') as
            | ThrellAnswer
            | ThrellEvent;
        } catch {
          return;
        }
        if (msg.type === 'answer') {
          handlers.onAnswer(msg.sdp);
        } else if (msg.type === 'event' && msg.event === 'transcript') {
          handlers.onTranscript({
            role: msg.speaker === 'agent' ? 'assistant' : 'user',
            text: (msg.text ?? '').trim(),
            final: msg.isFinal !== false,
          });
        } else if (msg.type === 'event' && msg.event === 'state' && msg.state) {
          handlers.onRemoteState(msg.state);
        }
      };
    });
  }

  sendOffer(sdp: string): void {
    this.send({ event: 'offer', sdp, sessionId: this.opts.sessionId });
  }

  sendCandidate(candidate: RTCIceCandidateInit): void {
    this.send({
      type: 'candidate',
      candidate: candidate.candidate ?? '',
      sdpMid: candidate.sdpMid ?? null,
      sdpMLineIndex: candidate.sdpMLineIndex ?? null,
    });
  }

  sendEndOfCandidates(): void {
    this.send({ type: 'ice-complete' });
  }

  close(): void {
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) this.ws.close();
    this.ws = null;
  }

  private send(payload: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }
}

registerSignalingProtocol('threll', (opts) => new ThrellSignalingChannel(opts));
