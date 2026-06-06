// mindmap.js - MindMap (Force-Directed Graph) Renderer

import { state, getActiveNormalNotes, getActiveNote } from './state.js';

// 力学シミュレーションのパラメータ
const REPULSION_STRENGTH = 4500;  // ノード同士の反発力
const ATTRACTION_STRENGTH = 0.05;  // エッジ間の引力（ばね強さ）
const CENTER_FORCE = 0.018;        // 中心への引力
const DAMPING = 0.82;             // 速度減衰（摩擦）
const MIN_VELOCITY = 0.005;       // シミュレーションがスリープする閾値
const DEFAULT_LINK_DISTANCE = 80;  // 接続線の目標長（ばねの自然長）

// タグごとのパステル・ネオン系配色
const TAG_COLORS = {
  'default': '#94a3b8',   // グレー
  '開発': '#8b5cf6',       // パープル (violet)
  'dev': '#8b5cf6',
  'アイデア': '#ec4899',   // ピンク (fuchsia)
  'idea': '#ec4899',
  'タスク': '#3b82f6',     // ブルー (blue)
  'task': '#3b82f6',
  '学習': '#10b981',       // グリーン (emerald)
  'study': '#10b981',
  '日記': '#fbbf24',       // イエロー
  'diary': '#fbbf24',
  '重要': '#ef4444',       // レッド
  'important': '#ef4444'
};

