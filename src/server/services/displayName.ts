/**
 * 가게 이름에서 표시 언어로 읽을 수 있는 부분만 골라낸다.
 *
 * 구글 Places 는 languageCode 를 무엇으로 보내도 가게 주인이 등록한 이름을
 * 그대로 돌려준다. 그래서 'โตซาลาเปา Chinese Steamed Buns 包子' 처럼 한 이름에
 * 세 가지 언어가 함께 들어있거나, 검색에 걸리려고 여러 언어를 이어 붙인
 * 이름이 그대로 내려온다. 이런 이름은 우리가 잘라내야 한다.
 *
 * 규칙은 하나다 — **사용자가 읽을 수 없는 문자 체계가 섞여 있을 때만 손댄다.**
 * 읽을 수 있는 문자(표시 언어 + 라틴 문자)로만 된 이름은 그대로 둔다.
 * 그래서 'FLIPPER'S 시부야'(브랜드 + 지점명)나 '맥도날드 전주인후DT점' 은
 * 건드리지 않고, 'Sae Phun ข้าวหน้าไก่แซ่พุ้น' 은 'Sae Phun' 으로 줄인다.
 *
 * 잘라낼 때는 표시 언어의 문자를 먼저 찾고, 없으면 라틴 문자를 쓴다.
 * 둘 다 없으면(태국어만 있는 이름 등) 원래 이름을 그대로 둔다.
 */

type Script = 'hangul' | 'kana' | 'han' | 'thai' | 'latin' | 'cyrillic' | 'arabic' | 'bengali' | 'devanagari';

/** 낱말이 어떤 문자 체계인지 세기 위한 목록. 라틴 문자는 마지막에 본다. */
const SCRIPT_RANGES: { script: Script; pattern: string }[] = [
  { script: 'hangul', pattern: '[가-힣]' },
  { script: 'kana', pattern: '[぀-ゟ゠-ヿ]' },
  { script: 'han', pattern: '[一-鿿㐀-䶿豈-﫿]' },
  { script: 'thai', pattern: '[฀-๿]' },
  { script: 'cyrillic', pattern: '[Ѐ-ӿ]' },
  { script: 'arabic', pattern: '[؀-ۿ]' },
  { script: 'bengali', pattern: '[ঀ-৿]' },
  { script: 'devanagari', pattern: '[ऀ-ॿ]' },
];

const LATIN = '[A-Za-zÀ-ɏ]';

/** 표시 언어로 읽을 수 있는 문자 체계. 앞에 있는 것을 먼저 골라 쓴다. */
const PREFERRED: Record<string, Script[]> = {
  ko: ['hangul'],
  ja: ['han', 'kana'],
  zh: ['han'],
  th: ['thai'],
  bn: ['bengali'],
  en: ['latin'],
  fr: ['latin'],
};

/**
 * 이름을 나누는 기준.
 * 공백뿐 아니라 괄호와 구분 기호도 경계로 삼는다. 그러지 않으면
 * '명동점(Daol Charcoal...' 처럼 괄호가 붙은 낱말이 통째로 한 덩어리가 되어
 * '명동점(Daol' 같은 깨진 결과가 나온다.
 * 'ㅣ'(홀로 쓰인 한글 자모)는 세로줄 대신 쓰인 것이므로 구분 기호로 본다.
 */
const HARD_SEPARATORS = /[()[\]{}|｜／/\\·・ㅣ]+/;

const countOf = (text: string, pattern: string): number => (text.match(new RegExp(pattern, 'g')) || []).length;

/**
 * 한 낱말이 어떤 문자 체계인지 판단한다.
 * 라틴 문자는 'DT점', '팀(TEAM)' 처럼 현지 이름 속에 약어로 섞여 들어오는 일이
 * 잦으므로, 라틴이 아닌 문자가 하나라도 있으면 그쪽을 낱말의 문자 체계로 본다.
 */
const scriptOfWord = (word: string): Script | null => {
  let best: { script: Script; count: number } | null = null;
  for (const { script, pattern } of SCRIPT_RANGES) {
    const count = countOf(word, pattern);
    if (count > 0 && (!best || count > best.count)) best = { script, count };
  }
  if (best) return best.script;
  return countOf(word, LATIN) > 0 ? 'latin' : null;
};

/** 앞뒤의 구두점과 공백을 떼어낸다. */
const trimEdges = (text: string): string =>
  text.replace(/^[\s\-–—,:;.'"«»&]+/, '').replace(/[\s\-–—,:;'"«»&]+$/, '').trim();

/**
 * 이름에서 표시 언어로 읽을 수 있는 부분만 돌려준다.
 * 고를 것이 없으면 원래 이름을 그대로 돌려준다.
 */
export const pickDisplayName = (name: string, langCode?: string | null): string => {
  if (!name) return name;

  // 낱말을 문자 체계별로 이어 붙여 덩어리를 만든다.
  // 구분 기호로 나뉜 조각은 같은 문자 체계라도 서로 다른 덩어리로 둔다.
  // 검색에 걸리려고 같은 뜻을 여러 번 적어 둔 이름을 하나로 합치지 않기 위함이다.
  const groups: { script: Script; words: string[] }[] = [];
  for (const segment of name.split(HARD_SEPARATORS)) {
    let atSegmentStart = true;
    for (const word of segment.split(/\s+/).filter(Boolean)) {
      const script = scriptOfWord(word);
      // 숫자나 기호뿐인 낱말('-', '&', '24')은 직전 덩어리에 붙인다.
      if (script === null) {
        if (groups.length > 0) groups[groups.length - 1].words.push(word);
        continue;
      }
      const last = groups[groups.length - 1];
      if (last && last.script === script && !atSegmentStart) last.words.push(word);
      else groups.push({ script, words: [word] });
      atSegmentStart = false;
    }
  }

  const preferred = PREFERRED[langCode || 'en'] || ['latin'];
  const readable = new Set<Script>([...preferred, 'latin']);

  // 읽을 수 있는 문자로만 된 이름은 손대지 않는다.
  // 'FLIPPER'S 시부야' 처럼 브랜드명과 지점명이 다른 문자로 적힌 경우가 많아,
  // 이런 이름을 쪼개면 오히려 정보가 사라진다.
  if (groups.every((g) => readable.has(g.script))) return name;

  /**
   * 해당 문자 체계로 된 덩어리 가운데 가장 긴 것을 쓴다.
   * 같은 문자의 덩어리를 모두 이어 붙이면 검색용으로 여러 번 적어 둔 이름
   * ('... star | ... Chicken | ...')이 통째로 남아 오히려 길어진다.
   */
  const textOf = (script: Script): string => {
    const parts = groups
      .filter((g) => g.script === script)
      .map((g) => trimEdges(g.words.join(' ')))
      // 구분 기호로 쓰인 한 글자('l' 등)가 남는 경우를 걸러낸다.
      .filter((part) => part.length > 1);
    return parts.sort((a, b) => b.length - a.length)[0] || '';
  };

  for (const script of [...preferred, 'latin' as Script]) {
    const picked = textOf(script);
    if (picked.length >= 2) return picked;
  }
  return name;
};
