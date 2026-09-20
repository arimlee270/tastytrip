import { GoogleGenAI } from '@google/genai';
import { env } from '../env';
import type { Member, ReferenceBundle } from '../../types';

/**
 * 기존 /api/analyze-menu 의 Gemini 호출 로직을 서비스로 분리하고(계획서 Phase 1),
 * 공개 데이터를 근거로 넣는 RAG 형 구조와 칼로리/알레르기/식단 필드를 추가했다(계획서 8장).
 */

let aiClient: GoogleGenAI | null = null;

export const getGeminiClient = (): GoogleGenAI => {
  if (!aiClient) {
    if (!env.geminiApiKey) {
      throw new Error(
        'GEMINI_API_KEY is not configured. Please add your Gemini API Key in the Settings > Secrets panel of Google AI Studio.'
      );
    }
    aiClient = new GoogleGenAI({
      apiKey: env.geminiApiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    });
  }
  return aiClient;
};

export const LANG_NAMES: Record<string, string> = {
  ko: 'Korean (한국어)',
  en: 'English',
  ja: 'Japanese (日本語)',
  zh: 'Simplified Chinese (简体中文)',
  fr: 'French (Français)',
  th: 'Thai (ไทย)',
  bn: 'Bengali (বাংলা)',
};

const buildSystemInstruction = (targetLangName: string, imageMode: boolean): string => `You are TastyTrip Core, an advanced global travel culinary assistant and food safety analyzer.
Your goal is to parse food menu photos, text lists, or default local recommendations, identify ALL readable dishes (do not limit to 2 or 3; extract every single dish that can be parsed from the menu board so the traveler gets a complete view of the options), and evaluate their safety against a travel party's diet constraints, allergies, and custom requests.
${
  imageMode
    ? `
[사진 모드 — 가장 중요한 규칙 / IMAGE MODE — HIGHEST PRIORITY]
An image was provided. The answer exists ONLY inside that image.
1. Return exactly the dishes printed in the image. Do not add, infer, or suggest any other dish.
2. NEVER fall back to "default local recommendations". Do not use the travel country to guess what a
   restaurant might serve. A traveler who sees a dish that is not on the menu may order something
   that was never checked for their allergies.
3. If the image is blurry, empty, or not a menu, return an EMPTY dishes array. Returning nothing is
   correct; inventing plausible dishes is a serious error.
