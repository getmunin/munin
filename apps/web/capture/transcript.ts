export interface ScriptedMessage {
  id: string;
  role: 'end_user' | 'agent' | 'system';
  authorKind: 'ai' | 'human' | null;
  authorName: string | null;
  body: string;
  typingMs: number;
  pauseMs: number;
}

export interface ScriptedExchange {
  ask: string;
  reply: ScriptedMessage;
}

export const ORG_NAME = 'Acme Kitchen';

export const GREETING = 'Hi there. Ask us anything about your order.';

export const SCRIPT: ScriptedExchange[] = [
  {
    ask: 'Hi! I ordered a stand mixer last week. Can I still change the delivery address?',
    reply: {
      id: 'msg_agent_1',
      role: 'agent',
      authorKind: 'ai',
      authorName: 'Munin',
      body: 'Yes, as long as the parcel has not left our warehouse. Orders ship the next working day, so tell me your order number and I will check where it is.',
      typingMs: 1600,
      pauseMs: 900,
    },
  },
  {
    ask: 'Order 10492. The new address is Nygata 3, Lillevik.',
    reply: {
      id: 'msg_agent_2',
      role: 'agent',
      authorKind: 'ai',
      authorName: 'Munin',
      body: 'Order 10492 is still being picked, so the address can be changed. I have put it in front of a colleague to confirm the change with the carrier.',
      typingMs: 1900,
      pauseMs: 900,
    },
  },
];

export const HANDOVER: ScriptedMessage = {
  id: 'msg_agent_3',
  role: 'agent',
  authorKind: 'human',
  authorName: 'Kari Nordmann',
  body: 'Kari here from the delivery team. The new address is on the label and it still goes out tomorrow. Anything else I can help with?',
  typingMs: 1700,
  pauseMs: 1200,
};
