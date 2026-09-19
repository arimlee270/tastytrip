import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Plane, Utensils } from 'lucide-react';

/**
 * 앱을 켤 때 잠깐 보이는 인트로 화면.
 *
 * 자바스크립트를 받아 화면을 그리기 전까지는 흰 화면이 보이는데, 사용자는 그걸
 * 고장이나 느림으로 받아들인다. 그 사이를 로고로 채워 기다림이 불안하지 않게 한다.
 *
 * 정해진 시간을 억지로 채우지 않는다. 준비가 끝나면 바로 사라진다.
 * 흔히 하듯 '무조건 3초'로 만들면, 0.5초 만에 준비된 날에도 2.5초를 붙잡아
 * 앱을 오히려 느리게 만든다.
 */

interface IntroScreenProps {
  /** 인트로가 끝났을 때 호출된다. */
  onDone: () => void;
}

/** 너무 빨리 깜빡이고 사라지면 오히려 어수선하므로 이만큼은 보여준다. */
const MIN_MS = 1500;
/** 무언가 잘못돼도 이 시간을 넘겨 붙잡아 두지 않는다. */
const MAX_MS = 3200;

export const IntroScreen: React.FC<IntroScreenProps> = ({ onDone }) => {
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const startedAt = Date.now();
    let closed = false;

    const close = () => {
      if (closed) return;
      closed = true;
      // 사라지는 동작이 끝난 뒤에 화면을 넘긴다.
      setLeaving(true);
      window.setTimeout(onDone, 420);
    };

    /** 화면을 그릴 준비가 끝났으면 최소 노출 시간만 채우고 닫는다. */
    const closeWhenReady = () => {
      const waited = Date.now() - startedAt;
      window.setTimeout(close, Math.max(0, MIN_MS - waited));
    };

    if (document.readyState === 'complete') {
      closeWhenReady();
    } else {
      window.addEventListener('load', closeWhenReady, { once: true });
    }

    const failsafe = window.setTimeout(close, MAX_MS);
    return () => {
      window.clearTimeout(failsafe);
      window.removeEventListener('load', closeWhenReady);
    };
  }, [onDone]);

  return (
    <motion.div
      initial={{ opacity: 1 }}
      animate={{ opacity: leaving ? 0 : 1 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-gradient-to-b from-[#fff6ef] via-[#fff1e6] to-[#ffe6d8]"
    >
      {/* 가운데 — 앱 아이콘과 이름 */}
      <div className="flex-1 flex flex-col items-center justify-center gap-6 px-8">
        <motion.div
          initial={{ opacity: 0, scale: 0.86, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="relative"
        >
          {/* 아이콘 뒤에 깔리는 은은한 빛 */}
          <div className="absolute inset-0 -m-6 rounded-[38px] bg-primary/25 blur-2xl" aria-hidden="true" />

          <div className="relative w-[92px] h-[92px] rounded-[26px] bg-gradient-to-br from-primary to-primary2 shadow-xl shadow-primary/30 flex items-center justify-center">
            <Utensils className="w-11 h-11 text-white" strokeWidth={2.2} />
          </div>

          {/* 여행을 뜻하는 비행기 배지 */}
          <div className="absolute -top-2 -right-2 w-9 h-9 rounded-full bg-white shadow-md flex items-center justify-center">
            <Plane className="w-4 h-4 text-primary" strokeWidth={2.6} />
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.12, ease: 'easeOut' }}
          className="text-center space-y-2"
        >
          <h1 className="logo text-[40px] leading-none font-black tracking-tight text-ink">
            Tasty<span className="text-primary">Trip</span>
          </h1>
          <p className="text-[13px] font-bold text-neutral-500">안심하고 즐기는 전 세계 미식 여행</p>
        </motion.div>
      </div>

      {/* 아래 — 준비 중 표시 */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4, delay: 0.2 }}
        className="w-full px-12 pb-14"
      >
        {/*
         * 진행률 숫자는 쓰지 않는다. 실제 진행 상황을 알 수 없는데 숫자를 올리면
         * 지어낸 값이 되고, 100%에서 멈춰 있는 순간이 생겨 더 답답해 보인다.
         * 대신 좌우로 흐르는 막대로 '준비 중'이라는 것만 전한다.
         */}
        <div className="h-[3px] w-full rounded-full bg-primary/15 overflow-hidden">
          <motion.div
            initial={{ x: '-60%' }}
            animate={{ x: '160%' }}
            transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut' }}
            className="h-full w-[45%] rounded-full bg-gradient-to-r from-primary/50 via-primary to-primary/50"
          />
        </div>
      </motion.div>
    </motion.div>
  );
};
