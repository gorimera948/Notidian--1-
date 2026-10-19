import { generateId } from './utils.js';

// Initial Sample Notes
export const sampleNotes = [
  {
    id: 'note-welcome',
    title: 'ようこそ Notidian へ 🚀',
    updatedAt: Date.now(),
    blocks: [
      { id: generateId(), type: 'h1', content: 'ようこそ！ Notion × Obsidian × Pomodoro' },
      { id: generateId(), type: 'p', content: 'Notidian（ノティディアン）は、**Notionの直感的なブロック編集・ドラッグカラム**と、**Obsidianの強力なローカル双方向リンク（Wikiリンク）**、そして**ポモドーロタイマー**を融合させた、ローカルファーストの先進的なノートアプリです。' },
      { id: generateId(), type: 'h2', content: '✨ 主な機能と使い方' },
      {
        id: generateId(),
        type: 'toggle',
        content: '💡 Notionスタイルのトグルリスト（クリックして開閉）',
        properties: { open: true },
        children: [
          { id: generateId(), type: 'p', content: 'トグルブロックの中には、他のテキストブロックやリスト、ToDoリストを自由にネストできます。' },
          { id: generateId(), type: 'todo', content: 'ドラッグ＆ドロップでこの中に他のブロックを移動することも可能です。', properties: { checked: true } }
        ]
      },
      {
        id: generateId(),
        type: 'columns',
        content: '',
        children: [
          {
            id: generateId(),
            type: 'column',
            children: [
              { id: generateId(), type: 'h2', content: '👈 左側のカラム' },
              { id: generateId(), type: 'p', content: 'ブロックをドラッグして、他のブロックの左右の端に近づけてドロップすると、このようにカラム（横並び列）を作ることができます！' }
            ]
          },
          {
            id: generateId(),
            type: 'column',
            children: [
              { id: generateId(), type: 'h2', content: '👉 右側のカラム' },
              { id: generateId(), type: 'todo', content: '列幅は自動調整され、Notionのように美しく並びます。', properties: { checked: false } }
            ]
          }
        ]
      },
      { id: generateId(), type: 'p', content: '次は、日本語入力でも瞬時にリンクできる双方向リンクについて学びましょう。右にあるリンクをクリックしてみてください： [[双方向リンクと和文カッコの機能]]' }
    ]
  },
  {
    id: 'note-links',
    title: '双方向リンクと和文カッコの機能',
    updatedAt: Date.now() - 10000,
    blocks: [
      { id: generateId(), type: 'h1', content: '双方向リンク（Wikiリンク）の革新' },
      { id: generateId(), type: 'p', content: 'Obsidianのように、ノート間で自由にリンクを作ることができます。本アプリは、日本語キーボードでの入力を劇的にスムーズにする機能を持っています。' },
      { id: generateId(), type: 'h2', content: '✍️ リンクの作り方' },
      { id: generateId(), type: 'bullet', content: '半角二重カッコ `[[` と入力すると、既存ノート of 補完ポップアップが表示されます。' },
      { id: generateId(), type: 'bullet', content: 'さらに、日本語全角カッコ 「「「」」 でも作成できます！「「 と入力すると同様に補完が動き、入力後は [[ノート名]] または 「「ノート名」」 の両方が同じ双方向リンクとして認識されます。' },
      { id: generateId(), type: 'p', content: 'リンクの例： [[ようこそ Notidian へ 🚀]] や 「「ポモドーロと学習ログの連携」」' },
      { id: generateId(), type: 'h2', content: '🔴 存在しないノートへのリンク' },
      { id: generateId(), type: 'p', content: '存在しないノート名で [[新規アイデア]] や 「「未作成のタスクリスト」」 と書くと、ピンク色の破線リンクになります。これをクリックすると、**その名前のノートが自動的に新規作成され、そこに瞬時に移動**します！' },
      { id: generateId(), type: 'p', content: '右パネルの「バックリンク」タブを開くと、現在どのノートからこのノートがリンクされているか（参照元）を確認できます。' }
    ]
  },
  {
    id: 'note-pomodoro',
    title: 'ポモドーロと学習ログの連携',
    updatedAt: Date.now() - 20000,
    blocks: [
      { id: generateId(), type: 'h1', content: '⏱️ ポモドーロタイマーと学習分析の連携' },
      { id: generateId(), type: 'p', content: '左サイドバー下部には、ドラッグ順序入れ替え可能な本格的ポモドーロタイマーが統合されています！' },
      { id: generateId(), type: 'h2', content: '🔄 自動保存とグラフ化の流れ' },
      { id: generateId(), type: 'todo', content: 'タイマーのスケジュールで「追加」を押し、タスクを選択します。（テスト用に10秒のセットを作るのがおすすめです！）', properties: { checked: false } },
      { id: generateId(), type: 'todo', content: 'タイマーを「開始」します。作業時間が終了すると美しくチャイムが鳴り、自動的に右パネルの「ポモドーロ分析」データベーステーブルにタスク名と時間が記録されます。', properties: { checked: false } },
      { id: generateId(), type: 'todo', content: '保存されたタスク時間は、過去7日間の「累計作業時間」棒グラフ（SVG）や、タスク別の比率メーターとして動的に可視化されます！', properties: { checked: false } },
      { id: generateId(), type: 'p', content: '記録されたデータテーブルは、タスク名や時間をその場でダブルクリック（またはクリック）して編集・削除可能です。Notionのようなデータベース感覚で学習状況を維持できます。' }
    ]
  }
];
