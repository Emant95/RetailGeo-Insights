/**
 * Notification delivery channels. In-app notifications are persisted by the notification
 * service; email/SMS go through a channel adapter (SES/SNS/Twilio in production).
 */
export interface OutboundMessage {
  to: string;
  subject: string;
  body: string;
  kind: string;
}
export interface MessageChannel {
  readonly name: 'email' | 'sms';
  send(msg: OutboundMessage): Promise<void>;
}

/** Captures messages in memory — used in dev, tests and the demo "outbox". */
export class OutboxChannel implements MessageChannel {
  readonly sent: (OutboundMessage & { at: string })[] = [];
  constructor(readonly name: 'email' | 'sms' = 'email', private listener?: (m: OutboundMessage) => void) {}
  async send(msg: OutboundMessage) {
    this.sent.push({ ...msg, at: new Date().toISOString() });
    if (this.sent.length > 200) this.sent.shift();
    this.listener?.(msg);
  }
}
