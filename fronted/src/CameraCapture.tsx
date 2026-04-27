import React, { useRef, useState, useCallback, useEffect } from 'react';

interface LocationData {
  lat: number;
  lng: number;
}

interface CameraCaptureProps {
  // הפונקציה מחזירה כעת גם את קובץ התמונה וגם את המיקום (אם אושר)
  onCapture: (file: File, location?: LocationData) => void;
  onCancel: () => void;
}

const CameraCapture: React.FC<CameraCaptureProps> = ({ onCapture, onCancel }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string>('');
  const [isFlashing, setIsFlashing] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false); // למנוע לחיצות כפולות

  const startCamera = useCallback(async () => {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'environment' } 
      });
      setStream(mediaStream);
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }
    } catch (err) {
      console.error("שגיאה בגישה למצלמה:", err);
      setError('לא הצלחנו לגשת למצלמה. אנא ודא שאישרת גישה.');
    }
  }, []);

  useEffect(() => {
    startCamera();
    return () => {
      if (stream) stream.getTracks().forEach(track => track.stop());
    };
  }, [startCamera]);

  // פונקציה פנימית לעיבוד התמונה (דחיסה וקנבס)
  const processImageAndFinish = (lat?: number, lng?: number) => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      
      // --- דחיסת תמונה (Image Compression) ---
      const MAX_WIDTH = 1280; // מקטין רזולוציית ענק של טלפונים
      let width = video.videoWidth;
      let height = video.videoHeight;
      
      if (width > MAX_WIDTH) {
        height = Math.round((height * MAX_WIDTH) / width);
        width = MAX_WIDTH;
      }
      
      canvas.width = width;
      canvas.height = height;
      
      const context = canvas.getContext('2d');
      if (context) {
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        // המרה ל-Blob באיכות 0.7 במקום 1.0 חוסכת 70% מהמשקל!
        canvas.toBlob((blob) => {
          if (blob) {
            const file = new File([blob], `photo_${Date.now()}.jpg`, { type: 'image/jpeg' });
            if (stream) stream.getTracks().forEach(track => track.stop());
            
            const locationData = (lat && lng) ? { lat, lng } : undefined;
            onCapture(file, locationData);
          }
        }, 'image/jpeg', 0.7);
      }
    }
  };

  const takePhoto = () => {
    if (isCapturing) return;
    setIsCapturing(true);
    setIsFlashing(true);
    
    setTimeout(() => {
      setIsFlashing(false);
      
      // --- שליפת מיקום GPS ---
      if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            processImageAndFinish(position.coords.latitude, position.coords.longitude);
          },
          (geoError) => {
            console.warn("הלקוח סירב או שאין קליטת GPS:", geoError);
            processImageAndFinish(); // ממשיכים גם בלי מיקום
          },
          { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
        );
      } else {
        processImageAndFinish(); // דפדפן לא תומך
      }
    }, 150);
  };

  const handleCancel = () => {
    if (stream) stream.getTracks().forEach(track => track.stop());
    onCancel();
  };

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.95)', zIndex: 1000,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center'
    }}>
      {isFlashing && (
        <div style={{
          position: 'absolute', inset: 0, backgroundColor: 'white', zIndex: 2000,
          transition: 'opacity 0.2s', opacity: 1
        }} />
      )}

      {error ? (
        <div style={{ color: 'white', textAlign: 'center' }}>
          <p>{error}</p>
          <button onClick={handleCancel} style={{ padding: '10px 20px', marginTop: '20px' }}>סגור</button>
        </div>
      ) : (
        <>
          <div style={{ position: 'relative', width: '100%', maxWidth: '500px', overflow: 'hidden', borderRadius: '16px' }}>
            <video 
              ref={videoRef} 
              autoPlay 
              playsInline 
              style={{ width: '100%', display: 'block', backgroundColor: 'black', opacity: isCapturing ? 0.8 : 1 }}
            />
            
            <div style={{
              position: 'absolute', inset: '15%', border: '2px solid rgba(255, 255, 255, 0.3)',
              borderRadius: '12px', boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.5)',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center'
            }}>
              <div style={{ position: 'absolute', top: '-2px', left: '-2px', width: '20px', height: '20px', borderTop: '4px solid #2563eb', borderLeft: '4px solid #2563eb', borderRadius: '10px 0 0 0' }} />
              <div style={{ position: 'absolute', top: '-2px', right: '-2px', width: '20px', height: '20px', borderTop: '4px solid #2563eb', borderRight: '4px solid #2563eb', borderRadius: '0 10px 0 0' }} />
              <div style={{ position: 'absolute', bottom: '-2px', left: '-2px', width: '20px', height: '20px', borderBottom: '4px solid #2563eb', borderLeft: '4px solid #2563eb', borderRadius: '0 0 0 10px' }} />
              <div style={{ position: 'absolute', bottom: '-2px', right: '-2px', width: '20px', height: '20px', borderBottom: '4px solid #2563eb', borderRight: '4px solid #2563eb', borderRadius: '0 0 10px 0' }} />
              {!isCapturing && <div className="scanning-line" style={{ width: '100%', height: '2px', backgroundColor: 'rgba(37, 99, 235, 0.6)', position: 'absolute', top: '50%', boxShadow: '0 0 10px #2563eb' }} />}
            </div>

            <div style={{
              position: 'absolute', top: '20px', left: '0', right: '0', textAlign: 'center',
              color: 'white', fontWeight: 'bold', textShadow: '0 2px 4px rgba(0,0,0,0.8)'
            }}>
              <span style={{ backgroundColor: 'rgba(0,0,0,0.5)', padding: '6px 16px', borderRadius: '20px', fontSize: '14px' }}>
                {isCapturing ? 'מעבד תמונה ומיקום...' : 'סריקת חלל אקטיבית'}
              </span>
            </div>
          </div>
          
          <canvas ref={canvasRef} style={{ display: 'none' }} />
          
          <div style={{ display: 'flex', gap: '20px', marginTop: '40px', zIndex: 10 }}>
            <button onClick={handleCancel} disabled={isCapturing} style={{
              padding: '12px 24px', backgroundColor: 'transparent', color: 'white', borderRadius: '8px', border: '1px solid white', cursor: 'pointer', opacity: isCapturing ? 0.5 : 1
            }}>
              ביטול
            </button>
            <button onClick={takePhoto} disabled={isCapturing} style={{
              padding: '12px 40px', backgroundColor: '#2563eb', color: 'white', borderRadius: '30px', border: 'none', cursor: 'pointer', fontWeight: 'bold', fontSize: '18px', boxShadow: '0 4px 15px rgba(37, 99, 235, 0.4)', opacity: isCapturing ? 0.7 : 1
            }}>
              {isCapturing ? '⏳ ממתין...' : '📸 צלם'}
            </button>
          </div>
        </>
      )}
      <style>{`
        .scanning-line { animation: scan 2s ease-in-out infinite alternate; }
        @keyframes scan { 0% { top: 5%; } 100% { top: 95%; } }
      `}</style>
    </div>
  );
};

export default CameraCapture;