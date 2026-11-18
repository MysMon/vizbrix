import { createDashboard } from 'vizbrix';

export const initialLayout = createDashboard({
  width: 1200,
  gap: 16,
  items: [
    { id: 'mrr', type: 'stat', title: '月次経常収益 (MRR)', x: 0, y: 0, w: 300, h: 148, props: { data: 'kpiMrr', format: 'currency:JPY', deltaLabel: '前月比' } },
    { id: 'customers', type: 'stat', title: '契約社数', x: 300, y: 0, w: 300, h: 148, props: { data: 'kpiCustomers', deltaLabel: '前月比' } },
    { id: 'churn', type: 'stat', title: '解約率', x: 600, y: 0, w: 300, h: 148, props: { data: 'kpiChurn', format: 'percent', deltaFormat: { style: 'percent', maximumFractionDigits: 1 }, upIsGood: false, deltaLabel: '前月比' } },
    { id: 'nps', type: 'stat', title: 'NPS', x: 900, y: 0, w: 300, h: 148, props: { data: 'kpiNps', deltaFormat: 'number', deltaLabel: '前四半期比' } },
    { id: 'revenue', type: 'line', title: '売上推移（万円）', x: 0, y: 148, w: 800, h: 340, props: { data: 'revenue', x: 'month', series: ['実績', '計画', '前年'], curve: 'smooth' } },
    { id: 'plans', type: 'donut', title: 'プラン別売上（万円）', x: 800, y: 148, w: 400, h: 340, props: { data: 'plans', centerLabel: '合計' } },
    { id: 'channels', type: 'bar', title: 'チャネル別受注（万円）', x: 0, y: 488, w: 480, h: 320, props: { data: 'channels', x: 'month', series: ['直販', 'パートナー', 'オンライン'], lines: ['目標'], stacked: true } },
    { id: 'traffic', type: 'area', title: 'サイト流入（日次）', x: 480, y: 488, w: 440, h: 320, props: { data: 'traffic', x: 'date', series: ['セッション', '新規'] } },
    { id: 'regions', type: 'barlist', title: '地域別売上（万円）', x: 920, y: 488, w: 280, h: 320, props: { data: 'regions' } },
    { id: 'funnel', type: 'funnel', title: '受注ファネル', x: 0, y: 808, w: 320, h: 340, props: { data: 'funnel' } },
    { id: 'inquiries', type: 'heatmap', title: '問い合わせ件数（曜日 × 時間帯）', x: 320, y: 808, w: 440, h: 340, props: { data: 'inquiries', x: 'hour', y: 'day', value: '件数' } },
    { id: 'accounts', type: 'scatter', title: '席数と月額（万円）', x: 760, y: 808, w: 440, h: 340, props: { data: 'accounts', x: '席数', y: '月額', group: 'プラン', label: '顧客' } },
    { id: 'deals', type: 'table', title: '進行中の案件', x: 0, y: 1148, w: 880, h: 360, props: { data: 'deals', columns: [{ key: '案件' }, { key: '担当' }, { key: 'ステージ' }, { key: '金額', format: 'currency:JPY' }, { key: '確度', format: 'percent' }, { key: '更新日' }] } },
    { id: 'quota', type: 'meter', title: '年間目標の達成状況', x: 880, y: 1148, w: 320, h: 160, props: { data: 'quota', format: 'currency:JPY', status: 'good', statusLabel: '計画どおり' } },
    { id: 'note', type: 'text', x: 880, y: 1308, w: 320, h: 200, props: { text: '編集モードでブリックをドラッグ・リサイズできます。\n\n幅を狭めると 2 列・1 列のレイアウトに自動で組み替わり、その状態で動かすと画面幅ごとの配置として保存されます。' } },
  ],
});
