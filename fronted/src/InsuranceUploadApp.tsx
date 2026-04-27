import React, { useState, useEffect, ChangeEvent } from 'react';
import myData from '../data.json'; 
import CameraCapture from './CameraCapture';
import Button from './Button';
import './iii.css';
import { 
  Hand, Sparkles, Check, Rocket, Lock, PartyPopper, Phone, 
  Camera, MapPin, RefreshCw, Image as ImageIcon, AlertTriangle, 
  Plus, ArrowRight, ArrowLeft, Home, CheckCircle2, ScanLine
} from 'lucide-react'; 

const generateSessionId = (): string => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {

    return crypto.randomUUID();
  }
  return `sess_${Date.now()}_${Math.random().toString(16).slice(2)}`;
};

interface PropertyCharacteristics {
  area_sqm: number;
  rooms: number;
  bathrooms: number;
  has_balcony: boolean;
  balcony_area_sqm: number;
  has_storage_room: boolean;
  has_parking: boolean;
  declared_finish_level: string;
}

interface SessionData {
  property_characteristics: PropertyCharacteristics;
}

type TaskStatus = 'pending' | 'analyzing' | 'uploaded' | 'rejected';

interface Task {
  id: string;
  name: string;
  status: TaskStatus;
  file: File | null;
  previewUrl?: string;
  aiFeedback?: string;
  allowOverride?: boolean;
  location?: { lat: number; lng: number }; // NEW: שמירת המיקום בסטייט
}

const checkIsBlurry = async (file: File): Promise<{ isBlurry: boolean; score: number }> => {
  return new Promise((resolve) => resolve({ isBlurry: false, score: 100 })); 
};

// הוספנו את ה-Location לקריאת השרת
const analyzeImageInServer = async (file: File, expectedRoom: string, location?: {lat: number, lng: number}): Promise<{ isValid: boolean; reason?: string }> => {
  const formData = new FormData();
  formData.append('image', file);
  formData.append('taskId', expectedRoom);
  formData.append('sessionId', sessionStorage.getItem('sessionId') || '');
  if (location) {
    formData.append('latitude', location.lat.toString());
    formData.append('longitude', location.lng.toString());
  }
  
  try {
    const response = await fetch('http://localhost:3001/api/upload', { method: 'POST', body: formData });
    const data = await response.json();
    if (response.ok && data.success) return { isValid: true };
    return { isValid: false, reason: data.error || 'המערכת זיהתה פערים בתמונה.' };
  } catch {
    return { isValid: false, reason: 'שגיאת תקשורת עם השרת.' };
  }
};

function StepDots({ tasks, currentIndex }: { tasks: Task[]; currentIndex: number }) {
  if (tasks.length > 9) return null;
  return (
    <div className="step-dots" style={{ display: 'flex', gap: '8px', justifyContent: 'center', marginBottom: '20px' }}>
      {tasks.map((task, i) => (
        <div
          key={task.id}
          style={{
            width: i === currentIndex ? '24px' : '8px',
            height: '8px',
            borderRadius: '4px',
            backgroundColor: task.status === 'uploaded' ? '#10b981' : i === currentIndex ? '#3b82f6' : '#cbd5e1',
            transition: 'all 0.3s ease'
          }}
        />
      ))}
    </div>
  );
}

// פונקציית עזר לדחיסת תמונות מהגלריה
const compressImageFile = async (file: File): Promise<File> => {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 1280;
        let width = img.width;
        let height = img.height;
        if (width > MAX_WIDTH) {
          height = Math.round((height * MAX_WIDTH) / width);
          width = MAX_WIDTH;
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          canvas.toBlob((blob) => {
            if (blob) {
              resolve(new File([blob], file.name, { type: 'image/jpeg' }));
            } else {
              resolve(file);
            }
          }, 'image/jpeg', 0.7);
        } else {
          resolve(file);
        }
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  });
};

