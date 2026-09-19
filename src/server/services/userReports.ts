import { db, daysSince, parseJson } from '../db';

/**
 * 계획서 8장 / 12.2 — 사용자가 현장에서 확인한 정보를 다음 조회에 반영한다.
 *
 * 설계 원칙:
 *  - 저장된 분석을 덮어쓰지 않고, 조회 시점에 합쳐서 보여준다.
 *    (제보가 늘거나 취소되면 즉시 반영되고, 원본 분석 결과는 보존된다)
 *  - "있다"는 제보는 한 건만 있어도 즉시 반영한다. 알레르기는 놓치는 쪽이 위험하다.
 *  - "없다"는 제보는 여러 명이 같은 말을 해야 반영한다. 한 사람의 착각으로
 *    경고를 지우면 안 되기 때문이다.
 */

/** '없다'는 제보를 반영하기 위해 필요한 최소 인원 */
const ABSENT_CONFIRM_THRESHOLD = 2;

export interface MenuUserReports {
  /** 사용자들이 실제로 들어 있다고 확인한 알레르기 */
  confirmedAllergens: string[];
  /** 여러 명이 없다고 확인한 알레르기 */
  clearedAllergens: string[];
  /** 화면에 보여줄 제보 메모 */
  notes: string[];
  /** 제보 건수 */
  reportCount: number;
  /** 가장 최근 제보가 며칠 전인지 */
  lastReportedDays: number | null;
}

const EMPTY: MenuUserReports = {
  confirmedAllergens: [],
  clearedAllergens: [],
  notes: [],
  reportCount: 0,
  lastReportedDays: null,
};

/**
 * 메뉴에 달린 사용자 제보를 집계한다.
 * 반려(rejected)된 제보는 제외하고, 접수 상태와 채택 상태를 모두 사용한다.
 */
export const collectUserReports = async (menuId: string): Promise<MenuUserReports> => {
  const rows = (await db.all(
    `SELECT report_type, report_text, reported_allergens, absent_allergens, visit_date, created_at, status
     FROM reports
     WHERE menu_id = ? AND status != 'rejected'
     ORDER BY created_at DESC`,
    [menuId]
  )) as any[];

  if (rows.length === 0) return EMPTY;

  const presentCount = new Map<string, number>();
  const absentCount = new Map<string, number>();
  const notes: string[] = [];

  rows.forEach((row) => {
    parseJson<string[]>(row.reported_allergens, []).forEach((a) =>
      presentCount.set(a, (presentCount.get(a) ?? 0) + 1)
    );
    parseJson<string[]>(row.absent_allergens, []).forEach((a) =>
      absentCount.set(a, (absentCount.get(a) ?? 0) + 1)
    );

    if (typeof row.report_text === 'string' && row.report_text.trim()) {
      const when = row.visit_date ? `${row.visit_date} 방문` : '방문자';
      notes.push(`${when}: ${row.report_text.trim()}`);
    }
  });

  const confirmedAllergens = [...presentCount.keys()];
  // '없다'는 제보는 여러 명이 확인했고, '있다'는 제보가 없을 때만 반영한다.
  const clearedAllergens = [...absentCount.entries()]
    .filter(([key, n]) => n >= ABSENT_CONFIRM_THRESHOLD && !presentCount.has(key))
    .map(([key]) => key);

  return {
    confirmedAllergens,
    clearedAllergens,
    notes: notes.slice(0, 5),
    reportCount: rows.length,
    lastReportedDays: daysSince(rows[0].created_at),
  };
};

/**
 * 사용자 제보가 있으면 신뢰도를 올린다.
 * 현장에서 직접 확인한 정보이므로 공개 데이터 추정보다 이 메뉴에 대해서는 더 정확하다.
 * (계획서 9.4 의 '사용자 정보' 출처)
 */
export const confidenceWithReports = (base: number, reports: MenuUserReports): number => {
  if (reports.confirmedAllergens.length === 0 && reports.clearedAllergens.length === 0) {
    return base;
  }
  // 제보가 쌓일수록 올라가되 상한을 둔다. 한 명의 제보로 확정 취급하지 않는다.
  const bonus = Math.min(0.2, 0.1 + reports.reportCount * 0.03);
  return Math.round(Math.min(0.9, Math.max(base, 0.7) + bonus) * 100) / 100;
};
