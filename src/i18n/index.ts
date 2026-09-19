import { baseTranslations } from './base';
import { additionTranslations } from './additions';

export type LangCode = 'ko' | 'en' | 'ja' | 'zh' | 'fr' | 'th' | 'bn';

export const SUPPORTED_LANGS: LangCode[] = ['ko', 'en', 'ja', 'zh', 'fr', 'th', 'bn'];

/** 표시 언어 라벨(한국어 / English / ...)을 코드로 변환. 기존 App.tsx 로직과 동일. */
export const getLangCode = (lang: string): LangCode => {
  if (lang === '영어' || lang === 'English' || lang === 'en') return 'en';
  if (lang === '일본어' || lang === '日本語' || lang === 'ja') return 'ja';
  if (lang === '중국어' || lang === '简体中文' || lang === 'zh') return 'zh';
  if (lang === '불어' || lang === 'Français' || lang === 'fr') return 'fr';
  if (lang === '태국어' || lang === 'ไทย' || lang === 'th') return 'th';
  if (lang === '방글라어' || lang === 'বাংলা' || lang === 'Bengali' || lang === 'bn') return 'bn';
  return 'ko';
};

/**
 * 언어별 문자열 사전.
 * 기존 문자열(baseTranslations)에 신규 화면 문자열(additionTranslations)을 병합한다.
 * 신규 문자열은 ko/en 만 완역되어 있으므로 나머지 언어는 en 으로 폴백한다.
 */
export const getTranslations = (code: LangCode): Record<string, any> => {
  const base = baseTranslations[code] || baseTranslations.ko;
  const extra = additionTranslations[code] || additionTranslations.en;
  return { ...additionTranslations.en, ...extra, ...base };
};

/** "{n}개" 처럼 자리표시자가 있는 문자열 치환 헬퍼. */
export const format = (template: string, vars: Record<string, string | number>): string =>
  Object.keys(vars).reduce(
    (acc, key) => acc.replace(new RegExp(`\\{${key}\\}`, 'g'), String(vars[key])),
    template
  );

export { baseTranslations, additionTranslations };