export default function InsuranceUploadApp() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isDataLoading, setIsDataLoading] = useState(false); // No auto-loading, user clicks to start
  const [sessionId, setSessionId] = useState<string>('');
  const [isCompleted, setIsCompleted] = useState(false);

  const addNewTask = () => {
    const newTask: Task = { id: `custom_${Date.now()}`, name: 'חלל נוסף', status: 'pending', file: null };
    setTasks(prev => [...prev, newTask]);
    setCurrentIndex(tasks.length);
  };

  useEffect(() => {
    // Only set up session ID on mount, don't load data yet
    const existingSessionId = sessionStorage.getItem('sessionId');
    const newSessionId = existingSessionId || generateSessionId();
    sessionStorage.setItem('sessionId', newSessionId);
    setSessionId(newSessionId);
    
    // Data will be loaded when user clicks "בואו נתחיל"
    console.log("App mounted, waiting for user to click start...");
  }, []);

  const handlePhotoCaptured = async (taskId: string, file: File, location?: {lat: number, lng: number}) => {
    setShowCamera(false);
    const previewUrl = URL.createObjectURL(file);
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: 'analyzing', file, previewUrl, location, aiFeedback: undefined } : t));
    
    const blurCheck = await checkIsBlurry(file);
    if (blurCheck.isBlurry) {
      setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: 'rejected', aiFeedback: `התמונה מטושטשת. אנא צלם שוב.` } : t));
      return;
    }
    
    const taskName = tasks.find(t => t.id === taskId)?.name || '';
    const result = await analyzeImageInServer(file, taskName, location);
    if (result.isValid) {
      setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: 'uploaded' } : t));
    } else {
      setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: 'rejected', aiFeedback: result.reason, allowOverride: true } : t));
    }
  };

  const handleFileUpload = async (taskId: string, event: ChangeEvent<HTMLInputElement>) => {
    const rawFile = event.target.files?.[0];
    if (!rawFile) return;
    
    const currentTask = tasks.find(t => t.id === taskId);
    if (!currentTask) return;
    
    // מעבירים את הקובץ דחיסה לפני שליחה
    const compressedFile = await compressImageFile(rawFile);
    const previewUrl = URL.createObjectURL(compressedFile);
    
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: 'analyzing', file: compressedFile, previewUrl, aiFeedback: undefined } : t));
    
    try {
      const aiResponse = await analyzeImageInServer(compressedFile, currentTask.name);
      if (aiResponse.isValid) {
        setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: 'uploaded' } : t));
      } else {
        setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: 'rejected', aiFeedback: aiResponse.reason, allowOverride: true } : t));
      }
    } catch {
      setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: 'rejected', aiFeedback: 'שגיאת תקשורת' } : t));
    }
  };

  const forceApproveTask = (taskId: string) => setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: 'uploaded' } : t));
  const resetTask = (taskId: string) => setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: 'pending', file: null, previewUrl: undefined, aiFeedback: undefined, location: undefined } : t));

  const handleSubmit = () => {
    // מעבר מיידי למסך סיום - העיבוד קורה ברקע
    setIsCompleted(true);
    
    // שליחה לשרת ברקע (fire-and-forget)
    fetch('http://localhost:3001/api/complete-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        sessionId,
        crmData: myData  // שליחת נתוני הלקוח מהקובץ המקומי
      })
    }).then(res => res.json())
      .then(data => {
        if (data?.success) {
          console.log('✅ נתונים נשלחו בהצלחה ברקע');
        } else {
          console.warn('⚠️ שגיאה בשליחת נתונים:', data?.error);
        }
      })
      .catch(err => {
        console.error('❌ שגיאת רשת בשליחת נתונים:', err);
      });
  };

  if (!hasStarted) {
    return (
      <div className="app-wrapper" dir="rtl" style={{ background: '#ffffff', position: 'relative', overflow: 'auto', height: '100dvh', display: 'flex', flexDirection: 'column' }}>
        {/* Decorative circles - Red/Pink gradient meshes */}
        <div style={{ position: 'fixed', top: '40px', left: '-30px', width: '100px', height: '100px', background: 'linear-gradient(135deg, #D32F2F 0%, #E91E63 100%)', borderRadius: '50%', opacity: 0.75, pointerEvents: 'none', filter: 'blur(2px)' }} />
        <div style={{ position: 'fixed', top: '20px', right: '40px', width: '60px', height: '60px', background: 'linear-gradient(135deg, #E91E63 0%, #F06292 100%)', borderRadius: '50%', opacity: 0.7, pointerEvents: 'none', filter: 'blur(1px)' }} />
        <div style={{ position: 'fixed', bottom: '200px', left: '-10px', width: '80px', height: '80px', background: 'linear-gradient(135deg, #D32F2F 0%, #E91E63 100%)', borderRadius: '50%', opacity: 0.65, pointerEvents: 'none', filter: 'blur(2px)' }} />
        
        <div style={{ padding: '40px 24px', textAlign: 'center', maxWidth: '420px', zIndex: 1, position: 'relative', margin: 'auto', width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', minHeight: 'min-content' }}>
          {/* Logo */}
          <div style={{ marginBottom: '32px', display: 'flex', justifyContent: 'center' }}>
            <img src="/logo.svg" alt="ביטוח ישיר" style={{ height: '40px', width: 'auto' }} />
          </div>

          {/* Badge - Red/Pink premium glass effect */}
          <div className="badge-premium animate-in" style={{ marginBottom: '28px' }}>
            <span style={{ width: '6px', height: '6px', background: 'linear-gradient(135deg, #D32F2F 0%, #E91E63 100%)', borderRadius: '50%', animation: 'pulse 2s infinite' }} />
            אימות נכס דיגיטלי
          </div>

          {/* House Icon in Circle - Floating Animation */}
          <div style={{ marginBottom: '28px' }} className="animate-in stagger-1">
            <div 
              className="float-animation"
              style={{ 
                width: '120px', 
                height: '120px', 
                margin: '0 auto', 
                background: 'linear-gradient(135deg, #FFEBEE 0%, #FCE4EC 50%, #F8BBD9 100%)', 
                borderRadius: '50%', 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center', 
                boxShadow: '0 12px 40px rgba(211, 47, 47, 0.2), inset 0 2px 4px rgba(255,255,255,0.8)',
                border: '2px solid rgba(233, 30, 99, 0.15)'
              }}
            >
              <Home style={{ width: '52px', height: '52px', color: '#D32F2F' }} />
            </div>
          </div>

          {/* Title - Premium Gradient Text */}
          <h1 
            className="animate-in stagger-2"
            style={{ 
              fontSize: '32px', 
              marginBottom: '16px', 
              fontWeight: '800', 
              lineHeight: '1.15',
              background: 'linear-gradient(135deg, #1a1a4e 0%, #D32F2F 50%, #E91E63 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text'
            }}
          >
            נאמת את הנכס<br />שלכם תוך דקות
          </h1>

          {/* Description */}
          <p style={{ color: '#6b7280', fontSize: '15px', lineHeight: '1.6', marginBottom: '28px', padding: '0 8px', maxWidth: '340px' }}>
            אימות נכס מהיר בנינימום מאמץ. מעלים את החדרים, והמערכת שלנו תשלים את יתר התהליך עבורכם בצורה חכמה ומדויקת.
          </p>

          {/* Feature Pills - Premium Animated */}
          <div style={{ display: 'flex', justifyContent: 'center', gap: '10px', marginBottom: '32px', flexWrap: 'wrap' }}>
            <div className="feature-pill animate-in stagger-1">
              <Lock style={{ width: '14px', height: '14px', color: '#D32F2F' }} />
              מאובטח
            </div>
            <div className="feature-pill animate-in stagger-2">
              <Rocket style={{ width: '14px', height: '14px', color: '#D32F2F' }} />
              מהיר
            </div>
          </div>

          {/* CTA Button - Premium Style */}
          <button 
            className="btn-premium animate-in stagger-3"
            onClick={() => {
              setHasStarted(true);
              setIsDataLoading(false);
              
              try {
                const data = (myData as any).property_characteristics;
                
                if (data && data.rooms) {
                  const { rooms, has_balcony, has_storage_room } = data;
                  let newTasks: Task[] = [
                    { id: 'living_room', name: 'סלון', status: 'pending' as TaskStatus, file: null },
                    { id: 'kitchen', name: 'מטבח', status: 'pending' as TaskStatus, file: null },
                  ];
                  const bedroomsCount = Math.max(1, Math.floor(rooms - 1));
                  for (let i = 1; i <= bedroomsCount; i++) {
                    newTasks.push({ id: `bedroom_${i}`, name: `חדר שינה ${i}`, status: 'pending' as TaskStatus, file: null });
                  }
                  if (has_balcony) newTasks.push({ id: 'balcony', name: 'מרפסת', status: 'pending' as TaskStatus, file: null });
                  if (has_storage_room) newTasks.push({ id: 'storage', name: 'מחסן', status: 'pending' as TaskStatus, file: null });
                  
                  setTasks(newTasks);
                } else {
                  setTasks([
                    { id: 'living_room', name: 'סלון', status: 'pending' as TaskStatus, file: null },
                    { id: 'kitchen', name: 'מטבח', status: 'pending' as TaskStatus, file: null },
                    { id: 'bedroom_1', name: 'חדר שינה 1', status: 'pending' as TaskStatus, file: null },
                  ]);
                }
              } catch (err) {
                console.error("Error loading data:", err);
                setTasks([
                  { id: 'living_room', name: 'סלון', status: 'pending' as TaskStatus, file: null },
                  { id: 'kitchen', name: 'מטבח', status: 'pending' as TaskStatus, file: null },
                  { id: 'bedroom_1', name: 'חדר שינה 1', status: 'pending' as TaskStatus, file: null },
                ]);
              }
            }}
            style={{ width: '100%', maxWidth: '300px', marginTop: 'auto', marginBottom: '20px' }}
          >
            <Rocket style={{ width: '18px', height: '18px' }} />
            בואו נתחיל
          </button>
        </div>
      </div>
    );
  }

  if (isCompleted) {
    return (
      <div className="app-wrapper" dir="rtl" style={{ background: '#ffffff' }}>
        <div style={{ padding: '48px 32px', textAlign: 'center', maxWidth: '420px' }}>
          <div style={{ marginBottom: '32px' }} className="success-animation">
            <div 
              style={{ 
                width: '120px', 
                height: '120px', 
                margin: '0 auto', 
                background: 'linear-gradient(135deg, #D32F2F 0%, #E91E63 100%)', 
                borderRadius: '50%', 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center', 
                boxShadow: '0 16px 50px rgba(211, 47, 47, 0.4), inset 0 2px 4px rgba(255,255,255,0.3)',
                animation: 'pulse 2s infinite'
              }}
            >
              <CheckCircle2 style={{ width: '56px', height: '56px', color: 'white' }} />
            </div>
          </div>
          
          <h1 
            className="animate-in"
            style={{ 
              fontSize: '32px', 
              marginBottom: '16px', 
              fontWeight: '800',
              background: 'linear-gradient(135deg, #1a1a4e 0%, #D32F2F 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text'
            }}
          >
            תודה שהיית איתנו
          </h1>
          
          <p 
            className="animate-in stagger-1"
            style={{ 
              color: '#6b7280', 
              fontSize: '18px', 
              lineHeight: '1.7', 
              marginBottom: '28px', 
              fontWeight: '500' 
            }}
          >
            נציגנו יחזור אליך בהקדם
          </p>
          
          <div className="glass-card" style={{ padding: '28px', marginBottom: '32px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '12px' }}>
              <Sparkles style={{ width: '24px', height: '24px', color: '#E91E63' }} />
            </div>
            <p style={{ fontSize: '15px', color: '#6b7280', margin: 0, lineHeight: '1.7', textAlign: 'center' }}>
              הצוות שלנו בוחן את החומרים,<br/>ומתאים עבורכם את הפוליסה הטובה ביותר.
            </p>
          </div>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <button 
              className="btn-premium success-animation"
              onClick={() => window.location.reload()} 
              style={{ width: '100%' }}
            >
              <RefreshCw style={{ width: '18px', height: '18px' }} />
              התחלת תהליך חדש
            </button>
            <button 
              onClick={() => window.close()} 
              className="glass-card"
              style={{ 
                width: '100%', 
                padding: '18px', 
                background: 'transparent', 
                color: '#6b7280', 
                borderRadius: '32px', 
                fontWeight: '500', 
                fontSize: '16px', 
                border: 'none',
                cursor: 'pointer',
                transition: 'all 0.2s ease'
              }}
            >
              סגור חלון
            </button>
          </div>
          
          <p style={{ marginTop: '28px', fontSize: '13px', color: '#9ca3af', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
            <Sparkles style={{ width: '14px', height: '14px', color: '#E91E63' }} /> ביטוח ישיר — כי ביטוח צריך להיות פשוט
          </p>
        </div>
      </div>
    );
  }

  if (isDataLoading) {
    return (
      <div className="app-wrapper" dir="rtl" style={{ background: '#ffffff' }}>
        <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <div className="analyzing-spinner" style={{ width: '60px', height: '60px', marginBottom: '24px', borderTopColor: '#D32F2F', borderRightColor: 'rgba(211,47,47,0.1)', borderBottomColor: 'rgba(211,47,47,0.1)', borderLeftColor: 'rgba(211,47,47,0.1)' }} />
          <h2 style={{ color: '#1a1a4e', marginBottom: '12px', fontSize: '22px', fontWeight: '800' }}>מתחבר למערכות ביטוח...</h2>
          <span style={{ color: '#6b7280', fontSize: '15px' }}>מושך נתוני פוליסה ומכין חיבור מאובטח</span>
        </div>
      </div>
    );
  }

  const currentTask = tasks[currentIndex];
  
  // Safety check - if somehow no tasks, show loading
  if (!currentTask) {
    console.log("No current task yet, waiting...");
    return (
      <div className="app-wrapper" dir="rtl" style={{ background: '#ffffff' }}>
        <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <div className="analyzing-spinner" style={{ width: '50px', height: '50px', marginBottom: '20px', borderTopColor: '#D32F2F' }} />
          <h2 style={{ color: '#1a1a4e', fontSize: '18px' }}>טוען משימות...</h2>
        </div>
      </div>
    );
  }
  const allCompleted = tasks.every(t => t.status === 'uploaded');
  const progressPercentage = ((currentIndex + 1) / tasks.length) * 100;

  console.log("=== RENDERING ===");
  console.log("hasStarted:", hasStarted, "isCompleted:", isCompleted, "isDataLoading:", isDataLoading);
  console.log("tasks.length:", tasks.length, "currentIndex:", currentIndex);
  console.log("currentTask:", currentTask?.name);
  console.log("Rendering capture screen for:", currentTask.name);
  
  return (
    <div className="app-wrapper" dir="rtl" style={{ background: '#ffffff', overflow: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start', paddingTop: '40px' }}>
      <div style={{ width: '100%', maxWidth: '480px', padding: '20px', position: 'relative', zIndex: 10, background: '#ffffff', minHeight: '100%', boxSizing: 'border-box' }}>
        {showCamera && <CameraCapture onCapture={(file, loc) => handlePhotoCaptured(currentTask.id, file, loc)} onCancel={() => setShowCamera(false)} />}

        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 'calc(100dvh - 80px)', paddingBottom: '40px' }}>
          <div style={{ marginBottom: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', fontWeight: 'bold', marginBottom: '8px' }}>
              <span style={{ color: '#6b7280' }}>שלב {currentIndex + 1} מתוך {tasks.length}</span>
              <span style={{ color: '#D32F2F', fontWeight: '700' }}>{Math.round(progressPercentage)}%</span>
            </div>
            <div style={{ height: '6px', backgroundColor: '#f3f4f6', borderRadius: '4px', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${progressPercentage}%`, background: 'linear-gradient(90deg, #D32F2F 0%, #E91E63 100%)', transition: 'width 0.4s ease', borderRadius: '4px' }} />
            </div>
          </div>

          <StepDots tasks={tasks} currentIndex={currentIndex} />

          <header style={{ textAlign: 'center', marginBottom: '28px' }}>
            <h2 style={{ fontSize: '26px', fontWeight: '800', color: '#1a1a4e', margin: '0 0 10px 0', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
              {currentTask.status === 'uploaded' ? <CheckCircle2 style={{ width: '32px', height: '32px', color: '#10B981' }} /> : <Camera style={{ width: '32px', height: '32px', color: '#D32F2F' }} />} {currentTask.name}
            </h2>
            <p style={{ color: '#6b7280', fontSize: '15px', margin: 0 }}>
              {currentTask.status === 'uploaded' ? 'התמונה אומתה בהצלחה — ניתן להמשיך' : 'ודאו שהחלל מואר וצלמו מזווית רחבה'}
            </p>
          </header>

          <div style={{ 
            transition: 'all 0.4s', backgroundColor: currentTask.status === 'uploaded' ? 'rgba(16,185,129,0.04)' : '#ffffff', 
            border: `1px solid ${currentTask.status === 'uploaded' ? 'rgba(16,185,129,0.25)' : '#e5e7eb'}`, 
            borderRadius: '28px', padding: '28px', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center',
            boxShadow: '0 4px 20px rgba(0,0,0,0.04)'
          }}>
            {currentTask.previewUrl && (
              <div style={{ position: 'relative', borderRadius: '20px', overflow: 'hidden', boxShadow: '0 8px 24px rgba(0,0,0,0.08)', maxHeight: '280px' }}>
                <img src={currentTask.previewUrl} alt="תצוגה" style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: currentTask.status === 'analyzing' ? 0.5 : 1 }} />
                
                {/* NEW: הצגת סטטוס חותמת המיקום (Geo-tag) באפליקציה */}
                {currentTask.location && currentTask.status === 'uploaded' && (
                  <div style={{ position: 'absolute', bottom: '12px', left: '12px', backgroundColor: 'rgba(211,47,47,0.9)', color: 'white', padding: '6px 10px', borderRadius: '10px', fontSize: '12px', display: 'flex', gap: '6px', alignItems: 'center' }}>
                    <MapPin style={{ width: '14px', height: '14px' }} /> מיקום אומת
                  </div>
                )}

                {currentTask.status === 'analyzing' && (
                  <div style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(255,255,255,0.75)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                    <div className="analyzing-spinner" style={{ borderTopColor: '#D32F2F', marginBottom: '12px', width: '40px', height: '40px' }} />
                    <span style={{ color: '#D32F2F', fontWeight: 'bold', fontSize: '15px' }}>מעבד וסורק...</span>
                  </div>
                )}
              </div>
            )}

            {currentTask.status === 'uploaded' && (
              <div style={{ textAlign: 'center', marginTop: '24px' }}>
                <span style={{ color: '#10B981', fontSize: '18px', fontWeight: 'bold', display: 'block', marginBottom: '14px' }}>אימות חזותי עבר בהצלחה!</span>
                <button onClick={() => resetTask(currentTask.id)} style={{ background: 'none', border: 'none', color: '#6b7280', textDecoration: 'underline', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', margin: '0 auto', fontSize: '14px' }}>
                  <RefreshCw style={{ width: '16px', height: '16px' }} /> צלם שוב
                </button>
              </div>
            )}

            {(currentTask.status === 'pending' || currentTask.status === 'rejected') && !currentTask.previewUrl && (
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '24px' }}>
                <div style={{ width: '90px', height: '90px', borderRadius: '45px', backgroundColor: 'rgba(211,47,47,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <ScanLine style={{ width: '40px', height: '40px', color: '#D32F2F' }} />
                </div>
              </div>
            )}

            {(currentTask.status === 'pending' || currentTask.status === 'rejected') && (
              <div style={{ display: 'flex', gap: '12px', marginTop: '24px' }}>
                <button onClick={() => setShowCamera(true)} style={{ flex: 1, padding: '16px', background: currentTask.status === 'rejected' ? '#ef4444' : 'linear-gradient(135deg, #D32F2F 0%, #E91E63 100%)', color: 'white', border: 'none', borderRadius: '28px', fontWeight: 'bold', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontSize: '15px', boxShadow: currentTask.status === 'rejected' ? '0 4px 16px rgba(239,68,68,0.3)' : '0 4px 16px rgba(211,47,47,0.35)' }}>
                  {currentTask.status === 'rejected' ? <><Camera style={{ width: '20px', height: '20px' }} /> צלם מחדש</> : <><Camera style={{ width: '20px', height: '20px' }} /> פתח מצלמה</>}
                </button>
                <label style={{ flex: 1, padding: '16px', backgroundColor: 'white', color: '#374151', border: '1px solid #e5e7eb', borderRadius: '28px', textAlign: 'center', fontWeight: 'bold', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontSize: '15px' }}>
                  <ImageIcon style={{ width: '20px', height: '20px', color: '#D32F2F' }} /> גלריה
                  <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => handleFileUpload(currentTask.id, e)} />
                </label>
              </div>
            )}

            {currentTask.status === 'rejected' && currentTask.aiFeedback && (
              <div style={{ marginTop: '20px', backgroundColor: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '12px', padding: '16px' }}>
                <strong style={{ color: '#ef4444', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}><AlertTriangle style={{ width: '16px', height: '16px' }} /> זיהינו בעיה בתמונה</strong>
                <span style={{ color: '#7f1d1d', fontSize: '14px' }}>{currentTask.aiFeedback}</span>
                {currentTask.allowOverride && (
                  <button onClick={() => forceApproveTask(currentTask.id)} style={{ marginTop: '12px', width: '100%', background: 'transparent', border: '1px dashed #ef4444', color: '#ef4444', padding: '8px', borderRadius: '8px', cursor: 'pointer' }}>
                    המשך בכל זאת
                  </button>
                )}
              </div>
            )}
          </div>

          <div style={{ marginTop: 'auto', paddingTop: '20px' }}>
            <div style={{ display: 'flex', gap: '12px' }}>
              <button onClick={() => setCurrentIndex(prev => Math.max(0, prev - 1))} disabled={currentIndex === 0 || currentTask.status === 'analyzing'} style={{ flex: 1, padding: '14px', backgroundColor: 'white', border: '1px solid #e2e8f0', borderRadius: '16px', color: '#64748b', fontWeight: 'bold', cursor: 'pointer', opacity: (currentIndex === 0 || currentTask.status === 'analyzing') ? 0.5 : 1 }}>
                ← חזור
              </button>

              {currentIndex < tasks.length - 1 ? (
                <button onClick={() => setCurrentIndex(prev => prev + 1)} disabled={currentTask.status !== 'uploaded'} style={{ flex: 2, padding: '14px', backgroundColor: currentTask.status === 'uploaded' ? '#10b981' : '#e2e8f0', color: currentTask.status === 'uploaded' ? 'white' : '#94a3b8', border: 'none', borderRadius: '16px', fontWeight: 'bold', cursor: 'pointer' }}>
                  המשך לחדר הבא →
                </button>
              ) : (
                <button 
                  onClick={handleSubmit} 
                  disabled={!allCompleted} 
                  className="btn-premium"
                  style={{ 
                    flex: 2, 
                    padding: '14px',
                    opacity: allCompleted ? 1 : 0.5
                  }}
                >
                  ✅ סיום התהליך
                </button>
              )}
            </div>
            
            {currentIndex === tasks.length - 1 && (
              <button onClick={addNewTask} style={{ width: '100%', marginTop: '12px', padding: '12px', background: 'transparent', border: '1px dashed #94a3b8', color: '#64748b', borderRadius: '16px', cursor: 'pointer' }}>
                ➕ חלל נוסף שלא הוצהר
              </button>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}