import React, { useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Flame,
  Info,
  Maximize2,
  MessageSquare,
  ShieldCheck,
  Soup,
  Users,
  Star,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import type { Dish, SourceType } from '../types';

/**
 * 기존 결과 카드 UI 를 컴포넌트로 분리하고(Phase 1),
 * 추정 칼로리 / 정보 출처 / 신뢰도 / 대표 재료 / 식단 적합성 / 오류 신고를 추가했다(계획서 9장).
 */

const fallbackImage = (dish: Dish): string => {
  const cleanQuery = (dish.original || dish.name).replace(/[^a-zA-Z가-힣0-9\s]/g, '').trim() || 'food';
  return `https://loremflickr.com/500/350/food,${encodeURIComponent(cleanQuery)}`;
};

const imageSrc = (dish: Dish): string =>
  dish.imageUrl && (dish.imageUrl.startsWith('data:image') || dish.imageUrl.startsWith('http'))
    ? dish.imageUrl
    : fallbackImage(dish);

const SOURCE_LABEL_KEY: Record<SourceType, string> = {
  official_nutrition: 'sourceOfficial',
  public_data: 'sourcePublic',
  reference_recipe: 'sourceReference',
  ai_estimate: 'sourceAi',
  restaurant_verified: 'sourceRestaurant',
  user_reported: 'sourceUser',
};

const SOURCE_STYLE: Record<SourceType, string> = {
  official_nutrition: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  public_data: 'bg-sky-50 text-sky-700 border-sky-200',
  reference_recipe: 'bg-neutral-100 text-neutral-600 border-neutral-200',
  ai_estimate: 'bg-neutral-100 text-neutral-600 border-neutral-200',
  restaurant_verified: 'bg-primary/10 text-primary border-primary/30',
  user_reported: 'bg-amber-50 text-amber-700 border-amber-200',
};

export interface DishCardProps {
  dish: Dish;
  index: number;
  isOpen: boolean;
  onToggle: () => void;
  t: Record<string, any>;
  langCode: string;
  onOpenLightbox: (url: string, name: string) => void;
  onAddReview: (comment: string, rating: number) => void;
  onEditReview: (reviewId: string, comment: string) => void;
  onDeleteReview: (reviewId: string) => void;
  onReport?: (dish: Dish) => void;
  playBeep: () => void;
}

export const DishCard: React.FC<DishCardProps> = ({
  dish,
  index,
  isOpen,
  onToggle,
  t,
  langCode,
  onOpenLightbox,
  onAddReview,
  onEditReview,
  onDeleteReview,
  onReport,
  playBeep,
}) => {
  const [editingReviewId, setEditingReviewId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const statusConfig =
    {
      green: {
        badgeBg: 'bg-emerald-500',
        alertBg: 'bg-emerald-50/90',
        alertBorder: 'border-emerald-300',
        alertTitleColor: 'text-emerald-800',
        alertTextColor: 'text-emerald-950',
        alertTitle: langCode === 'ko' ? '✅ 맞춤 식단 적합' : '✅ Dietary Fit: Suitable',
        icon: <ShieldCheck className="w-5 h-5 text-emerald-600 flex-shrink-0" />,
        badgeText: t.safe,
      },
      yellow: {
        badgeBg: 'bg-amber-500',
        alertBg: 'bg-amber-50/95 border-l-4 border-l-amber-500 shadow-xs',
        alertBorder: 'border-amber-400',
        alertTitleColor: 'text-amber-800',
        alertTextColor: 'text-amber-950',
        alertTitle: langCode === 'ko' ? '⚠️ 식단 주의 (확인 필요)' : '⚠️ Dietary Check (Caution)',
        icon: <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0" />,
        badgeText: t.check,
      },
      red: {
        badgeBg: 'bg-rose-500',
        alertBg: 'bg-rose-50 border-l-4 border-l-rose-500 shadow-sm',
        alertBorder: 'border-rose-400',
        alertTitleColor: 'text-rose-800',
        alertTextColor: 'text-rose-950',
        alertTitle: langCode === 'ko' ? '🚨 섭취 부적합 (식단 경고)' : '🚨 Dietary Clash: Warning',
        icon: <AlertCircle className="w-5 h-5 text-rose-600 flex-shrink-0" />,
        badgeText: t.warning,
      },
    }[dish.status] || {
      badgeBg: 'bg-neutral-500',
      alertBg: 'bg-neutral-50',
      alertBorder: 'border-neutral-300',
      alertTitleColor: 'text-neutral-700',
      alertTextColor: 'text-neutral-950',
      alertTitle: langCode === 'ko' ? 'ℹ️ 식단 적합성 정보 없음' : 'ℹ️ Dietary Fit: Unknown',
      icon: <AlertCircle className="w-5 h-5 text-neutral-600 flex-shrink-0" />,
      badgeText: t.unknown,
    };

  const calories = dish.estimated_calories;
  const sourceType = dish.source_type;

  /**
   * 사진 위 배지는 "누가" 못 먹는지 바로 보이게 한다.
   * 동반인이 없거나 걸리는 사람이 없으면 기존 안전/확인/주의 라벨을 그대로 쓴다.
   * 이름이 많으면 배지가 넘치므로 두 명까지만 적고 나머지는 인원수로 줄인다.
   */
  const warned = dish.member_warnings ?? [];
  const statusBadgeText = (() => {
    if (warned.length === 0) return statusConfig.badgeText;
    const shown = warned.slice(0, 2).map((w) => `'${w.name}'`).join(' ');
    const rest = warned.length > 2 ? ` 외 ${warned.length - 2}` : '';
    return `${shown}${rest} ${t.memberWarnLabel}`;
  })();

  const openLightbox = (e: React.MouseEvent) => {
    e.stopPropagation();
    onOpenLightbox(imageSrc(dish), dish.name);
    playBeep();
  };

  return (
    <article
      className={`menu-card bg-white border border-line-trip rounded-[25px] overflow-hidden shadow-sm transition-all duration-250 ${
        isOpen ? 'ring-2 ring-primary/30 scale-[1.01]' : 'hover:scale-[1.005]'
      }`}
      id={`dish-card-${index}`}
    >
      {/* 음식 사진 영역 */}
      <div className="food-photo h-[176px] sm:h-[196px] relative text-white overflow-hidden flex items-end justify-between p-4">
        <img
          src={imageSrc(dish)}
          alt={dish.name}
          referrerPolicy="no-referrer"
          onError={(e) => {
            e.currentTarget.onerror = null;
            e.currentTarget.src = fallbackImage(dish);
          }}
          className="absolute inset-0 w-full h-full object-cover object-center z-0 transition-transform duration-300 hover:scale-105 cursor-zoom-in filter brightness-[1.08] contrast-[1.04]"
          onClick={openLightbox}
        />
        <div
          className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/20 to-transparent z-10 cursor-zoom-in"
          onClick={openLightbox}
        ></div>

        <button
          onClick={openLightbox}
          className="absolute top-3 left-3 z-20 bg-black/45 hover:bg-black/60 border border-white/20 p-2 rounded-full transition-all text-white backdrop-blur-xs cursor-pointer flex items-center justify-center shadow-sm"
          title="이미지 크게 보기"
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </button>

        {/* 추정 칼로리 배지 (계획서 9.2). 신뢰도는 이 추정값에 대한 것이므로 같은 배지에 붙인다. */}
        {calories && calories.max > 0 && (
          <div
            className="absolute top-3 right-3 z-20 bg-black/55 border border-white/20 backdrop-blur-xs rounded-full px-2.5 py-1 flex items-center gap-1 shadow-sm"
            title={calories.basis || t.caloriesBasisDefault}
          >
            <Flame className="w-3 h-3 text-amber-300" />
            <span className="text-[10px] font-black text-white">
              {calories.min}~{calories.max} kcal
            </span>
            {dish.confidence_score != null && (
              <span className="text-[10px] font-bold text-white/70 border-l border-white/25 pl-1.5">
                {Math.round(dish.confidence_score * 100)}%
              </span>
            )}
          </div>
        )}

        <div
          onClick={() => {
            onToggle();
            playBeep();
          }}
          className="space-y-0.5 z-20 cursor-pointer select-none pr-2 flex-1"
        >
          <h3 className="food-name font-black text-xl tracking-tight text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.85)]">
            {dish.name}
          </h3>
          <p className="food-origin text-xs text-white/95 drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)] italic font-mono">
            {dish.original}
          </p>
        </div>

        <div className="flex flex-col items-end gap-2 z-20">
          <span
            onClick={() => {
              onToggle();
              playBeep();
            }}
            className={`status text-[11px] font-black rounded-full text-white cursor-pointer ${statusConfig.badgeBg} px-3 py-1 shadow-sm max-w-[160px] truncate`}
            title={warned.length > 0 ? warned.map((w) => `${w.name}: ${w.reasons.join(', ')}`).join(' / ') : undefined}
          >
            {statusBadgeText}
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
              playBeep();
            }}
            className="bg-white/15 hover:bg-white/25 rounded-full p-1.5 text-white transition-all cursor-pointer flex items-center justify-center border border-white/10 shadow-xs"
          >
            {isOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* 항상 보이는 본문 */}
      <div className="menu-body p-4 space-y-3">
        <div
          className={`alert p-3.5 rounded-xl border-2 shadow-xs ${statusConfig.alertBg} ${statusConfig.alertBorder} flex gap-3 items-start`}
        >
          <div className="flex-shrink-0 mt-0.5">{statusConfig.icon}</div>
          <div className="space-y-1 flex-1">
            <div className={`text-[11px] font-extrabold uppercase tracking-wider ${statusConfig.alertTitleColor}`}>
              {statusConfig.alertTitle}
            </div>
            <p className={`text-xs font-black leading-relaxed ${statusConfig.alertTextColor}`}>{dish.warning}</p>
          </div>
        </div>

        {/* 출처 / 최근 확인일 (계획서 9.4) */}
        {(sourceType || dish.last_verified_at || dish.from_cache) && (
          <div className="flex flex-wrap items-center gap-1.5">
            {sourceType && (
              <span
                className={`inline-flex items-center gap-1 text-[10px] font-black border rounded-full px-2 py-0.5 ${SOURCE_STYLE[sourceType]}`}
              >
                <Info className="w-2.5 h-2.5" />
                {t[SOURCE_LABEL_KEY[sourceType]] || sourceType}
              </span>
            )}
            {/* 신뢰도는 칼로리 추정에 대한 값이므로 사진 위 칼로리 배지에 함께 표시한다. */}
            {dish.last_verified_at && (
              <span className="inline-flex items-center text-[10px] font-bold text-muted-trip bg-white border border-line-trip rounded-full px-2 py-0.5">
                {t.lastVerified} {dish.last_verified_at.slice(0, 10)}
              </span>
            )}
          </div>
        )}

        {/*
         * 설명·맛·재료·방문자 확인 정보·주의 문구·영상 링크는 펼침 영역으로 옮겼다.
         * 메뉴판 한 장에서 카드가 여러 장 나오는데, 접힌 상태에서 모든 설명을 보여주면
         * 목록을 훑어볼 수가 없다. 접힌 카드는 '먹어도 되는지' 만 답한다.
         * 칼로리와 신뢰도는 사진 위 배지로 보여준다.
         */}
      </div>

      {/* 펼침 영역 */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="details overflow-hidden border-t border-line-trip bg-[#fffaf7]/70"
          >
            <div className="p-4 space-y-4">
              <div className="detail-row flex flex-col gap-1.5 border-b border-line-trip/40 pb-3">
                <div className="detail-title text-xs font-black text-primary">{t.descLabel}</div>
                <p className="detail-text text-xs text-neutral-800 leading-relaxed">{dish.desc}</p>
              </div>

              <div className="detail-row flex flex-col gap-1.5 border-b border-line-trip/40 pb-3">
                <div className="detail-title text-xs font-black text-primary">{t.tasteLabel}</div>
                <p className="detail-text text-xs text-neutral-800 leading-relaxed font-semibold italic">
                  "{dish.taste}"
                </p>
              </div>

              {/* 대표 재료 (식단 적합성은 접힌 카드의 경고와 중복되므로 표시하지 않는다) */}
              {dish.typical_ingredients && dish.typical_ingredients.length > 0 && (
                <div className="detail-row flex flex-col gap-1.5 border-b border-line-trip/40 pb-3">
                  <div className="detail-title flex items-center gap-1 text-xs font-black text-primary">
                    <Soup className="w-3 h-3" />
                    {t.ingredientsLabel}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {dish.typical_ingredients.slice(0, 12).map((ing, i) => (
                      <span
                        key={`${ing}-${i}`}
                        className="text-[10px] font-semibold bg-soft-trip/60 text-neutral-700 border border-line-trip rounded-full px-2 py-0.5"
                      >
                        {ing}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* 이 식당을 다녀온 사용자가 직접 확인한 정보 (계획서 8장) */}
              {dish.user_notes && dish.user_notes.length > 0 && (
                <div className="line-info bg-emerald-50/60 border border-emerald-200 rounded-xl p-3 space-y-1 text-xs">
                  <span className="flex items-center gap-1 text-[11px] font-black text-emerald-800">
                    <Users className="w-3 h-3" />
                    {t.userNotesLabel}
                  </span>
                  <ul className="space-y-0.5">
                    {dish.user_notes.slice(0, 3).map((note, i) => (
                      <li key={i} className="text-[11px] text-emerald-900 leading-relaxed">
                        · {note}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="detail-row flex flex-col gap-1.5 border-b border-line-trip/40 pb-3">
                <div className="detail-title text-xs font-black text-primary">{t.pairingLabel}</div>
                <p className="detail-text text-xs text-neutral-800 leading-relaxed">{dish.pair}</p>
              </div>

              <div className="detail-row flex flex-col gap-1.5 border-b border-line-trip/40 pb-3">
                <div className="detail-title text-xs font-black text-primary">{t.orderLabel}</div>
                <p className="detail-text text-xs text-neutral-800 leading-relaxed">{dish.order}</p>
                <div className="order-sentence p-2.5 bg-white border border-dashed border-primary/40 rounded-xl text-xs font-extrabold text-primary flex items-center justify-between">
                  <span>{dish.phrase}</span>
                </div>
              </div>

              <div className="detail-row flex flex-col gap-1.5 border-b border-line-trip/40 pb-3">
                <div className="detail-title text-xs font-black text-primary">{t.etiquetteLabel}</div>
                <p className="detail-text text-xs text-neutral-800 leading-relaxed">{dish.etiquette}</p>
              </div>

              {/* 정보 출처 요약 (계획서 9.1) */}
              {dish.source_summary && dish.source_summary.length > 0 && (
                <div className="detail-row flex flex-col gap-1.5 border-b border-line-trip/40 pb-3">
                  <div className="detail-title text-xs font-black text-primary">{t.sourceLabel}</div>
                  <div className="flex flex-wrap gap-1">
                    {dish.source_summary.map((s, i) => (
                      <span
                        key={`${s}-${i}`}
                        className="text-[10px] font-semibold text-neutral-600 bg-white border border-line-trip rounded-full px-2 py-0.5"
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <a
                href={`https://www.youtube.com/results?search_query=${encodeURIComponent(dish.name + ' ' + dish.original)}`}
                target="_blank"
                rel="noreferrer referrer"
                className="video w-full py-2.5 bg-primary hover:bg-primary/90 text-white rounded-xl text-xs font-black text-center block transition-all shadow-md shadow-primary/15"
              >
                {t.youtubeBtn}
              </a>

              {/* 리뷰 */}
              <div className="detail-row space-y-2">
                <div className="flex items-center gap-1">
                  <MessageSquare className="w-3.5 h-3.5 text-primary" />
                  <span className="detail-title text-xs font-black text-primary">{t.reviewsLabel}</span>
                </div>

                <div className="reviews space-y-2 max-h-[190px] overflow-y-auto pr-1">
                  {dish.reviews.map((r, rIdx) => {
                    const isMyReview = !!r[2];
                    const isEditing = editingReviewId === r[2];
                    const isDeleting = deleteConfirmId === r[2];

                    return (
                      <div key={rIdx} className="review bg-white border border-line-trip rounded-xl p-2.5 space-y-1 shadow-2xs">
                        <div className="flex items-center justify-between">
                          <b className="text-[10px] text-neutral-900 font-extrabold">{r[0]}</b>
                          {/* 별점이 없던 시절의 리뷰는 5점으로 본다. */}
                          <div className="flex items-center gap-0.5">
                            {[1, 2, 3, 4, 5].map((n) => (
                              <Star
                                key={n}
                                className={`w-2.5 h-2.5 ${
                                  n <= (r[3] ?? 5) ? 'fill-amber-400 text-amber-400' : 'fill-none text-line-trip'
                                }`}
                              />
                            ))}
                          </div>
                        </div>

                        {isEditing ? (
                          <div className="space-y-1.5 mt-1">
                            <textarea
                              value={editingText}
                              onChange={(e) => setEditingText(e.target.value)}
                              className="w-full text-[11px] p-2 border border-line-trip rounded-lg bg-bg-trip focus:outline-none focus:ring-1 focus:ring-primary font-medium text-neutral-800"
                              rows={2}
                            />
                            <div className="flex justify-end gap-1.5">
                              <button
                                onClick={() => {
                                  onEditReview(r[2]!, editingText);
                                  setEditingReviewId(null);
                                }}
                                className="text-[10px] font-black bg-primary text-white rounded-md px-2 py-1 hover:bg-primary/95 cursor-pointer shadow-2xs"
                              >
                                {langCode === 'ko' ? '저장' : 'Save'}
                              </button>
                              <button
                                onClick={() => setEditingReviewId(null)}
                                className="text-[10px] font-black bg-neutral-100 text-neutral-600 border border-neutral-200 rounded-md px-2 py-1 hover:bg-neutral-200 cursor-pointer"
                              >
                                {langCode === 'ko' ? '취소' : 'Cancel'}
                              </button>
                            </div>
                          </div>
                        ) : isDeleting ? (
                          <div className="flex items-center justify-between mt-1 bg-rose-50 border border-rose-100 rounded-lg p-1.5 px-2">
                            <span className="text-[10px] font-bold text-rose-800">
                              {langCode === 'ko' ? '정말 삭제하시겠습니까?' : 'Delete this review?'}
                            </span>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => {
                                  onDeleteReview(r[2]!);
                                  setDeleteConfirmId(null);
                                }}
                                className="text-[10px] font-black text-rose-600 hover:text-rose-800 cursor-pointer"
                              >
                                {langCode === 'ko' ? '확인' : 'Confirm'}
                              </button>
                              <button
                                onClick={() => setDeleteConfirmId(null)}
                                className="text-[10px] font-black text-neutral-500 hover:text-neutral-700 cursor-pointer"
                              >
                                {langCode === 'ko' ? '취소' : 'Cancel'}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <p className="text-[11px] text-neutral-700 leading-normal">{r[1]}</p>
                            {isMyReview && (
                              <div className="flex items-center gap-1.5 mt-1 justify-end">
                                <button
                                  onClick={() => {
                                    setEditingReviewId(r[2]!);
                                    setEditingText(r[1]);
                                  }}
                                  className="text-[10px] font-black text-neutral-500 hover:text-primary cursor-pointer"
                                >
                                  {langCode === 'ko' ? '수정' : 'Edit'}
                                </button>
                                <span className="text-[9px] text-neutral-300">|</span>
                                <button
                                  onClick={() => setDeleteConfirmId(r[2]!)}
                                  className="text-[10px] font-black text-rose-500 hover:text-rose-700 cursor-pointer"
                                >
                                  {langCode === 'ko' ? '삭제' : 'Delete'}
                                </button>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>

                <ReviewInputForm buttonLabel={t.registerBtn} placeholder={t.reviewPlaceholder} onAddReview={onAddReview} />
              </div>

              {/* 오류 신고 (계획서 4.3 / 13.7) — 식당 메뉴로 저장된 항목만 신고할 수 있다. */}
              {onReport && dish.menu_id && (
                <button
                  onClick={() => onReport(dish)}
                  className="w-full border border-line-trip bg-white text-muted-trip hover:text-primary hover:bg-soft-trip/40 py-2.5 rounded-xl text-[11px] font-black transition-all cursor-pointer"
                >
                  {t.reportBtn}
                </button>
              )}

              {/* 알레르기 안내 문구 (계획서 9.4) */}
              <div className="text-[10px] leading-relaxed text-muted-trip bg-soft-trip/30 border border-line-trip/50 rounded-xl p-2.5">
                ⚠️ {dish.verification_message || t.allergenDisclaimer}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </article>
  );
};

interface ReviewFormProps {
  onAddReview: (comment: string, rating: number) => void;
  buttonLabel: string;
  placeholder: string;
}

export function ReviewInputForm({ onAddReview, buttonLabel, placeholder }: ReviewFormProps) {
  const [text, setText] = useState('');
  // 대부분 좋았을 때 리뷰를 쓰므로 5점에서 시작한다. 고치고 싶으면 별을 누르면 된다.
  const [rating, setRating] = useState(5);
  const [hovered, setHovered] = useState(0);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    onAddReview(text, rating);
    setText('');
    setRating(5);
  };

  return (
    <form onSubmit={handleSubmit} className="review-write mt-2 space-y-1.5">
      <div className="flex items-center gap-1" onMouseLeave={() => setHovered(0)}>
        {[1, 2, 3, 4, 5].map((n) => {
          const filled = n <= (hovered || rating);
          return (
            <button
              key={n}
              type="button"
              onClick={() => setRating(n)}
              onMouseEnter={() => setHovered(n)}
              aria-label={`${n}점`}
              className="p-0.5 cursor-pointer transition-transform hover:scale-110"
            >
              <Star
                className={`w-4 h-4 ${filled ? 'fill-amber-400 text-amber-400' : 'fill-none text-line-trip'}`}
              />
            </button>
          );
        })}
        <span className="text-[10px] font-black text-muted-trip ml-1">{rating}.0</span>
      </div>

      <div className="flex gap-1.5">
        <input
          type="text"
          placeholder={placeholder}
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="flex-1 h-[34px] border border-line-trip rounded-xl px-3 py-1 text-xs outline-none bg-white focus:border-primary transition-all text-neutral-800"
        />
        <button
          type="submit"
          className="btn w-12 h-[34px] p-0 bg-primary hover:bg-primary2 text-white rounded-xl text-xs font-black shadow-none flex items-center justify-center cursor-pointer border-0"
        >
          {buttonLabel}
        </button>
      </div>
    </form>
  );
}
