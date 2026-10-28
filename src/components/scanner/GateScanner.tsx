import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  QrCode, 
  CheckCircle2, 
  XCircle, 
  AlertTriangle, 
  Clock, 
  Search, 
  RefreshCw, 
  UserCheck, 
  ArrowLeft,
  Crown,
  Lock,
  LogOut,
  ShieldCheck,
  Camera,
  CameraOff,
  SwitchCamera,
  Zap,
  ZapOff,
  Volume2,
  VolumeX,
  RotateCcw,
  Sparkles
} from 'lucide-react';
import jsQR from 'jsqr';
import { TicketService } from '../../lib/ticketService';
import { CheckInResult, TicketCategory, TicketRecord } from '../../types/inventory';

interface GateScannerProps {
  onBack: () => void;
  onViewTicket?: (ticket: TicketRecord) => void;
}

interface RecentGateCheckInItem {
  id: string;
  ticket_number: string;
  category: TicketCategory;
  buyer_name: string | null;
  checked_in_at: string | null;
  ticket_channel?: 'online' | 'hardcopy';
}

function playScanBeep(success: boolean = true) {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    if (success) {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.12);
      gain.gain.setValueAtTime(0.18, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.14);
      osc.start();
      osc.stop(ctx.currentTime + 0.14);
    } else {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(320, ctx.currentTime);
      osc.frequency.setValueAtTime(240, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.25);
      osc.start();
      osc.stop(ctx.currentTime + 0.25);
    }
  } catch {
    // Non-critical: AudioContext may be blocked before interaction
  }
}

