import React, { useState } from 'react';
import { motion } from 'motion/react';
import { AlertTriangle, Flag, X } from 'lucide-react';
import * as api from '../lib/api';
import type { Dish, ReportType } from '../types';

/** 계획서 13.7 / Phase 8 — 메뉴 정보 오류 신고 */

interface ReportModalProps {
  dish: Dish;
  t: Record<string, any>;
  onClose: () => void;
  onSubmitted: () => void;
  playBeep: () => void;
}

export const ReportModal: React.FC<ReportModalProps> = ({ dish, t, onClose, onSubmitted, playBeep }) => {
  const [type, setType] = useState<ReportType>('ingredient');
  const [text, setText] = useState('');
  const [visitDate, setVisitDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  /** 현장에서 확인한 알레르기 — 있음 / 없음 */
  const [present, setPresent] = useState<string[]>([]);
  const [absent, setAbsent] = useState<string[]>([]);

  const toggle = (list: string[], setList: (v: string[]) => void, other: string[], setOther: (v: string[]) => void, key: string) => {
    if (list.includes(key)) {
      setList(list.filter((k) => k !== key));
    } else {
      setList([...list, key]);
      // 같은 항목을 '있음'과 '없음'에 동시에 넣을 수 없다.
      if (other.includes(key)) setOther(other.filter((k) => k !== key));
    }
  };

  const types: { key: ReportType; label: string }[] = [
    { key: 'ingredient', label: t.reportIngredient },
    { key: 'allergen', label: t.reportAllergen },
    { key: 'calorie', label: t.reportCalorie },
    { key: 'price', label: t.reportPrice },
    { key: 'other', label: t.reportOther },
  ];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dish.menu_id || !text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.submitReport(dish.menu_id, {
        report_type: type,
        report_text: text.trim(),
        visit_date: visitDate || undefined,
        reported_allergens: present,
        absent_allergens: absent,
      });
      playBeep();
      setDone(true);
      setTimeout(onSubmitted, 1200);
    } catch (err: any) {
      setError(err.message || '신고 접수에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/70 z-[100] flex items-center justify-center p-4 backdrop-blur-xs"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, y: 15 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.95, y: 15 }}
        transition={{ type: 'spring', damping: 25, stiffness: 350 }}
        className="bg-bg-trip border border-line-trip rounded-[28px] p-5 shadow-2xl w-full max-w-[340px] space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line-trip/60 pb-3">
          <div className="flex items-center gap-2 text-primary">
            <Flag className="w-4 h-4" />
            <h2 className="text-sm font-black text-neutral-900">{t.reportTitle}</h2>
          </div>
          <button
            onClick={onClose}
            className="bg-soft-trip hover:bg-line-trip/40 p-1.5 rounded-full transition-all cursor-pointer text-neutral-600"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {done ? (
          <p className="text-xs font-bold text-emerald-700 text-center py-6">{t.reportDone}</p>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <div className="text-[11px] font-bold text-neutral-700">
              {dish.name} <span className="text-muted-trip font-normal">({dish.original})</span>
            </div>

            <div className="space-y-1.5">
              <div className="text-[11px] font-black text-neutral-800">{t.reportTypeLabel}</div>
              <div className="flex flex-wrap gap-1.5">
                {types.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setType(item.key)}
                    className={`text-[11px] font-semibold border rounded-full px-2.5 py-1 transition-all cursor-pointer ${
                      type === item.key
                        ? 'bg-soft-trip border-primary text-primary font-bold'
                        : 'bg-white border-line-trip text-neutral-600 hover:bg-neutral-50'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 알레르기 신고는 자유 텍스트 대신 선택값으로 받아야 다음 사용자에게 바로 반영된다. */}
            {type === 'allergen' && Array.isArray(t.allergiesList) && (
              <div className="space-y-2 bg-soft-trip/40 border border-line-trip rounded-xl p-2.5">
                <div className="space-y-1">
                  <div className="text-[11px] font-black text-rose-700">{t.reportAllergenPresent}</div>
                  <div className="flex flex-wrap gap-1">
                    {t.allergiesList.map((a: any) => (
                      <button
                        key={`p-${a.key}`}
                        type="button"
                        onClick={() => toggle(present, setPresent, absent, setAbsent, a.key)}
                        className={`text-[11px] font-semibold border rounded-full px-2 py-0.5 transition-all cursor-pointer ${
                          present.includes(a.key)
                            ? 'bg-rose-500 border-rose-500 text-white font-bold'
                            : 'bg-white border-line-trip text-neutral-600 hover:bg-neutral-50'
                        }`}
                      >
                        {a.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="text-[11px] font-black text-emerald-700">{t.reportAllergenAbsent}</div>
                  <div className="flex flex-wrap gap-1">
                    {t.allergiesList.map((a: any) => (
                      <button
                        key={`a-${a.key}`}
                        type="button"
                        onClick={() => toggle(absent, setAbsent, present, setPresent, a.key)}
                        className={`text-[11px] font-semibold border rounded-full px-2 py-0.5 transition-all cursor-pointer ${
                          absent.includes(a.key)
                            ? 'bg-emerald-600 border-emerald-600 text-white font-bold'
                            : 'bg-white border-line-trip text-neutral-600 hover:bg-neutral-50'
                        }`}
                      >
                        {a.label}
                      </button>
                    ))}
                  </div>
                </div>

                <p className="text-[10px] text-muted-trip leading-relaxed">{t.reportAllergenHelp}</p>
              </div>
            )}

            <div className="space-y-1.5">
              <div className="text-[11px] font-black text-neutral-800">{t.reportTextLabel}</div>
              <textarea
                rows={3}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={t.reportTextPlaceholder}
                className="w-full text-xs border border-line-trip rounded-xl bg-white p-2.5 outline-none text-neutral-800 focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all resize-none"
                required
              />
            </div>

            <div className="space-y-1.5">
              <div className="text-[11px] font-black text-neutral-800">{t.visitDateLabel}</div>
              <input
                type="date"
                value={visitDate}
                onChange={(e) => setVisitDate(e.target.value)}
                className="w-full text-xs border border-line-trip rounded-xl bg-white p-2.5 outline-none text-neutral-800 focus:border-primary transition-all"
              />
            </div>

            {error && (
              <div className="bg-danger-trip/5 border border-danger-trip/20 rounded-xl p-2.5 text-[11px] text-danger-trip flex items-start gap-2">
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full border-0 rounded-xl py-3 bg-gradient-to-r from-primary to-primary2 text-white font-black text-xs shadow-md hover:scale-[1.01] active:scale-[0.99] transition-all cursor-pointer disabled:opacity-60"
            >
              {t.reportSubmit}
            </button>
          </form>
        )}
      </motion.div>
    </motion.div>
  );
};
