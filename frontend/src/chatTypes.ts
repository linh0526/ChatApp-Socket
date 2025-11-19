export interface VoiceRecordingPayload {
  dataUrl?: string;
  url?: string;
  fileName?: string;
  originalName?: string;
  mimeType?: string;
  size?: number;
}

export interface ImagePayload {
  dataUrl?: string;
  url?: string;
  fileName?: string;
  originalName?: string;
  mimeType?: string;
  size?: number;
}

export interface FilePayload {
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
  senderId?: string | null;
  content: string;
  createdAt: string;
  error?: string;
  isPending?: boolean;
  messageType?: 'text' | 'voice' | 'image' | 'file';
  voiceRecording?: VoiceRecordingPayload | null;
  image?: ImagePayload | null;
  file?: FilePayload | null;
  seenBy?: string[];
}

