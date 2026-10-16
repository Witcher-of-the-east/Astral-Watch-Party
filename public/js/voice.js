// Peer-to-peer WebRTC voice chat over WebSocket signaling.
// Zero external dependencies. Audio-only with active speaker detection and mute toggle.

const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
  ]
};

export function createVoiceChat({ myId, net, onSpeakingChange = () => {}, onStateChange = () => {}, onError = () => {} }) {
  let inVoice = false;
  let muted = false;
  let speaking = false;
  let localStream = null;
  let audioCtx = null;
  let analyserTimer = null;
  const peers = new Map(); // peerId -> { pc, audioEl }
  const pendingCandidates = new Map(); // peerId -> candidate[]

  const isSupported = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.RTCPeerConnection);

  function notifyState() {
    onStateChange({ inVoice, muted, speaking, isSupported: isSupported() });
  }

  function startAudioMeter() {
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      audioCtx = new AudioContextClass();
      if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
      const src = audioCtx.createMediaStreamSource(localStream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      src.connect(analyser);

      const buffer = new Uint8Array(analyser.frequencyBinCount);
      let silenceCount = 0;

      clearInterval(analyserTimer);
      analyserTimer = setInterval(() => {
        if (!inVoice || muted) {
          if (speaking) {
            speaking = false;
            onSpeakingChange(myId, false);
            net.send('voice_state', { inVoice: true, muted, speaking: false });
          }
          return;
        }
        analyser.getByteFrequencyData(buffer);
        let sum = 0;
        for (let i = 0; i < buffer.length; i++) sum += buffer[i];
        const avg = sum / buffer.length;
        const isLoud = avg > 14;

        if (isLoud) {
          silenceCount = 0;
          if (!speaking) {
            speaking = true;
            onSpeakingChange(myId, true);
            net.send('voice_state', { inVoice: true, muted: false, speaking: true });
          }
        } else {
          silenceCount++;
          if (silenceCount >= 4 && speaking) {
            speaking = false;
            onSpeakingChange(myId, false);
            net.send('voice_state', { inVoice: true, muted: false, speaking: false });
          }
        }
      }, 90);
    } catch (e) {
      console.warn('Audio analysis unavailable', e);
    }
  }

  function getOrCreatePeer(peerId) {
    if (peers.has(peerId)) return peers.get(peerId).pc;

    const pc = new RTCPeerConnection(RTC_CONFIG);
    const audioEl = document.createElement('audio');
    audioEl.autoplay = true;
    audioEl.playsInline = true;
    audioEl.style.display = 'none';
    document.body.appendChild(audioEl);

    if (localStream) {
      localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));
    }

    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        net.send('voice_signal', { to: peerId, signal: { type: 'candidate', candidate: ev.candidate } });
      }
    };

    pc.ontrack = (ev) => {
      if (ev.streams && ev.streams[0]) {
        audioEl.srcObject = ev.streams[0];
        audioEl.play().catch(() => {});
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        removePeer(peerId);
      }
    };

    peers.set(peerId, { pc, audioEl });
    return pc;
  }

  function removePeer(peerId) {
    const p = peers.get(peerId);
    if (p) {
      try { p.pc.close(); } catch {}
      try { p.audioEl.remove(); } catch {}
      peers.delete(peerId);
    }
    pendingCandidates.delete(peerId);
  }

  async function flushCandidates(peerId, pc) {
    const list = pendingCandidates.get(peerId) || [];
    pendingCandidates.delete(peerId);
    for (const c of list) {
      try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch (e) { console.warn('ICE add error', e); }
    }
  }

  async function initiateCall(peerId) {
    try {
      const pc = getOrCreatePeer(peerId);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      net.send('voice_signal', { to: peerId, signal: { type: 'offer', sdp: offer.sdp } });
    } catch (e) {
      console.error('Failed to create offer for', peerId, e);
    }
  }

  async function handleSignal(from, signal) {
    if (!inVoice || from === myId || !signal) return;
    try {
      const pc = getOrCreatePeer(from);
      if (signal.type === 'offer') {
        await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: signal.sdp }));
        await flushCandidates(from, pc);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        net.send('voice_signal', { to: from, signal: { type: 'answer', sdp: answer.sdp } });
      } else if (signal.type === 'answer') {
        if (pc.signalingState !== 'stable') {
          await pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: signal.sdp }));
          await flushCandidates(from, pc);
        }
      } else if (signal.type === 'candidate' && signal.candidate) {
        if (pc.remoteDescription && pc.remoteDescription.type) {
          await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
        } else {
          if (!pendingCandidates.has(from)) pendingCandidates.set(from, []);
          pendingCandidates.get(from).push(signal.candidate);
        }
      }
    } catch (e) {
      console.warn('Signal handling error with', from, e);
    }
  }

  async function join(membersInVoice = []) {
    if (inVoice) return;
    if (!isSupported()) {
      onError('Your browser does not support WebRTC voice chat.');
      return;
    }

    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false
      });
    } catch (err) {
      const msg = err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError'
        ? 'Microphone permission was denied. Please allow microphone access in your browser settings to join voice.'
        : 'Could not access your microphone. Please check your audio devices.';
      onError(msg);
      return;
    }

    inVoice = true;
    muted = false;
    speaking = false;
    startAudioMeter();
    notifyState();
    net.send('voice_state', { inVoice: true, muted: false, speaking: false });

    // Call any existing members already in voice
    membersInVoice.forEach((m) => {
      if (m.id !== myId && m.inVoice && m.connected) {
        initiateCall(m.id);
      }
    });
  }

  function toggleMute() {
    if (!inVoice || !localStream) return muted;
    muted = !muted;
    localStream.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
    });
    if (muted && speaking) {
      speaking = false;
      onSpeakingChange(myId, false);
    }
    net.send('voice_state', { inVoice: true, muted, speaking: false });
    notifyState();
    return muted;
  }

  function leave() {
    if (!inVoice && !localStream) return;
    inVoice = false;
    muted = false;
    speaking = false;
    clearInterval(analyserTimer);

    if (localStream) {
      localStream.getTracks().forEach((t) => t.stop());
      localStream = null;
    }
    if (audioCtx) {
      try { audioCtx.close(); } catch {}
      audioCtx = null;
    }
    for (const peerId of [...peers.keys()]) {
      removePeer(peerId);
    }
    net.send('voice_state', { inVoice: false, muted: false, speaking: false });
    onSpeakingChange(myId, false);
    notifyState();
  }

  function handlePeerVoiceState(peerId, state) {
    if (peerId === myId) return;
    onSpeakingChange(peerId, !!state.speaking);
    if (!state.inVoice) {
      removePeer(peerId);
    }
  }

  return {
    isSupported,
    get inVoice() { return inVoice; },
    get muted() { return muted; },
    get speaking() { return speaking; },
    join,
    toggleMute,
    leave,
    handleSignal,
    handlePeerVoiceState,
    removePeer,
    destroy() { leave(); }
  };
}