4. Do not merge two menu lines into one, and do not split one line into several.
`
    : ''
}

For each identified dish, cross-reference its common ingredients with the dietary constraints of all members in the travel party:
- Mark as "red" (주의/Danger) if a dish contains ingredients that trigger a member's allergies, religious restrictions, or diet exclusions.
- Mark as "yellow" (확인/Check) if there is a cross-contamination risk, if ingredients are frequently optional/unclear, or if it has custom requests.
- Mark as "green" (안전/Safe) if the dish is totally safe based on the profiles provided.

Format your responses strictly in ${targetLangName} for user convenience, except original names which must remain in their original script. Provide accurate taste analogies tailored to home country or language cultures, customized order guidelines, localized phonetics/pronunciations for dining requests, and realistic reviews. All descriptive text fields, warnings, badges, pairings, customized order text, etiquette tips, and reviews MUST be written entirely in ${targetLangName}.

[근거 데이터 사용 규칙 / EVIDENCE RULES]
1. "reference_data" 가 제공되면 그것을 사실 근거로 우선 사용하십시오. 공개 영양·원재료·알레르기 데이터와 충돌하는 추측을 하지 마십시오.
2. 근거 데이터에 없는 내용을 단정적으로 서술하지 마십시오. 불확실하면 "uncertain" 또는 가능성 표현을 사용하십시오.
3. 알레르기와 종교 식단 정보는 확정적으로 표현하지 말고 위험 수준(level)과 확인 안내 문구를 함께 제공하십시오.
4. 칼로리는 단일 값이 아니라 반드시 최소/최대 범위와 기준(1인분 중량 등)을 함께 제시하십시오.
5. "standard_food_name" 에는 국제적으로 통용되는 영문 표준 음식명을 넣으십시오 (예: "Shrimp Pad Thai").

[음식 이름 표기 규칙 / DISH NAMING]
1. "name" 은 번역문이 아니라 **${targetLangName} 사용자가 실제로 그 음식을 부르는 이름**입니다.
   이미 그 나라에 들어와 통용되는 이름이 있으면 직역하지 말고 그 이름을 쓰십시오.
   예) サイコロステーキ → "사이코로 스테이크" (O) / "주사위 스테이크" (X)
       刺身盛り合わせ → "모둠 사시미" (O) / "생선회 모음" (X)
       ぎょうざ → "교자" 또는 "군만두" (O)
2. 통용되는 이름이 없을 때만 뜻이 통하도록 옮기되, 설명문이 아니라 이름처럼 짧게 쓰십시오.
   길게 풀어쓴 설명은 "description" 에 넣고 "name" 에는 넣지 마십시오.
3. 음식 이름을 지어내지 마십시오. 확신이 없으면 원문 발음을 그대로 옮겨 적으십시오.
6. "typical_ingredients" 는 일반적인 레시피 기준의 대표 재료이며, 특정 식당의 실제 재료와 다를 수 있음을 전제로 작성하십시오.

[음식 이미지 검색 규칙 - 최우선 / CRITICAL FOOD IMAGE RULES]
1. 각 메뉴에 적합한 3가지 종류의 영문 이미지 검색 쿼리 후보('primary_query', 'secondary_query', 'fallback_query')를 생성하여 Pexels 검색의 정확도와 복원력을 극대화하십시오.
2. 검색어는 단순 번역이나 직역이 아니라, 실제 이미지 검색에 가장 최적화된 형태여야 합니다. 모든 메뉴에 다음 '검색어 생성 프로세스'를 일관되게 적용하십시오:
   - 메뉴 분석 -> 국가 및 요리(Cuisine) 추론 -> 음식 카테고리(Food type) 및 조리 방식(Cooking style) 추론 -> 대표 재료(Key ingredient) 및 플레이팅/그릇 형태(Plating/Bowl/Serving style) 추론 -> 이미지 검색 최적화 영문 키워드 조합 생성.
3. 세 가지 쿼리는 다음과 같이 단계별로 구성하며, 각 쿼리는 4~8개의 자연스럽고 구체적인 영어 단어 조합으로 작성되어야 합니다:
   - 'primary_query': 요리의 정체성이 가장 잘 드러나며, 조리 방식, 대표 재료, 플레이팅 형태, 음식 종류가 모두 포함된 가장 구체적이고 이상적인 완성형 푸드 포토그래피용 검색어. (예: "cuisine-name cooking-style key-ingredient plate/bowl style food-type photography")
   - 'secondary_query': primary_query보다 조금 더 보편적이고 대표적인 요리 형태를 타겟으로 하여, 플레이팅 조건을 유연하게 완화하거나 대체 재료/스타일을 가미한 높은 품질의 대체 검색어.
   - 'fallback_query': 특정 요리 이름보다는 요리의 핵심 장르, 음식 카테고리 및 요리 형태 자체에 집중하여 어떤 상황에서도 관련성 높은 음식이 검색될 수 있도록 설계된 일반화된 백업용 영어 검색어.
4. 절대로 특정 예시를 하드코딩하지 마시고, 메뉴 분석을 통한 동적 생성 규칙을 완벽하게 준수하십시오.
5. Unsplash 이미지 URL을 제공할 때, 반드시 사실적이고 생생하며 대표적인 음식 이미지 URL(예: "https://images.unsplash.com/photo-...?w=500&q=80")을 가리키는 Unsplash URL을 선택하여 "imageUrl" 필드에 할당해 두십시오 (Pexels 실패 시 백업용으로 활용됨).`;

