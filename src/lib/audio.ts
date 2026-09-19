/** 기존 App.tsx 의 사운드 / TTS 헬퍼 (Phase 1: 코드 정리) */

/**
 * 버튼 효과음.
 *
 * 누를 때마다 소리가 나는 게 거슬려서 쓰지 않기로 했다.
 * 호출하는 곳이 화면 곳곳에 있어 함수는 남겨 두고 아무 일도 하지 않게 한다.
 * (발음 읽어주기는 사용자가 직접 누르는 기능이라 그대로 둔다.)
 */
export const playBeep = (): void => {
  /* 효과음 사용 안 함 */
};

export const speakPhrase = (phrase: string, country: string): void => {
  if (!window.speechSynthesis) return;

  let speechText = phrase;
  if (phrase.includes(':')) {
    speechText = phrase.split(':')[1] || phrase;
  }
  speechText = speechText.replace(/\([^)]*\)/g, '').trim();

  const utterance = new SpeechSynthesisUtterance(speechText);
  const voices = window.speechSynthesis.getVoices();
  if (country === '태국') {
    const thVoice = voices.find((v) => v.lang.startsWith('th'));
    if (thVoice) utterance.voice = thVoice;
  } else if (country === '일본') {
    const jaVoice = voices.find((v) => v.lang.startsWith('ja'));
    if (jaVoice) utterance.voice = jaVoice;
  } else if (country === '베트남') {
    const viVoice = voices.find((v) => v.lang.startsWith('vi'));
    if (viVoice) utterance.voice = viVoice;
  } else {
    const enVoice = voices.find((v) => v.lang.startsWith('en'));
    if (enVoice) utterance.voice = enVoice;
  }

  utterance.rate = 0.85;
  window.speechSynthesis.speak(utterance);
};
