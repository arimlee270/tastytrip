import React, { useEffect, useState } from 'react';
import { Globe, Share2, Utensils, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

import { getLangCode, getTranslations } from './i18n';
import * as api from './lib/api';
import { playBeep } from './lib/audio';
import { AuthProvider, accountToParty, useAuth } from './lib/auth';
import {
  getCustomReviewsMap,
  loadDishes,
  loadParty,
  mergeDishesWithCustomReviews,
  readSetting,
  saveCustomReviewsMap,
  saveDishes,
  saveParty,
  writeSetting,
} from './lib/storage';
import { searchPexelsImageWithFallbacks } from './utils/pexels';
import { BottomNav, type NavTab } from './components/BottomNav';
import { CameraScreen } from './screens/CameraScreen';
import { LoginScreen } from './screens/LoginScreen';
import { MapScreen } from './screens/MapScreen';
import { IntroScreen } from './screens/IntroScreen';
import { ProfileScreen } from './screens/ProfileScreen';
import { RestaurantScreen } from './screens/RestaurantScreen';
import { ResultsScreen } from './screens/ResultsScreen';
import type { Dish, Member, Restaurant } from './types';

/**
 * 앱 셸.
 * 기존 카메라 분석 → 결과 카드 플로우를 그대로 유지하면서,
 * 하단 3분할 내비게이션(내 정보 / 카메라 / 지도)과 로그인·지도·식당 화면을 추가했다.
 */

const getLoadingTips = (code: string): string[] => {
  switch (code) {
    case 'en':
      return [
        'Scanning local ingredients and cross-checking unknown allergen triggers...',
        'Matching traveler allergen profiles with authentic local recipes...',
        'Translating and localizing pronunciation guidelines for your party...',
        'Syncing up global reviewer logs and tourist culinary advice...',
      ];
    case 'ja':
      return [
        '現地の固有食材や未知のアレルゲンをスキャンしています...',
        '同行者のアレルギー情報と現地の調理レシピを照合中...',
        '発音ガイドとカスタム注文フレーズを翻訳中...',
        '旅行者のレビューと食事のヒントを読み込んでいます...',
      ];
    case 'zh':
      return [
        '正在扫描当地特有食材并筛查未知过敏原...',
        '正在将同行者的过敏档案与当地正宗食谱进行匹配...',
        '正在为您的团队翻译和本地化发音指南...',
        '正在同步全球旅行者评论和用餐建议...',
      ];
    case 'fr':
      return [
        'Scan des ingrédients locaux et vérification des allergènes...',
        "Correspondance des profils d'allergies avec les recettes locales...",
        'Traduction et localisation des guides de prononciation...',
        'Synchronisation des avis voyageurs et des conseils culinaires...',
      ];
    case 'th':
      return [
        'กำลังสแกนส่วนผสมท้องถิ่นและตรวจสอบสารก่อภูมิแพ้...',
        'กำลังจับคู่ประวัติการแพ้อาหารของผู้เดินทางกับสูตรอาหารท้องถิ่น...',
        'กำลังแปลและปรับปรุงแนวทางการออกเสียงสแกนเมนู...',
        'กำลังซิงค์ข้อมูลรีวิวจากผู้เดินทางทั่วโลกและเคล็ดลับ...',
      ];
    case 'bn':
      return [
        'স্থানীয় উপাদান স্ক্যান করা হচ্ছে এবং অজানা অ্যালার্জেন ঝুঁকি পরীক্ষা করা হচ্ছে...',
        'খাবারের আসল রেসিপির সাথে ভ্রমণকারী অ্যালার্জি প্রোফাইল মেলানো হচ্ছে...',
        'উচ্চারণ নির্দেশিকা এবং কাস্টম অর্ডার বাক্যাংশ অনুবাদ করা হচ্ছে...',
        'ভ্রমণকারী রিভিউ এবং খাবারের দরকারী টিপস সিঙ্ক করা হচ্ছে...',
      ];
    default:
      return [
        '여행지의 고유한 향신채와 미지의 알레르기 유발물질을 스캔하고 있습니다...',
        '동반 여행 구성원의 알레르기 프로필과 현지 음식 조리 레시피를 대조 중입니다...',
        '현지 발음 및 맞춤형 제외 요청 주문 문장을 완벽히 번역하고 있습니다...',
        '생생한 글로벌 여행자들의 미식 후기와 한 줄 맛 평가를 동기화하고 있습니다...',
      ];
  }
};

const shareUrl = 'https://remix-tastytrip-356020796948.asia-east1.run.app';

function AppShell() {
  const { user, profile, companions, isLoggedIn } = useAuth();

  /* ------------------------------ 상태 ------------------------------ */

  const [tab, setTab] = useState<NavTab>('camera');
  /** 카메라 탭 내부 단계 */
  const [cameraStage, setCameraStage] = useState<'camera' | 'results'>('camera');
  /** 지도 탭 내부 단계 */
  const [selectedRestaurant, setSelectedRestaurant] = useState<Restaurant | null>(null);
  const [showLogin, setShowLogin] = useState(false);
  /** 앱을 켤 때 잠깐 보이는 인트로 화면 */
  const [showIntro, setShowIntro] = useState(true);

  const [homeCountry, setHomeCountry] = useState('한국');
  const [displayLanguage, setDisplayLanguage] = useState('한국어');
  const [travelCountry, setTravelCountry] = useState('태국');
  const [party, setParty] = useState<Member[]>([]);

  const [image, setImage] = useState<string | null>(null);
  const [imageName, setImageName] = useState<string | null>(null);
  const [menuText, setMenuText] = useState('');
  /** 이 식당에 메뉴를 등록할 대상 (계획서 5.2) */
  const [targetRestaurant, setTargetRestaurant] = useState<Restaurant | null>(null);

  const [loading, setLoading] = useState(false);
  const [loadingTipIndex, setLoadingTipIndex] = useState(0);
  const [dishes, setDishes] = useState<Dish[]>([]);
  const [geminiCalled, setGeminiCalled] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedLightboxImage, setSelectedLightboxImage] = useState<{ url: string; name: string } | null>(null);
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const langCode = getLangCode(displayLanguage);
  const t = getTranslations(langCode);
  const loadingTips = getLoadingTips(langCode);

  /* --------------------------- 초기 로드 --------------------------- */

  useEffect(() => {
    setParty(loadParty());

    const savedTravel = readSetting('tastytrip_travel');
    const savedLang = readSetting('tastytrip_lang');
    if (savedTravel) setTravelCountry(savedTravel);
    if (savedLang) setDisplayLanguage(savedLang);

    const savedDishes = loadDishes();
    if (savedDishes && savedDishes.length > 0) {
      setDishes(savedDishes);
      setCameraStage('results');
    }
  }, []);

  // 로그인하면 계정에 저장된 프로필을 화면 구성원으로 가져온다. (계획서 Phase 2 마이그레이션)
  useEffect(() => {
    if (!isLoggedIn) return;
    const accountParty = accountToParty(user, profile, companions);
    const hasAccountData =
      accountParty.length > 1 ||
      (accountParty[0] && (accountParty[0].allergies.length > 0 || accountParty[0].diets.length > 0));

    if (hasAccountData) {
      setParty(accountParty);
      saveParty(accountParty);
    }
  }, [isLoggedIn, user, profile, companions]);

  useEffect(() => {
    saveDishes(dishes);
  }, [dishes]);

  useEffect(() => {
    if (!selectedLightboxImage) {
      document.body.style.overflow = '';
      return;
    }
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedLightboxImage(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [selectedLightboxImage]);

  /* --------------------------- 설정 변경 --------------------------- */

  const updateParty = (next: Member[]) => {
    setParty(next);
    saveParty(next);
  };

  const updateTravelCountry = (val: string) => {
    setTravelCountry(val);
    writeSetting('tastytrip_travel', val);
  };

  const updateDisplayLanguage = (val: string) => {
    setDisplayLanguage(val);
    writeSetting('tastytrip_lang', val);
  };

  /* ---------------------------- 이미지 검색 ---------------------------- */

  const triggerImageGeneration = async (parsedDishes: Dish[]) => {
    for (let i = 0; i < parsedDishes.length; i++) {
      const dish = parsedDishes[i];
      try {
        const result = await searchPexelsImageWithFallbacks(
          dish.primary_query,
          dish.secondary_query,
          dish.fallback_query,
          dish.imageUrl
        );
        if (result) {
          setDishes((prev) => {
            const updated = [...prev];
            if (updated[i]) {
              updated[i] = { ...updated[i], imageUrl: result.imageUrl, active_query: result.activeQuery };
            }
            return updated;
          });
        }
      } catch (err) {
        console.log('Error searching Pexels for', dish.name, err);
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  };

  /* ------------------------------ 분석 ------------------------------ */

  const handleAnalyzeMenu = async () => {
    setLoading(true);
    setError(null);

    const tipsTimer = setInterval(() => setLoadingTipIndex((prev) => (prev + 1) % 4), 2800);

    try {
      const body = {
        image,
        menuText,
        homeCountry,
        travelCountry,
        party,
        targetLanguage: langCode,
      };

      // 식당을 선택한 상태면 해당 식당의 메뉴 DB 에 저장하는 경로로 분석한다. (계획서 5.2)
      const data = targetRestaurant
        ? await api.analyzeRestaurantMenu(targetRestaurant.restaurant_id, body)
        : await api.analyzeMenu(body);

      if (data.dishes && data.dishes.length > 0) {
        const merged = mergeDishesWithCustomReviews(data.dishes);
        setDishes(merged);
        setGeminiCalled(data.meta?.gemini_called ?? true);
        setCameraStage('results');
        setTab('camera');
        triggerImageGeneration(merged);
      } else {
        throw new Error(
          langCode === 'en'
            ? 'No food items were parsed. Please try a different photo or search query.'
            : '분석된 음식 정보가 없습니다. 다른 이미지나 검색어를 시도해주세요.'
        );
      }
    } catch (err: any) {
      console.error(err);
      setError(
        err.message ||
          (langCode === 'en'
            ? 'Scanner service unavailable. Please check backend connection.'
            : '인공지능 분석 연동 도중 에러가 발생하였습니다. API 설정 및 네트워크를 확인해주세요.')
      );
    } finally {
      setLoading(false);
      clearInterval(tipsTimer);
    }
  };

  /* ------------------------------ 리뷰 ------------------------------ */

  const reviewerName = (): string => {
    const names: Record<string, string> = {
      ko: '나 · 한국',
      en: 'Me · Korea',
      ja: '私 · 韓国',
      zh: '我 · 韩国',
      fr: 'Moi · Corée',
      th: 'ฉัน · เกาหลี',
      bn: 'আমি · কোরিয়া',
    };
    return names[langCode] || 'Me · Korea';
  };

  /** 특정 요리(카드)의 리뷰를 localStorage 와 화면 상태에 동시에 반영한다. */
  const addReviewToDish = (
    dish: Dish,
    comment: string,
    rating: number,
    apply: (updater: (d: Dish) => Dish) => void
  ) => {
    if (!comment.trim()) return;
    const author = reviewerName();
    const reviewId = `rev-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    // 별점은 1~5 사이로만 받는다.
    const stars = Math.min(5, Math.max(1, Math.round(rating || 5)));

    const customMap = getCustomReviewsMap();
    const key = (dish.original || dish.name).trim();
    if (!customMap[key]) customMap[key] = [];
    customMap[key].unshift({
      id: reviewId,
      author,
      comment: comment.trim(),
      timestamp: Date.now(),
      rating: stars,
    });
    saveCustomReviewsMap(customMap);

    apply((d) => ({ ...d, reviews: [[author, comment.trim(), reviewId, stars], ...d.reviews] }));
  };

  const editReviewOfDish = (
    dish: Dish,
    reviewId: string,
    comment: string,
    apply: (updater: (d: Dish) => Dish) => void
  ) => {
    if (!comment.trim()) return;
    const customMap = getCustomReviewsMap();
    const key = (dish.original || dish.name).trim();
    if (customMap[key]) {
      customMap[key] = customMap[key].map((r) => (r.id === reviewId ? { ...r, comment: comment.trim() } : r));
      saveCustomReviewsMap(customMap);
    }
    apply((d) => ({
      ...d,
      reviews: d.reviews.map((r) => (r[2] === reviewId ? [r[0], comment.trim(), r[2], r[3]] : r)),
    }));
    playBeep();
  };

  const deleteReviewOfDish = (dish: Dish, reviewId: string, apply: (updater: (d: Dish) => Dish) => void) => {
    const customMap = getCustomReviewsMap();
    const key = (dish.original || dish.name).trim();
    if (customMap[key]) {
      customMap[key] = customMap[key].filter((r) => r.id !== reviewId);
      saveCustomReviewsMap(customMap);
    }
    apply((d) => ({ ...d, reviews: d.reviews.filter((r) => r[2] !== reviewId) }));
    playBeep();
  };

  const applyToDishIndex = (index: number) => (updater: (d: Dish) => Dish) =>
    setDishes((prev) => prev.map((d, i) => (i === index ? updater(d) : d)));

  // 식당 화면의 카드는 App 상태에 없으므로 localStorage 만 갱신한다(화면은 재조회 시 반영).
  const noopApply = () => (_updater: (d: Dish) => Dish) => undefined;

  /* ------------------------------ 이동 ------------------------------ */

  const openRestaurant = (restaurant: Restaurant) => {
    setSelectedRestaurant(restaurant);
    setTab('map');
  };

  const shootMenuFor = (restaurant: Restaurant) => {
    setTargetRestaurant(restaurant);
    setImage(null);
    setImageName(null);
    setMenuText('');
    setCameraStage('camera');
    setTab('camera');
  };

  const restartScan = () => {
    setImage(null);
    setImageName(null);
    setMenuText('');
    setDishes([]);
    setCameraStage('camera');
  };

  /* ------------------------------ 렌더 ------------------------------ */

  /** 지도 목록 화면일 때만 전체 화면 모드 (식당 상세로 들어가면 일반 문서형으로 돌아간다) */
  const isMapFullBleed = tab === 'map' && !selectedRestaurant && !showLogin;

  return (
    <div className="min-h-[100dvh] bg-[#191514] text-ink font-sans flex items-center justify-center p-0 md:p-6 select-none overflow-x-hidden">
      <div className="phone w-full max-w-[390px] h-[100dvh] md:h-[844px] md:rounded-[38px] bg-bg-trip border-0 md:border-8 border-neutral-900 relative flex flex-col overflow-hidden shadow-2xl">
        {/* 인트로 — 준비가 끝나면 스스로 사라진다 */}
        <AnimatePresence>
          {showIntro && <IntroScreen key="intro" onDone={() => setShowIntro(false)} />}
        </AnimatePresence>

        <div
          className="hidden md:block absolute top-[9px] left-1/2 -translate-x-1/2 w-[92px] bg-neutral-900 rounded-full z-30 pointer-events-none"
          style={{ height: '24px' }}
        ></div>

        {/* 헤더 */}
        <header className="h-[68px] pt-[24px] px-5 flex items-center justify-between bg-bg-trip/95 border-b border-line-trip/60 backdrop-blur-md sticky top-0 z-20">
          <div
            className="flex items-center gap-1.5 cursor-pointer"
            onClick={() => {
              setTab('camera');
              setCameraStage('camera');
            }}
          >
            <Utensils className="w-5 h-5 text-primary" />
            <span className="logo font-black text-xl tracking-tight text-primary">{t.title}</span>
          </div>

          <div className="header-right flex items-center gap-2">
            <button
              onClick={() => {
                setIsShareOpen(true);
                playBeep();
              }}
              className="w-[28px] h-[28px] rounded-full bg-white border border-line-trip flex items-center justify-center text-primary hover:text-primary2 hover:bg-soft-trip/50 active:scale-95 transition-all cursor-pointer shadow-2xs"
              title={t.shareBtn}
            >
              <Share2 className="w-3.5 h-3.5" />
            </button>
            <div className="text-[11px] font-extrabold text-muted-trip bg-white border border-line-trip rounded-full px-3 py-1 flex items-center gap-1">
              <Globe className="w-3 h-3 text-primary" />
              <span>
                {t.countries?.[travelCountry] || travelCountry} {t.tripLabel}
              </span>
            </div>
          </div>
        </header>

        {/* 본문 */}
        {/*
         * 지도 화면은 여백 없이 화면을 꽉 채우고, 검색·목록은 지도 위에 떠 있다.
         * 그래서 지도일 때만 main 의 안쪽 여백과 세로 스크롤을 없앤다.
         */}
        <main className={isMapFullBleed ? 'flex-1 relative overflow-hidden' : 'flex-1 overflow-y-auto p-4 pb-6'}>
          <AnimatePresence mode="wait">
            {showLogin ? (
              <LoginScreen
                key="login"
                t={t}
                langCode={langCode}
                onDone={() => setShowLogin(false)}
                onGuest={() => setShowLogin(false)}
                playBeep={playBeep}
              />
            ) : tab === 'me' ? (
              <ProfileScreen
                key="me"
                t={t}
                langCode={langCode}
                party={party}
                homeCountry={homeCountry}
                displayLanguage={displayLanguage}
                travelCountry={travelCountry}
                onChangeHomeCountry={setHomeCountry}
                onChangeDisplayLanguage={updateDisplayLanguage}
                onChangeTravelCountry={updateTravelCountry}
                onChangeParty={updateParty}
                onGoLogin={() => setShowLogin(true)}
                onSelectRestaurant={openRestaurant}
                playBeep={playBeep}
              />
            ) : tab === 'map' ? (
              selectedRestaurant ? (
                <RestaurantScreen
                  key={`restaurant-${selectedRestaurant.restaurant_id}`}
                  restaurant={selectedRestaurant}
                  t={t}
                  langCode={langCode}
                  party={party}
                  onBack={() => setSelectedRestaurant(null)}
                  onShootMenu={shootMenuFor}
                  onOpenLightbox={(url, name) => setSelectedLightboxImage({ url, name })}
                  onAddReview={(dish, comment, rating) => addReviewToDish(dish, comment, rating, noopApply())}
                  onEditReview={(dish, reviewId, comment) => editReviewOfDish(dish, reviewId, comment, noopApply())}
                  onDeleteReview={(dish, reviewId) => deleteReviewOfDish(dish, reviewId, noopApply())}
                  playBeep={playBeep}
                />
              ) : (
                <MapScreen
                  key="map"
                  t={t}
                  travelCountry={travelCountry}
                  langCode={langCode}
                  party={party}
                  onSelectRestaurant={openRestaurant}
                  onGoCamera={() => {
                    setCameraStage('camera');
                    setTab('camera');
                  }}
                  playBeep={playBeep}
                />
              )
            ) : cameraStage === 'results' ? (
              <ResultsScreen
                key="results"
                t={t}
                langCode={langCode}
                travelCountry={travelCountry}
                party={party}
                dishes={dishes}
                geminiCalled={geminiCalled}
                onRestart={restartScan}
                onOpenLightbox={(url, name) => setSelectedLightboxImage({ url, name })}
                onAddReview={(idx, comment, rating) => addReviewToDish(dishes[idx], comment, rating, applyToDishIndex(idx))}
                onEditReview={(idx, reviewId, comment) =>
                  editReviewOfDish(dishes[idx], reviewId, comment, applyToDishIndex(idx))
                }
                onDeleteReview={(idx, reviewId) => deleteReviewOfDish(dishes[idx], reviewId, applyToDishIndex(idx))}
                playBeep={playBeep}
              />
            ) : (
              <CameraScreen
                key="camera"
                t={t}
                langCode={langCode}
                image={image}
                imageName={imageName}
                menuText={menuText}
                loading={loading}
                error={error}
                loadingTips={loadingTips}
                loadingTipIndex={loadingTipIndex}
                targetRestaurant={targetRestaurant}
                onClearRestaurant={() => setTargetRestaurant(null)}
                hasPreviousResults={dishes.length > 0}
                onViewResults={() => setCameraStage('results')}
                onSetImage={(img, name) => {
                  setImage(img);
                  setImageName(name);
                }}
                onChangeMenuText={setMenuText}
                onAnalyze={handleAnalyzeMenu}
                onError={setError}
                playBeep={playBeep}
              />
            )}
          </AnimatePresence>
        </main>

        {/* 하단 내비게이션 (계획서 2.2) */}
        {!showLogin && (
          <BottomNav
            active={tab}
            onChange={(next) => {
              playBeep();
              setTab(next);
              // 가운데 카메라 버튼은 언제나 촬영 화면으로 간다.
              if (next === 'camera') setCameraStage('camera');
              if (next === 'map') setSelectedRestaurant(null);
            }}
            t={t}
          />
        )}
      </div>

      {/* 라이트박스 */}
      <AnimatePresence>
        {selectedLightboxImage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black/85 z-[100] flex flex-col items-center justify-center p-4 backdrop-blur-xs"
            onClick={() => {
              setSelectedLightboxImage(null);
              playBeep();
            }}
          >
            <button
              onClick={(e) => {
                e.stopPropagation();
                setSelectedLightboxImage(null);
                playBeep();
              }}
              className="absolute top-6 right-6 z-[110] bg-white/10 hover:bg-white/20 border border-white/20 text-white p-3 rounded-full transition-all cursor-pointer flex items-center justify-center"
              aria-label="Close Lightbox"
            >
              <X className="w-5 h-5" />
            </button>

            <motion.div
              initial={{ scale: 0.95 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.95 }}
              transition={{ type: 'spring', damping: 25, stiffness: 350 }}
              className="relative max-w-full max-h-[80vh] flex flex-col items-center gap-4"
              onClick={(e) => e.stopPropagation()}
            >
              <img
                src={selectedLightboxImage.url}
                alt={selectedLightboxImage.name}
                referrerPolicy="no-referrer"
                className="max-w-full max-h-[70vh] object-contain rounded-2xl shadow-2xl border border-white/10 select-none pointer-events-auto"
              />
              <div className="text-center">
                <h4 className="text-white font-black text-lg tracking-tight drop-shadow-md">
                  {selectedLightboxImage.name}
                </h4>
                <p className="text-white/60 text-xs mt-1">이 영역 바깥을 누르거나 ESC를 눌러 닫기</p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 공유 모달 */}
      <AnimatePresence>
        {isShareOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black/70 z-[100] flex flex-col items-center justify-center p-4 backdrop-blur-xs"
            onClick={() => {
              setIsShareOpen(false);
              playBeep();
            }}
          >
            <motion.div
              initial={{ scale: 0.95, y: 15 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 15 }}
              transition={{ type: 'spring', damping: 25, stiffness: 350 }}
              className="bg-bg-trip border border-line-trip rounded-[28px] p-6 shadow-2xl w-full max-w-[350px] space-y-5 relative flex flex-col text-neutral-800"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-line-trip/60 pb-3">
                <div className="flex items-center gap-2 text-primary">
                  <Share2 className="w-5 h-5 animate-pulse" />
                  <h2 className="text-base font-black text-neutral-900">{t.shareBtn}</h2>
                </div>
                <button
                  onClick={() => {
                    setIsShareOpen(false);
                    playBeep();
                  }}
                  className="bg-soft-trip hover:bg-line-trip/40 p-1.5 rounded-full transition-all cursor-pointer text-neutral-600 hover:text-neutral-900 flex items-center justify-center"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex flex-col items-center text-center space-y-3">
                <div className="bg-white p-3.5 rounded-2xl border border-line-trip/80 inline-flex items-center justify-center shadow-xs">
                  <img
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(
                      shareUrl
                    )}&color=241815&bgcolor=ffffff`}
                    alt="TastyTrip Share QR Code"
                    className="w-40 h-40 rounded-lg object-contain bg-white"
                    referrerPolicy="no-referrer"
                  />
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-black text-neutral-900">{t.qrTitle}</p>
                  <p className="text-[11px] text-neutral-600 leading-normal font-medium px-2">{t.qrSub}</p>
                </div>
              </div>

              <div className="space-y-2">
                <div className="bg-white border border-line-trip rounded-xl p-2.5 flex items-center justify-between gap-2 shadow-inner">
                  <span className="text-[10px] font-mono text-neutral-600 truncate flex-1 select-all">{shareUrl}</span>
                  <button
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(shareUrl);
                        setCopied(true);
                        playBeep();
                        setTimeout(() => setCopied(false), 2000);
                      } catch (err) {
                        console.error('Failed to copy text', err);
                      }
                    }}
                    className={`shrink-0 text-[10px] font-black px-2.5 py-1.5 rounded-lg transition-all cursor-pointer ${
                      copied ? 'bg-emerald-600 text-white' : 'bg-primary hover:bg-primary2 text-white'
                    }`}
                  >
                    {copied ? '✓' : t.copyLinkBtn}
                  </button>
                </div>

                {copied && (
                  <motion.p
                    initial={{ opacity: 0, y: -5 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-[10px] font-bold text-emerald-600 text-center"
                  >
                    {t.copiedMsg}
                  </motion.p>
                )}
              </div>

              <button
                onClick={() => {
                  setIsShareOpen(false);
                  playBeep();
                }}
                className="w-full bg-neutral-200 hover:bg-neutral-300 text-neutral-700 font-bold py-3 rounded-xl text-xs transition-colors cursor-pointer"
              >
                {t.closeBtn}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  );
}
