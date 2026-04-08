import { useEffect, useRef, useState } from 'react';

// Lazy načtená kamera + dekodér čárových kódů (zxing-js).
// Otevře video stream, čte EAN/UPC kódy, po prvním rozpoznání volá onDetected(code).
// onClose = zavření overlay (např. křížek).

export default function BarcodeScanner({ onDetected, onClose }) {
  const videoRef = useRef(null);
  const controlsRef = useRef(null);
  const [error, setError] = useState(null);
  const [starting, setStarting] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function start() {
      try {
        // Dynamický import — zxing/browser se stáhne až tady.
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

        // Použít constraints místo deviceId — `listVideoInputDevices()` na iOS
        // a v některých Androidech vrací prázdný seznam, dokud uživatel nepovolí
        // kameru. `facingMode: environment` rovnou požádá o zadní kameru.
        const constraints = {
          audio: false,
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        };

        const controls = await reader.decodeFromConstraints(
          constraints,
          videoRef.current,
          (result, err, ctrls) => {
            if (cancelled) return;
            if (result) {
              const code = result.getText();
              ctrls.stop();
              onDetected(code);
            }
            // err = NotFoundException při každém prázdném snímku → ignorujeme
          }
        );

        controlsRef.current = controls;
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
      try {
        controlsRef.current?.stop();
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
