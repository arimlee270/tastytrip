/**
 * Utility to search for high-quality food images using Pexels API.
 * The Pexels API key lives on the server; this module calls /api/images/search.
 * Employs a three-tier search query fallback system (primary -> secondary -> fallback)
 * evaluating image quality with food-centric scoring to select the best plated meal.
 */

interface ScoredPhoto {
  photo: any;
  score: number;
  reasons: string[];
}

export interface PexelsSearchResult {
  imageUrl: string;
  activeQuery: string;
  isFallbackUrl: boolean;
}

/**
 * Searches Pexels with three-tier query fallbacks.
 * If the highest quality candidate in the primary query scores below the quality threshold,
 * it automatically falls back to secondary, then fallback, and finally to the Unsplash backup.
 */
export async function searchPexelsImageWithFallbacks(
  primary: string,
  secondary: string,
  fallback: string,
  fallbackUrl?: string
): Promise<PexelsSearchResult> {
  const defaultBackupUrl = fallbackUrl || "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=500&q=80";

  const queries = [
    { type: "primary", text: primary },
    { type: "secondary", text: secondary },
    { type: "fallback", text: fallback }
  ];

  let bestAcrossAll: { photo: any; score: number; queryText: string } | null = null;
  // qualityThreshold is set to 110 because we added massive boosts for high quality and exact match.
  // This allows us to keep searching secondary and fallback queries if the primary query candidate 
  // is just a generic image and we hope to find a perfect match.
  const qualityThreshold = 110;

  for (const q of queries) {
    if (!q.text || q.text.trim() === "") continue;

    console.log(`[Pexels Search] Attempting [${q.type}] query: "${q.text}"`);
    try {
      // Pexels 를 직접 부르지 않고 서버를 거친다.
      // 브라우저에 키를 두면 빌드 결과물에 그대로 노출되기 때문이다.
      const url = `/api/images/search?query=${encodeURIComponent(q.text)}`;
      const response = await fetch(url);

      if (!response.ok) {
        console.warn(`[Pexels API] Query "${q.text}" failed with status ${response.status}`);
        continue;
      }

      const data = await response.json();
      if (data.photos && data.photos.length > 0) {
        const scoredCandidates: ScoredPhoto[] = data.photos.map((photo: any) => {
          const altText = (photo.alt || "").toLowerCase();
          const photoUrl = (photo.url || "").toLowerCase();
          
          // Extract the URL slug to catch highly descriptive words
          const pexelsSlug = photoUrl.split("/photo/")[1] || "";
          const slugWords = pexelsSlug.replace(/-\d+\/?$/, "").replace(/-/g, " ").toLowerCase();
          
          const textToAnalyze = `${altText} ${slugWords}`;

          let score = 100; // Base score
          let reasons: string[] = [];

          // --- 1. STRICT EXCLUSION FILTERS (Severe penalties to exclude non-food/raw assets/people) ---

          // Raw/unprepared ingredients, grocery, prep scenes
          const rawPrepTerms = [
            "raw", "uncooked", "ingredients on", "chopping board", "cutting board", 
            "kitchen counter", "prep", "preparing", "preparation", "grocery", "groceries", 
            "market stall", "crate", "basket", "harvest", "peeling", "chopped vegetables",
            "raw meat", "raw fish", "uncooked noodle", "uncooked pasta", "grain", "seeds"
          ];
          for (const term of rawPrepTerms) {
            if (textToAnalyze.includes(term)) {
              score -= 150;
              reasons.push(`raw/prep:${term}`);
            }
          }

          // Knives, chopping boards, prep tools
          const utensilTerms = [
            "knife", "knives", "cleaver", "grater", "peeler", "chopping", 
            "slicing", "dicing", "cutting board", "chopping board", "wooden board"
          ];
          for (const term of utensilTerms) {
            if (textToAnalyze.includes(term)) {
              score -= 150;
              reasons.push(`utensil:${term}`);
            }
          }

          // People, faces, portrait shots, dining crowds (Heavily penalized to keep focus purely on food)
          const peopleTerms = [
            "portrait", "person", "man", "woman", "guy", "girl", "child", "baby", "kid", 
            "people", "waiter", "chef", "posing", "model", "wearing", "talking", 
            "smiling", "face", "spectators", "crowd", "standing next to", "friend", "friends",
            "family", "customer", "customers", "guests", "patron", "patrons", "staff", "human"
          ];
          for (const term of peopleTerms) {
            if (textToAnalyze.includes(term)) {
              score -= 300;
              reasons.push(`person:${term}`);
            }
          }

          // Hands holding dishes is severely discouraged to meet the requirement: "사람, 손, 테이블 배경 비중이 낮은지"
          const handTerms = ["holding", "hand", "hands", "finger", "fingers", "eating with", "holding chopsticks", "fork in hand"];
          for (const term of handTerms) {
            if (textToAnalyze.includes(term)) {
              score -= 150;
              reasons.push(`hand:${term}`);
            }
          }

          // Restaurant interiors and furnishings (Avoid ambient wide shots)
          const interiorTerms = [
            "interior", "decor", "seating", "table setting", "empty table", "chairs", 
            "furniture", "room", "restaurant decoration", "entrance", "storefront", 
            "building", "facade", "bar counter", "cafe seating", "kitchen sink", 
            "stove", "oven", "refrigerator", "dining table", "restaurant table", "table set"
          ];
          for (const term of interiorTerms) {
            if (textToAnalyze.includes(term)) {
              score -= 150;
              reasons.push(`interior:${term}`);
            }
          }

          // Events, conferences, or meetings (Avoid lifestyle party pictures)
          const eventTerms = [
            "meeting", "seminar", "workshop", "conference", "party", "gathering", 
            "event", "hall", "celebration", "wedding", "banquet", "speech", "lifestyle", "social"
          ];
          for (const term of eventTerms) {
            if (textToAnalyze.includes(term)) {
              score -= 150;
              reasons.push(`event:${term}`);
            }
          }

          // Advertisements, text overlay, posters, illustrations
          const graphicTerms = [
            "poster", "banner", "flyer", "mockup", "text", "graphic", "illustration", 
            "vector", "drawing", "painting", "art", "infographic", "label", "logo", 
            "menu card", "template"
          ];
          for (const term of graphicTerms) {
            if (textToAnalyze.includes(term)) {
              score -= 300;
              reasons.push(`graphic/text:${term}`);
            }
          }

          // --- 2. POSITIVE HIGH-QUALITY FOOD-CENTRIC BOOSTERS ---

          // Close-up / Detailed view focusing on food textures (Food-centric focus)
          const closeupMarkers = ["close-up", "closeup", "close up", "macro", "macro shot", "detailed text", "focus on", "depth of field"];
          for (const term of closeupMarkers) {
            if (textToAnalyze.includes(term)) {
              score += 50;
              reasons.push(`closeup:${term}`);
            }
          }

          // Plated or served states (Plates, bowls, dishes, direct serving)
          const platedMarkers = ["plated", "on a plate", "in a bowl", "bowl of", "plate of", "dish of", "served in", "garnish"];
          for (const term of platedMarkers) {
            if (textToAnalyze.includes(term)) {
              score += 40;
              reasons.push(`plated:${term}`);
            }
          }

          // Clean aerial / top-down shots (usually extremely food-centric)
          const topdownMarkers = ["overhead", "top view", "flat lay", "flat-lay", "aerial view", "top-down"];
          for (const term of topdownMarkers) {
            if (textToAnalyze.includes(term)) {
              score += 35;
              reasons.push(`topdown:${term}`);
            }
          }

          // Representative cooked state
          const diningMarkers = [
            "cooked", "baked", "fried", "grilled", "roasted", "steamed", "stew", "soup", "sauce", 
            "gourmet", "meal", "food", "delicious", "tasty", "appetizing", "freshly prepared"
          ];
          for (const term of diningMarkers) {
            if (textToAnalyze.includes(term)) {
              score += 20;
            }
          }

          // --- 3. RELEVANCY & ACCURACY BOOSTS (High priority for exact menu matches) ---
          const lowercaseQuery = q.text.toLowerCase().trim();
          
          // 1) Full exact query phrase match
          if (textToAnalyze.includes(lowercaseQuery)) {
            score += 100;
            reasons.push("exact_phrase_match");
          }

          // 2) Keyword matches (excluding short stop words)
          const stopWords = new Set(["and", "the", "with", "for", "in", "of", "a", "an", "on", "to", "at", "by", "from", "or", "but", "is", "are", "was", "were", "food", "dish", "meal"]);
          const queryWords = q.text.toLowerCase().split(/\s+/).filter(w => w.length > 2 && !stopWords.has(w));
          
          let matchCount = 0;
          for (const word of queryWords) {
            if (textToAnalyze.includes(word)) {
              matchCount++;
            }
          }
          if (matchCount > 0) {
            score += matchCount * 30;
            reasons.push(`keyword_matches:${matchCount}`);
          }

          // 3) Multi-word consecutive sequence match if query is 2+ words
          if (queryWords.length >= 2) {
            for (let i = 0; i < queryWords.length - 1; i++) {
              const sequence = `${queryWords[i]} ${queryWords[i+1]}`;
              if (textToAnalyze.includes(sequence)) {
                score += 50;
                reasons.push(`sequence_match:${sequence}`);
                break;
              }
            }
          }

          // 4) Dimensions bonus: Prefer clean landscape layout
          if (photo.width && photo.height && photo.width > photo.height) {
            score += 10;
          }

          return {
            photo,
            score,
            reasons
          };
        });

        // Sort scored candidates descending (highest score first)
        scoredCandidates.sort((a, b) => b.score - a.score);

        const bestCandidate = scoredCandidates[0];
        console.log(`[Pexels Scoring] Best candidate for "${q.text}" scored: ${bestCandidate.score}`);

        // Update overall best if this is the highest we've seen so far
        if (!bestAcrossAll || bestCandidate.score > bestAcrossAll.score) {
          bestAcrossAll = {
            photo: bestCandidate.photo,
            score: bestCandidate.score,
            queryText: q.text
          };
        }

        // If this candidate meets or exceeds our high-quality threshold, use it immediately!
        if (bestCandidate.score >= qualityThreshold) {
          console.log(`[Pexels Match] Found high-quality match for "${q.text}" (Score: ${bestCandidate.score}).`);
          const imgUrl = bestCandidate.photo.src.large || bestCandidate.photo.src.medium;
          if (imgUrl) {
            return {
              imageUrl: imgUrl,
              activeQuery: q.text,
              isFallbackUrl: false
            };
          }
        } else {
          console.log(`[Pexels Skip] Best candidate for "${q.text}" scored ${bestCandidate.score}, which is below the threshold of ${qualityThreshold}. Trying next query...`);
        }
      }
    } catch (err) {
      console.error(`[Pexels API Error] Failed searching for "${q.text}":`, err);
    }
  }

  // Fallback decision block:
  // If we couldn't find any candidate that met the strict high-quality threshold,
  // we check if we have ANY candidate across all queries that scored > 40 (positive, not heavily penalized).
  if (bestAcrossAll && bestAcrossAll.score > 40) {
    console.log(`[Pexels Fallback] No query exceeded threshold, but using best overall positive candidate from "${bestAcrossAll.queryText}" (Score: ${bestAcrossAll.score}).`);
    const imgUrl = bestAcrossAll.photo.src.large || bestAcrossAll.photo.src.medium;
    if (imgUrl) {
      return {
        imageUrl: imgUrl,
        activeQuery: bestAcrossAll.queryText,
        isFallbackUrl: false
      };
    }
  }

  // Absolute fallback: use the provided fallback Unsplash URL
  console.log(`[Pexels Fallback] All queries failed or scored poorly. Falling back to default backup image.`);
  return {
    imageUrl: defaultBackupUrl,
    activeQuery: "Fallback to Unsplash (low-quality Pexels matches)",
    isFallbackUrl: true
  };
}