/** 계획서 8.3 출력 형식 — 기존 필드 + 추가 필드 */
const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    dishes: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: {
            type: 'STRING',
            description:
              'The name this dish is actually known by in the target language. ' +
              'If the dish is already familiar there under a borrowed or established name, use that name ' +
              'rather than translating the words literally. Only translate word-by-word when no established name exists.',
          },
          original: { type: 'STRING', description: 'Dish name in native language script of the travel country.' },
          standard_food_name: {
            type: 'STRING',
            description: 'Internationally used standard English name of the dish, e.g. "Shrimp Pad Thai".',
          },
          imageUrl: { type: 'STRING', description: 'A direct fallback high-quality Unsplash image URL matching the dish.' },
          primary_query: { type: 'STRING', description: 'Primary English search query. Must contain [cuisine/region/country] + [cooking style] + [key ingredient] + [plated/bowl/serving style] + [food-type] + photography, e.g. "japanese pan fried pork gyoza dumplings plate photography".' },
          secondary_query: { type: 'STRING', description: 'Secondary English search query, slightly broader/alternative ingredients or style.' },
          fallback_query: { type: 'STRING', description: 'Fallback English search query, focusing on the core general category of the dish to guarantee a relevant result.' },
          desc: { type: 'STRING', description: 'Brief explanation of the dish ingredients and preparation written in the target language.' },
          taste: { type: 'STRING', description: 'Metaphorical comparison or translation of taste to the home country or display language culture, written in the target language.' },
          status: { type: 'STRING', enum: ['green', 'yellow', 'red'], description: 'Overall safety rating: green (Safe), yellow (Check/Warning), red (Danger/Exclude).' },
          badge: { type: 'STRING', description: 'The safety badge label matching the status, translated into the target language.' },
          warning: { type: 'STRING', description: 'Detailed warning reasoning in the target language, specifying which member profile was triggered.' },
          pair: { type: 'STRING', description: 'Local beverage, tea, or side dish pairing advice written in the target language.' },
          order: { type: 'STRING', description: 'Specific culinary customization advice for ordering written in the target language.' },
          phrase: { type: 'STRING', description: 'Custom order request sentence in local script followed by phonetic pronunciation and translation in the target language.' },
          etiquette: { type: 'STRING', description: 'Traditional localized table manner or cultural etiquette when consuming this dish, written in the target language.' },
          typical_ingredients: {
            type: 'ARRAY',
            items: { type: 'STRING' },
            description: 'Typical ingredients of the dish written in the target language. Base this on reference_data when provided.',
          },
          allergen_risk: {
            type: 'OBJECT',
            properties: {
              level: { type: 'STRING', enum: ['low', 'medium', 'high'] },
              items: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Allergen names in the target language.' },
              message: { type: 'STRING', description: 'Guidance for the traveler in the target language. Never state allergen presence as certain.' },
            },
            required: ['level', 'items', 'message'],
          },
          dietary: {
            type: 'OBJECT',
            properties: {
              vegan: { type: 'STRING', enum: ['suitable', 'not_suitable', 'uncertain'] },
              halal: { type: 'STRING', enum: ['suitable', 'not_suitable', 'uncertain'] },
            },
            required: ['vegan', 'halal'],
          },
          estimated_calories: {
            type: 'OBJECT',
            properties: {
              min: { type: 'NUMBER' },
              max: { type: 'NUMBER' },
              basis: { type: 'STRING', description: 'Basis of the estimate, e.g. typical single serving 300-420g, written in the target language.' },
              confidence: { type: 'NUMBER', description: '0.0 - 1.0' },
            },
            required: ['min', 'max', 'basis', 'confidence'],
          },
          source_summary: {
            type: 'ARRAY',
            items: { type: 'STRING' },
            description: 'Where the information came from, e.g. public nutrition data, general recipe, AI estimate.',
          },
          verification_message: {
            type: 'STRING',
            description: 'Reminder that actual ingredients differ per restaurant, written in the target language.',
          },
          reviews: {
            type: 'ARRAY',
            items: {
              type: 'ARRAY',
              items: { type: 'STRING' },
              description: 'Array containing [Author, reviewText] written in the target language. Author format: "Name · Nationality".',
            },
            description: '2-3 localized reviews or helpful tourist hints written in the target language.',
          },
        },
        required: [
          'name', 'original', 'imageUrl', 'primary_query', 'secondary_query', 'fallback_query',
          'desc', 'taste', 'status', 'badge', 'warning', 'pair', 'order', 'phrase', 'etiquette', 'reviews',
          'standard_food_name', 'typical_ingredients', 'allergen_risk', 'dietary', 'estimated_calories',
          'source_summary', 'verification_message',
        ],
      },
    },
  },
  required: ['dishes'],
};

