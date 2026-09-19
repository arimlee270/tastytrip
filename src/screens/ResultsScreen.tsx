import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Check, Sparkles, Store } from 'lucide-react';
import { DishCard } from '../components/DishCard';
import { ReportModal } from '../components/ReportModal';
import { RegisterToRestaurantModal } from '../components/RegisterToRestaurantModal';
import type { Dish, Member } from '../types';

/** 기존 STEP 4(분석 결과) 화면 */

interface ResultsScreenProps {
  t: Record<string, any>;
  langCode: string;
  travelCountry: string;
  party: Member[];
  dishes: Dish[];
  geminiCalled: boolean;
  onRestart: () => void;
  onOpenLightbox: (url: string, name: string) => void;
  onAddReview: (dishIndex: number, comment: string, rating: number) => void;
  onEditReview: (dishIndex: number, reviewId: string, comment: string) => void;
  onDeleteReview: (dishIndex: number, reviewId: string) => void;
  playBeep: () => void;
}

export const ResultsScreen: React.FC<ResultsScreenProps> = ({
  t,
  langCode,
  travelCountry,
  party,
  dishes,
  geminiCalled,
  onRestart,
  onOpenLightbox,
  onAddReview,
  onEditReview,
  onDeleteReview,
  playBeep,
}) => {
  const [activeCardIndex, setActiveCardIndex] = useState<number | null>(null);
  const [reportTarget, setReportTarget] = useState<Dish | null>(null);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [registeredMsg, setRegisteredMsg] = useState<string | null>(null);

  // 이미 식당에 속한 메뉴라면 다시 등록할 필요가 없다.
  const alreadyRegistered = dishes.some((d) => d.restaurant_id);

  return (
    <motion.section
      key="results"
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -15 }}
      transition={{ duration: 0.2 }}
      className="space-y-4"
    >
      <div className="sticky top-[-16px] bg-bg-trip/95 backdrop-blur-md z-10 pt-1 pb-2 border-b border-line-trip/30">
        {/* 다시 촬영하려면 하단 가운데 카메라 버튼을 쓰면 되므로 별도 버튼을 두지 않는다. */}
        <div>
          <span className="kicker text-[11px] font-black text-primary tracking-wider uppercase block">RESULT</span>
          <h1 className="title text-2xl font-black text-neutral-900 tracking-tight leading-none">{t.step4Title}</h1>
        </div>
        <p className="small text-[11px] text-muted-trip font-semibold mt-1">{t.step4Sub}</p>
      </div>

      {/* 적용된 필터 요약 + DB/AI 응답 표시 (계획서 18장 AI 비용 지표) */}
      <div className="bg-white border border-line-trip rounded-2xl p-3 shadow-xs flex items-center justify-between text-[11px]">
        <span className="font-bold text-neutral-800">
          {t.appliedFilters} ({party.length}
          {langCode === 'en' ? 'P' : '명'})
        </span>
        <div className="flex items-center gap-1">
          {party.map((p) => (
            <span key={p.id} className="bg-soft-trip text-primary text-[9px] font-extrabold px-1.5 py-0.5 rounded-full">
              {p.name.substring(0, 5)}
            </span>
          ))}
          {!geminiCalled && (
            <span className="ml-1 inline-flex items-center gap-0.5 text-[9px] font-black text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-1.5 py-0.5">
              DB
            </span>
          )}
          {geminiCalled && (
            <span className="ml-1 inline-flex items-center gap-0.5 text-[9px] font-black text-primary bg-soft-trip border border-primary/30 rounded-full px-1.5 py-0.5">
              <Sparkles className="w-2 h-2" />
              AI
            </span>
          )}
        </div>
      </div>

      <div className="space-y-3" id="cards">
        {dishes.map((dish, idx) => (
          <DishCard
            key={idx}
            dish={dish}
            index={idx}
            isOpen={activeCardIndex === idx}
            onToggle={() => setActiveCardIndex(activeCardIndex === idx ? null : idx)}
            t={t}
            langCode={langCode}
            onOpenLightbox={onOpenLightbox}
            onAddReview={(comment, rating) => onAddReview(idx, comment, rating)}
            onEditReview={(reviewId, comment) => onEditReview(idx, reviewId, comment)}
            onDeleteReview={(reviewId) => onDeleteReview(idx, reviewId)}
            onReport={(d) => setReportTarget(d)}
            playBeep={playBeep}
          />
        ))}
      </div>

      {/* 분석 결과를 식당에 등록해 데이터를 쌓는다. (계획서 5.2) */}
      {!alreadyRegistered && dishes.length > 0 && (
        <div className="pt-1">
          {registeredMsg ? (
            <div className="w-full bg-emerald-50 border border-emerald-200 text-emerald-800 py-3 rounded-2xl text-[11px] font-bold text-center flex items-center justify-center gap-1.5">
              <Check className="w-4 h-4" />
              {registeredMsg}
            </div>
          ) : (
            <button
              onClick={() => {
                playBeep();
                setRegisterOpen(true);
              }}
              className="w-full border-0 rounded-2xl py-3.5 bg-gradient-to-r from-primary to-primary2 text-white font-black text-xs shadow-lg shadow-primary/20 hover:scale-[1.01] active:scale-[0.99] transition-all cursor-pointer flex items-center justify-center gap-1.5"
            >
              <Store className="w-4 h-4" />
              <span>{t.registerBtnLabel}</span>
            </button>
          )}
        </div>
      )}

      {/*
        '새로운 메뉴 촬영/검색하기' 버튼은 뺐다.
        하단 가운데 카메라 버튼을 누르면 언제든 촬영 화면으로 가므로 같은 일을 하는
        버튼이 두 개가 되고, 결과를 다 보기도 전에 화면 아래에서 먼저 눈에 띈다.
      */}

      {registerOpen && (
        <RegisterToRestaurantModal
          dishes={dishes}
          t={t}
          langCode={langCode}
          travelCountry={travelCountry}
          onClose={() => setRegisterOpen(false)}
          onRegistered={(restaurant, count) => {
            setRegisterOpen(false);
            setRegisteredMsg(
              String(t.registerDone ?? '')
                .replace('{name}', restaurant.name)
                .replace('{n}', String(count))
            );
          }}
          playBeep={playBeep}
        />
      )}

      {reportTarget && (
        <ReportModal
          dish={reportTarget}
          t={t}
          onClose={() => setReportTarget(null)}
          onSubmitted={() => setReportTarget(null)}
          playBeep={playBeep}
        />
      )}
    </motion.section>
  );
};
