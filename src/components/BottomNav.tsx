import React from 'react';
import { Camera, Map, User } from 'lucide-react';

/**
 * 계획서 2.2 — 하단 3분할 내비게이션.
 * 가운데 카메라 버튼은 어느 화면에서도 항상 접근 가능해야 한다.
 */

export type NavTab = 'me' | 'camera' | 'map';

interface BottomNavProps {
  active: NavTab;
  onChange: (tab: NavTab) => void;
  t: Record<string, any>;
}

export const BottomNav: React.FC<BottomNavProps> = ({ active, onChange, t }) => {
  const item = (tab: NavTab, icon: React.ReactNode, label: string) => {
    const isActive = active === tab;
    return (
      <button
        onClick={() => onChange(tab)}
        className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-2 transition-all cursor-pointer border-0 bg-transparent ${
          isActive ? 'text-primary' : 'text-muted-trip hover:text-neutral-700'
        }`}
        aria-current={isActive ? 'page' : undefined}
        id={`nav-${tab}`}
      >
        {icon}
        <span className={`text-[10px] ${isActive ? 'font-black' : 'font-bold'}`}>{label}</span>
      </button>
    );
  };

  return (
    <nav className="h-[62px] shrink-0 bg-white/95 backdrop-blur-md border-t border-line-trip flex items-stretch relative z-30">
      {item('me', <User className="w-5 h-5" />, t.navMe)}

      {/* 가운데 카메라 — 항상 강조 */}
      <div className="flex-1 flex items-start justify-center">
        <button
          onClick={() => onChange('camera')}
          className={`-mt-5 w-14 h-14 rounded-full flex flex-col items-center justify-center shadow-lg border-4 border-bg-trip transition-all cursor-pointer ${
            active === 'camera'
              ? 'bg-gradient-to-br from-primary to-primary2 text-white scale-105'
              : 'bg-white text-primary hover:bg-soft-trip'
          }`}
          title={t.navCamera}
          id="nav-camera"
        >
          <Camera className="w-6 h-6" />
        </button>
      </div>

      {item('map', <Map className="w-5 h-5" />, t.navMap)}
    </nav>
  );
};
