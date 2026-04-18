import { useEffect, useRef, useState } from 'react';

// Lazy načtená kamera + dekodér čárových kódů.
// Preferuje nativní `BarcodeDetector` (Chrome Android/desktop — ML Kit, rychlé
// a spolehlivé), fallback na zxing-js (Safari iOS, Firefox).
// onDetected(code) se zavolá po prvním rozpoznaném kódu; onClose zavře overlay.

const FORMATS_NATIVE = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'];

export default function BarcodeScanner({ onDetected, onClose }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const zxingControlsRef = useRef(null);
  const rafRef = useRef(null);
  const [error, setError] = useState(null);
  const [starting, setStarting] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function start() {
      try {
        // Constraints: zadní kamera + vyšší rozlišení + continuous autofocus.
        // Android bez autofocus hintu často zamrzne na hyperfocal distance
        // a čárové kódy zblízka jsou rozmazané → nic se nedekóduje.
        const constraints = {
          audio: false,
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            focusMode: { ideal: 'continuous' },
            advanced: [{ focusMode: 'continuous' }],
          },
        };

        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;

        const video = videoRef.current;
        video.srcObject = stream;
        await video.play();

        // Preferuj nativní BarcodeDetector (Android Chrome, desktop Chrome).
        // Safari iOS ho nemá → fallback na zxing níže.
        const hasNative =
          'BarcodeDetector' in window &&
          typeof window.BarcodeDetector.getSupportedFormats === 'function';

        let nativeOk = false;
        if (hasNative) {
          try {
            const supported = await window.BarcodeDetector.getSupportedFormats();
            const formats = FORMATS_NATIVE.filter((f) => supported.includes(f));
            if (formats.length > 0) {
              const detector = new window.BarcodeDetector({ formats });
              setStarting(false);
              nativeOk = true;

              const tick = async () => {
                if (cancelled) return;
                try {
                  const codes = await detector.detect(video);
                  if (codes && codes.length > 0) {
                    const code = codes[0].rawValue;
                    onDetected(code);
                    return;
                  }
                } catch (_) {
                  // občasné chyby detektoru ignorujeme, zkusíme další snímek
                }
                rafRef.current = requestAnimationFrame(tick);
              };
              rafRef.current = requestAnimationFrame(tick);
            }
          } catch (_) {
            // nativní detektor selhal (např. nepodporovaný formát) → fallback
            nativeOk = false;
          }
        }

        if (nativeOk) return;

        // Fallback: zxing-js z existujícího streamu.
        const { BrowserMultiFormatReader } = await import('@zxing/browser');
        const { BarcodeFormat, DecodeHintType } = await import('@zxing/library');

        if (cancelled) return;

        const hints = new Map();
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [
          BarcodeFormat.EAN_13,
          BarcodeFormat.EAN_8,
          BarcodeFormat.UPC_A,
          BarcodeFormat.UPC_E,
          BarcodeFormat.CODE_128,
        ]);
        hints.set(DecodeHintType.TRY_HARDER, true);

        const reader = new BrowserMultiFormatReader(hints, {
          delayBetweenScanAttempts: 200,
        });

        const controls = await reader.decodeFromStream(
          stream,
          video,
          (result, err, ctrls) => {
            if (cancelled) return;
            if (result) {
              const code = result.getText();
              ctrls.stop();
              onDetected(code);
            }
          }
        );

        zxingControlsRef.current = controls;
        setStarting(false);
      } catch (e) {
        console.error('Scanner error:', e);
        if (e?.name === 'NotAllowedError') {
          setError('Nepovolil/a jsi přístup ke kameře.');
        } else if (e?.name === 'NotFoundError') {
          setError('V prohlížeči není dostupná kamera.');
        } else {
          setError('Chyba kamery: ' + (e?.message || e));
        }
        setStarting(false);
      }
    }

    start();

    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      try {
        zxingControlsRef.current?.stop();
      } catch (_) {}
      try {
        streamRef.current?.getTracks().forEach((t) => t.stop());
      } catch (_) {}
    };
  }, [onDetected]);

  return (
    <div className="scanner-overlay" onClick={(e) => e.stopPropagation()}>
      <div className="scanner-frame">
        <video ref={videoRef} className="scanner-video" playsInline muted />
        <div className="scanner-target" />
      </div>
      <div className="scanner-status">
        {starting && !error && 'Spouštím kameru…'}
        {error && <span className="scanner-error">{error}</span>}
        {!starting && !error && 'Namiř kameru na čárový kód.'}
      </div>
      <button className="scanner-close" onClick={onClose}>Zrušit</button>
    </div>
  );
}
