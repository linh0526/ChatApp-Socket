export interface VoiceRecordingPayload {
  dataUrl?: string;
  url?: string;
  fileName?: string;
  originalName?: string;
  mimeType?: string;
  size?: number;
}

export interface ChatMessage {
  id: string;
  sender: string;
  content: string;
  createdAt: string;
  error?: string;
  isPending?: boolean;
  messageType?: 'text' | 'voice';
  voiceRecording?: VoiceRecordingPayload | null;
}