// 任意のタグ文字列から色を決定する（ハッシュ値による自動割り当て）
function getTagColor(tag) {
  if (!tag) return TAG_COLORS.default;
  const cleanTag = tag.trim();
  
  // 1. カスタムカラーを最優先で使用
  if (state.customTagColors && state.customTagColors[cleanTag]) {
    return state.customTagColors[cleanTag];
  }
  
  // 2. メインアプリの getNoteTagStyles にカラー取得を委ねる（配色の完全統一）
  if (window.Notidian && typeof window.Notidian.getNoteTagStyles === 'function') {
    const styles = window.Notidian.getNoteTagStyles(cleanTag);
    if (styles && styles.fg) {
      return styles.fg;
    }
  }
  
  // 3. フォールバック
  const cleanTagLower = cleanTag.toLowerCase();
  if (TAG_COLORS[cleanTagLower]) {
    return TAG_COLORS[cleanTagLower];
  }
  
  // 文字列ハッシュでカラフルなHSLカラーを生成
  let hash = 0;
  for (let i = 0; i < cleanTagLower.length; i++) {
    hash = cleanTagLower.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 75%, 65%)`;
}

// ノート内のWikiLinkを抽出
function extractLinks(note, notes) {
  const links = new Set();
  const checkText = (text) => {
    if (!text) return;
    // [[...]] パターンの抽出
    text.replace(/\[\[(.*?)\]\]/g, (m, target) => {
      const trimmed = target.trim().toLowerCase();
      const targetNote = notes.find(n => n.title.toLowerCase() === trimmed);
      if (targetNote && targetNote.id !== note.id) {
        links.add(targetNote.id);
      }
    });
    // 「「...」」 パターンの抽出
    text.replace(/「「(.*?)」」/g, (m, target) => {
      const trimmed = target.trim().toLowerCase();
      const targetNote = notes.find(n => n.title.toLowerCase() === trimmed);
      if (targetNote && targetNote.id !== note.id) {
        links.add(targetNote.id);
      }
    });
  };

  const traverse = (blocks) => {
    if (!blocks || !Array.isArray(blocks)) return;
    blocks.forEach(b => {
      if (b.content) checkText(b.content);
      if (b.type === 'database' && b.properties && b.properties.rows) {
        b.properties.rows.forEach(row => {
          for (let key in row) {
            checkText(String(row[key] || ''));
          }
        });
      }
      if (b.children) traverse(b.children);
    });
  };

  traverse(note.blocks);
  return Array.from(links);
}

export class MindMap {
  constructor() {
    this.canvas = document.getElementById('mindmap-canvas');
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    this.tooltip = document.getElementById('mindmap-tooltip');
    this.resetBtn = document.getElementById('btn-mindmap-reset');
    this.fullscreenBtn = document.getElementById('btn-mindmap-fullscreen');
    this.containerSection = this.canvas.closest('.mindmap-section');
    this.originalParent = this.containerSection ? this.containerSection.parentElement : null;

    this.nodes = [];
    this.edges = [];
    
    // パン＆ズームの状態
    this.panX = 0;
    this.panY = 0;
    this.zoom = 1.0;
    this.isFullscreen = false;
    
    // ドラッグ＆パン操作の状態
    this.draggedNode = null;
    this.hoveredNode = null;
    this.isPanning = false;
    this.startX = 0;
    this.startY = 0;
    this.lastX = 0;
    this.lastY = 0;
    
    // クリック判定用
    this.mouseDownTime = 0;
    this.mouseDownX = 0;
    this.mouseDownY = 0;

    // シミュレーションループ制御
    this.isSimulating = false;
    this.animationFrameId = null;

    this.initEvents();
    this.resizeCanvas();
    this.updateData();
  }

  // キャンバスのサイズフィッティング
  resizeCanvas() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.scale(dpr, dpr);
    
    this.width = rect.width;
    this.height = rect.height;
  }

  // データの同期とグラフの再構築
  updateData() {
    const normalNotes = getActiveNormalNotes();
    const activeNote = getActiveNote();
    const activeId = activeNote ? activeNote.id : null;

    // 1. ノードリストの更新（既存のノード座標と速度は維持する）
    const newNodes = normalNotes.map(note => {
      const existing = this.nodes.find(n => n.id === note.id);
      if (existing) {
        // 更新された情報をマージ
        existing.title = note.title;
        existing.tags = note.tags || [];
        return existing;
      } else {
        // 新しいノードは中心付近にランダムに散らす
        const angle = Math.random() * Math.PI * 2;
        const radius = Math.random() * 40;
        return {
          id: note.id,
          title: note.title,
          tags: note.tags || [],
          x: this.width / 2 + Math.cos(angle) * radius,
          y: this.height / 2 + Math.sin(angle) * radius,
          vx: 0,
          vy: 0,
          isDragging: false
        };
      }
    });

    this.nodes = newNodes;

    // 2. エッジ（接続関係）の構築
    const newEdges = [];
    normalNotes.forEach(note => {
      const links = extractLinks(note, normalNotes);
      links.forEach(targetId => {
        // 重複を除けて片方向エッジにする（無向グラフ）
        const exists = newEdges.some(e => 
          (e.source === note.id && e.target === targetId) || 
          (e.source === targetId && e.target === note.id)
        );
        if (!exists) {
          newEdges.push({
            source: note.id,
            target: targetId
          });
        }
      });
    });

    this.edges = newEdges;

    // アクティブなノートがあればそれを中心に少し引き寄せる
    if (activeId) {
      const activeNode = this.nodes.find(n => n.id === activeId);
      if (activeNode && !activeNode.isDragging) {
        // 中心付近に寄せる
        activeNode.vx += (this.width / 2 - activeNode.x) * 0.05;
        activeNode.vy += (this.height / 2 - activeNode.y) * 0.05;
      }
    }

    this.triggerSimulation();
  }

  // シミュレーションループの再始動
  triggerSimulation() {
    if (!this.isSimulating) {
      this.isSimulating = true;
      this.tick();
    }
  }

  // 配置のリセット
  resetLayout() {
    this.panX = 0;
    this.panY = 0;
    this.zoom = 1.0;
    
    this.nodes.forEach((node, idx) => {
      const angle = (idx / this.nodes.length) * Math.PI * 2;
      const radius = 60 + Math.random() * 20;
      node.x = this.width / 2 + Math.cos(angle) * radius;
      node.y = this.height / 2 + Math.sin(angle) * radius;
      node.vx = 0;
      node.vy = 0;
    });

    this.triggerSimulation();
  }

  // 物理エンジンのステップ計算
  tick() {
    if (!this.isSimulating) return;

    let totalEnergy = 0;

    // 1. クーロン反発力とタグクラスタリング引力の計算
    for (let i = 0; i < this.nodes.length; i++) {
      const n1 = this.nodes[i];
      const tag1 = n1.tags && n1.tags[0] ? n1.tags[0].trim() : null;
      for (let j = i + 1; j < this.nodes.length; j++) {
        const n2 = this.nodes[j];
        const tag2 = n2.tags && n2.tags[0] ? n2.tags[0].trim() : null;
        const dx = n2.x - n1.x;
        const dy = n2.y - n1.y;
        const distSq = dx * dx + dy * dy + 1;
        const dist = Math.sqrt(distSq);
        
        const isSameTag = tag1 && tag2 && tag1 === tag2 && tag1 !== 'default';
        // 離れすぎている場合は無視。ただし同じメインタグを持つ場合は引力を利かせるためスキップしない
        if (dist > 180 && !isSameTag) continue;

        let force = 0;
        if (dist <= 180) {
          force = REPULSION_STRENGTH / distSq;
        }

        // 同じメインタグ同士を引き寄せる緩やかなクラスタリング引力を追加
        if (isSameTag) {
          const tagAttraction = dist * 0.012; // 緩やかな引力
          force -= tagAttraction;
        }

        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;

        if (!n1.isDragging) {
          n1.vx -= fx;
          n1.vy -= fy;
        }
        if (!n2.isDragging) {
          n2.vx += fx;
          n2.vy += fy;
        }
      }
    }

    // 2. ばね引力の計算 (エッジ接続)
    this.edges.forEach(edge => {
      const sourceNode = this.nodes.find(n => n.id === edge.source);
      const targetNode = this.nodes.find(n => n.id === edge.target);
      if (!sourceNode || !targetNode) return;

      const dx = targetNode.x - sourceNode.x;
      const dy = targetNode.y - sourceNode.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      
      const force = (dist - DEFAULT_LINK_DISTANCE) * ATTRACTION_STRENGTH;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;

      if (!sourceNode.isDragging) {
        sourceNode.vx += fx;
        sourceNode.vy += fy;
      }
      if (!targetNode.isDragging) {
        targetNode.vx -= fx;
        targetNode.vy -= fy;
      }
    });

    // 3. 中心引力と位置更新
    const centerX = this.width / 2;
    const centerY = this.height / 2;

    this.nodes.forEach(node => {
      if (node.isDragging) return;

      // 画面中央へ引き寄せる
      const dx = centerX - node.x;
      const dy = centerY - node.y;
      node.vx += dx * CENTER_FORCE;
      node.vy += dy * CENTER_FORCE;

      // 減衰と適用
      node.vx *= DAMPING;
      node.vy *= DAMPING;
      node.x += node.vx;
      node.y += node.vy;

      totalEnergy += node.vx * node.vx + node.vy * node.vy;
    });

    // 4. キャンバス描画
    this.draw();

    // 5. 収束時のスリープ判定（ドラッグ中でなく、全運動エネルギーが閾値以下なら休止）
    if (totalEnergy < MIN_VELOCITY && !this.draggedNode) {
      this.isSimulating = false;
      cancelAnimationFrame(this.animationFrameId);
    } else {
      this.animationFrameId = requestAnimationFrame(() => this.tick());
    }
  }

  // グラフィックス描画
  draw() {
    this.ctx.clearRect(0, 0, this.width, this.height);

    this.ctx.save();
    this.ctx.translate(this.panX, this.panY);
    this.ctx.scale(this.zoom, this.zoom);

    // 1. タググループ領域（ぼかし混色背景）の描画
    this.drawTagRegions();

    // 2. 接続線の描画（2色グラデーション）
    this.drawEdges();

    // 3. ノードの描画
    this.drawNodes();

    this.ctx.restore();
  }

  // 背景の色分け領域 (メインタグごとの重心・最大半径に基づくザックリしたエリア分け)
  drawTagRegions() {
    this.ctx.save();
    // ぼかしは無効化 (くっきりしたエリア分け)

    // メインタグ（1番目のタグ）ごとにノードをグループ化
    const groups = {};
    this.nodes.forEach(node => {
      const mainTag = (node.tags && node.tags.length > 0) ? node.tags[0].trim() : 'default';
      if (!groups[mainTag]) {
        groups[mainTag] = [];
      }
      groups[mainTag].push(node);
    });

    // 各グループの重心と半径を計算し描画
    for (const [tag, groupNodes] of Object.entries(groups)) {
      if (tag === 'default') continue; // タグなしは背景色分けを描画しない

      // A. 重心 (平均座標) の算出
      let sumX = 0;
      let sumY = 0;
      groupNodes.forEach(node => {
        sumX += node.x;
        sumY += node.y;
      });
      const avgX = sumX / groupNodes.length;
      const avgY = sumY / groupNodes.length;

      // B. 最大半径の算出 (重心から各メンバーへの最大距離)
      let maxDist = 0;
      groupNodes.forEach(node => {
        const dx = node.x - avgX;
        const dy = node.y - avgY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > maxDist) maxDist = dist;
      });

      // 描画用の半径 (最低限の大きさ 35px を確保し、広がりを持たせる)
      const radius = Math.max(35, maxDist + 15);
      const color = getTagColor(tag);

      // C. 背景サークルの描画
      this.ctx.fillStyle = color;
      this.ctx.globalAlpha = 0.30; // 不透明度を 30% に引き上げて見やすくする
      this.ctx.beginPath();
      this.ctx.arc(avgX, avgY, radius, 0, Math.PI * 2);
      this.ctx.fill();
    }

    this.ctx.restore();
  }

  // 接続線
  drawEdges() {
    this.edges.forEach(edge => {
      const sourceNode = this.nodes.find(n => n.id === edge.source);
      const targetNode = this.nodes.find(n => n.id === edge.target);
      if (!sourceNode || !targetNode) return;

      const sourceTag = sourceNode.tags && sourceNode.tags[0];
      const targetTag = targetNode.tags && targetNode.tags[0];
      const sourceColor = getTagColor(sourceTag);
      const targetColor = getTagColor(targetTag);

      this.ctx.beginPath();
      this.ctx.moveTo(sourceNode.x, sourceNode.y);
      this.ctx.lineTo(targetNode.x, targetNode.y);

      if (sourceColor === targetColor) {
        // 同じ分野なら単色でうっすら描画
        this.ctx.strokeStyle = sourceColor;
        this.ctx.globalAlpha = 0.35;
      } else {
        // 異なる分野同士なら、2色のグラデーション線で美しく接続（分野の架け橋）
        const grad = this.ctx.createLinearGradient(sourceNode.x, sourceNode.y, targetNode.x, targetNode.y);
        grad.addColorStop(0, sourceColor);
        grad.addColorStop(1, targetColor);
        this.ctx.strokeStyle = grad;
        this.ctx.globalAlpha = 0.45;
      }

      this.ctx.lineWidth = 1.2;
      this.ctx.stroke();
    });
    
    this.ctx.globalAlpha = 1.0; // アルファを元に戻す
  }

  // ノード（名前とドット）
  drawNodes() {
    const activeNote = getActiveNote();
    const activeId = activeNote ? activeNote.id : null;

    this.nodes.forEach(node => {
      const isCurrent = node.id === activeId;
      const primaryTag = node.tags && node.tags[0];
      const color = getTagColor(primaryTag);

      // A. ノード本体（ドット）
      this.ctx.beginPath();
      const radius = isCurrent ? 6 : 4;
      this.ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
      
      if (isCurrent) {
        // アクティブノートはグロー効果をのせて白ドット＋タグ色枠線
        this.ctx.save();
        this.ctx.shadowColor = color;
        this.ctx.shadowBlur = 10;
        this.ctx.fillStyle = '#ffffff';
        this.ctx.fill();
        this.ctx.strokeStyle = color;
        this.ctx.lineWidth = 2.5;
        this.ctx.stroke();
        this.ctx.restore();
      } else {
        this.ctx.fillStyle = color;
        this.ctx.fill();
      }

      // B. タイトルテキスト
      this.ctx.font = isCurrent ? 'bold 10.5px var(--font-ui)' : '500 10px var(--font-ui)';
      this.ctx.textAlign = 'center';
      this.ctx.textBaseline = 'top';

      if (isCurrent) {
        this.ctx.fillStyle = '#ffffff';
      } else {
        this.ctx.fillStyle = 'var(--text-secondary, #94a3b8)';
      }
      
      // 文字が被りにくいように少し下に配置
      const textY = node.y + radius + 4;
      
      // 長いタイトルは省略表示
      let displayTitle = node.title;
      if (displayTitle.length > 11) {
        displayTitle = displayTitle.substring(0, 10) + '...';
      }
      
      this.ctx.fillText(displayTitle, node.x, textY);
    });
  }

  // マウスイベントハンドラ

  // 論理座標に変換
  getEventCoords(e) {
    const rect = this.canvas.getBoundingClientRect();
    const clientX = e.clientX - rect.left;
    const clientY = e.clientY - rect.top;
    const x = (clientX - this.panX) / this.zoom;
    const y = (clientY - this.panY) / this.zoom;
    return { x, y, clientX, clientY };
  }

  findNodeAt(x, y) {
    const hitRadius = 24; // 選択しやすいようにやや広めに判定
    return this.nodes.find(node => {
      const dx = node.x - x;
      const dy = node.y - y;
      return Math.sqrt(dx * dx + dy * dy) < hitRadius;
    });
  }

  handleMouseDown(e) {
    const coords = this.getEventCoords(e);
    const hitNode = this.findNodeAt(coords.x, coords.y);

    this.mouseDownTime = Date.now();
    this.mouseDownX = coords.clientX;
    this.mouseDownY = coords.clientY;

    if (hitNode) {
      // ノードドラッグの開始
      this.draggedNode = hitNode;
      hitNode.isDragging = true;
      hitNode.vx = 0;
      hitNode.vy = 0;
      this.canvas.style.cursor = 'grabbing';
    } else {
      // 背景ドラッグ（パン）の開始
      this.isPanning = true;
      this.startX = coords.clientX - this.panX;
      this.startY = coords.clientY - this.panY;
      this.canvas.style.cursor = 'grabbing';
    }

    this.triggerSimulation();
  }

  handleMouseMove(e) {
    const coords = this.getEventCoords(e);

    // 1. ノードドラッグ中
    if (this.draggedNode) {
      this.draggedNode.x = coords.x;
      this.draggedNode.y = coords.y;
      this.triggerSimulation();
      return;
    }

    // 2. パン操作中
    if (this.isPanning) {
      this.panX = coords.clientX - this.startX;
      this.panY = coords.clientY - this.startY;
      this.draw();
      return;
    }

    // 3. 通常時のホバー＆カーソル判定
    const hoverNode = this.findNodeAt(coords.x, coords.y);
    if (hoverNode) {
      this.canvas.style.cursor = 'pointer';
      this.hoveredNode = hoverNode;
      this.showTooltip(hoverNode, e.clientX, e.clientY);
    } else {
      this.canvas.style.cursor = 'grab';
      this.hoveredNode = null;
      this.hideTooltip();
    }
  }

  handleMouseUp() {
    const clickDuration = Date.now() - this.mouseDownTime;
    const dragDistance = this.draggedNode || this.isPanning ? 
      Math.sqrt(Math.pow(this.canvas.style.cursor === 'grabbing' ? 10 : 0, 2)) : 0; // ざっくりのドラッグ判定

    // 軽微なドラッグリリース
    if (this.draggedNode) {
      this.draggedNode.isDragging = false;
      
      // クリック判定（移動量が小さく短時間のタップ）
      const dx = this.lastX - this.mouseDownX;
      const dy = this.lastY - this.mouseDownY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (clickDuration < 300 && dist < 5) {
        // ノートへジャンプ！
        if (window.Notidian && typeof window.Notidian.navigateToNote === 'function') {
          window.Notidian.navigateToNote(this.draggedNode.id);
        }
      }
      this.draggedNode = null;
    }

    this.isPanning = false;
    this.canvas.style.cursor = this.hoveredNode ? 'pointer' : 'grab';
    this.triggerSimulation();
  }

  handleMouseLeave() {
    if (this.draggedNode) {
      this.draggedNode.isDragging = false;
      this.draggedNode = null;
    }
    this.isPanning = false;
    this.hideTooltip();
    this.triggerSimulation();
  }

  handleWheel(e) {
    e.preventDefault();

    const rect = this.canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // ズーム前後の論理座標を合わせることで、マウスカーソル位置を中心に拡大縮小させる
    const beforeX = (mouseX - this.panX) / this.zoom;
    const beforeY = (mouseY - this.panY) / this.zoom;

    const zoomFactor = 1.1;
    if (e.deltaY < 0) {
      this.zoom = Math.min(this.zoom * zoomFactor, 2.5); // 上限 2.5倍
    } else {
      this.zoom = Math.max(this.zoom / zoomFactor, 0.4); // 下限 0.4倍
    }

    this.panX = mouseX - beforeX * this.zoom;
    this.panY = mouseY - beforeY * this.zoom;

    this.draw();
  }

  // ツールチップ表示
  showTooltip(node, x, y) {
    if (!this.tooltip) return;
    
    // タグがあればコンテキストとして表示
    const tagText = node.tags.length > 0 ? 
      `<div style="font-size: 9px; color: var(--accent-secondary); margin-top: 2px;">🏷️ ${node.tags.join(', ')}</div>` : '';

    this.tooltip.innerHTML = `
      <div style="font-weight: 700; font-size: 11px;">${node.title}</div>
      ${tagText}
    `;
    
    this.tooltip.style.left = `${x + 12}px`;
    this.tooltip.style.top = `${y + 12}px`;
    this.tooltip.style.display = 'block';
  }

  hideTooltip() {
    if (this.tooltip) {
      this.tooltip.style.display = 'none';
    }
  }

  toggleFullscreen() {
    const section = this.containerSection;
    if (!section) return;

    this.isFullscreen = !this.isFullscreen;
    
    const btn = document.getElementById('btn-mindmap-fullscreen');
    if (this.isFullscreen) {
      // 全画面時は body の直下へ移動（親要素の backdrop-filter や clip を回避して最前面に表示）
      document.body.appendChild(section);
      section.classList.add('mindmap-fullscreen-mode');
      if (btn) btn.innerHTML = '<i class="fa-solid fa-compress"></i> 縮小';
    } else {
      // 解除時は元の親要素（右サイドバー）の最下部に戻す
      if (this.originalParent) {
        this.originalParent.appendChild(section);
      }
      section.classList.remove('mindmap-fullscreen-mode');
      if (btn) btn.innerHTML = '<i class="fa-solid fa-expand"></i> 全画面';
    }

    // 移動直後に一度サイズを再計算
    this.resizeCanvas();

    // リフロー確定後に確実にもう一度サイズを再計算して再描画
    setTimeout(() => {
      this.resizeCanvas();
      this.triggerSimulation();
    }, 150); // タイムアウトを150msに延長して安定化
  }

  initEvents() {
    if (this.resetBtn) {
      this.resetBtn.addEventListener('click', () => this.resetLayout());
    }

    if (this.fullscreenBtn) {
      this.fullscreenBtn.addEventListener('click', () => this.toggleFullscreen());
    }

    // Escapeキーで全画面解除
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isFullscreen) {
        this.toggleFullscreen();
      }
    });

    this.canvas.addEventListener('mousedown', (e) => {
      const coords = this.getEventCoords(e);
      this.lastX = coords.clientX;
      this.lastY = coords.clientY;
      this.handleMouseDown(e);
    });

    this.canvas.addEventListener('mousemove', (e) => {
      this.handleMouseMove(e);
    });

    this.canvas.addEventListener('mouseup', () => {
      this.handleMouseUp();
    });

    this.canvas.addEventListener('mouseleave', () => {
      this.handleMouseLeave();
    });

    this.canvas.addEventListener('wheel', (e) => {
      this.handleWheel(e);
    });

    // リサイズ監視
    const resizeObserver = new ResizeObserver(() => {
      this.resizeCanvas();
      this.draw();
    });
    if (this.canvas.parentElement) {
      resizeObserver.observe(this.canvas.parentElement);
    }
  }
}
