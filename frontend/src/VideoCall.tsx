import { useEffect, useRef, useState } from 'react';
import { X, Mic, MicOff, Video, VideoOff, PhoneOff } from 'lucide-react';
import { Button } from './ui/button';
import type { Socket } from 'socket.io-client';

interface VideoCallProps {
  isOpen: boolean;
  onClose: () => void;
  conversationId: string;
  otherUserName: string;
  socket: Socket | null;
  callType?: 'video' | 'audio'; // 'video' or 'audio' call
}

export function VideoCall({
  isOpen,
  onClose,
  conversationId,
  otherUserName,
  socket,
  callType = 'video',
}: VideoCallProps) {
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);

  // queue candidates that arrive before remote description is set
  const remoteCandidatesQueue = useRef<RTCIceCandidateInit[]>([]);

  // store pending incoming offer when UI closed or pc not ready
  const pendingOfferRef = useRef<{ conversationId: string; offer: RTCSessionDescriptionInit; from?: string } | null>(null);

  const [isVideoEnabled, setIsVideoEnabled] = useState(callType === 'video');
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [isCallActive, setIsCallActive] = useState(false);
  const [callStatus, setCallStatus] = useState<'connecting' | 'ringing' | 'active' | 'ended'>('connecting');
  const [callDuration, setCallDuration] = useState(0); // in seconds
  const callStartTimeRef = useRef<number | null>(null);
  const durationIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Timer functions
  const startCallTimer = () => {
    if (durationIntervalRef.current) return;
    durationIntervalRef.current = setInterval(() => {
      if (callStartTimeRef.current) {
        const elapsed = Math.floor((Date.now() - callStartTimeRef.current) / 1000);
        setCallDuration(elapsed);
      }
    }, 1000);
  };

  const stopCallTimer = () => {
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }
    callStartTimeRef.current = null;
    setCallDuration(0);
  };

  const formatDuration = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hours > 0) {
      return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // helper: create RTCPeerConnection and attach handlers
  const createPeerConnection = (s: Socket | null) => {
    if (pcRef.current) return pcRef.current;

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
    });

    pc.ontrack = (ev) => {
      const stream = ev.streams?.[0];
      if (stream) {
        if (remoteVideoRef.current && callType === 'video') {
          remoteVideoRef.current.srcObject = stream;
        }
        setIsCallActive(true);
        setCallStatus('active');
        // Start timer when call becomes active
        if (!callStartTimeRef.current) {
          callStartTimeRef.current = Date.now();
          startCallTimer();
        }
      }
    };

    pc.onicecandidate = (ev) => {
      if (ev.candidate && s) {
        const token = localStorage.getItem('token');
        s.emit('video-call:ice-candidate', {
          token,
          conversationId,
          candidate: ev.candidate,
        });
      }
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === 'disconnected' || state === 'failed' || state === 'closed') {
        setCallStatus('ended');
        setIsCallActive(false);
      }
      // keep other states for debugging if needed
    };

    // When negotiationneeded (e.g., tracks added), create offer and send
    // Only fire for outgoing calls (when we have localDescription but no remoteDescription)
    pc.onnegotiationneeded = async () => {
      try {
        if (!s) return;
        // Only create offer if we're in outgoing call state (have local but no remote)
        // If we already have remoteDescription, we're handling an incoming call
        if (pc.remoteDescription) return;
        // Prevent duplicate offers
        if (pc.localDescription) return;
        
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        const token = localStorage.getItem('token');
        s.emit('video-call:offer', { token, conversationId, offer });
        setCallStatus('ringing');
      } catch (err) {
        console.error('Negotiation error', err);
      }
    };

    pcRef.current = pc;
    return pc;
  };

  // Add remote candidates queued earlier
  const flushRemoteCandidates = async () => {
    const pc = pcRef.current;
    if (!pc) return;
    const queue = remoteCandidatesQueue.current.splice(0);
    for (const c of queue) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(c));
      } catch (err) {
        console.warn('Error adding queued candidate', err);
      }
    }
  };

  const stopLocalTracks = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }
  };

  const closePeer = () => {
    if (pcRef.current) {
      try {
        pcRef.current.ontrack = null;
        pcRef.current.onicecandidate = null;
        pcRef.current.onconnectionstatechange = null;
        pcRef.current.onnegotiationneeded = null;
        pcRef.current.close();
      } catch (e) {
        // ignore
      }
      pcRef.current = null;
    }
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
    remoteCandidatesQueue.current = [];
  };

  const cleanupAll = () => {
    stopLocalTracks();
    closePeer();
    setIsCallActive(false);
    stopCallTimer();
  };

  useEffect(() => {
    if (!isOpen) {
      // when closing UI, signal end and cleanup
      if (socket) {
        const token = localStorage.getItem('token');
        socket.emit('video-call:end', { token, conversationId });
      }
      cleanupAll();
      setCallStatus('ended');
      return;
    }

    let mounted = true;

    const init = async () => {
      try {
        // ensure getUserMedia available
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          throw new Error('Trình duyệt không hỗ trợ camera/micro');
        }

        // reuse existing stream if any
        if (!localStreamRef.current) {
          // Request media based on call type
          if (callType === 'audio') {
            // Audio-only call
            try {
              localStreamRef.current = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
              setIsVideoEnabled(false);
              setIsAudioEnabled(true);
            } catch (e) {
              throw new Error('Không thể truy cập microphone. Vui lòng kiểm tra quyền.');
            }
          } else {
            // Video call - try video + audio, fallback to video only or audio only
            try {
              localStreamRef.current = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
              setIsVideoEnabled(Boolean(localStreamRef.current.getVideoTracks().length));
              setIsAudioEnabled(Boolean(localStreamRef.current.getAudioTracks().length));
            } catch (e) {
              // fallback attempts
              try {
                localStreamRef.current = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
                setIsAudioEnabled(false);
              } catch {
                localStreamRef.current = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
                setIsVideoEnabled(false);
              }
            }
          }
        }

        if (callType === 'video' && localVideoRef.current && localStreamRef.current) {
          localVideoRef.current.srcObject = localStreamRef.current;
        }

        // prepare peer connection
        const pc = createPeerConnection(socket);

        // If there's a pending offer for this convo, accept it (incoming call)
        if (pendingOfferRef.current && pendingOfferRef.current.conversationId === conversationId) {
          const pending = pendingOfferRef.current;
          pendingOfferRef.current = null;
          
          // Set remote description first (incoming offer)
          await pc.setRemoteDescription(new RTCSessionDescription(pending.offer));
          
          // Add local tracks after setting remote description
          if (localStreamRef.current) {
            localStreamRef.current.getTracks().forEach((t) => {
              const senderExists = pc.getSenders().some(s => s.track === t);
              if (!senderExists) pc.addTrack(t, localStreamRef.current as MediaStream);
            });
          }
          
          await flushRemoteCandidates();
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          if (socket) {
            const token = localStorage.getItem('token');
            socket.emit('video-call:answer', { token, conversationId, answer });
          }
          setCallStatus('active');
          // Start timer for incoming call
          if (!callStartTimeRef.current) {
            callStartTimeRef.current = Date.now();
            startCallTimer();
          }
        } else {
          // Outgoing call: add tracks first, then onnegotiationneeded will fire
          if (localStreamRef.current) {
            localStreamRef.current.getTracks().forEach((t) => {
              const senderExists = pc.getSenders().some(s => s.track === t);
              if (!senderExists) pc.addTrack(t, localStreamRef.current as MediaStream);
            });
          }
          
          // If onnegotiationneeded didn't fire (shouldn't happen), create offer manually
          // Wait a bit to see if onnegotiationneeded fires
          setTimeout(async () => {
            if (!pc.localDescription && !pc.remoteDescription && mounted) {
              try {
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                if (socket && mounted) {
                  const token = localStorage.getItem('token');
                  socket.emit('video-call:offer', { token, conversationId, offer });
                  setCallStatus('ringing');
                }
              } catch (err) {
                console.error('Manual offer creation failed', err);
              }
            }
          }, 100);
        }
      } catch (err) {
        console.error('Init call error', err);
        alert((err as Error)?.message || 'Không thể khởi tạo cuộc gọi');
        onClose();
      }
    };

    init();

    // socket handlers (stable references)
    const handleIncomingOffer = async (data: { conversationId: string; offer: RTCSessionDescriptionInit; from?: string }) => {
      if (data.conversationId !== conversationId) return;
      
      // if UI closed or not ready -> store pending
      if (!mounted || !isOpen) {
        pendingOfferRef.current = data;
        return;
      }
      
      // If we already have a remote description, ignore duplicate offer
      const pc = pcRef.current;
      if (pc && pc.remoteDescription) {
        return;
      }
      
      const activePc = createPeerConnection(socket);
      try {
        // ensure we have local stream
        if (!localStreamRef.current) {
          localStreamRef.current = await navigator.mediaDevices.getUserMedia({ video: true, audio: true }).catch(() => null);
          if (!localStreamRef.current) {
            console.error('Failed to get user media for incoming call');
            return;
          }
          if (localVideoRef.current) {
            localVideoRef.current.srcObject = localStreamRef.current;
          }
        }

        // Set remote description first (incoming offer)
        await activePc.setRemoteDescription(new RTCSessionDescription(data.offer));
        
        // Add local tracks after setting remote description
        if (localStreamRef.current) {
          localStreamRef.current.getTracks().forEach(t => {
            const senderExists = activePc.getSenders().some(s => s.track === t);
            if (!senderExists) activePc.addTrack(t, localStreamRef.current as MediaStream);
          });
        }
        
        await flushRemoteCandidates();
        const answer = await activePc.createAnswer();
        await activePc.setLocalDescription(answer);
        if (socket && mounted) {
          const token = localStorage.getItem('token');
          socket.emit('video-call:answer', { token, conversationId, answer });
        }
        if (mounted) {
          setCallStatus('active');
          // Start timer when call becomes active
          if (!callStartTimeRef.current) {
            callStartTimeRef.current = Date.now();
            startCallTimer();
          }
        }
      } catch (err) {
        console.error('handleIncomingOffer error', err);
        if (mounted) {
          alert('Không thể chấp nhận cuộc gọi. Vui lòng thử lại.');
          onClose();
        }
      }
    };

    const handleAnswer = async (data: { conversationId: string; answer: RTCSessionDescriptionInit }) => {
      if (data.conversationId !== conversationId) return;
      const pc = pcRef.current;
      if (!pc) return;
      
      // If we already have a remote description, ignore duplicate answer
      if (pc.remoteDescription) {
        return;
      }
      
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
        await flushRemoteCandidates();
        if (mounted) {
          setCallStatus('active');
          // Start timer when answer is processed
          if (!callStartTimeRef.current) {
            callStartTimeRef.current = Date.now();
            startCallTimer();
          }
        }
      } catch (err) {
        console.warn('setRemoteDescription(answer) failed', err);
      }
    };

    const handleIce = async (data: { conversationId: string; candidate: RTCIceCandidateInit }) => {
      if (data.conversationId !== conversationId) return;
      const pc = pcRef.current;
      if (!pc || !pc.remoteDescription || !pc.remoteDescription.type) {
        // queue if remoteDescription not set yet
        remoteCandidatesQueue.current.push(data.candidate);
        return;
      }
      try {
        await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
      } catch (err) {
        console.warn('addIceCandidate failed', err);
      }
    };

    const handleCallEnded = (data: { conversationId: string }) => {
      if (data.conversationId !== conversationId) return;
      cleanupAll();
      setCallStatus('ended');
    };

    if (socket) {
      socket.on('video-call:offer', handleIncomingOffer);
      socket.on('video-call:answer', handleAnswer);
      socket.on('video-call:ice-candidate', handleIce);
      socket.on('video-call:ended', handleCallEnded);
    }

    return () => {
      mounted = false;
      if (socket) {
        socket.off('video-call:offer', handleIncomingOffer);
        socket.off('video-call:answer', handleAnswer);
        socket.off('video-call:ice-candidate', handleIce);
        socket.off('video-call:ended', handleCallEnded);
      }
      // do not call onClose here, just cleanup resources
      // UI closing will handle signalling
      cleanupAll();
    };
    // intentionally exclude onClose to avoid re-registering; include conversationId & isOpen & socket
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, conversationId, socket]);

  const toggleVideo = () => {
    if (!localStreamRef.current) return;
    const videoTrack = localStreamRef.current.getVideoTracks()[0];
    if (!videoTrack) return;
    videoTrack.enabled = !videoTrack.enabled;
    setIsVideoEnabled(videoTrack.enabled);
  };

  const toggleAudio = () => {
    if (!localStreamRef.current) return;
    const audioTrack = localStreamRef.current.getAudioTracks()[0];
    if (!audioTrack) return;
    audioTrack.enabled = !audioTrack.enabled;
    setIsAudioEnabled(audioTrack.enabled);
  };

  const endCall = () => {
    if (socket) {
      const token = localStorage.getItem('token');
      socket.emit('video-call:end', { token, conversationId });
    }
    cleanupAll();
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-90">
      <div className="relative w-full h-full max-w-7xl mx-auto flex flex-col">
        <div className="flex-1 relative bg-black rounded-lg overflow-hidden">
          {callType === 'video' ? (
            <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <div className="text-center text-white">
                <div className="size-32 mx-auto mb-4 rounded-full bg-blue-600 flex items-center justify-center text-4xl font-bold">
                  {otherUserName.charAt(0).toUpperCase()}
                </div>
                <div className="text-2xl font-semibold">{otherUserName}</div>
                {isCallActive && callDuration > 0 && (
                  <div className="text-lg mt-2 text-blue-400">{formatDuration(callDuration)}</div>
                )}
              </div>
            </div>
          )}
          {!isCallActive && (
            <div className="absolute inset-0 flex items-center justify-center text-white">
              <div className="text-center">
                <div className="animate-pulse text-2xl mb-2">{otherUserName}</div>
                <div className="text-sm">
                  {callStatus === 'ringing' ? 'Đang gọi...' : 'Đang kết nối...'}
                </div>
              </div>
            </div>
          )}
          {isCallActive && callType === 'video' && callDuration > 0 && (
            <div className="absolute top-4 left-4 bg-black/70 px-4 py-2 rounded-lg text-white text-lg font-mono">
              {formatDuration(callDuration)}
            </div>
          )}
        </div>

        {callType === 'video' && (
          <div className="absolute top-4 right-4 w-48 h-36 bg-black rounded-lg overflow-hidden border-2 border-white">
            <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
          </div>
        )}

        <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2 flex gap-4">
          <Button onClick={toggleAudio} size="icon" className="rounded-full w-14 h-14" variant={isAudioEnabled ? 'default' : 'destructive'}>
            {isAudioEnabled ? <Mic className="w-6 h-6" /> : <MicOff className="w-6 h-6" />}
          </Button>
          {callType === 'video' && (
            <Button onClick={toggleVideo} size="icon" className="rounded-full w-14 h-14" variant={isVideoEnabled ? 'default' : 'destructive'}>
              {isVideoEnabled ? <Video className="w-6 h-6" /> : <VideoOff className="w-6 h-6" />}
            </Button>
          )}
          <Button onClick={endCall} size="icon" className="rounded-full w-14 h-14 bg-red-600 hover:bg-red-700">
            <PhoneOff className="w-6 h-6" />
          </Button>
        </div>

        <Button onClick={endCall} size="icon" variant="ghost" className="absolute top-4 left-4 text-white hover:bg-white/20">
          <X className="w-6 h-6" />
        </Button>
      </div>
    </div>
  );
}
