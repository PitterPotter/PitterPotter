import { useRef, useEffect, useState, useCallback } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { X } from 'lucide-react';

interface QRScannerProps {
  onScan: (code: string) => void;
  onClose: () => void;
}

export default function QRScanner({ onScan, onClose }: QRScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [manualCode, setManualCode] = useState('');

  const stop = useCallback(() => {
    if (controlsRef.current) {
      controlsRef.current.stop();
      controlsRef.current = null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const start = async () => {
      try {
        const reader = new BrowserMultiFormatReader();
        readerRef.current = reader;

        const controls = await reader.decodeFromVideoDevice(
          undefined,
          videoRef.current!,
          (result, err) => {
            if (result && !cancelled) {
              const text = result.getText();
              if (text) {
                stop();
                onScan(text);
              }
            }
          }
        );

        if (cancelled) {
          controls.stop();
        } else {
          controlsRef.current = controls;
          setReady(true);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Camera not available');
      }
    };

    start();

    return () => {
      cancelled = true;
      stop();
    };
  }, [onScan, stop]);

  return (
    <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-50 p-4">
      <div className="relative w-full max-w-md">
        <div className="relative rounded-2xl overflow-hidden bg-black aspect-square">
          <video
            ref={videoRef}
            className="w-full h-full object-cover"
            playsInline
            muted
          />
          {!ready && !error && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            </div>
          )}
          {error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center">
              <p className="text-white text-sm font-semibold">{error}</p>
              <p className="text-white/60 text-xs">Please enter your code manually</p>
            </div>
          )}
          {ready && (
            <>
              <div className="absolute inset-0 pointer-events-none">
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-40 border-2 border-white/80 rounded-xl" />
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-0.5 bg-[#DBE7E4]/60 animate-pulse" />
              </div>
              <p className="absolute bottom-4 left-0 right-0 text-center text-white/80 text-xs font-semibold">
                Point camera at QR code
              </p>
            </>
          )}
        </div>
        <div className="mt-3 flex gap-2">
          <input
            type="text"
            value={manualCode}
            onChange={(e) => setManualCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && manualCode.trim()) {
                stop();
                onScan(manualCode.trim());
              }
            }}
            placeholder="Or type the code manually…"
            className="flex-1 px-3 py-2 bg-white/10 border border-white/30 text-white placeholder-white/50 text-sm rounded-lg focus:outline-none focus:border-white/60"
          />
          <button
            onClick={() => {
              if (manualCode.trim()) {
                stop();
                onScan(manualCode.trim());
              }
            }}
            className="px-4 py-2 bg-white text-[#1B2D3C] text-xs font-bold uppercase tracking-wider rounded-lg hover:bg-[#DBE7E4] transition-colors cursor-pointer"
          >
            Enter
          </button>
        </div>
        <button
          onClick={() => { stop(); onClose(); }}
          className="absolute -top-3 -right-3 w-10 h-10 bg-white text-[#1B2D3C] rounded-full flex items-center justify-center shadow-lg hover:bg-[#DBE7E4] transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}