export interface AnalyzeRequest {
  image?: string | null;
  menuText?: string | null;
  homeCountry?: string;
  travelCountry?: string;
  party: Member[];
  targetLanguage: string;
  /** 특정 식당 컨텍스트 (계획서 5.2) */
  restaurantName?: string;
  /** 공개 데이터 근거 (계획서 8.2). 메뉴명 -> 근거 */
  referenceData?: Record<string, ReferenceBundle>;
  /** 이미 등록된 메뉴명 목록 — 신규 메뉴만 분석하고 싶을 때 (계획서 5.3) */
  knownMenuNames?: string[];
}

/** 어떤 모델로 응답했는지 — 품질 문제가 생겼을 때 원인을 판별하기 위해 남긴다. */
export let lastUsedModel = '';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isOverloaded = (msg: string): boolean =>
  msg.includes('503') || msg.includes('UNAVAILABLE') || msg.toLowerCase().includes('high demand');

const isQuotaExceeded = (msg: string): boolean =>
  msg.includes('429') || msg.toLowerCase().includes('quota') || msg.includes('RESOURCE_EXHAUSTED');

/**
 * 모델 호출.
 *  - 503(구글 서버 과부하)은 일시적이므로 잠시 뒤 다시 시도한다.
 *  - 429(할당량 초과)일 때만 더 가벼운 모델로 내려간다.
 *    이 경우 번역 품질이 떨어질 수 있으므로 어떤 모델을 썼는지 기록해 둔다.
 */
