import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  AlertTriangle,
  BookOpen,
  Camera,
  RotateCcw,
  Sparkles,
  Upload,
  Utensils,
  Video,
  VideoOff,
  X,
} from 'lucide-react';
import type { Restaurant } from '../types';

/** 기존 STEP 3(메뉴 스캐너) 화면. 식당을 선택한 상태면 해당 식당에 메뉴를 등록한다. */

interface CameraScreenProps {
  t: Record<string, any>;
  langCode: string;
  image: string | null;
  imageName: string | null;
  menuText: string;
  loading: boolean;
  error: string | null;
  loadingTips: string[];
  loadingTipIndex: number;
  /** 선택된 식당 (계획서 5.2) */
  targetRestaurant: Restaurant | null;
  onClearRestaurant: () => void;
  /** 직전 분석 결과가 남아 있으면 다시 볼 수 있게 한다. */
  hasPreviousResults: boolean;
  onViewResults: () => void;
  onSetImage: (image: string | null, name: string | null) => void;
  onChangeMenuText: (text: string) => void;
  onAnalyze: () => void;
  onError: (message: string | null) => void;
  playBeep: () => void;
}

export const CameraScreen: React.FC<CameraScreenProps> = ({
  t,
  langCode,
  image,
  imageName,
  menuText,
  loading,
  error,
  loadingTips,
  loadingTipIndex,
  targetRestaurant,
  onClearRestaurant,
  hasPreviousResults,
  onViewResults,
  onSetImage,
  onChangeMenuText,
  onAnalyze,
  onError,
  playBeep,
}) => {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      setStream(null);
    }
    setIsCameraActive(false);
  };

  const startCamera = async () => {
    onError(null);
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      setStream(mediaStream);
      setIsCameraActive(true);
      setTimeout(() => {
        if (videoRef.current) videoRef.current.srcObject = mediaStream;
      }, 150);
    } catch (err: any) {
      console.error('Camera access failed:', err);
      onError(
        langCode === 'ko'
          ? "카메라 권한이 거부되었거나 접근할 수 없습니다. 브라우저 주소창 왼쪽의 자물쇠 아이콘을 클릭해 카메라 권한을 허용해 주시거나, 상단 우측의 '새 탭에서 열기' 버튼을 클릭하여 새 창에서 실행하시면 정상적으로 작동합니다."
          : "Camera permission denied or unavailable. Please click the lock icon in your browser's address bar to allow camera access, or click the 'Open in new tab' button on the top right to run the application in a separate tab."
      );
    }
  };

  const capturePhoto = () => {
    if (!videoRef.current) return;
    try {
      const canvas = document.createElement('canvas');
      const maxDim = 1024;
      let width = videoRef.current.videoWidth || 640;
      let height = videoRef.current.videoHeight || 480;

      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(videoRef.current, 0, 0, width, height);
        onSetImage(canvas.toDataURL('image/jpeg', 0.8), langCode === 'en' ? 'Captured_Menu.jpg' : '촬영된_메뉴판.jpg');
        stopCamera();
        playBeep();
      }
    } catch (e) {
      console.error('Failed to capture image', e);
    }
  };

  // 화면을 벗어나면 카메라를 끈다.
  useEffect(() => {
    return () => {
      if (stream) stream.getTracks().forEach((track) => track.stop());
    };
  }, [stream]);

  const compressImage = (dataUrl: string, maxDimension: number, callback: (compressed: string) => void) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;

      if (width > maxDimension || height > maxDimension) {
        if (width > height) {
          height = Math.round((height * maxDimension) / width);
          width = maxDimension;
        } else {
          width = Math.round((width * maxDimension) / height);
          height = maxDimension;
        }
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0, width, height);
        callback(canvas.toDataURL('image/jpeg', 0.8));
      } else {
        callback(dataUrl);
      }
    };
    img.onerror = () => callback(dataUrl);
    img.src = dataUrl;
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      compressImage(dataUrl, 1024, (compressed) => onSetImage(compressed, file.name));
    };
    reader.readAsDataURL(file);
  };

  return (
    <motion.section
      key="camera"
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -15 }}
      transition={{ duration: 0.2 }}
      className="space-y-4"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <span className="kicker text-[11px] font-black text-primary tracking-wider uppercase block mb-1">SCAN</span>
          <h1 className="title text-2xl font-black text-neutral-900 tracking-tight leading-none">{t.step3Title}</h1>
        </div>
        {hasPreviousResults && (
          <button
            onClick={onViewResults}
            className="shrink-0 border border-line-trip bg-white hover:bg-soft-trip/30 text-primary rounded-full px-3 py-1.5 text-[11px] font-black transition-all cursor-pointer"
          >
            {t.viewPreviousResults}
          </button>
        )}
      </div>

      {/* 선택된 식당 컨텍스트 */}
      {targetRestaurant && (
        <div className="bg-soft-trip/60 border border-primary/30 rounded-2xl p-3 flex items-center gap-2">
          <Utensils className="w-4 h-4 text-primary shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-[11px] font-black text-neutral-900 truncate">{targetRestaurant.name}</div>
            <div className="text-[10px] text-muted-trip truncate">{t.shootMenuBtn}</div>
          </div>
          <button
            onClick={onClearRestaurant}
            className="shrink-0 text-muted-trip hover:text-neutral-800 p-1 rounded-full transition-all cursor-pointer bg-transparent border-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* 카메라 프리뷰 */}
      <div className="camera-shell bg-[#050505] rounded-[29px] p-2 shadow-xl border border-neutral-800">
        <div className="camera h-[300px] bg-neutral-950 border border-neutral-850 rounded-[22px] relative overflow-hidden flex flex-col items-center justify-center text-center p-4">
          {image ? (
            <div className="absolute inset-0 w-full h-full z-10">
              <img src={image} alt={t.previewText} className="w-full h-full object-cover" id="cameraPreview" referrerPolicy="no-referrer" />
              <div className="absolute inset-4 border border-white/30 rounded-xl pointer-events-none"></div>
              <button
                onClick={() => onSetImage(null, null)}
                className="absolute top-3 right-3 bg-black/70 text-white rounded-full p-2 hover:bg-black transition-all cursor-pointer border-0 z-20"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : isCameraActive ? (
            <div className="absolute inset-0 w-full h-full z-10">
              <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
              <div className="absolute inset-4 border border-white/30 rounded-xl pointer-events-none"></div>
              <button
                onClick={stopCamera}
                className="absolute top-3 right-3 bg-rose-600/90 hover:bg-rose-700 text-white rounded-full px-3 py-1.5 text-[10px] font-extrabold transition-all cursor-pointer border-0 z-20 flex items-center gap-1 shadow-md"
              >
                <VideoOff className="w-3.5 h-3.5" />
                <span>{langCode === 'ko' ? '카메라 끄기' : 'Turn Off'}</span>
              </button>
            </div>
          ) : (
            <div className="space-y-4 z-10 p-2">
              <div className="w-12 h-12 bg-neutral-900 rounded-full flex items-center justify-center text-white/80 mx-auto border border-white/10">
                <Camera className="w-5 h-5 text-primary" />
              </div>
              <div className="space-y-1">
                <p className="text-xs text-white font-bold">{t.cameraHint}</p>
                <p className="text-[10px] text-neutral-500 leading-normal mb-2">{t.cameraSubHint}</p>
              </div>
              <button
                onClick={startCamera}
                className="bg-primary hover:bg-primary2 text-white text-xs font-black px-4 py-2 rounded-xl transition-all shadow-md flex items-center gap-1.5 mx-auto cursor-pointer border-0"
              >
                <Video className="w-3.5 h-3.5" />
                <span>{langCode === 'ko' ? '실시간 카메라 켜기' : 'Start Live Camera'}</span>
              </button>
            </div>
          )}

          <div className="absolute inset-0 border-[1.5px] border-white/10 rounded-[20px] pointer-events-none m-4"></div>
          <div className="focus absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-14 h-14 rounded-full border border-white/20 pointer-events-none"></div>

          {imageName && (
            <div className="cam-hint absolute left-1/2 bottom-4 -translate-x-1/2 z-10 text-white bg-black/85 border border-white/10 rounded-full px-3 py-1 text-[11px] font-bold whitespace-nowrap">
              {imageName} {t.loadedText}
            </div>
          )}
        </div>
      </div>

      {/* 셔터 및 입력 */}
      <div className="space-y-3">
        <div className="shutter-wrap flex justify-center py-1">
          {isCameraActive ? (
            <button
              onClick={capturePhoto}
              className="shutter w-16 h-16 rounded-full border-[5px] border-primary bg-white shadow-lg shadow-primary/20 cursor-pointer flex items-center justify-center hover:scale-105 active:scale-95 transition-all"
              title={langCode === 'ko' ? '찰칵! 사진 촬영' : 'Capture Menu Photo'}
              id="btn-shutter"
            >
              <Camera className="w-6 h-6 text-primary" />
            </button>
          ) : (
            <button
              onClick={onAnalyze}
              disabled={loading}
              className="shutter w-16 h-16 rounded-full border-[5px] border-primary bg-white shadow-lg shadow-primary/20 cursor-pointer flex items-center justify-center hover:scale-105 active:scale-95 transition-all"
              title={t.shutterTooltip}
              id="btn-shutter"
            >
              <Sparkles className="w-6 h-6 text-primary animate-pulse" />
            </button>
          )}
        </div>

        <div className="text-center">
          <span className="text-[10px] font-bold text-muted-trip block">
            {isCameraActive
              ? langCode === 'ko'
                ? '셔터를 눌러 메뉴판 사진을 촬영하세요'
                : 'Press shutter to take a photo of the menu'
              : t.shutterTooltip}
          </span>
        </div>

        <div className="bg-white border border-line-trip rounded-2xl p-3.5 shadow-sm space-y-2">
          <div className="flex items-center gap-1">
            <BookOpen className="w-3.5 h-3.5 text-primary" />
            <span className="text-xs font-bold text-neutral-800">{t.manualTextTitle}</span>
          </div>
          <input
            type="text"
            placeholder={t.manualTextPlaceholder}
            value={menuText}
            onChange={(e) => onChangeMenuText(e.target.value)}
            className="w-full text-xs border border-line-trip rounded-xl bg-white p-2.5 outline-none text-neutral-800 focus:border-primary transition-all"
            id="input-manual-menu"
          />
        </div>

        <input id="imagePicker" type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
        <button
          onClick={() => document.getElementById('imagePicker')?.click()}
          className="btn ghost w-full border border-primary/30 rounded-2xl p-3.5 bg-white text-primary font-black text-xs hover:bg-soft-trip transition-all cursor-pointer flex items-center justify-center gap-1"
          id="btn-upload-file"
        >
          <Upload className="w-3.5 h-3.5" />
          <span>{t.galleryBtn}</span>
        </button>
      </div>

      {error && (
        <div className="bg-danger-trip/5 border border-danger-trip/20 rounded-2xl p-4 text-xs text-danger-trip space-y-1.5 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5 text-danger-trip" />
          <div>
            <div className="font-extrabold">{t.scannerError}</div>
            <p className="text-[11px] leading-relaxed text-danger-trip/90">{error}</p>
          </div>
        </div>
      )}

      {loading && (
        <div className="fixed inset-0 bg-black/75 z-50 flex items-center justify-center p-5">
          <div className="bg-white border border-line-trip rounded-[32px] p-6 w-full max-w-[340px] text-center space-y-4 shadow-2xl">
            <div className="relative w-16 h-16 mx-auto flex items-center justify-center">
              <div className="absolute inset-0 border-4 border-soft-trip rounded-full"></div>
              <div className="absolute inset-0 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
              <Sparkles className="w-6 h-6 text-primary animate-pulse" />
            </div>
            <div className="space-y-1.5">
              <h4 className="font-black text-sm text-neutral-900">{t.loadingTitle}</h4>
              <div className="h-10 flex items-center justify-center">
                <p className="text-[11px] text-primary font-bold leading-relaxed px-2 transition-all">
                  {loadingTips[loadingTipIndex]}
                </p>
              </div>
            </div>
            <div className="w-32 bg-soft-trip h-1.5 rounded-full overflow-hidden mx-auto">
              <div className="bg-primary h-full rounded-full animate-progress" style={{ width: '60%' }}></div>
            </div>
          </div>
        </div>
      )}
    </motion.section>
  );
};
