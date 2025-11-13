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
}

export function VideoCall({
  isOpen,
  onClose,
  conversationId,
  otherUserName,
  socket,
}: VideoCallProps) {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [isCallActive, setIsCallActive] = useState(false);
  const [callStatus, setCallStatus] = useState<'connecting' | 'ringing' | 'active' | 'ended'>('connecting');
  const pendingOfferRef = useRef<{ conversationId: string; offer: RTCSessionDescriptionInit; from?: string } | null>(null);

  const cleanup = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
  };

  useEffect(() => {
    if (!isOpen) {
      cleanup();
      setIsCallActive(false);
      setCallStatus('ended');
      return;
    }

    const initializeCall = async () => {
      try {
        console.log('[VideoCall] ===== INITIALIZING CALL =====');
        console.log('[VideoCall] isOpen:', isOpen);
        console.log('[VideoCall] conversationId:', conversationId);
        console.log('[VideoCall] pendingOfferRef:', pendingOfferRef.current);
        console.log('[VideoCall] navigator.mediaDevices:', navigator.mediaDevices);
        
        // Check if mediaDevices is available
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          throw new Error('Trình duyệt không hỗ trợ truy cập camera và microphone. Vui lòng sử dụng trình duyệt hiện đại như Chrome, Firefox, Edge.');
        }

        // Check current permissions (if supported)
        try {
          const videoPermission = await navigator.permissions?.query({ name: 'camera' as PermissionName });
          const audioPermission = await navigator.permissions?.query({ name: 'microphone' as PermissionName });
          console.log('Camera permission:', videoPermission?.state);
          console.log('Microphone permission:', audioPermission?.state);
          
          if (videoPermission?.state === 'denied' || audioPermission?.state === 'denied') {
            alert('Quyền camera/microphone đã bị từ chối. Vui lòng:\n1. Click vào biểu tượng khóa ở thanh địa chỉ\n2. Cho phép Camera và Microphone\n3. Làm mới trang và thử lại');
            onClose();
            return;
          }
        } catch (permError) {
          // Permissions API might not be supported, continue anyway
          console.log('Permissions API not available, continuing...');
        }

        // List available devices first
        try {
          const devices = await navigator.mediaDevices.enumerateDevices();
          const videoDevices = devices.filter(device => device.kind === 'videoinput');
          const audioDevices = devices.filter(device => device.kind === 'audioinput');
          console.log('Available video devices:', videoDevices.length);
          console.log('Available audio devices:', audioDevices.length);
          
          if (videoDevices.length === 0 && audioDevices.length === 0) {
            throw new Error('Không tìm thấy camera và microphone. Vui lòng kiểm tra thiết bị của bạn.');
          }
        } catch (enumError) {
          console.log('Could not enumerate devices:', enumError);
        }

        // Get user media - this will trigger browser permission prompt
        console.log('Calling getUserMedia...');
        let stream: MediaStream;
        
        try {
          // Try to get both video and audio
          stream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: true,
          });
        } catch (error) {
          // If both fail, try video only
          if (error instanceof Error && error.name === 'NotFoundError') {
            console.log('Both video and audio not found, trying video only...');
            try {
              stream = await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: false,
              });
              alert('Không tìm thấy microphone. Cuộc gọi sẽ chỉ có video.');
            } catch (videoError) {
              // If video fails, try audio only
              console.log('Video not found, trying audio only...');
              try {
                stream = await navigator.mediaDevices.getUserMedia({
                  video: false,
                  audio: true,
                });
                alert('Không tìm thấy camera. Cuộc gọi sẽ chỉ có audio.');
                setIsVideoEnabled(false);
              } catch (audioError) {
                // Both failed
                throw new Error('Không tìm thấy camera và microphone. Vui lòng:\n1. Kiểm tra xem camera/microphone đã được kết nối chưa\n2. Đảm bảo không có ứng dụng khác đang sử dụng thiết bị\n3. Kiểm tra cài đặt quyền trong trình duyệt');
              }
            }
          } else {
            throw error;
          }
        }
        
        console.log('Media stream obtained:', stream);
        localStreamRef.current = stream;
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
          console.log('Local video stream set');
        }

        // Create peer connection
        const configuration = {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
          ],
        };
        const pc = new RTCPeerConnection(configuration);
        peerConnectionRef.current = pc;

        // Add local tracks
        stream.getTracks().forEach((track) => {
          pc.addTrack(track, stream);
        });

        // Handle remote stream
        pc.ontrack = (event) => {
          console.log('[VideoCall] 🎥 Received remote track:', event);
          if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = event.streams[0];
            setIsCallActive(true);
            setCallStatus('active');
            console.log('[VideoCall] ✅ Remote stream set, call is active');
          }
        };

        // Handle ICE candidates
        pc.onicecandidate = (event) => {
          if (event.candidate && socket) {
            console.log('[VideoCall] 🧊 ICE candidate generated:', event.candidate);
            const token = localStorage.getItem('token');
            socket.emit('video-call:ice-candidate', {
              token,
              conversationId,
              candidate: event.candidate,
            });
          } else if (!event.candidate) {
            console.log('[VideoCall] 🧊 ICE gathering complete');
          }
        };

        // Handle connection state
        pc.onconnectionstatechange = () => {
          console.log('[VideoCall] 🔄 Connection state changed:', pc.connectionState);
          if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
            console.log('[VideoCall] ❌ Connection lost, ending call');
            setCallStatus('ended');
            setIsCallActive(false);
          } else if (pc.connectionState === 'connected') {
            console.log('[VideoCall] ✅ Connection established');
          }
        };

        // Check if there's a pending incoming offer
        if (pendingOfferRef.current && pendingOfferRef.current.conversationId === conversationId) {
          // This is an incoming call, handle the offer
          console.log('[VideoCall] 📞 INCOMING CALL - Handling pending offer');
          const pendingOffer = pendingOfferRef.current;
          pendingOfferRef.current = null;
          
          console.log('[VideoCall] Setting remote description (offer)');
          await pc.setRemoteDescription(new RTCSessionDescription(pendingOffer.offer));
          console.log('[VideoCall] Creating answer');
          const answer = await pc.createAnswer();
          console.log('[VideoCall] Setting local description (answer)');
          await pc.setLocalDescription(answer);
          
          if (socket) {
            const token = localStorage.getItem('token');
            console.log('[VideoCall] 📤 Emitting video-call:answer');
            socket.emit('video-call:answer', {
              token,
              conversationId,
              answer,
            });
          }
          setCallStatus('active');
          console.log('[VideoCall] ✅ Incoming call answered, status: active');
        } else {
          // This is an outgoing call, create offer
          console.log('[VideoCall] 📞 OUTGOING CALL - Creating offer');
          const offer = await pc.createOffer();
          console.log('[VideoCall] Setting local description (offer)');
          await pc.setLocalDescription(offer);

          if (socket) {
            const token = localStorage.getItem('token');
            console.log('[VideoCall] 📤 Emitting video-call:offer');
            socket.emit('video-call:offer', {
              token,
              conversationId,
              offer,
            });
            setCallStatus('ringing');
            console.log('[VideoCall] ✅ Offer sent, status: ringing');
          }
        }
      } catch (error) {
        console.error('Error initializing call:', error);
        if (error instanceof Error) {
          console.error('Error name:', error.name);
          console.error('Error message:', error.message);
          
          let errorMessage = 'Không thể khởi tạo cuộc gọi.';
          
          if (error.name === 'NotFoundError' || error.message.includes('not found')) {
            errorMessage = 'Không tìm thấy camera hoặc microphone.\n\nVui lòng:\n1. Kiểm tra xem camera/microphone đã được kết nối chưa\n2. Đảm bảo không có ứng dụng khác đang sử dụng thiết bị\n3. Thử kết nối lại thiết bị\n4. Kiểm tra cài đặt quyền trong trình duyệt';
          } else if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
            errorMessage = 'Quyền truy cập camera/microphone bị từ chối.\n\nVui lòng:\n1. Click vào biểu tượng khóa ở thanh địa chỉ\n2. Cho phép Camera và Microphone\n3. Làm mới trang và thử lại';
          } else if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
            errorMessage = 'Camera hoặc microphone đang được sử dụng bởi ứng dụng khác.\n\nVui lòng đóng các ứng dụng khác đang sử dụng camera/microphone và thử lại.';
          } else {
            errorMessage = error.message || 'Lỗi không xác định';
          }
          
          alert(errorMessage);
        } else {
          alert('Không thể khởi tạo cuộc gọi. Vui lòng thử lại.');
        }
        onClose();
      }
    };

    // Initialize call immediately when opened
    initializeCall();

    // Setup socket listeners if socket is available
    if (socket) {
      // Listen for incoming offer (when receiving a call)
      const handleIncomingOffer = async (data: { conversationId: string; offer: RTCSessionDescriptionInit; from?: string }) => {
        console.log('[VideoCall] 📨 Received incoming offer:', data);
        if (data.conversationId === conversationId) {
          // If component is not open or peer connection not ready, store the offer
          if (!isOpen || !peerConnectionRef.current) {
            console.log('[VideoCall] ⏳ Storing offer (component not ready)');
            pendingOfferRef.current = data;
            return;
          }
          
          // If peer connection exists but no local description, handle the offer
          if (!peerConnectionRef.current.localDescription) {
            console.log('[VideoCall] 📞 Handling incoming offer (component already open)');
            try {
              // Create peer connection if it doesn't exist (shouldn't happen but just in case)
              if (!peerConnectionRef.current) {
                const configuration = {
                  iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' },
                  ],
                };
                const pc = new RTCPeerConnection(configuration);
                peerConnectionRef.current = pc;

                // Handle remote stream
                pc.ontrack = (event) => {
                  if (remoteVideoRef.current) {
                    remoteVideoRef.current.srcObject = event.streams[0];
                    setIsCallActive(true);
                    setCallStatus('active');
                  }
                };

                // Handle ICE candidates
                pc.onicecandidate = (event) => {
                  if (event.candidate && socket) {
                    const token = localStorage.getItem('token');
                    socket.emit('video-call:ice-candidate', {
                      token,
                      conversationId,
                      candidate: event.candidate,
                    });
                  }
                };

                // Handle connection state
                pc.onconnectionstatechange = () => {
                  if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
                    setCallStatus('ended');
                    setIsCallActive(false);
                  }
                };
              }

              // Request media permission if not already granted
              if (!localStreamRef.current) {
                const stream = await navigator.mediaDevices.getUserMedia({
                  video: true,
                  audio: true,
                });
                localStreamRef.current = stream;
                if (localVideoRef.current) {
                  localVideoRef.current.srcObject = stream;
                }
                // Add tracks to peer connection
                stream.getTracks().forEach((track) => {
                  if (peerConnectionRef.current) {
                    peerConnectionRef.current.addTrack(track, stream);
                  }
                });
              }

              console.log('[VideoCall] Setting remote description (offer)');
              await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(data.offer));
              console.log('[VideoCall] Creating answer');
              const answer = await peerConnectionRef.current.createAnswer();
              console.log('[VideoCall] Setting local description (answer)');
              await peerConnectionRef.current.setLocalDescription(answer);
              
              if (socket) {
                const token = localStorage.getItem('token');
                console.log('[VideoCall] 📤 Emitting video-call:answer');
                socket.emit('video-call:answer', {
                  token,
                  conversationId,
                  answer,
                });
              }
              setCallStatus('active');
              console.log('[VideoCall] ✅ Incoming call answered, status: active');
            } catch (error) {
              console.error('Error handling incoming offer:', error);
              alert('Không thể chấp nhận cuộc gọi. Vui lòng kiểm tra quyền camera và microphone.');
            }
          }
        }
      };

      // Listen for answer
      const handleAnswer = async (data: { conversationId: string; answer: RTCSessionDescriptionInit }) => {
        console.log('[VideoCall] 📨 Received answer:', data);
        if (data.conversationId === conversationId && peerConnectionRef.current) {
          console.log('[VideoCall] Setting remote description (answer)');
          await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(data.answer));
          console.log('[VideoCall] ✅ Answer processed');
        }
      };

      // Listen for ICE candidate
      const handleIceCandidate = async (data: {
        conversationId: string;
        candidate: RTCIceCandidateInit;
      }) => {
        console.log('[VideoCall] 🧊 Received ICE candidate:', data);
        if (data.conversationId === conversationId && peerConnectionRef.current) {
          await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(data.candidate));
          console.log('[VideoCall] ✅ ICE candidate added');
        }
      };

      // Listen for call ended
      const handleCallEnded = (data: { conversationId: string }) => {
        console.log('[VideoCall] 📞 Call ended:', data);
        if (data.conversationId === conversationId) {
          setCallStatus('ended');
          setIsCallActive(false);
          console.log('[VideoCall] ✅ Call ended, status: ended');
        }
      };

      socket.on('video-call:offer', handleIncomingOffer);
      socket.on('video-call:answer', handleAnswer);
      socket.on('video-call:ice-candidate', handleIceCandidate);
      socket.on('video-call:ended', handleCallEnded);

      return () => {
        socket.off('video-call:offer', handleIncomingOffer);
        socket.off('video-call:answer', handleAnswer);
        socket.off('video-call:ice-candidate', handleIceCandidate);
        socket.off('video-call:ended', handleCallEnded);
      };
    }
  }, [isOpen, conversationId, socket, onClose]);

  const toggleVideo = () => {
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !isVideoEnabled;
        setIsVideoEnabled(!isVideoEnabled);
      }
    }
  };

  const toggleAudio = () => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !isAudioEnabled;
        setIsAudioEnabled(!isAudioEnabled);
      }
    }
  };

  const endCall = () => {
    console.log('[VideoCall] 📞 Ending call');
    if (socket) {
      const token = localStorage.getItem('token');
      console.log('[VideoCall] 📤 Emitting video-call:end');
      socket.emit('video-call:end', { token, conversationId });
    }
    cleanup();
    onClose();
    console.log('[VideoCall] ✅ Call ended and cleaned up');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-90">
      <div className="relative w-full h-full max-w-7xl mx-auto flex flex-col">
        {/* Remote video (main) */}
        <div className="flex-1 relative bg-black rounded-lg overflow-hidden">
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="w-full h-full object-cover"
            muted={false}
          />
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
        </div>

        {/* Local video (small) */}
        <div className="absolute top-4 right-4 w-48 h-36 bg-black rounded-lg overflow-hidden border-2 border-white">
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover"
          />
        </div>

        {/* Controls */}
        <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2 flex gap-4">
          <Button
            onClick={toggleAudio}
            size="icon"
            className="rounded-full w-14 h-14"
            variant={isAudioEnabled ? 'default' : 'destructive'}
          >
            {isAudioEnabled ? <Mic className="w-6 h-6" /> : <MicOff className="w-6 h-6" />}
          </Button>
          <Button
            onClick={toggleVideo}
            size="icon"
            className="rounded-full w-14 h-14"
            variant={isVideoEnabled ? 'default' : 'destructive'}
          >
            {isVideoEnabled ? <Video className="w-6 h-6" /> : <VideoOff className="w-6 h-6" />}
          </Button>
          <Button
            onClick={endCall}
            size="icon"
            className="rounded-full w-14 h-14 bg-red-600 hover:bg-red-700"
          >
            <PhoneOff className="w-6 h-6" />
          </Button>
        </div>

        {/* Close button */}
        <Button
          onClick={endCall}
          size="icon"
          variant="ghost"
          className="absolute top-4 left-4 text-white hover:bg-white/20"
        >
          <X className="w-6 h-6" />
        </Button>
      </div>
    </div>
  );
}

