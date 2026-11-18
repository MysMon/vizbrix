/** Deterministic demo data, so screenshots and tests are stable. */
function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const months = ['4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月', '1月', '2月', '3月'];

export function buildData(scale = 1): Record<string, unknown> {
  const r = rng(7);
  let mrr = 3200;
  const revenue = months.map((month, i) => {
    mrr *= 1.03 + r() * 0.05;
    const plan = 3300 * Math.pow(1.055, i);
    return { month, 実績: Math.round(mrr * scale), 計画: Math.round(plan * scale), 前年: Math.round(mrr * 0.74 * scale) };
  });

  const channels = months.slice(6).map((month) => ({
    month,
    直販: Math.round((900 + r() * 500) * scale),
    パートナー: Math.round((500 + r() * 400) * scale),
    オンライン: Math.round((300 + r() * 350) * scale),
    目標: Math.round((2100 + r() * 300) * scale),
  }));

  const start = Date.UTC(2026, 7, 1);
  let sessions = 5200;
  const traffic = Array.from({ length: 90 }, (_, i) => {
    sessions += (r() - 0.46) * 520;
    const weekday = new Date(start + i * 86400000).getUTCDay();
    const dip = weekday === 0 || weekday === 6 ? 0.72 : 1;
    return {
      date: new Date(start + i * 86400000),
      セッション: Math.round(sessions * dip * scale),
      新規: Math.round(sessions * dip * (0.34 + r() * 0.06) * scale),
    };
  });

  const plans = [
    { label: 'Enterprise', value: Math.round(4120 * scale) },
    { label: 'Business', value: Math.round(2860 * scale) },
    { label: 'Team', value: Math.round(1540 * scale) },
    { label: 'Starter', value: Math.round(620 * scale) },
  ];

  const regions = [
    { label: '関東', value: 4280 },
    { label: '関西', value: 2140 },
    { label: '中部', value: 1320 },
    { label: '九州', value: 760 },
    { label: '東北', value: 410 },
    { label: '北海道', value: 230 },
  ].map((row) => ({ ...row, value: Math.round(row.value * scale) }));

  const names = ['青葉商事', '北斗システムズ', 'みなと物流', '桜井製作所', '東雲ホールディングス', 'ひかり電機', '千歳フーズ', '七海トレーディング'];
  const stages = ['提案', '見積', '交渉', '契約'];
  const owners = ['佐藤', '鈴木', '高橋', '田中', '伊藤'];
  const deals = Array.from({ length: 400 }, (_, i) => ({
    案件: `${names[i % names.length]} #${1000 + i}`,
    担当: owners[Math.floor(r() * owners.length)],
    ステージ: stages[Math.floor(r() * stages.length)],
    金額: Math.round((120 + r() * 2400) * scale) * 1000,
    確度: Math.round((0.1 + r() * 0.85) * 100) / 100,
    更新日: new Date(start + Math.floor(r() * 90) * 86400000),
  }));

  const funnel = [
    { label: 'サイト訪問', value: Math.round(48200 * scale) },
    { label: '資料請求', value: Math.round(9640 * scale) },
    { label: '商談', value: Math.round(2890 * scale) },
    { label: '見積提出', value: Math.round(1310 * scale) },
    { label: '受注', value: Math.round(520 * scale) },
  ];

  const hours = ['9時', '10時', '11時', '12時', '13時', '14時', '15時', '16時', '17時', '18時'];
  const inquiries = ['月', '火', '水', '木', '金'].flatMap((day, d) =>
    hours.map((hour, h) => ({
      day,
      hour,
      件数: Math.round((18 + 26 * Math.exp(-((h - 2) ** 2) / 6) + 20 * Math.exp(-((h - 6) ** 2) / 5) - (h === 3 ? 14 : 0) + (d === 0 ? 8 : 0) + r() * 10) * scale),
    })),
  );

  const planNames = ['Enterprise', 'Business', 'Team'];
  const accounts = Array.from({ length: 72 }, (_, i) => {
    const plan = i % 3;
    const seats = Math.round([180, 60, 14][plan]! * (0.4 + r() * 1.5));
    return {
      顧客: `${names[i % names.length]} ${Math.floor(i / names.length) + 1}`,
      プラン: planNames[plan]!,
      席数: seats,
      月額: Math.round(seats * [0.9, 0.7, 0.5][plan]! * (0.7 + r() * 0.7) * scale * 10) / 10,
    };
  });

  const last = revenue[revenue.length - 1]!;
  const prev = revenue[revenue.length - 2]!;
  return {
    revenue,
    channels,
    traffic,
    plans,
    regions,
    deals,
    funnel,
    inquiries,
    accounts,
    kpiMrr: { value: last.実績 * 10000, delta: last.実績 / prev.実績 - 1, trend: revenue.map((d) => d.実績) },
    kpiCustomers: { value: Math.round(1284 * scale), delta: 0.042, trend: [980, 1010, 1060, 1090, 1130, 1170, 1196, 1232, 1284] },
    kpiChurn: { value: 0.018, delta: -0.003, trend: [0.026, 0.024, 0.025, 0.022, 0.021, 0.021, 0.019, 0.018] },
    kpiNps: { value: 47, delta: 3, trend: [38, 41, 40, 43, 44, 44, 47] },
    quota: { value: last.実績 * 10000, max: 80000000 },
  };
}
