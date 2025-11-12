export interface FriendSummary {
  id: string;
  username: string;
  email: string;
}

export type FriendRequestStatus = 'pending' | 'accepted' | 'declined' | 'cancelled';

export interface FriendRequestPreview {
  id: string;
  status: FriendRequestStatus;
  createdAt: string;
  respondedAt?: string | null;
  direction: 'incoming' | 'outgoing';
  user: FriendSummary;
}

export interface FriendActionFeedback {
  type: 'success' | 'error';
  message: string;
}

export interface FriendRequestTarget {
  userId?: string;
  email?: string;
}