export const GateScanner: React.FC<GateScannerProps> = ({ onBack, onViewTicket }) => {
  const [checkingSession, setCheckingSession] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [staffRole, setStaffRole] = useState<'gate_staff' | 'admin' | null>(null);
  const [sessionExpiresAt, setSessionExpiresAt] = useState<string | null>(null);

  const [gatePasscode, setGatePasscode] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  // Camera & Scanner State
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [isStartingCamera, setIsStartingCamera] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false);
  const [hasTorch, setHasTorch] = useState(false);
  const [isTorchOn, setIsTorchOn] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [isSecureContextEnv, setIsSecureContextEnv] = useState(true);

  // Manual & Verification State
  const [inputCode, setInputCode] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [result, setResult] = useState<CheckInResult | null>(null);
  const [recentScans, setRecentScans] = useState<RecentGateCheckInItem[]>([]);

  // Refs for camera loop
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const isVerifyingRef = useRef<boolean>(false);
  const lastScannedCodeRef = useRef<string>('');
  const lastScannedTimeRef = useRef<number>(0);
  const barcodeDetectorRef = useRef<any>(null);

  // Sync isVerifying ref for scanner loop
  useEffect(() => {
    isVerifyingRef.current = isVerifying;
  }, [isVerifying]);

  // Check secure context on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const isLocal = 
        window.location.hostname === 'localhost' || 
        window.location.hostname === '127.0.0.1' || 
        window.location.hostname.endsWith('.localhost');
      const isHttps = window.location.protocol === 'https:';
      const secure = Boolean(window.isSecureContext || isHttps || isLocal);
      setIsSecureContextEnv(secure);
    }
  }, []);

  // Initialize BarcodeDetector if natively supported (hardware-accelerated in Chrome/Edge/Android)
  useEffect(() => {
    if (typeof window !== 'undefined' && 'BarcodeDetector' in window) {
      try {
        const DetectorClass = (window as any).BarcodeDetector;
        barcodeDetectorRef.current = new DetectorClass({ formats: ['qr_code'] });
      } catch {
        barcodeDetectorRef.current = null;
      }
    }
  }, []);

  const loadRecent = useCallback(async () => {
    try {
      const res = await TicketService.getRecentGateCheckIns(8);
      if (res.unauthorized) {
        setIsAuthenticated(false);
        setStaffRole(null);
        setLoginError('Gate staff session expired. Please sign in again.');
        return;
      }
      if (res.success && Array.isArray(res.checkIns)) {
        setRecentScans(res.checkIns);
      }
    } catch {
      // ignore transient feed error
    }
  }, []);

  // Check active gate session on mount
  useEffect(() => {
    let active = true;
    TicketService.checkGateSession()
      .then((session) => {
        if (!active) return;
        if (session.authenticated) {
          setIsAuthenticated(true);
          setStaffRole(session.role || 'gate_staff');
          setSessionExpiresAt(session.expiresAt || null);
        } else {
          setIsAuthenticated(false);
          setStaffRole(null);
        }
      })
      .finally(() => {
        if (active) setCheckingSession(false);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      void loadRecent();
    }
  }, [isAuthenticated, result, loadRecent]);

  // -------------------------------------------------------------
  // CAMERA STREAM MANAGEMENT
  // -------------------------------------------------------------

  const stopCamera = useCallback(() => {
    // 1. Cancel animation frame
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    // 2. Turn off torch if active
    if (isTorchOn && streamRef.current) {
      const videoTrack = streamRef.current.getVideoTracks()[0];
      if (videoTrack && typeof (videoTrack as any).applyConstraints === 'function') {
        (videoTrack as any).applyConstraints({ advanced: [{ torch: false }] }).catch(() => {});
      }
      setIsTorchOn(false);
    }

    // 3. Stop all media stream tracks
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // ignore track stop error
        }
      });
      streamRef.current = null;
    }

    // 4. Detach video element
    if (videoRef.current) {
      try {
        videoRef.current.pause();
        videoRef.current.srcObject = null;
      } catch {
        // ignore video pause error
      }
    }

    setIsCameraActive(false);
    setIsStartingCamera(false);
  }, [isTorchOn]);

  // Clean up on component unmount
  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  const handleVerify = useCallback(async (codeToVerify?: string) => {
    const target = (codeToVerify || inputCode).trim();
    if (!target || isVerifyingRef.current) return;

    setIsVerifying(true);
    isVerifyingRef.current = true;
    setResult(null);

    let cleanToken = target;
    if (target.includes('verify=')) {
      const match = target.match(/[?&]verify=([^&#\s]+)/i) || target.match(/verify=([^&#\s]+)/i);
      if (match && match[1]) {
        try {
          cleanToken = decodeURIComponent(match[1]);
        } catch {
          cleanToken = match[1];
        }
      }
    }

    try {
      const res = await TicketService.verifyAndCheckIn(cleanToken);
      if (res.status === 'UNAUTHORIZED') {
        setIsAuthenticated(false);
        setStaffRole(null);
        setLoginError(res.message || 'Gate staff session expired. Please sign in again.');
        stopCamera();
        return;
      }

      setResult(res);

      if (res.status === 'ADMITTED') {
        setInputCode('');
        if (soundEnabled) playScanBeep(true);
        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
          try { navigator.vibrate([100, 50, 100]); } catch {}
        }
      } else {
        if (soundEnabled) playScanBeep(false);
        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
          try { navigator.vibrate(200); } catch {}
        }
      }
    } catch {
      if (soundEnabled) playScanBeep(false);
      setResult({
        status: 'INVALID',
        message: 'Network error during verification. Check gate server connection.',
      });
    } finally {
      setIsVerifying(false);
      isVerifyingRef.current = false;
    }
  }, [inputCode, soundEnabled, stopCamera]);

  // QR Scanning Loop
  const runScanFrame = useCallback(() => {
    if (!videoRef.current || !streamRef.current) return;

    const video = videoRef.current;

    // Only process if video is actively playing with valid dimensions
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0 && video.videoHeight > 0) {
      // Check if we are currently verifying a ticket to avoid spamming the backend
      if (!isVerifyingRef.current) {
        const processDecodedString = (text: string) => {
          const trimmed = text.trim();
          if (!trimmed) return;

          const now = Date.now();
          // Debounce same QR code within 3.5 seconds
          if (trimmed === lastScannedCodeRef.current && now - lastScannedTimeRef.current < 3500) {
            return;
          }

          lastScannedCodeRef.current = trimmed;
          lastScannedTimeRef.current = now;
          setInputCode(trimmed);
          void handleVerify(trimmed);
        };

        // 1. Try native BarcodeDetector API if supported (GPU-accelerated)
        if (barcodeDetectorRef.current) {
          barcodeDetectorRef.current
            .detect(video)
            .then((barcodes: Array<{ rawValue?: string }>) => {
              if (barcodes && barcodes.length > 0 && barcodes[0].rawValue) {
                processDecodedString(barcodes[0].rawValue);
              }
            })
            .catch(() => {
              // Fallback to canvas + jsQR on detector error
            });
        }

        // 2. Pure JS canvas analysis via jsQR (ensures 100% compatibility across iOS Safari / all browsers)
        if (canvasRef.current) {
          const canvas = canvasRef.current;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (ctx) {
            // Downscale to 640px max width for high frame rate with excellent QR resolution
            const targetWidth = Math.min(video.videoWidth, 640);
            const scale = targetWidth / video.videoWidth;
            const targetHeight = Math.round(video.videoHeight * scale);

            if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
              canvas.width = targetWidth;
              canvas.height = targetHeight;
            }

            ctx.drawImage(video, 0, 0, targetWidth, targetHeight);
            const imageData = ctx.getImageData(0, 0, targetWidth, targetHeight);
            const qrResult = jsQR(imageData.data, targetWidth, targetHeight, {
              inversionAttempts: 'dontInvert',
            });

            if (qrResult && qrResult.data) {
              processDecodedString(qrResult.data);
            }
          }
        }
      }
    }

    // Schedule next frame
    animationFrameRef.current = requestAnimationFrame(runScanFrame);
  }, [handleVerify]);

  const startCamera = async (targetFacing: 'environment' | 'user' = facingMode) => {
    if (isStartingCamera || streamRef.current) return;

    setCameraError(null);
    setIsStartingCamera(true);

    // Require HTTPS or localhost
    if (!isSecureContextEnv) {
      setCameraError(
        'Camera access requires a secure connection (HTTPS or localhost). Insecure HTTP blocks camera streaming.'
      );
      setIsStartingCamera(false);
      return;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraError(
        'Camera API is not supported by your browser. Please update your browser or enter ticket numbers manually below.'
      );
      setIsStartingCamera(false);
      return;
    }

    try {
      // Prefer rear camera on mobile with resolution constraints
      let stream: MediaStream | null = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: targetFacing },
            width: { ideal: 1280, min: 640 },
            height: { ideal: 720, min: 480 },
          },
          audio: false,
        });
      } catch (constraintErr: any) {
        // Fallback: relaxed constraints if environment camera fails
        if (
          constraintErr.name === 'OverconstrainedError' || 
          constraintErr.name === 'ConstraintNotSatisfiedError'
        ) {
          stream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false,
          });
        } else {
          throw constraintErr;
        }
      }

      if (!stream) {
        throw new Error('Failed to acquire camera stream.');
      }

      streamRef.current = stream;

      // Attach to video element
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute('playsinline', 'true');
        videoRef.current.muted = true;
        try {
          await videoRef.current.play();
        } catch {
          // Play was interrupted or auto-play prevented
        }
      }

      // Inspect hardware capabilities (torch, device count)
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack && typeof (videoTrack as any).getCapabilities === 'function') {
        const caps = (videoTrack as any).getCapabilities();
        setHasTorch(Boolean(caps?.torch));
      } else {
        setHasTorch(false);
      }

      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoInputs = devices.filter((d) => d.kind === 'videoinput');
        setHasMultipleCameras(videoInputs.length > 1);
      } catch {
        setHasMultipleCameras(false);
      }

      setIsCameraActive(true);
      setFacingMode(targetFacing);

      // Start processing frames
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      animationFrameRef.current = requestAnimationFrame(runScanFrame);

    } catch (err: any) {
      stopCamera();
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setCameraError(
          'Camera permission was denied. Please allow camera permissions in your browser address bar/settings, then click Start Scanner.'
        );
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        setCameraError(
          'No camera was found on this device. Please connect a camera or enter the ticket number manually.'
        );
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        setCameraError(
          'Camera is currently in use by another app or browser tab. Please close other camera applications and try again.'
        );
      } else if (err.name === 'SecurityError') {
        setCameraError(
          'Camera access blocked due to security restrictions. Use HTTPS or localhost.'
        );
      } else {
        setCameraError(err.message || 'Unable to open camera on this device.');
      }
    } finally {
      setIsStartingCamera(false);
    }
  };

  const handleToggleFacingMode = async () => {
    const nextFacing = facingMode === 'environment' ? 'user' : 'environment';
    stopCamera();
    setTimeout(() => {
      void startCamera(nextFacing);
    }, 150);
  };

  const handleToggleTorch = async () => {
    if (!streamRef.current || !hasTorch) return;
    const track = streamRef.current.getVideoTracks()[0];
    if (!track || typeof (track as any).applyConstraints !== 'function') return;

    try {
      const nextState = !isTorchOn;
      await (track as any).applyConstraints({
        advanced: [{ torch: nextState }],
      });
      setIsTorchOn(nextState);
    } catch {
      // Torch toggle failed
    }
  };

  // -------------------------------------------------------------
  // GATE LOGIN / LOGOUT
  // -------------------------------------------------------------

  const handleGateLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!gatePasscode.trim() || isLoggingIn) return;

    setIsLoggingIn(true);
    setLoginError(null);

    try {
      const res = await TicketService.loginGateSession(gatePasscode.trim());
      if (res.success && res.authenticated) {
        setGatePasscode('');
        setIsAuthenticated(true);
        setStaffRole(res.role || 'gate_staff');
        setSessionExpiresAt(res.expiresAt || null);
        setResult(null);
      } else {
        setLoginError(res.message || 'Invalid gate staff passcode.');
      }
    } catch {
      setLoginError('Network error signing into gate checkpoint.');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    stopCamera();
    await TicketService.logoutGateSession();
    setIsAuthenticated(false);
    setStaffRole(null);
    setSessionExpiresAt(null);
    setResult(null);
    setRecentScans([]);
  };

  // -------------------------------------------------------------
  // RENDERING
  // -------------------------------------------------------------

  if (checkingSession) {
    return (
      <div className="min-h-screen bg-[#080c14] text-slate-100 flex items-center justify-center p-4">
        <div className="flex items-center gap-2.5 text-xs text-slate-300">
          <RefreshCw className="w-4 h-4 animate-spin text-amber-400" />
          <span>Checking gate checkpoint session...</span>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-[#080c14] text-slate-100 flex items-center justify-center p-3 sm:p-4">
        <div className="w-full max-w-md bg-[#0d1522] border border-white/10 rounded-xl sm:rounded-2xl p-5 sm:p-8 shadow-2xl space-y-5">
          <div className="w-12 h-12 rounded-xl bg-cyan-500/10 border border-cyan-400/20 text-cyan-300 flex items-center justify-center mx-auto">
            <Lock className="w-6 h-6" />
          </div>

          <div className="text-center">
            <h1 className="text-xl font-bold text-white font-display">
              Gate Staff Checkpoint Sign-In
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              Authorized gate staff credentials are required to check passes in at Prince Resort Bunamwaya.
            </p>
          </div>

          {loginError && (
            <div className="p-3 bg-rose-950/40 border border-rose-500/40 rounded-lg text-xs text-rose-300">
              {loginError}
            </div>
          )}

          <form onSubmit={handleGateLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                Gate Staff Passcode
              </label>
              <input
                type="password"
                value={gatePasscode}
                onChange={(e) => setGatePasscode(e.target.value)}
                placeholder="Enter gate staff passcode"
                className="w-full px-3.5 sm:px-4 py-3 bg-[#080c14] border border-white/15 rounded-lg text-white text-base sm:text-sm min-h-[46px] focus:outline-none focus:border-cyan-400 font-mono transition-colors"
                autoFocus
                required
              />
            </div>

            <button
              type="submit"
              disabled={isLoggingIn || !gatePasscode.trim()}
              className="w-full min-h-[46px] py-3 bg-amber-400 hover:bg-amber-300 disabled:opacity-50 text-slate-950 font-bold rounded-lg text-xs uppercase tracking-wider shadow-sm transition-colors cursor-pointer flex items-center justify-center gap-2"
            >
              {isLoggingIn ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Signing In...</span>
                </>
              ) : (
                <>
                  <ShieldCheck className="w-4 h-4" />
                  <span>Unlock Gate Scanner</span>
                </>
              )}
            </button>
          </form>

          <div className="pt-2 border-t border-white/10 flex items-center justify-between text-xs text-slate-400">
            <span>Pool Gate 1 · Staff Only</span>
            <button
              onClick={onBack}
              className="text-cyan-400 hover:underline cursor-pointer py-1"
            >
              Back to Website
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#080c14] text-slate-100 p-3 sm:p-6 lg:p-8">
      {/* Hidden canvas for image data processing */}
      <canvas ref={canvasRef} className="hidden" aria-hidden="true" />

      <div className="max-w-4xl mx-auto space-y-4 sm:space-y-6">
        
        {/* Top Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 pb-4 border-b border-white/10">
          <div className="flex items-center gap-2.5 sm:gap-3">
            <button
              onClick={() => {
                stopCamera();
                onBack();
              }}
              className="p-2 min-w-[40px] min-h-[40px] flex items-center justify-center bg-white/5 hover:bg-white/10 rounded-lg transition-colors cursor-pointer shrink-0"
              title="Return to Main Website"
            >
              <ArrowLeft className="w-5 h-5 text-amber-400" />
            </button>
            <div className="min-w-0">
              <h1 className="text-lg sm:text-2xl font-bold text-white font-display truncate">
                Gate Entry Scanner
              </h1>
              <p className="text-[11px] sm:text-xs text-slate-400 truncate">
                Prince Resort Bunamwaya · Single-Scan QR Token Verification
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 text-[11px] sm:text-xs">
            <button
              type="button"
              onClick={() => setSoundEnabled(!soundEnabled)}
              className={`p-2 rounded-lg border transition-colors cursor-pointer flex items-center gap-1.5 ${
                soundEnabled 
                  ? 'bg-amber-400/10 border-amber-400/30 text-amber-300' 
                  : 'bg-white/5 border-white/10 text-slate-400'
              }`}
              title={soundEnabled ? 'Mute Scan Sound' : 'Enable Scan Sound'}
            >
              {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            </button>

            <span className="px-2.5 py-1.5 rounded-lg bg-emerald-950/60 border border-emerald-700/60 text-emerald-300 font-mono">
              {staffRole === 'admin' ? 'Admin Session' : 'Gate Staff'}
              {sessionExpiresAt ? ` · Exp ${new Date(sessionExpiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
            </span>

            <button
              type="button"
              onClick={handleLogout}
              className="px-3 py-1.5 bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white rounded-lg border border-white/10 flex items-center gap-1.5 cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>

        {/* Insecure Context Warning (if applicable) */}
        {!isSecureContextEnv && (
          <div className="p-4 bg-amber-950/50 border border-amber-500/50 rounded-xl text-amber-200 text-xs flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-amber-100">Insecure Context Detected</p>
              <p className="mt-0.5 text-amber-200/90">
                Modern browsers require a secure HTTPS origin or localhost to grant camera access. If you are accessing this gate tool over plain HTTP, the browser disables camera streaming. You can still check attendees in using the manual ticket code entry below.
              </p>
            </div>
          </div>
        )}

        {/* Camera Error Message */}
        {cameraError && (
          <div className="p-4 bg-rose-950/50 border border-rose-500/50 rounded-xl text-rose-200 text-xs flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <XCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold text-rose-100">Camera Access Error</p>
                <p className="mt-0.5 text-rose-200/90">{cameraError}</p>
              </div>
            </div>
            <button
              onClick={() => setCameraError(null)}
              className="text-xs text-rose-400 hover:text-rose-200 cursor-pointer font-bold px-2 py-1"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* CAMERA SCANNER VIEWPORT */}
        <div className="bg-[#0d1522] border border-white/10 rounded-xl sm:rounded-2xl p-4 sm:p-6 shadow-xl space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-sm sm:text-base font-bold text-white flex items-center gap-2">
                <Camera className="w-4 h-4 text-cyan-400" />
                <span>Live QR Gate Camera</span>
                {isCameraActive && (
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-mono bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    LIVE · {facingMode === 'environment' ? 'Rear Lens' : 'Front Lens'}
                  </span>
                )}
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Target the QR code on the digital pass or printed hardcopy wristband.
              </p>
            </div>

            {/* Camera Controls */}
            <div className="flex items-center gap-2">
              {hasTorch && isCameraActive && (
                <button
                  type="button"
                  onClick={handleToggleTorch}
                  className={`p-2.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
                    isTorchOn
                      ? 'bg-amber-400 text-slate-950 border-amber-300'
                      : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10'
                  }`}
                  title={isTorchOn ? 'Turn Flashlight Off' : 'Turn Flashlight On'}
                >
                  {isTorchOn ? <Zap className="w-4 h-4 fill-current" /> : <ZapOff className="w-4 h-4" />}
                  <span className="hidden sm:inline">Torch</span>
                </button>
              )}

              {hasMultipleCameras && isCameraActive && (
                <button
                  type="button"
                  onClick={handleToggleFacingMode}
                  className="p-2.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                  title="Switch Front/Rear Camera"
                >
                  <SwitchCamera className="w-4 h-4" />
                  <span className="hidden sm:inline">Flip</span>
                </button>
              )}

              {!isCameraActive ? (
                <button
                  type="button"
                  onClick={() => startCamera(facingMode)}
                  disabled={isStartingCamera}
                  className="px-4 py-2.5 bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-slate-950 font-bold text-xs uppercase tracking-wider rounded-lg transition-colors cursor-pointer flex items-center gap-2 shadow-lg shadow-cyan-500/10"
                >
                  {isStartingCamera ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Starting Camera...</span>
                    </>
                  ) : (
                    <>
                      <Camera className="w-4 h-4" />
                      <span>Start Scanner</span>
                    </>
                  )}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={stopCamera}
                  className="px-4 py-2.5 bg-rose-600/80 hover:bg-rose-500 text-white font-bold text-xs uppercase tracking-wider rounded-lg transition-colors cursor-pointer flex items-center gap-2"
                >
                  <CameraOff className="w-4 h-4" />
                  <span>Stop Scanner</span>
                </button>
              )}
            </div>
          </div>

          {/* Viewfinder Area */}
          <div className="relative w-full aspect-4/3 sm:aspect-16/9 max-h-[380px] bg-black/80 rounded-xl overflow-hidden border border-white/10 flex items-center justify-center">
            {/* The Live Video Element */}
            <video
              ref={videoRef}
              playsInline
              muted
              autoPlay
              className={`w-full h-full object-cover ${isCameraActive ? 'block' : 'hidden'}`}
            />

            {/* Scanner Inactive Placeholder */}
            {!isCameraActive && (
              <div className="text-center p-6 space-y-3">
                <div className="w-16 h-16 rounded-2xl bg-white/5 border border-white/10 text-slate-400 flex items-center justify-center mx-auto">
                  <QrCode className="w-8 h-8 text-amber-400/80" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-white">Camera is Standby</p>
                  <p className="text-xs text-slate-400 mt-1 max-w-xs mx-auto">
                    Click <strong className="text-cyan-400">Start Scanner</strong> above to activate your camera and scan Pool Party pass QR codes automatically.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => startCamera(facingMode)}
                  disabled={isStartingCamera}
                  className="px-5 py-2.5 bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold text-xs uppercase tracking-wider rounded-lg transition-colors cursor-pointer inline-flex items-center gap-2"
                >
                  <Camera className="w-4 h-4" />
                  <span>Activate Camera Scanner</span>
                </button>
              </div>
            )}

            {/* Target Reticle Overlay (Active when camera is on) */}
            {isCameraActive && (
              <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                {/* Viewfinder Box */}
                <div className="relative w-56 h-56 sm:w-64 sm:h-64 border-2 border-cyan-400/40 rounded-2xl shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]">
                  {/* Corner Accents */}
                  <div className="absolute -top-1 -left-1 w-6 h-6 border-t-4 border-l-4 border-amber-400 rounded-tl-lg" />
                  <div className="absolute -top-1 -right-1 w-6 h-6 border-t-4 border-r-4 border-amber-400 rounded-tr-lg" />
                  <div className="absolute -bottom-1 -left-1 w-6 h-6 border-b-4 border-l-4 border-amber-400 rounded-bl-lg" />
                  <div className="absolute -bottom-1 -right-1 w-6 h-6 border-b-4 border-r-4 border-amber-400 rounded-br-lg" />

                  {/* Scanning Laser Line */}
                  <div className="absolute left-2 right-2 h-0.5 bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_8px_#22d3ee] animate-pulse top-1/2 -translate-y-1/2" />
                </div>

                {/* Sub-label under reticle */}
                <div className="absolute bottom-4 left-0 right-0 text-center">
                  <span className="px-3 py-1 rounded-full bg-black/75 border border-white/20 text-[11px] font-medium text-slate-200 backdrop-blur-sm">
                    {isVerifying ? 'Verifying pass with gate database...' : 'Center pass QR code within the frame'}
                  </span>
                </div>
              </div>
            )}

            {/* In-Flight Verification Loading Overlay */}
            {isVerifying && (
              <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-xs flex flex-col items-center justify-center p-4 z-20">
                <RefreshCw className="w-8 h-8 text-amber-400 animate-spin" />
                <p className="text-sm font-bold text-white mt-3 font-display">
                  Checking In Pass...
                </p>
                <p className="text-xs text-slate-300 mt-1 font-mono">
                  Atomic Gate Verification in Progress
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Verification Result Card */}
        {result && (
          <div
            className={`p-5 sm:p-6 rounded-2xl border transition-all shadow-xl ${
              result.status === 'ADMITTED'
                ? 'bg-emerald-950/40 border-emerald-500/60 shadow-emerald-950/30'
                : result.status === 'ALREADY_USED'
                ? 'bg-rose-950/40 border-rose-500/60 shadow-rose-950/30'
                : result.status === 'UNPAID'
                ? 'bg-amber-950/40 border-amber-500/60 shadow-amber-950/30'
                : 'bg-red-950/40 border-red-500/60 shadow-red-950/30'
            }`}
          >
            <div className="flex items-start gap-4">
              <div className="shrink-0 mt-0.5">
                {result.status === 'ADMITTED' && (
                  <CheckCircle2 className="w-10 h-10 text-emerald-400" />
                )}
                {result.status === 'ALREADY_USED' && (
                  <XCircle className="w-10 h-10 text-rose-400" />
                )}
                {result.status === 'UNPAID' && (
                  <AlertTriangle className="w-10 h-10 text-amber-400" />
                )}
                {(result.status === 'CANCELLED' || result.status === 'INVALID' || result.status === 'NOT_ISSUED') && (
                  <XCircle className="w-10 h-10 text-rose-400" />
                )}
              </div>

              <div className="flex-1 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span
                    className={`text-[11px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full ${
                      result.status === 'ADMITTED'
                        ? 'bg-emerald-400 text-slate-950 font-bold'
                        : result.status === 'ALREADY_USED'
                        ? 'bg-rose-500 text-white font-bold'
                        : result.status === 'UNPAID'
                        ? 'bg-amber-400 text-slate-950 font-bold'
                        : 'bg-red-600 text-white font-bold'
                    }`}
                  >
                    {result.status.replace('_', ' ')}
                  </span>

                  {result.ticket && (
                    <span className="text-xs font-mono font-bold text-slate-200">
                      Pass #{result.ticket.ticket_number}
                    </span>
                  )}
                </div>

                <h3 className="text-lg sm:text-xl font-bold text-white font-display">
                  {result.message}
                </h3>

                {result.ticket && (
                  <div className="pt-3 border-t border-white/10 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                    <div>
                      <span className="text-slate-400 block text-[10px] uppercase tracking-wider">Attendee Name</span>
                      <span className="font-semibold text-white">{result.ticket.buyer_name || 'Walk-up / Guest'}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px] uppercase tracking-wider">Category</span>
                      <span className={`font-semibold flex items-center gap-1 ${
                        result.ticket.category === 'VIP' ? 'text-cyan-400' : 'text-amber-400'
                      }`}>
                        {result.ticket.category === 'VIP' && <Crown className="w-3.5 h-3.5" />}
                        {result.ticket.category} Pass
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px] uppercase tracking-wider">Payment Status</span>
                      <span className="font-semibold uppercase text-white">{result.ticket.payment_status}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px] uppercase tracking-wider">Channel</span>
                      <span className="font-mono uppercase text-slate-300">
                        {result.ticket.ticket_channel === 'hardcopy' ? 'Hardcopy' : 'Online'}
                      </span>
                    </div>
                  </div>
                )}

                <div className="pt-2 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setResult(null);
                      setInputCode('');
                    }}
                    className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white text-xs font-bold rounded-lg transition-colors cursor-pointer flex items-center gap-1.5"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Scan Next Ticket</span>
                  </button>

                  {result.ticket && onViewTicket && (
                    <button
                      type="button"
                      onClick={() => onViewTicket(result.ticket!)}
                      className="px-4 py-2 bg-amber-400/20 hover:bg-amber-400/30 text-amber-300 border border-amber-400/40 text-xs font-bold rounded-lg transition-colors cursor-pointer flex items-center gap-1.5"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>View Full Pass</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Manual Verification Fallback Box */}
        <div className="bg-[#0d1522] border border-white/10 rounded-xl sm:rounded-2xl p-4 sm:p-6 shadow-lg">
          <label className="block text-xs font-bold uppercase tracking-wider text-slate-300 mb-2">
            Manual Ticket Entry / Barcode Scanner Input
          </label>
          <p className="text-[11px] text-slate-400 mb-3">
            If the pass QR is smudged or camera access is unavailable, scan with a handheld USB/Bluetooth scanner or enter the Pass Number (e.g. VIP-001, ORD-051) or QR token UUID.
          </p>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleVerify();
            }}
            className="flex flex-col sm:flex-row gap-2.5 sm:gap-3"
          >
            <div className="relative flex-1">
              <input
                type="text"
                value={inputCode}
                onChange={(e) => setInputCode(e.target.value)}
                placeholder="Scan QR token UUID or type ticket number (e.g. VIP-001, ORD-051)"
                className="w-full px-3.5 py-3 pl-10 bg-[#080c14] border border-white/15 rounded-lg text-white text-base sm:text-sm font-mono placeholder-slate-500 min-h-[46px] focus:outline-none focus:border-amber-400 transition-colors"
              />
              <QrCode className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
            </div>

            <button
              type="submit"
              disabled={isVerifying || !inputCode.trim()}
              className="w-full sm:w-auto min-h-[46px] px-6 py-3 bg-amber-400 hover:bg-amber-300 disabled:opacity-40 text-slate-950 font-bold text-xs uppercase tracking-wider rounded-lg transition-colors whitespace-nowrap cursor-pointer flex items-center justify-center gap-2"
            >
              {isVerifying ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin shrink-0" />
                  <span>Verifying...</span>
                </>
              ) : (
                <>
                  <Search className="w-4 h-4 shrink-0" />
                  <span>Check In Pass</span>
                </>
              )}
            </button>
          </form>
        </div>

        {/* Recent Check-Ins Log */}
        <div className="bg-[#0d1522] border border-white/10 rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
              <UserCheck className="w-4 h-4 text-amber-400" />
              <span>Recent Admitted Guests (Gate Feed)</span>
            </h4>
            <button
              onClick={loadRecent}
              className="text-xs text-amber-400 hover:text-amber-300 flex items-center gap-1 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Refresh</span>
            </button>
          </div>

          {recentScans.length === 0 ? (
            <p className="text-xs text-slate-500 py-4 text-center">No admissions logged yet.</p>
          ) : (
            <div className="divide-y divide-white/5 text-xs">
              {recentScans.map((scan) => (
                <div key={scan.id} className="py-2.5 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="font-mono font-bold text-cyan-300">{scan.ticket_number}</span>
                    <span className="font-medium text-white">{scan.buyer_name || 'Guest'}</span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                      scan.category === 'VIP' ? 'bg-cyan-950 text-cyan-300 border border-cyan-800' : 'bg-slate-800 text-slate-300'
                    }`}>
                      {scan.category}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-slate-400">
                    <span className="flex items-center gap-1 text-[11px]">
                      <Clock className="w-3.5 h-3.5 text-slate-500" />
                      {scan.checked_in_at ? new Date(scan.checked_in_at).toLocaleTimeString() : 'Just now'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
};
