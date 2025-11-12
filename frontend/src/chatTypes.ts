export interface ChatMessage {
  id: string;
  sender: string;
  content: string;
  createdAt: string;
  error?: string;
  isPending?: boolean;
}