const generate = async (contents: any[], config: any) => {
  const client = getGeminiClient();
  const maxRetries = 3;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[Gemini API] '${env.geminiModel}' 호출 (시도 ${attempt}/${maxRetries})`);
      const result = await client.models.generateContent({ model: env.geminiModel, contents, config });
      lastUsedModel = env.geminiModel;
      return result;
    } catch (error: any) {
      const msg = String(error?.message || error || '');

      if (isOverloaded(msg) && attempt < maxRetries) {
        const waitMs = attempt * 3000;
        console.warn(`[Gemini API] 서버 과부하(503). ${waitMs / 1000}초 후 재시도합니다.`);
        await sleep(waitMs);
        continue;
      }

      if (isQuotaExceeded(msg)) {
        console.log(`[Gemini API] 할당량 초과. 더 가벼운 '${env.geminiFallbackModel}' 로 전환합니다.`);
        const result = await client.models.generateContent({
          model: env.geminiFallbackModel,
          contents,
          config,
        });
        lastUsedModel = env.geminiFallbackModel;
        console.warn('[Gemini API] 폴백 모델로 응답했습니다. 번역 품질이 평소보다 낮을 수 있습니다.');
        return result;
      }

      console.error(`[Gemini API] 호출 실패:`, msg.slice(0, 200));
      throw error;
    }
  }

  throw new Error('Gemini 서버가 계속 응답하지 않습니다. 잠시 후 다시 시도해주세요.');
};

export const analyzeMenu = async (req: AnalyzeRequest): Promise<{ dishes: any[] }> => {
  const targetLangName = LANG_NAMES[req.targetLanguage] || LANG_NAMES.ko;

  let userPrompt = `
Home Country: ${req.homeCountry || '한국'}
Travel Target Country: ${req.travelCountry || '태국'}
Target Display Language: ${targetLangName}
${req.restaurantName ? `Restaurant: ${req.restaurantName}` : ''}

Travel Party Profiles:
${JSON.stringify(req.party, null, 2)}

Instructions:
1. If an image is provided, extract ALL readable menu dishes visible in the image. Do not limit to 2-3 items; we want a complete list of all dishes on the menu board.
2. If text is provided in menuText, use it to analyze all of the named dishes.
3. If neither an image nor text is provided, dynamically recommend 5 highly popular traditional local dishes from the travel country (${req.travelCountry}) to act as a localized preview list.
4. For each dish, fill the required JSON schema fields including three-tier English Pexels search queries (primary_query, secondary_query, fallback_query) and a high-quality fallback Unsplash image URL (imageUrl).
5. Use the reference_data below as factual grounding when it is provided. Do not contradict it.
`;

  if (req.knownMenuNames && req.knownMenuNames.length > 0) {
    userPrompt += `\nAlready registered menu items for this restaurant (analyze them too but keep the same original names): ${JSON.stringify(
      req.knownMenuNames
    )}\n`;
  }

  if (req.referenceData && Object.keys(req.referenceData).length > 0) {
    userPrompt += `\nreference_data (public food/nutrition/allergen data to use as grounding):\n${JSON.stringify(
      req.referenceData,
      null,
      2
    )}\n`;
  }

  if (req.menuText && req.menuText.trim()) {
    userPrompt += `\nAdditional manual menu text query input: "${req.menuText.trim()}"`;
  }

  const contents: any[] = [];
  if (req.image && typeof req.image === 'string' && req.image.startsWith('data:image')) {
    const commaIndex = req.image.indexOf(',');
    if (commaIndex !== -1) {
      contents.push({
        inlineData: {
          data: req.image.substring(commaIndex + 1),
          mimeType: req.image.substring(5, req.image.indexOf(';')),
        },
      });
    }
  }
  const hasImage = contents.length > 0;
  contents.push(userPrompt);

  const response = await generate(contents, {
    // 사진이 있으면 '현지 추천' 으로 빠지지 않도록 더 엄격한 지시를 준다.
    systemInstruction: buildSystemInstruction(targetLangName, hasImage),
    temperature: 0.2,
    responseMimeType: 'application/json',
    responseSchema: RESPONSE_SCHEMA,
  });

  const text = response.text;
  if (!text) throw new Error('Received an empty response from Gemini.');

  return JSON.parse(text.trim());
};

/**
 * 사진에서 메뉴 이름만 읽어 온다.
 *
 * 전체 분석과 달리 재료·알레르기·칼로리를 묻지 않으므로 응답이 짧고 빠르다.
 * 이름을 먼저 알아내면, 이미 분석해 둔 음식은 AI 를 다시 부르지 않고
 * 저장된 결과를 쓸 수 있다. (계획서 12.1 DB 우선 조회)
 */
export const extractMenuNames = async (image: string): Promise<string[]> => {
  if (!image || !image.startsWith('data:image')) return [];

  const commaIndex = image.indexOf(',');
  if (commaIndex === -1) return [];

  const contents: any[] = [
    {
      inlineData: {
        data: image.substring(commaIndex + 1),
        mimeType: image.substring(5, image.indexOf(';')),
      },
    },
    'Read this menu photo and list EVERY menu item name exactly as written, in the original language. ' +
      'Go through the image section by section, top to bottom, left to right, including any side columns, ' +
      'boxed specials, and items near the edges. Do not skip or merge items, and do not stop early. ' +
      'Only dish names — no prices, no descriptions, no category headings, no commentary.',
  ];

  const response = await generate(contents, {
    /*
     * 이 단계는 '읽는' 일만 한다. 아는 것을 말하는 자리가 아니다.
     *
     * 예전 지시문은 "메뉴판을 전부 옮겨 적어라" 였는데, 글자가 없는 사진을 주자
     * 인도 음식 20개를 '읽었다'고 돌려줬다. 사진을 보고 업종을 짐작해 그럴듯한
     * 메뉴를 만들어 낸 것이다. 그래서 읽을 수 없을 때 어떻게 해야 하는지를
     * 먼저, 분명하게 적는다.
     */
    systemInstruction:
      'You are an OCR transcriber. You copy characters that are physically visible in the image. ' +
      'You do not know anything about restaurants, cuisines, or what a menu usually contains.\n\n' +
      'RULES (in order of priority):\n' +
      '1. If you cannot clearly read printed text in the image, return an empty list. ' +
      'An empty list is the correct answer for a blank, blurry, dark, or non-menu image.\n' +
      '2. Never output a dish name unless you can point to the exact characters in the image. ' +
      'Do not guess from the restaurant type, the country, the photo style, or your own knowledge.\n' +
      '3. Copy the characters exactly as printed, in the original script and order.\n' +
      '4. Returning fewer items than are on the menu is acceptable. ' +
      'Returning an item that is not printed there is a serious error.',
    temperature: 0,
    responseMimeType: 'application/json',
    responseSchema: {
      type: 'OBJECT',
      properties: {
        /** 글자를 실제로 읽었는지. 읽지 못했으면 names 는 비어 있어야 한다. */
        readable: {
          type: 'BOOLEAN',
          description:
            'true only if printed text was actually legible in the image. ' +
            'false for blank, blurry, dark, or non-menu images.',
        },
        names: { type: 'ARRAY', items: { type: 'STRING' } },
      },
      required: ['readable', 'names'],
    },
  });

  const text = response.text;
  if (!text) return [];
  try {
    const parsed = JSON.parse(text.trim());
    // 스스로 '읽지 못했다'고 답하면 이름이 딸려 와도 버린다.
    if (parsed?.readable === false) {
      console.warn('[gemini] 사진에서 글자를 읽지 못했다고 응답했습니다.');
      return [];
    }
    return Array.isArray(parsed?.names)
      ? parsed.names.map((n: unknown) => String(n).trim()).filter(Boolean).slice(0, 20)
      : [];
  } catch {
    return [];
  }
};

/** 할당량 초과 오류를 사용자 안내 문구로 변환 (기존 동작 유지) */
export const friendlyGeminiError = (error: any): string => {
  const errorMsg = error?.message || 'An unexpected error occurred during food safety analysis.';
  const errStr = String(errorMsg);
  if (errStr.includes('429') || errStr.toLowerCase().includes('quota') || errStr.includes('RESOURCE_EXHAUSTED')) {
    return "⚠️ [Gemini API Quota Exceeded] Google AI Studio Gemini Free-tier daily limit (20 requests) has been reached. To continue scanning menus, please configure your own Gemini API Key in the Settings (Secrets panel) on the bottom-left of Google AI Studio, or try again later!\n\n(구글 AI 스튜디오의 Gemini 무료 티어 일일 제한(20회)을 초과했습니다. 계속 사용하시려면 좌측 하단의 Settings > Secrets 메뉴에서 본인의 Gemini API Key를 등록하시거나 잠시 후 다시 시도해주세요!)";
  }
  if (errStr.includes('503') || errStr.includes('UNAVAILABLE') || errStr.toLowerCase().includes('high demand')) {
    return '지금 Gemini 서버가 붐벼서 분석에 실패했습니다. 잠시 후 다시 시도해주세요. (사용량 초과가 아니라 구글 서버 상태 문제입니다)';
  }
  return errorMsg;
};
