import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import chinaData from './china.json';
import chinaOutline from './china-outline.json';
import img1 from './assets/01.jpg';
import img2 from './assets/02.jpg';
import img3 from './assets/03.jpg';
import img4 from './assets/04.jpg';
import img5 from './assets/05.jpg';
import img6 from './assets/06.jpg';
import img7 from './assets/07.jpg';
import img8 from './assets/08.jpg';
import terrainHeightUrl from './assets/terrain-height.png';

const TOP_H = 0.62;
// 高程位移：0–9000 m 映射到 0–2.0 个场景单位（相对 56 单位宽的中国版图，约 25 倍夸张）
const MAX_ELEV = 9000;
const ELEV_SCALE = 5.0 / MAX_ELEV;
const TERRAIN_BASE = TOP_H + 0.02;

// 阿尔伯斯等积圆锥投影（中国全国图常用：25°N / 47°N 双标准纬线，105°E 中央经线）。
// 相比简单的“1 度 = 1 单位”，它能还原中国真实的南北比例与海岸线走向。
const albers = (() => {
  const D2R = Math.PI / 180;
  const p1 = 25 * D2R;
  const p2 = 47 * D2R;
  const lon0 = 105;
  const lat0 = 35;
  const n = (Math.sin(p1) + Math.sin(p2)) / 2;
  const C = Math.cos(p1) ** 2 + 2 * n * Math.sin(p1);
  const rho0 = Math.sqrt(C - 2 * n * Math.sin(lat0 * D2R)) / n;
  return (lon, lat) => {
    const rho = Math.sqrt(C - 2 * n * Math.sin(lat * D2R)) / n;
    const theta = n * (lon - lon0) * D2R;
    return [rho * Math.sin(theta), rho0 - rho * Math.cos(theta)];
  };
})();

// 主图取景只用大陆 + 台湾/海南，南海诸岛的远端点不参与，避免地图被拉得很高。
const FIT = (() => {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const f of chinaData.features) {
    if (!f.geometry) continue;
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const poly of polys) for (const ring of poly) for (const [lon, lat] of ring) {
      if (lat < 17) continue;
      const [x, y] = albers(lon, lat);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
  }
  const TARGET_W = 56;
  const scale = TARGET_W / (maxX - minX);
  return {
    scale,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    width: (maxX - minX) * scale,
    height: (maxY - minY) * scale,
  };
})();

// —— 高程图（3D 地形顶点位移 / 路线、边界的贴地采样）——
async function loadHeightmap(url) {
  const img = new Image();
  img.src = url;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, img.width, img.height).data;
  const heights = new Float32Array(img.width * img.height);
  for (let i = 0; i < heights.length; i++) heights[i] = (data[i * 4] / 255) * MAX_ELEV;
  return { w: img.width, h: img.height, heights };
}
const HEIGHT = await loadHeightmap(terrainHeightUrl);

// DEM 原始数据带有细碎噪声，在 480×414 的采样网格上会被放大成竖向“锯齿墙”。
// 先做两遍 1-2-1 可分离平滑，斜视时山体才是连续的山脉，而不是一排尖刺。
{
  const w = HEIGHT.w;
  const h = HEIGHT.h;
  const src = HEIGHT.heights;
  const tmpA = new Float32Array(src.length);
  const tmpB = new Float32Array(src.length);
  for (let pass = 0; pass < 1; pass++) {
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        const x0 = x > 0 ? x - 1 : 0;
        const x1 = x < w - 1 ? x + 1 : w - 1;
        tmpB[row + x] = (src[row + x0] + 2 * src[row + x] + src[row + x1]) * 0.25;
      }
    }
    for (let y = 0; y < h; y++) {
      const y0 = y > 0 ? y - 1 : 0;
      const y1 = y < h - 1 ? y + 1 : h - 1;
      for (let x = 0; x < w; x++) {
        tmpA[y * w + x] = (tmpB[y0 * w + x] + 2 * tmpB[y * w + x] + tmpB[y1 * w + x]) * 0.25;
      }
    }
    src.set(tmpA);
  }
}

function heightAt(x, z) {
  const u = x / FIT.width + 0.5;
  const v = 0.5 - z / FIT.height;
  const px = Math.max(0, Math.min(HEIGHT.w - 1, u * (HEIGHT.w - 1)));
  const py = Math.max(0, Math.min(HEIGHT.h - 1, (1 - v) * (HEIGHT.h - 1)));
  const x0 = Math.floor(px), y0 = Math.floor(py);
  const x1 = Math.min(HEIGHT.w - 1, x0 + 1), y1 = Math.min(HEIGHT.h - 1, y0 + 1);
  const fx = px - x0, fy = py - y0;
  const h00 = HEIGHT.heights[y0 * HEIGHT.w + x0];
  const h10 = HEIGHT.heights[y0 * HEIGHT.w + x1];
  const h01 = HEIGHT.heights[y1 * HEIGHT.w + x0];
  const h11 = HEIGHT.heights[y1 * HEIGHT.w + x1];
  return (h00 * (1 - fx) + h10 * fx) * (1 - fy) + (h01 * (1 - fx) + h11 * fx) * fy;
}

// 与地形网格一致的高度采样：贴地线条/路线/侧裙都按这个更平滑的网格高度走，避免穿模
const TERRAIN_NX = 480;
const TERRAIN_NY = 414;
const TERRAIN_GRID = new Float32Array((TERRAIN_NX + 1) * (TERRAIN_NY + 1));
for (let j = 0; j <= TERRAIN_NY; j++) {
  const z = -FIT.height / 2 + (j / TERRAIN_NY) * FIT.height;
  for (let i = 0; i <= TERRAIN_NX; i++) {
    const x = -FIT.width / 2 + (i / TERRAIN_NX) * FIT.width;
    TERRAIN_GRID[j * (TERRAIN_NX + 1) + i] = heightAt(x, z);
  }
}

function meshY(x, z) {
  const fx = (x + FIT.width / 2) / FIT.width * TERRAIN_NX;
  const fz = (z + FIT.height / 2) / FIT.height * TERRAIN_NY;
  const i = Math.max(0, Math.min(TERRAIN_NX - 1, Math.floor(fx)));
  const j = Math.max(0, Math.min(TERRAIN_NY - 1, Math.floor(fz)));
  const tx = Math.max(0, Math.min(1, fx - i));
  const tz = Math.max(0, Math.min(1, fz - j));
  const w = TERRAIN_NX + 1;
  const h00 = TERRAIN_GRID[j * w + i];
  const h10 = TERRAIN_GRID[j * w + i + 1];
  const h01 = TERRAIN_GRID[(j + 1) * w + i];
  const h11 = TERRAIN_GRID[(j + 1) * w + i + 1];
  // 与网格三角形完全一致（对角线 b-c）
  const h = tx + tz <= 1
    ? h00 + tx * (h10 - h00) + tz * (h01 - h00)
    : h11 + (1 - tx) * (h01 - h11) + (1 - tz) * (h10 - h11);
  return TERRAIN_BASE + h * ELEV_SCALE;
}

const EVENTS = [
  {
    name: '瑞金', date: '1934.10', title: '瑞金 · 长征出发', img: img1,
    text: '1934年10月，中央红军从江西瑞金出发，10月17日渡过于都河，开始战略转移。夜色中，军民在河上架起浮桥，踏上漫漫征途。',
    meaning: '长征的起点。一次被迫的战略转移，开启了改变中国命运的伟大远征。',
    labelPx: [40, -25],
    imgNote: '瑞金叶坪 · 实景照片（青海新闻网）',
    photoPos: '50% 50%',
    facts: ['1934.10 出发', '8.6 万余人', '于都河'],
  },
  {
    name: '湘江', date: '1934.11', title: '湘江战役', img: img2,
    text: '1934年11月27日至12月1日，中央红军在湘江两岸与国民党军血战五昼夜，突破第四道封锁线，但由出发时的8.6万余人锐减至3万余人。',
    meaning: '长征以来最惨烈的一战。惨重代价促使全党全军反思“左”倾错误，为遵义会议的召开埋下伏笔。',
    labelPx: [8, 30],
    imgNote: '湘江战役纪念馆 · 实景照片',
    photoPos: '50% 50%',
    facts: ['1934.11.27—12.1', '血战五昼夜', '3 万余人'],
  },
  {
    name: '遵义', date: '1935.01', title: '遵义会议', img: img3,
    text: '1935年1月15日至17日，中共中央在遵义召开政治局扩大会议，集中解决当时具有决定意义的军事和组织问题。',
    meaning: '生死攸关的转折点。开始确立以毛泽东同志为主要代表的马克思主义正确路线在党中央的领导地位。',
    labelPx: [0, 34],
    imgNote: '遵义会议会址 · 实景照片（遵义日报）',
    photoPos: '50% 50%',
    facts: ['1935.1.15—17', '政治局扩大会议', '历史转折'],
  },
  {
    name: '赤水', date: '1935.01—05', title: '四渡赤水 · 巧渡金沙江', img: img4,
    text: '1935年1月至3月，红军四渡赤水，佯攻贵阳、威逼昆明，随后巧渡金沙江，跳出数十万敌军的围追堵截。',
    meaning: '毛泽东军事指挥的“得意之笔”。红军由被动变主动，掌握了战略主动权。',
    labelPx: [9, -16],
    imgNote: '赤水河畔 · 丙安古镇 · 实景照片',
    photoPos: '50% 50%',
    facts: ['1935.1—3', '四渡赤水', '巧渡金沙江'],
  },
  {
    name: '泸定', date: '1935.05', title: '飞夺泸定桥', img: img5,
    text: '1935年5月29日，红四团一昼夜奔袭240里，22名突击队员冒着弹雨攀着铁索夺桥，打开北上通道。',
    meaning: '大渡河天险前的生死一战。十三根铁链，劈开了通往共和国之路。',
    labelPx: [-50, -18],
    imgNote: '泸定桥 · 实景照片',
    photoPos: '50% 50%',
    facts: ['1935.5.29', '一昼夜 240 里', '22 名勇士'],
  },
  {
    name: '雪山', date: '1935.06', title: '翻越夹金山', img: img6,
    text: '1935年6月，中央红军翻越海拔4000多米的夹金山。缺氧、严寒、暴风雪，这是长征中翻越的第一座大雪山。',
    meaning: '以钢铁意志征服自然天险。红军在极限环境中，保持了队伍的战斗意志。',
    labelPx: [-22, -40],
    imgNote: '夹金山 · 实景照片（新华社）',
    photoPos: '50% 50%',
    facts: ['1935.6', '海拔 4000+ m', '第一座大雪山'],
  },
  {
    name: '草地', date: '1935.08', title: '穿越松潘草地', img: img7,
    text: '1935年8月，红军进入茫茫沼泽草地。泥潭、暴雨、缺粮，许多战士牺牲在这片土地上。',
    meaning: '长征中最艰苦的一段行程。“金色的鱼钩”等故事，记录下绝境中的互助与信念。',
    labelPx: [33, -29],
    imgNote: '松潘草地 · 实景照片',
    photoPos: '50% 50%',
    facts: ['1935.8', '松潘草地', '最艰苦路段'],
  },
  {
    name: '吴起', date: '1935.10', title: '吴起镇会师', img: img8,
    text: '1935年10月19日，中央红军到达陕北吴起镇，与陕北红军会师。历时一年，行程二万五千里。',
    meaning: '中央红军长征胜利结束。1936年10月，三大主力在会宁、将台堡会师，长征取得全面胜利。',
    labelPx: [-48, -29],
    imgNote: '吴起长征胜利纪念园 · 实景照片',
    photoPos: '50% 50%',
    facts: ['1935.10.19', '二万五千里', '陕北会师'],
  },
];

const ROUTE = [
  { lon: 116.03, lat: 25.89, event: 0 },  // 瑞金
  { lon: 115.41, lat: 25.95 },             // 于都（夜渡于都河）
  { lon: 111.07, lat: 25.93, event: 1 },   // 湘江
  { lon: 109.78, lat: 26.16 },             // 通道
  { lon: 109.14, lat: 26.23 },             // 黎平
  { lon: 107.45, lat: 27.10 },             // 乌江
  { lon: 106.93, lat: 27.72, event: 2 },   // 遵义
  { lon: 105.60, lat: 28.00, event: 3 },   // 赤水（四渡赤水）
  { lon: 103.80, lat: 25.50 },             // 曲靖（威逼昆明）
  { lon: 102.20, lat: 26.10 },             // 皎平渡（巧渡金沙江）
  { lon: 102.25, lat: 26.65 },             // 会理
  { lon: 102.30, lat: 29.00 },             // 安顺场
  { lon: 102.23, lat: 29.91, event: 4 },   // 泸定
  { lon: 102.76, lat: 30.75, event: 5 },   // 夹金山
  { lon: 102.40, lat: 30.90 },             // 懋功
  { lon: 103.60, lat: 32.65, event: 6 },   // 松潘草地
  { lon: 103.60, lat: 34.15 },             // 腊子口
  { lon: 104.40, lat: 34.20 },             // 哈达铺
  { lon: 105.00, lat: 35.20 },             // 榜罗镇
  { lon: 107.30, lat: 36.57 },             // 环县
  { lon: 108.18, lat: 36.93, event: 7 },   // 吴起
];

// 延安：长征落脚点（1937 年中共中央进驻），作为终点星标，不进入 8 个史实卡片
const YANAN = { lon: 109.49, lat: 36.60 };

// —— 省名注记：锚点均落在本省区内部，并避开了 8 个史实节点及其标签 ——
// 北京 / 天津 / 上海 / 香港 / 澳门 / 海南 辖区太小或岛屿被 HUD 压住，dx/dy 用屏幕像素把名字
// 挑到海面或邻省上空，再由引线指回辖区；顺序也是屏幕空间避让的优先级（小辖区优先保名）。
const PROVINCES = [
  { name: '北京', lon: 116.4, lat: 39.9, dx: 22, dy: -26, lead: true },
  { name: '天津', lon: 117.45, lat: 39.35, dx: 38, dy: 12, lead: true },
  { name: '上海', lon: 121.5, lat: 31.3, dx: 40, dy: -12, lead: true },
  { name: '香港', lon: 114.17, lat: 22.32, dx: 38, dy: 18, lead: true },
  { name: '澳门', lon: 113.55, lat: 22.2, dx: -38, dy: 20, lead: true },
  { name: '海南', lon: 109.8, lat: 19.2, dx: 34, dy: -2, lead: true },
  { name: '台湾', lon: 121.0, lat: 23.75 },
  { name: '宁夏', lon: 106.0, lat: 36.9 },
  { name: '江苏', lon: 119.6, lat: 33.2 },
  { name: '浙江', lon: 119.9, lat: 29.2 },
  { name: '安徽', lon: 117.2, lat: 31.9 },
  { name: '福建', lon: 118.9, lat: 25.4 },
  { name: '江西', lon: 115.2, lat: 27.6 },
  { name: '湖南', lon: 111.8, lat: 27.7 },
  { name: '湖北', lon: 112.4, lat: 31.2 },
  { name: '广东', lon: 114.1, lat: 24.0 },
  { name: '广西', lon: 108.4, lat: 22.9 },
  { name: '贵州', lon: 105.0, lat: 24.8 },
  { name: '云南', lon: 100.8, lat: 24.7 },
  { name: '四川', lon: 104.9, lat: 31.5 },
  { name: '重庆', lon: 108.3, lat: 30.6 },
  { name: '陕西', lon: 109.0, lat: 34.9 },
  { name: '山西', lon: 112.6, lat: 35.5 },
  { name: '河北', lon: 115.7, lat: 38.9 },
  { name: '山东', lon: 118.4, lat: 36.3 },
  { name: '河南', lon: 113.6, lat: 33.9 },
  { name: '甘肃', lon: 100.8, lat: 38.6 },
  { name: '青海', lon: 96.6, lat: 35.6 },
  { name: '内蒙古', lon: 112.5, lat: 42.5 },
  { name: '辽宁', lon: 122.4, lat: 41.6 },
  { name: '吉林', lon: 126.4, lat: 43.6 },
  { name: '黑龙江', lon: 127.8, lat: 47.6 },
  { name: '新疆', lon: 84.5, lat: 41.6 },
  { name: '西藏', lon: 88.3, lat: 31.4 },
];

// 国民党中央军薛岳部追击路线：按有明确记载的主要节点复原（1934.10 赣南—1935.6 西昌）。
// 这是作战层面的追击主轴，不是逐日行军轨迹；川南各纵队的多次分进做了合并，未逐条单列。
const PURSUIT = [
  { lon: 116.33, lat: 26.31 }, // 石城（1934.10）
  { lon: 115.41, lat: 25.95 }, // 于都
  { lon: 114.94, lat: 25.83 }, // 赣州
  { lon: 113.02, lat: 25.77 }, // 郴州
  { lon: 112.57, lat: 26.89 }, // 衡阳（湘桂公路）
  { lon: 111.62, lat: 26.42 }, // 零陵
  { lon: 109.98, lat: 27.55 }, // 芷江
  { lon: 108.43, lat: 27.05 }, // 镇远
  { lon: 106.63, lat: 26.65 }, // 贵阳（1935.1）
  { lon: 106.93, lat: 27.72 }, // 遵义（吴奇伟纵队追堵）
  { lon: 106.37, lat: 27.82 }, // 茅台
  { lon: 105.29, lat: 27.30 }, // 毕节
  { lon: 103.80, lat: 25.49 }, // 曲靖
  { lon: 102.83, lat: 24.88 }, // 昆明（1935.4—5）
  { lon: 102.20, lat: 26.10 }, // 皎平渡（金沙江）
  { lon: 102.25, lat: 26.65 }, // 会理（1935.5）
  { lon: 102.27, lat: 27.90 }, // 西昌（1935.6）
];

// 长征途中次级事件：只做路线上的小点 + 悬停/点击小卡，不占 8 站时间轴，也不做全屏页。
const WAY_EVENTS = [
  {
    name: '通道转兵', date: '1934.12.12', lon: 109.78, lat: 26.16,
    text: '中央红军在湖南通道召开紧急会议，采纳毛泽东的建议，改向敌人力量薄弱的贵州前进，避免了北上湘西钻入敌人口袋的危险。',
  },
  {
    name: '黎平会议', date: '1934.12.18', lon: 109.14, lat: 26.23,
    text: '中共中央政治局在贵州黎平召开会议，正式放弃与红二、六军团会合的原定计划，改向黔北遵义地区前进。',
  },
  {
    name: '强渡乌江', date: '1935.1.1—6', lon: 107.45, lat: 27.10,
    text: '红军在江界河、回龙场等渡口突破乌江天险，为进占遵义打开通道。',
  },
  {
    name: '巧渡金沙江', date: '1935.5.3—9', lon: 102.20, lat: 26.10,
    text: '红军在皎平渡等渡口用 7 条小船，历时 7 天 7 夜渡过金沙江，摆脱了数十万敌军的追堵。',
  },
  {
    name: '懋功会师', date: '1935.6.12—18', lon: 102.40, lat: 30.90,
    text: '中央红军与红四方面军在四川懋功（今小金）会师。',
  },
  {
    name: '腊子口战斗', date: '1935.9.17', lon: 103.60, lat: 34.15,
    text: '红军攻克甘南腊子口天险，打开了北上甘陕的通道。',
  },
];

const app = document.getElementById('app');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x03060d);
scene.fog = new THREE.FogExp2(0x03060d, 0.0032);

const CAM_DIR = new THREE.Vector3(0.06, 0.74, 0.67).normalize();
const CAM_TARGET = new THREE.Vector3(0, 1.6, 1.2);
const CAM_DIST = FIT.height * 1.66;

const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.1, 1000);
camera.position.copy(CAM_DIR).multiplyScalar(CAM_DIST).add(CAM_TARGET);
camera.lookAt(CAM_TARGET);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
app.appendChild(renderer.domElement);

const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(innerWidth, innerHeight);
Object.assign(labelRenderer.domElement.style, {
  position: 'fixed', top: '0', left: '0', pointerEvents: 'none', zIndex: '2',
});
app.appendChild(labelRenderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.copy(CAM_TARGET);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.32;
controls.minDistance = 24;
controls.maxDistance = 150;
controls.maxPolarAngle = Math.PI * 0.46;

const hemi = new THREE.HemisphereLight(0xa8d4ff, 0x223040, 1.2);
scene.add(hemi);
const key = new THREE.DirectionalLight(0xbfdcff, 1.95);
key.position.set(48, 90, 36);
scene.add(key);
const warmKey = new THREE.DirectionalLight(0xff8a5c, 0.55);
warmKey.position.set(-45, 34, 18);
scene.add(warmKey);
const relief = new THREE.DirectionalLight(0xcfe4ff, 0.85);
relief.position.set(-60, 46, -38);
scene.add(relief);
const warm = new THREE.PointLight(0xff8f3f, 900, 120, 1.8);
warm.position.set(12, 26, 16);
scene.add(warm);

function project(lon, lat) {
  const [x, y] = albers(lon, lat);
  return new THREE.Vector2((x - FIT.cx) * FIT.scale, -(y - FIT.cy) * FIT.scale);
}

// 彩色分层设色贴图（没有烘焙山影；3D 地形的明暗来自真实法线与灯光）
const sideMat = new THREE.MeshStandardMaterial({
  color: 0x0a1a2b,
  emissive: 0x0c2238,
  emissiveIntensity: 0.45,
  metalness: 0.25,
  roughness: 0.8,
  side: THREE.DoubleSide,
});

// 分层设色（与 bake-terrain.mjs 同一套色带）：按高程直接给顶点上色，
// 这样陡坡上不会出现贴图沿竖直方向拉丝的伪影。
const ELEV_STOPS = [
  [-300, [56, 92, 66]],
  [0, [72, 112, 66]],
  [200, [104, 128, 64]],
  [500, [140, 138, 70]],
  [1000, [168, 146, 86]],
  [2000, [176, 128, 84]],
  [3000, [164, 118, 82]],
  [4000, [156, 124, 94]],
  [5000, [172, 146, 116]],
  [5600, [190, 170, 150]],
  [6200, [214, 210, 206]],
  [7000, [242, 244, 246]],
];
const tmpColor = new THREE.Color();
function elevationColor(e) {
  let i = 0;
  while (i < ELEV_STOPS.length - 1 && e > ELEV_STOPS[i + 1][0]) i++;
  const [e0, c0] = ELEV_STOPS[i];
  const [e1, c1] = ELEV_STOPS[Math.min(i + 1, ELEV_STOPS.length - 1)];
  const t = e1 === e0 ? 0 : Math.max(0, Math.min(1, (e - e0) / (e1 - e0)));
  let R = c0[0] + (c1[0] - c0[0]) * t;
  let G = c0[1] + (c1[1] - c0[1]) * t;
  let B = c0[2] + (c1[2] - c0[2]) * t;
  const snow = Math.max(0, Math.min(1, (e - 5900) / 900));
  R = R * (1 - snow) + 224 * snow;
  G = G * (1 - snow) + 228 * snow;
  B = B * (1 - snow) + 230 * snow;
  tmpColor.setRGB(R / 255, G / 255, B / 255, THREE.SRGBColorSpace);
  return tmpColor;
}

// 陆地遮罩（投影空间栅格）：地形用 alphaTest 按片元 UV(世界 XZ) 裁剪，
// 低角度时不会像屏幕空间模板那样把远山/海岸裁掉。
const landMaskTex = (() => {
  const Wp = 4096;
  const Hp = Math.round(Wp * FIT.height / FIT.width);
  const canvas = document.createElement('canvas');
  canvas.width = Wp;
  canvas.height = Hp;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, Wp, Hp);
  ctx.fillStyle = '#fff';
  ctx.filter = 'blur(3px)';
  for (const f of chinaData.features) {
    if (!f.geometry) continue;
    const adcode = f.properties && f.properties.adcode;
    if (adcode === '100000_JD') continue;
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const poly of polys) {
      if (!poly || !poly.length || !poly[0] || poly[0].length < 3) continue;
      if (ringMaxLat(poly[0]) < 17) continue;
      const path = new Path2D();
      for (const ring of poly) {
        ring.forEach(([lon, lat], i) => {
          const v = project(lon, lat);
          const px = (v.x / FIT.width + 0.5) * Wp;
          const py = (0.5 + v.y / FIT.height) * Hp;
          if (i) path.lineTo(px, py); else path.moveTo(px, py);
        });
        path.closePath();
      }
      ctx.fill(path, 'evenodd');
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tex;
})();

const terrainMat = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.95,
  metalness: 0,
  alphaMap: landMaskTex,
  alphaTest: 0.5,
});

// 省界压暗、国界/海岸线提亮：远看先读到完整的中国轮廓，再读到省界。
const edgeMat = new THREE.LineBasicMaterial({ color: 0xa8bcae, transparent: true, opacity: 0.26 });
const outlineMat = new THREE.LineBasicMaterial({ color: 0x93c2de, transparent: true, opacity: 0.9 });
const goldRimMat = new THREE.LineBasicMaterial({ color: 0xffb066, transparent: true, opacity: 0.38, toneMapped: false });

// 沿地形起伏画线（省界、国界、路线都用它贴地）
function addLine(ring, mat, lift) {
  const pts = ring.map(([lon, lat]) => {
    const v = project(lon, lat);
    return new THREE.Vector3(v.x, meshY(v.x, v.y) + lift, v.y);
  });
  scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat));
}

function ringMaxLat(ring) {
  let m = -90;
  for (const [, lat] of ring) if (lat > m) m = lat;
  return m;
}

function buildProvince(feature) {
  const g = feature.geometry;
  if (!g) return;
  const adcode = feature.properties && feature.properties.adcode;
  if (adcode === '100000_JD') return; // 九段线单独画进南海诸岛小图
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  for (const poly of polys) {
    if (!poly || !poly.length || !poly[0] || poly[0].length < 3) continue;
    if (ringMaxLat(poly[0]) < 17) continue; // 远海岛礁交给小图
    const shape = new THREE.Shape();
    poly.forEach((ring, ri) => {
      // ExtrudeGeometry works in the XY plane and extrudes along +Z; after rotateX(-90deg)
      // shape Y maps to world -Z. Everything else (route, labels, borders) uses project()
      // directly, so negate Y here to keep the extruded landmass in the same plane.
      const pts = ring.map(([lon, lat]) => {
        const v = project(lon, lat);
        return new THREE.Vector2(v.x, -v.y);
      });
      if (ri === 0) {
        shape.setFromPoints(pts);
      } else {
        const hole = new THREE.Path();
        hole.setFromPoints(pts);
        shape.holes.push(hole);
      }
    });
    // 底座（plinth）：暗色，提供沙盘的厚度
    const geo = new THREE.ExtrudeGeometry(shape, { depth: TOP_H, bevelEnabled: false, curveSegments: 1 });
    geo.rotateX(-Math.PI / 2);
    scene.add(new THREE.Mesh(geo, sideMat));


    for (const ring of poly) addLine(ring, edgeMat, 0.05);
  }
}
chinaData.features.forEach(buildProvince);

// —— 3D 地形高度场（一个覆盖包围盒的网格，按陆地遮罩裁到中国轮廓内）——
const terrainGeo = new THREE.BufferGeometry();
{
  const vertexCount = (TERRAIN_NX + 1) * (TERRAIN_NY + 1);
  const positions = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const indices = [];
  let p = 0, c = 0, u = 0;
  for (let j = 0; j <= TERRAIN_NY; j++) {
    const z = -FIT.height / 2 + (j / TERRAIN_NY) * FIT.height;
    for (let i = 0; i <= TERRAIN_NX; i++) {
      const x = -FIT.width / 2 + (i / TERRAIN_NX) * FIT.width;
      const e = TERRAIN_GRID[j * (TERRAIN_NX + 1) + i];
      positions[p++] = x;
      positions[p++] = TERRAIN_BASE + e * ELEV_SCALE;
      positions[p++] = z;
      const col = elevationColor(e);
      colors[c++] = col.r;
      colors[c++] = col.g;
      colors[c++] = col.b;
      uvs[u++] = x / FIT.width + 0.5;
      uvs[u++] = 0.5 - z / FIT.height;
    }
  }
  for (let j = 0; j < TERRAIN_NY; j++) {
    for (let i = 0; i < TERRAIN_NX; i++) {
      const a = j * (TERRAIN_NX + 1) + i;
      const b = a + 1;
      const c2 = a + TERRAIN_NX + 1;
      const d = c2 + 1;
      indices.push(a, c2, b, b, c2, d);
    }
  }
  terrainGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  terrainGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  terrainGeo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  terrainGeo.setIndex(indices);
  terrainGeo.computeVertexNormals();
}
const terrainMesh = new THREE.Mesh(terrainGeo, terrainMat);
terrainMesh.name = 'terrain';
terrainMesh.renderOrder = 2;
scene.add(terrainMesh);

// 等高线：每隔 1000 m 在真实高程处切一条线，强化山体的立体层次
function buildContours() {
  const levels = [1000, 2000, 3000, 4000, 5000, 6000];
  const step = 2;
  const w = TERRAIN_NX + 1;
  const pos = [];
  const col = [];
  const push = (x0, z0, x1, z1, lvl) => {
    pos.push(x0, meshY(x0, z0) + 0.035, z0, x1, meshY(x1, z1) + 0.035, z1);
    const b = 0.66 + (lvl / 6000) * 0.34;
    col.push(b * 0.82, b * 0.9, b, b * 0.82, b * 0.9, b);
  };
  for (const lvl of levels) {
    for (let j = 0; j < TERRAIN_NY; j += step) {
      const j2 = Math.min(j + step, TERRAIN_NY);
      const z0 = -FIT.height / 2 + (j / TERRAIN_NY) * FIT.height;
      const z1 = -FIT.height / 2 + (j2 / TERRAIN_NY) * FIT.height;
      for (let i = 0; i < TERRAIN_NX; i += step) {
        const i2 = Math.min(i + step, TERRAIN_NX);
        const x0 = -FIT.width / 2 + (i / TERRAIN_NX) * FIT.width;
        const x1 = -FIT.width / 2 + (i2 / TERRAIN_NX) * FIT.width;
        const h00 = TERRAIN_GRID[j * w + i];
        const h10 = TERRAIN_GRID[j * w + i2];
        const h11 = TERRAIN_GRID[j2 * w + i2];
        const h01 = TERRAIN_GRID[j2 * w + i];
        const cross = (a, b) => (a < lvl) !== (b < lvl);
        const pts = [];
        if (cross(h00, h10)) { const t = (lvl - h00) / (h10 - h00); pts.push(x0 + (x1 - x0) * t, z0); }
        if (cross(h10, h11)) { const t = (lvl - h10) / (h11 - h10); pts.push(x1, z0 + (z1 - z0) * t); }
        if (cross(h11, h01)) { const t = (lvl - h11) / (h01 - h11); pts.push(x1 + (x0 - x1) * t, z1); }
        if (cross(h01, h00)) { const t = (lvl - h01) / (h00 - h01); pts.push(x0, z1 + (z0 - z1) * t); }
        if (pts.length === 4) push(pts[0], pts[1], pts[2], pts[3], lvl);
        else if (pts.length === 8) {
          push(pts[0], pts[1], pts[2], pts[3], lvl);
          push(pts[4], pts[5], pts[6], pts[7], lvl);
        }
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const mesh = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.3, depthWrite: false, toneMapped: false,
  }));
  mesh.name = 'contours';
  mesh.renderOrder = 3;
  scene.add(mesh);
}
buildContours();

// 国界 / 海岸线：单独一层亮线，构成清晰的国家轮廓
for (const f of chinaOutline.features) {
  if (!f.geometry) continue;
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const poly of polys) for (const ring of poly) {
    if (ringMaxLat(ring) < 17) continue;
    addLine(ring, outlineMat, 0.09);
    // 沙盘底边的暗金细线：低角度看像展台的一圈金属包边
    const rimPts = [];
    for (const [lon, lat] of ring) {
      const v = project(lon, lat);
      const len = Math.hypot(v.x, v.y) || 1;
      rimPts.push(new THREE.Vector3(v.x + (v.x / len) * 0.03, TOP_H - 0.19, v.y + (v.y / len) * 0.03));
    }
    scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(rimPts), goldRimMat));
  }
}

// 侧裙：把地形边缘（海岸/国界）从地表高度垂直补到沙盘底座，避免露出缺口
{
  const positions = [];
  const indices = [];
  let baseIndex = 0;
  for (const f of chinaOutline.features) {
    if (!f.geometry) continue;
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const poly of polys) for (const ring of poly) {
      if (ringMaxLat(ring) < 17 || ring.length < 3) continue;
      const n = ring.length;
      for (const [lon, lat] of ring) {
        const v = project(lon, lat);
        const top = meshY(v.x, v.y) - 0.015;
        positions.push(v.x, top, v.y);
        positions.push(v.x, TOP_H - 0.2, v.y);
      }
      for (let i = 0; i < n; i++) {
        const a = baseIndex + i * 2;
        const b = baseIndex + ((i + 1) % n) * 2;
        indices.push(a, a + 1, b, b, a + 1, b + 1);
      }
      baseIndex += n * 2;
    }
  }
  const skirtGeo = new THREE.BufferGeometry();
  skirtGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  skirtGeo.setIndex(indices);
  skirtGeo.computeVertexNormals();
  const skirt = new THREE.Mesh(skirtGeo, sideMat);
  skirt.name = 'land-skirt';
  skirt.renderOrder = 0;
  scene.add(skirt);
}

// 南海诸岛小图：把远海岛礁与九段线收进右下角，符合中国地图的常规表达
function buildSCSInset() {
  const rings = [];
  const jd = chinaData.features.find((f) => f.properties && f.properties.adcode === '100000_JD');
  if (jd && jd.geometry) {
    const polys = jd.geometry.type === 'Polygon' ? [jd.geometry.coordinates] : jd.geometry.coordinates;
    for (const poly of polys) for (const ring of poly) rings.push({ ring, dash: true });
  }
  for (const f of chinaOutline.features) {
    if (!f.geometry) continue;
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const poly of polys) for (const ring of poly) {
      if (ringMaxLat(ring) < 17) rings.push({ ring, dash: false });
    }
  }
  if (!rings.length) return;

  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const { ring } of rings) for (const [lon, lat] of ring) {
    minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon);
    minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
  }

  const wrap = document.createElement('div');
  wrap.className = 'scs';
  const canvas = document.createElement('canvas');
  const scale = Math.min(devicePixelRatio, 2);
  const cw = 200, ch = 230;
  canvas.width = Math.round(cw * scale);
  canvas.height = Math.round(ch * scale);
  wrap.appendChild(canvas);
  const tag = document.createElement('span');
  tag.className = 'scs-tag';
  tag.textContent = '南海诸岛';
  wrap.appendChild(tag);
  document.body.appendChild(wrap);

  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  const pad = 12;
  const s = Math.min((cw - pad * 2) / (maxLon - minLon), (ch - pad * 2 - 14) / (maxLat - minLat));
  const ox = (cw - (maxLon - minLon) * s) / 2;
  const oy = (ch - (maxLat - minLat) * s) / 2 + 8;
  const px = (lon) => ox + (lon - minLon) * s;
  const py = (lat) => oy + (maxLat - lat) * s;

  ctx.lineJoin = 'round';
  for (const { ring, dash } of rings) {
    ctx.beginPath();
    ring.forEach(([lon, lat], i) => {
      const x = px(lon);
      const y = py(lat);
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    });
    ctx.closePath();
    if (dash) {
      ctx.fillStyle = 'rgba(160, 226, 255, .9)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(160, 226, 255, .9)';
      ctx.lineWidth = 1.3;
      ctx.stroke();
    } else {
      ctx.fillStyle = 'rgba(30, 70, 108, .9)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(138, 216, 255, .7)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
}
buildSCSInset();

function radialTexture(inner, outer) {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const grd = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, inner);
  grd.addColorStop(0.35, outer);
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const glowTex = radialTexture('rgba(255,245,220,1)', 'rgba(255,140,50,0.55)');
const softGlowTex = radialTexture('rgba(255,220,180,0.85)', 'rgba(255,120,40,0.3)');

function cssLabel(text, px = 0, py = 0, no = '') {
  const div = document.createElement('div');
  div.className = 'lbl';
  // The inner box carries the styling and is shifted in screen pixels so labels keep a
  // constant distance from their node at every zoom level (the outer div is the anchor).
  const box = document.createElement('span');
  box.className = 'lbl-box';
  if (no) {
    const num = document.createElement('span');
    num.className = 'lbl-no';
    num.textContent = no;
    box.appendChild(num);
  }
  box.appendChild(document.createTextNode(text));
  box.style.setProperty('--lx', px + 'px');
  box.style.setProperty('--ly', py + 'px');
  div.style.setProperty('--lbl-line', Math.hypot(px, py) + 'px');
  div.style.setProperty('--lbl-angle', Math.atan2(py, px) + 'rad');
  div.appendChild(box);
  const obj = new CSS2DObject(div);
  obj.center.set(0.5, 0.5);
  return obj;
}

const routePts = ROUTE.map((p) => {
  const v = project(p.lon, p.lat);
  return new THREE.Vector3(v.x, 0, v.y);
});

// Chaikin 切角：长征路线多急转弯，直接 Catmull-Rom 会在拐点处打结；
// 先做两轮切角再插值，线形接近参考图里的圆滑路线。
function chaikin(points, iterations = 3) {
  let pts = points;
  for (let k = 0; k < iterations; k++) {
    const out = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      out.push(a.clone().lerp(b, 0.25));
      out.push(a.clone().lerp(b, 0.75));
    }
    out.push(pts[pts.length - 1]);
    pts = out;
  }
  return pts;
}
// 贴地：切角后的平面路线逐点采样高程，抬高 0.16，避免钻进山体
const routeSmooth = chaikin(routePts, 3).map((p) => (
  new THREE.Vector3(p.x, meshY(p.x, p.z) + 0.16, p.z)
));
const curve = new THREE.CatmullRomCurve3(routeSmooth, false, 'centripetal', 0.5);

function curveUAt(point) {
  let best = 0;
  let bestD = Infinity;
  const N = 1000;
  for (let i = 0; i <= N; i++) {
    const p = curve.getPointAt(i / N);
    const dx = p.x - point.x;
    const dz = p.z - point.z;
    const d = dx * dx + dz * dz;
    if (d < bestD) { bestD = d; best = i / N; }
  }
  return best;
}

const routeU = routePts.map(curveUAt);
EVENTS.forEach((ev, i) => {
  const routeIndex = ROUTE.findIndex((p) => p.event === i);
  ev.routeIndex = routeIndex;
  ev.u = routeU[routeIndex];
  ev.pos = curve.getPointAt(ev.u);
});

const casingGeo = new THREE.TubeGeometry(curve, 600, 0.145, 8, false);
const casing = new THREE.Mesh(casingGeo, new THREE.MeshBasicMaterial({ color: 0x170d06, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.BackSide }));
casing.renderOrder = 1;
scene.add(casing);

const tubeGeo = new THREE.TubeGeometry(curve, 600, 0.1, 8, false);
const tube = new THREE.Mesh(tubeGeo, new THREE.MeshBasicMaterial({ color: 0xff8a3a, toneMapped: false }));
tube.renderOrder = 2;
scene.add(tube);

const haloGeo = new THREE.TubeGeometry(curve, 300, 0.32, 8, false);
const halo = new THREE.Mesh(haloGeo, new THREE.MeshBasicMaterial({
  color: 0xff6a1a, transparent: true, opacity: 0.15, blending: THREE.AdditiveBlending, depthWrite: false,
}));
scene.add(halo);

// —— 国民党中央军薛岳部追击路线：蓝色实线，默认显示 ——
const pursuitGroup = new THREE.Group();
pursuitGroup.visible = true;
scene.add(pursuitGroup);

const pursuitCurve = (() => {
  const pts = PURSUIT.map(({ lon, lat }) => {
    const v = project(lon, lat);
    return new THREE.Vector3(v.x, 0, v.y);
  });
  const smooth = chaikin(pts, 2).map((p) => new THREE.Vector3(p.x, meshY(p.x, p.z) + 0.14, p.z));
  return new THREE.CatmullRomCurve3(smooth, false, 'centripetal', 0.5);
})();

{
  // 与红军主线同一套“管线 + 暗色包边 + 光晕”的语言，但更细、更冷，保证主次
  const casing = new THREE.Mesh(
    new THREE.TubeGeometry(pursuitCurve, 600, 0.11, 8, false),
    new THREE.MeshBasicMaterial({
      color: 0x03101c, transparent: true, opacity: 0.55,
      depthWrite: false, side: THREE.BackSide,
    })
  );
  casing.renderOrder = 1;
  pursuitGroup.add(casing);

  const tube = new THREE.Mesh(
    new THREE.TubeGeometry(pursuitCurve, 600, 0.07, 8, false),
    new THREE.MeshBasicMaterial({ color: 0x4f8fc4, toneMapped: false })
  );
  tube.renderOrder = 2;
  pursuitGroup.add(tube);

  const halo = new THREE.Mesh(
    new THREE.TubeGeometry(pursuitCurve, 300, 0.22, 8, false),
    new THREE.MeshBasicMaterial({
      color: 0x1e5f8f, transparent: true, opacity: 0.07,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    })
  );
  pursuitGroup.add(halo);
}

// 路线末端的小注记：投影模式下图例会被隐藏，仍能说明这条蓝线是谁
const pursuitLabel = cssLabel('薛岳部追击', -58, -6);
pursuitLabel.element.classList.add('kmt');
pursuitLabel.element.querySelector('.lbl-box').style.pointerEvents = 'none';
const pursuitEnd = project(102.27, 27.90);
pursuitLabel.position.set(pursuitEnd.x, meshY(pursuitEnd.x, pursuitEnd.y) + 0.45, pursuitEnd.y);
pursuitLabel.visible = true;
scene.add(pursuitLabel);

const pursuitEndDot = new THREE.Mesh(
  new THREE.SphereGeometry(0.09, 12, 12),
  new THREE.MeshBasicMaterial({ color: 0x9fd0f0, toneMapped: false })
);
pursuitEndDot.position.set(pursuitEnd.x, meshY(pursuitEnd.x, pursuitEnd.y) + 0.28, pursuitEnd.y);
pursuitGroup.add(pursuitEndDot);

// —— 途中次级事件点：CSS2D 小菱形，悬停提示 / 点击小卡；做屏幕避让，不压主站标签 ——
const wayDots = [];
WAY_EVENTS.forEach((ev, i) => {
  const p = project(ev.lon, ev.lat);
  const u = curveUAt(new THREE.Vector3(p.x, 0, p.y));
  const pos = curve.getPointAt(u);
  const el = document.createElement('div');
  el.className = 'way-dot';
  const dot = document.createElement('i');
  el.appendChild(dot);
  const obj = new CSS2DObject(el);
  obj.center.set(0.5, 0.5);
  obj.position.set(pos.x, pos.y + 0.3, pos.z);
  scene.add(obj);
  dot.addEventListener('pointerenter', (e) => showWayTip(i, e.clientX, e.clientY));
  dot.addEventListener('pointermove', (e) => showWayTip(i, e.clientX, e.clientY));
  dot.addEventListener('pointerleave', hideWayTip);
  dot.addEventListener('click', (e) => {
    e.stopPropagation();
    stopTour();
    openWayEvent(i);
  });
  wayDots.push({ el, dot, obj });
});

const labelEls = [];
const routeMarkers = [];
const pickables = [];

routePts.forEach((_, i) => {
  const pos = curve.getPointAt(routeU[i]);
  const evIndex = ROUTE[i].event;
  const isEvent = evIndex !== undefined;

  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(isEvent ? 0.14 : 0.08, 16, 16),
    new THREE.MeshBasicMaterial({ color: isEvent ? 0xffd9a8 : 0xffb27a, toneMapped: false })
  );
  sphere.position.copy(pos);
  scene.add(sphere);

  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: isEvent ? glowTex : softGlowTex, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  glow.position.copy(pos);
  glow.scale.setScalar(isEvent ? 1.7 : 0.9);
  scene.add(glow);

  const marker = { glow, sphere, base: isEvent ? 1.7 : 0.9, phase: Math.random() * Math.PI * 2, u: routeU[i] };
  routeMarkers.push(marker);

  if (isEvent) {
    const ev = EVENTS[evIndex];
    const label = cssLabel(ev.name, ev.labelPx[0], ev.labelPx[1], String(evIndex + 1).padStart(2, '0'));
    label.position.set(pos.x, pos.y + 0.5, pos.z);
    label.element.addEventListener('click', (e) => {
      e.stopPropagation();
      selectEvent(evIndex);
    });
    scene.add(label);
    labelEls[evIndex] = label;
    marker.label = label;

    const pick = new THREE.Mesh(
      new THREE.SphereGeometry(1.15, 8, 8),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
    );
    pick.position.copy(pos);
    pick.userData.event = evIndex;
    scene.add(pick);
    pickables.push(pick);
  }
});

// —— 延安落脚点：星标 + 虚线与“延安”注记（不属于 8 个史实节点） ——
const destStarTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  ctx.translate(64, 64);
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 22 : 50;
    const a = -Math.PI / 2 + i * Math.PI / 5;
    ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.closePath();
  const grd = ctx.createRadialGradient(0, 0, 0, 0, 0, 64);
  grd.addColorStop(0, 'rgba(255, 246, 214, 1)');
  grd.addColorStop(0.45, 'rgba(255, 196, 100, 0.95)');
  grd.addColorStop(1, 'rgba(255, 140, 40, 0)');
  ctx.fillStyle = grd;
  ctx.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
})();
const yananP = project(YANAN.lon, YANAN.lat);
const yananPos = new THREE.Vector3(yananP.x, meshY(yananP.x, yananP.y) + 0.5, yananP.y);
const yananStar = new THREE.Sprite(new THREE.SpriteMaterial({
  map: destStarTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
}));
yananStar.position.copy(yananPos);
yananStar.scale.setScalar(1.6);
scene.add(yananStar);

const wuqiPos = curve.getPointAt(1);
const yananLineGeo = new THREE.BufferGeometry().setFromPoints([
  new THREE.Vector3(wuqiPos.x, wuqiPos.y + 0.12, wuqiPos.z),
  new THREE.Vector3(yananPos.x, yananPos.y + 0.06, yananPos.z),
]);
const yananLine = new THREE.Line(yananLineGeo, new THREE.LineDashedMaterial({
  color: 0xffc27a, dashSize: 0.34, gapSize: 0.26, transparent: true, opacity: 0.8, toneMapped: false,
}));
yananLine.computeLineDistances();
scene.add(yananLine);

const yananLabel = cssLabel('延安', 44, 2);
yananLabel.element.classList.add('dest');
yananLabel.position.set(yananPos.x, yananPos.y + 0.5, yananPos.z);
yananLabel.element.querySelector('.lbl-box').style.pointerEvents = 'none';
scene.add(yananLabel);

// —— 省名层：CSS2D 常显，按屏幕空间避让，不与节点标签叠字 ——
const provItems = [];
PROVINCES.forEach((prov) => {
  const p = project(prov.lon, prov.lat);
  const el = document.createElement('div');
  el.className = prov.lead ? 'prov lead' : 'prov';
  const txt = document.createElement('span');
  txt.className = 'prov-txt';
  txt.textContent = prov.name;
  const dx = prov.dx || 0;
  const dy = prov.dy || 0;
  if (dx || dy) {
    txt.style.setProperty('--lx', dx + 'px');
    txt.style.setProperty('--ly', dy + 'px');
  }
  if (prov.lead) {
    el.style.setProperty('--lead-len', Math.max(8, Math.hypot(dx, dy) - 16) + 'px');
    el.style.setProperty('--lead-angle', Math.atan2(dy, dx) + 'rad');
  }
  el.appendChild(txt);
  const obj = new CSS2DObject(el);
  obj.center.set(0.5, 0.5);
  obj.position.set(p.x, meshY(p.x, p.y) + 0.42, p.y);
  scene.add(obj);
  provItems.push({ el, txt, hidden: false });
});

const ring = new THREE.Mesh(
  new THREE.RingGeometry(0.9, 1.04, 64),
  new THREE.MeshBasicMaterial({ color: 0xffc27a, transparent: true, opacity: 0.95, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })
);
ring.rotation.x = -Math.PI / 2;
ring.visible = false;
scene.add(ring);

const comets = [];
for (let i = 0; i < 3; i++) {
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  sp.scale.setScalar(i === 0 ? 2.6 : 1.7);
  scene.add(sp);
  comets.push({ sp, offset: i * 0.035 });
}

const starGeo = new THREE.BufferGeometry();
const starCount = 1600;
const starPos = new Float32Array(starCount * 3);
for (let i = 0; i < starCount; i++) {
  const r = 120 + Math.random() * 160;
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.acos(THREE.MathUtils.randFloat(-0.15, 1));
  starPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
  starPos[i * 3 + 1] = r * Math.cos(phi) * 0.55 + 8;
  starPos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
}
starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
const starTex = radialTexture('rgba(255,255,255,0.95)', 'rgba(150,200,255,0.5)');
const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
  color: 0x9fc4e8, map: starTex, size: 0.62, transparent: true, opacity: 0.7,
  sizeAttenuation: true, depthWrite: false, alphaTest: 0.01,
  blending: THREE.AdditiveBlending,
}));
scene.add(stars);

const groundTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const ctx = c.getContext('2d');
  const grd = ctx.createRadialGradient(256, 256, 30, 256, 256, 256);
  grd.addColorStop(0, 'rgba(30, 70, 120, 0.35)');
  grd.addColorStop(0.55, 'rgba(12, 32, 60, 0.18)');
  grd.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, 512, 512);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(190, 150),
  new THREE.MeshBasicMaterial({ map: groundTex, transparent: true, depthWrite: false })
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -1.4;
scene.add(ground);

const warmGroundTex = radialTexture('rgba(255, 190, 110, 0.32)', 'rgba(255, 120, 40, 0.06)');
const underglow = new THREE.Mesh(
  new THREE.PlaneGeometry(172, 142),
  new THREE.MeshBasicMaterial({ map: warmGroundTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.10 })
);
underglow.rotation.x = -Math.PI / 2;
underglow.position.y = -1.3;
scene.add(underglow);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.8, 0.5, 0.55);
composer.addPass(bloom);

const cardEl = document.getElementById('card');
const cardImg = document.getElementById('cardImg');
const aiNote = document.getElementById('aiNote');
const cardDate = document.getElementById('cardDate');
const cardTitle = document.getElementById('cardTitle');
const cardText = document.getElementById('cardText');
const cardMeaning = document.getElementById('cardMeaning');
const playBtn = document.getElementById('playBtn');
const tlDate = document.getElementById('tlDate');
const tlFill = document.getElementById('tlFill');
const tlTrack = document.getElementById('tlTrack');
const tlTicks = document.getElementById('tlTicks');
const stopsEl = document.getElementById('stops');
const stopsToggle = document.getElementById('stopsToggle');
const stopsList = document.getElementById('stopsList');
const dhAlt = document.getElementById('dhAlt');
const dhStation = document.getElementById('dhStation');
const dhChart = document.getElementById('dhChart');
const dhCaption = document.querySelector('.data-hud .dh-caption');
const tlDist = document.getElementById('tlDist');
const tlRemain = document.getElementById('tlRemain');
const tlStation = document.getElementById('tlStation');
const tourBtn = document.getElementById('tourBtn');
const themeButtons = Array.from(document.querySelectorAll('.theme-switch button[data-theme]'));
const provBtn = document.getElementById('provBtn');
const pursuitBtn = document.getElementById('pursuitBtn');
const wayBtn = document.getElementById('wayBtn');
const wayCard = document.getElementById('wayCard');
const wayClose = document.getElementById('wayClose');
const wayDate = document.getElementById('wayDate');
const wayTitle = document.getElementById('wayTitle');
const wayText = document.getElementById('wayText');
const wayTip = document.getElementById('wayTip');
const locatorCanvas = document.getElementById('locator');
const cardFactsEl = document.getElementById('cardFacts');
const scaleBar = document.querySelector('.scale-bar');
const scaleTxt = document.querySelector('.scale-txt');
const stopRows = [];
const cardSource = document.getElementById('cardSource');
const storyBack = document.getElementById('storyBack');
const storyPrev = document.getElementById('storyPrev');
const storyNext = document.getElementById('storyNext');
const storyIndex = document.getElementById('storyIndex');
const storyYear = document.getElementById('storyYear');
const storyCredit = document.getElementById('storyCredit');
const storySource = document.getElementById('storySource');
const storyRail = document.getElementById('storyRail');
const presentBtn = document.getElementById('presentBtn');
const loaderEl = document.getElementById('loader');
const diveFlash = document.getElementById('diveFlash');

const tickEls = EVENTS.map((ev, i) => {
  const btn = document.createElement('button');
  btn.className = 'tick';
  btn.style.left = `${ev.u * 100}%`;
  btn.title = `${ev.date} ${ev.title}`;
  btn.innerHTML = `<span class="dot"></span><span class="nm">${ev.name}</span>`;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    stopTour();
    selectEvent(i);
  });
  tlTicks.appendChild(btn);
  return btn;
});

let progress = 0;
let playing = false;
let selected = -1;
let lastDateText = '';
let flyState = null;
let playFrom = 0;
let playStart = 0;
let intro = { active: true, start: performance.now() };

function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
function easeInOutCubic(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

function dateTextFor(p) {
  if (selected >= 0) return `${EVENTS[selected].date} · ${EVENTS[selected].title}`;
  if (!playing && p >= 0.999) return '1934—1935 · 二万五千里';
  let idx = 0;
  for (let i = 0; i < EVENTS.length; i++) {
    if (EVENTS[i].u <= p + 0.0005) idx = i;
  }
  return `${EVENTS[idx].date} · ${EVENTS[idx].name}`;
}

function updateTimelineUI() {
  tlFill.style.width = `${progress * 100}%`;
  tickEls.forEach((el, i) => {
    el.classList.toggle('passed', EVENTS[i].u <= progress + 0.0005);
    el.classList.toggle('active', i === selected);
  });
  const txt = dateTextFor(progress);
  if (txt !== lastDateText) {
    lastDateText = txt;
    tlDate.textContent = txt;
  }
  updateProgressInfo();
}

function setProgress(p) {
  progress = THREE.MathUtils.clamp(p, 0, 1);
  const tubeCount = tubeGeo.index.count;
  const haloCount = haloGeo.index.count;
  tubeGeo.setDrawRange(0, Math.floor(tubeCount * progress));
  haloGeo.setDrawRange(0, Math.floor(haloCount * progress));
  routeMarkers.forEach((m) => {
    const vis = progress >= m.u - 0.001;
    m.sphere.visible = vis;
    m.glow.visible = vis;
    if (m.label) m.label.visible = vis;
  });
  updateTimelineUI();
}

const SOURCE_TEXT = '史实依据：《中国共产党简史》（人民出版社，2021）；《中共中央关于党的百年奋斗重大成就和历史经验的决议》。';
const PHOTO_BRIGHT = [0.98, 1.08, 1.0, 1.02, 1.03, 0.97, 1.0, 1.02];
let storyToken = 0;
const storyRailEls = [];

function buildStoryRail() {
  if (!storyRail) return;
  EVENTS.forEach((ev, i) => {
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'rail-dot';
    dot.style.left = (ev.u * 100) + '%';
    dot.title = ev.date + ' ' + ev.name;
    const num = document.createElement('span');
    num.textContent = String(i + 1).padStart(2, '0');
    dot.appendChild(num);
    dot.addEventListener('click', (e) => {
      e.stopPropagation();
      stopTour();
      selectEvent(i, { fly: false });
    });
    storyRail.appendChild(dot);
    storyRailEls.push(dot);
  });
}

function updateStoryRail(i) {
  storyRailEls.forEach((dot, idx) => {
    dot.classList.toggle('active', idx === i);
    dot.classList.toggle('passed', idx <= i);
  });
}

function fillCard(i) {
  const ev = EVENTS[i];
  cardImg.src = ev.img;
  cardImg.alt = ev.title;
  cardImg.style.objectPosition = ev.photoPos || 'center';
  cardEl.style.setProperty('--photo-pos', ev.photoPos || 'center');
  cardEl.style.setProperty('--photo-bright', String(PHOTO_BRIGHT[i] || 0.97));
  aiNote.textContent = ev.imgNote || '实景照片 · 图源：公开资料';
  cardDate.textContent = ev.date;
  cardTitle.textContent = ev.title;
  cardText.textContent = ev.text;
  cardMeaning.textContent = ev.meaning;
  if (storyCredit) {
    storyCredit.textContent = '图片：' + (ev.imgNote || '实景照片 · 图源：公开资料');
  }
  if (storySource) storySource.textContent = SOURCE_TEXT;
  if (storyYear) storyYear.textContent = (ev.date.match(/\d{4}/) || ['1935'])[0];
  cardFactsEl.innerHTML = '';
  const facts = ev.facts || [];
  for (let k = 0; k < facts.length; k++) {
    const chip = document.createElement('span');
    chip.className = 'fact';
    chip.textContent = facts[k];
    cardFactsEl.appendChild(chip);
  }
  drawLocator(i);
  if (storyIndex) storyIndex.textContent = String(i + 1).padStart(2, '0') + ' / 08';
  if (storyPrev) storyPrev.disabled = i === 0;
  if (storyNext) storyNext.disabled = i === EVENTS.length - 1;
  updateStoryRail(i);
}

function revealCard() {
  cardEl.classList.add('story', 'open');
  cardEl.setAttribute('aria-hidden', 'false');
  document.body.classList.add('card-open', 'story-open');
  if (diveFlash) {
    diveFlash.classList.remove('on');
    void diveFlash.offsetWidth;
    diveFlash.classList.add('on');
  }
}

function hideCard() {
  cardEl.classList.remove('open');
  cardEl.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('story-open');
  window.setTimeout(() => {
    if (cardEl.classList.contains('open')) return;
    cardEl.classList.remove('story');
    document.body.classList.remove('card-open');
  }, 420);
}

function openCard(i) {
  fillCard(i);
  revealCard();
}

function closeCard() {
  storyToken += 1;
  hideCard();
  labelEls.forEach((l) => l?.element.classList.remove('dim'));
  if (selected >= 0) {
    labelEls[selected]?.element.classList.remove('active');
    selected = -1;
    ring.visible = false;
    updateTimelineUI();
    if (!playing) resetView();
  }
}

function animateCamera(toPos, toTarget, dur = 1.15, onDone = null) {
  flyState = {
    t: 0,
    dur,
    fromPos: camera.position.clone(),
    toPos: toPos.clone(),
    fromTarget: controls.target.clone(),
    toTarget: toTarget.clone(),
    onDone,
  };
  controls.enabled = false;
  controls.autoRotate = false;
}



function flyTo(pos, onDone = null) {
  // 信息页会盖住终点，所以可以比原来俯冲得更近，收尾由页面淡入接住
  const dist = CAM_DIST * 0.62;
  const dir = camera.position.clone().sub(pos).normalize();
  if (dir.lengthSq() < 1e-6) dir.set(0.06, 0.74, 0.67).normalize();
  const target = pos.clone();
  animateCamera(target.clone().add(dir.multiplyScalar(dist)), target, 1.15, onDone);
}

function resetView() {
  animateCamera(CAM_DIR.clone().multiplyScalar(CAM_DIST).add(CAM_TARGET), CAM_TARGET.clone(), 1.25);
}

function selectEvent(i, opts = {}) {
  if (i < 0 || i >= EVENTS.length) return;
  closeWayCard();
  if (playing) pause();
  intro.active = false;
  const wasOpen = cardEl.classList.contains('open');
  const token = ++storyToken;
  // 信息页与时间轴保持同步：选中站点时，进度条也退回到该站点
  if (Math.abs(progress - EVENTS[i].u) > 0.001) setProgress(EVENTS[i].u);
  if (selected >= 0) labelEls[selected]?.element.classList.remove('active');
  selected = i;
  labelEls.forEach((l, idx) => {
    if (l) l.element.classList.toggle('dim', idx !== i);
  });
  labelEls[i]?.element.classList.add('active');
  if (opts.fly !== false && wasOpen) hideCard();
  fillCard(i);
  ring.visible = true;
  ring.position.copy(EVENTS[i].pos);
  ring.position.y = EVENTS[i].pos.y + 0.05;
  controls.autoRotate = false;
  if (opts.fly === false) {
    revealCard();
  } else {
    flyTo(EVENTS[i].pos, () => {
      if (token === storyToken) revealCard();
    });
  }
  updateTimelineUI();
}

function play() {
  stopTour();
  if (cardEl.classList.contains('open')) closeCard();
  if (progress >= 0.999) setProgress(0);
  intro.active = false;
  playing = true;
  playFrom = progress;
  playStart = performance.now();
  playBtn.textContent = '❚❚';
  controls.autoRotate = false;
  updateTimelineUI();
}

function pause() {
  playing = false;
  playBtn.textContent = '▶';
  if (!cardEl.classList.contains('open')) controls.autoRotate = true;
  updateTimelineUI();
}

playBtn.addEventListener('click', () => {
  if (playing) pause();
  else play();
});

document.getElementById('cardClose').addEventListener('click', () => {
  stopTour();
  closeCard();
});
if (storyBack) {
  storyBack.addEventListener('click', () => {
    stopTour();
    closeCard();
  });
}
if (storyPrev) {
  storyPrev.addEventListener('click', () => {
    stopTour();
    if (selected > 0) selectEvent(selected - 1, { fly: false });
  });
}
if (storyNext) {
  storyNext.addEventListener('click', () => {
    stopTour();
    if (selected >= 0 && selected < EVENTS.length - 1) selectEvent(selected + 1, { fly: false });
  });
}

tlTrack.addEventListener('click', (e) => {
  if (e.target.closest('.tick')) return;
  const rect = tlTrack.getBoundingClientRect();
  const p = THREE.MathUtils.clamp((e.clientX - rect.left) / rect.width, 0, 1);
  intro.active = false;
  stopTour();
  if (playing) pause();
  setProgress(p);
});

addEventListener('keydown', (e) => {
  if (e.code === 'KeyP') {
    e.preventDefault();
    togglePresent();
    return;
  }
  const storyOpen = cardEl.classList.contains('open');
  if (storyOpen && (e.code === 'ArrowRight' || e.code === 'ArrowLeft')) {
    e.preventDefault();
    stopTour();
    const dir = e.code === 'ArrowRight' ? 1 : -1;
    const base = selected < 0 ? 0 : selected;
    const next = Math.min(EVENTS.length - 1, Math.max(0, base + dir));
    if (next !== selected) selectEvent(next, { fly: false });
    return;
  }
  if (e.code === 'Space') {
    e.preventDefault();
    if (playing) pause();
    else play();
  } else if (e.code === 'Escape') {
    stopTour();
    closeWayCard();
    closeCard();
  } else if (e.code === 'ArrowRight') {
    stopTour();
    selectEvent(Math.min(EVENTS.length - 1, selected + 1));
  } else if (e.code === 'ArrowLeft') {
    stopTour();
    selectEvent(Math.max(0, selected - 1));
  }
});

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let downPos = null;

function pickEvent(clientX, clientY) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(pickables, false);
  return hits.length ? hits[0].object.userData.event : -1;
}

renderer.domElement.addEventListener('pointerdown', (e) => {
  downPos = { x: e.clientX, y: e.clientY };
  if (tour.active) stopTour();
});

renderer.domElement.addEventListener('pointerup', (e) => {
  if (!downPos) return;
  const moved = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
  downPos = null;
  if (moved > 6) return;
  const hit = pickEvent(e.clientX, e.clientY);
  if (hit >= 0) { stopTour(); selectEvent(hit); }
  else if (wayCard.classList.contains('open')) closeWayCard();
  else if (cardEl.classList.contains('open')) closeCard();
});

renderer.domElement.addEventListener('pointermove', (e) => {
  renderer.domElement.style.cursor = pickEvent(e.clientX, e.clientY) >= 0 ? 'pointer' : 'grab';
});

renderer.domElement.addEventListener('pointerleave', hideWayTip);

// ===== 信息层：进度读数 / 8 站导航 / 海拔剖面 / 定位小图 / 比例尺 =====
function stationIndexFor(p) {
  let idx = 0;
  for (let i = 0; i < EVENTS.length; i++) {
    if (EVENTS[i].u <= p + 0.0005) idx = i;
  }
  return idx;
}

let lastDistBucket = -1;
let lastStationIdx = -1;
let lastRemain = -1;
let lastAlt = -1;

function updateProgressInfo() {
  const p = progress;
  const dist = Math.round(25000 * p / 10) * 10;
  const remain = Math.max(0, Math.round((1 - p) * 100));
  const idx = stationIndexFor(p);
  const st = EVENTS[idx];
  if (dist !== lastDistBucket) {
    lastDistBucket = dist;
    if (tlDist) tlDist.textContent = '已行进 ' + dist.toLocaleString('en-US') + ' 里';
  }
  if (remain !== lastRemain) {
    lastRemain = remain;
    if (tlRemain) tlRemain.textContent = remain <= 0 ? '已抵达' : '剩余 ' + remain + '%';
  }
  if (idx !== lastStationIdx) {
    lastStationIdx = idx;
    if (tlStation) tlStation.textContent = '第 ' + (idx + 1) + ' / 8 站 · ' + st.name;
    if (dhStation) dhStation.textContent = '第 ' + (idx + 1) + ' / 8 站 · ' + st.date + ' ' + st.name;
    for (let i = 0; i < stopRows.length; i++) {
      stopRows[i].classList.toggle('active', i === idx);
      stopRows[i].classList.toggle('passed', i <= idx);
    }
  }
  drawProfileMarker(p);
}

// 8 站导航（左侧折叠面板）
function buildStops() {
  if (!stopsList) return;
  EVENTS.forEach((ev, i) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'stop-row';
    row.innerHTML = '<b>' + String(i + 1).padStart(2, '0') + '</b>' +
      '<span class="stop-date">' + ev.date + '</span>' +
      '<span class="stop-name">' + ev.name + '</span>';
    row.addEventListener('click', (e) => {
      e.stopPropagation();
      stopTour();
      selectEvent(i);
    });
    stopsList.appendChild(row);
    stopRows.push(row);
  });
  const isWide = innerWidth >= 1440;
  stopsEl.classList.toggle('open', isWide);
  stopsToggle.setAttribute('aria-expanded', String(isWide));
  stopsToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = stopsEl.classList.toggle('open');
    stopsToggle.setAttribute('aria-expanded', String(isOpen));
  });
  lastStationIdx = -1;
}

// 沿途海拔剖面：直接采样 3D 地形的高程，作为“行军海拔”背景数据
const PROFILE = [];
const PROFILE_TOP = 6;
const PROFILE_BOTTOM = 78;
let PROFILE_MAX = 3000;
let profileBase = null;
let profileReady = false;

{
  const N = 140;
  for (let i = 0; i <= N; i++) {
    const v = curve.getPointAt(i / N);
    PROFILE.push(heightAt(v.x, v.z));
  }
  const peak = Math.max.apply(null, PROFILE);
  PROFILE_MAX = Math.max(3000, Math.ceil(peak / 1000) * 1000);
  profileBase = document.createElement('canvas');
  profileBase.width = 560;
  profileBase.height = 88;
  const ctx = profileBase.getContext('2d');
  const yOf = (e) => PROFILE_BOTTOM - Math.min(1, e / PROFILE_MAX) * (PROFILE_BOTTOM - PROFILE_TOP);
  ctx.strokeStyle = 'rgba(120, 170, 220, .16)';
  ctx.lineWidth = 1;
  for (let e = 0; e <= PROFILE_MAX; e += 2000) {
    const y = Math.round(yOf(e)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(profileBase.width, y);
    ctx.stroke();
  }
  const W = profileBase.width;
  ctx.beginPath();
  ctx.moveTo(0, PROFILE_BOTTOM);
  for (let i = 0; i < PROFILE.length; i++) {
    ctx.lineTo(i / (PROFILE.length - 1) * W, yOf(PROFILE[i]));
  }
  ctx.lineTo(W, PROFILE_BOTTOM);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, PROFILE_TOP, 0, PROFILE_BOTTOM);
  grad.addColorStop(0, 'rgba(255, 190, 110, .36)');
  grad.addColorStop(1, 'rgba(255, 140, 60, .04)');
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.beginPath();
  for (let i = 0; i < PROFILE.length; i++) {
    const x = i / (PROFILE.length - 1) * W;
    if (i) ctx.lineTo(x, yOf(PROFILE[i])); else ctx.moveTo(x, yOf(PROFILE[i]));
  }
  ctx.strokeStyle = 'rgba(255, 207, 138, .85)';
  ctx.lineWidth = 2;
  ctx.stroke();
  profileReady = true;
  if (dhCaption) {
    dhCaption.textContent = '沿途海拔 / m · 最高 ' + (Math.round(peak / 100) * 100).toLocaleString('en-US') + ' m';
  }
}

function drawProfileMarker(p) {
  if (!profileReady || !dhChart) return;
  const ctx = dhChart.getContext('2d');
  const W = dhChart.width;
  const H = dhChart.height;
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(profileBase, 0, 0);
  const t = Math.max(0, Math.min(1, p)) * (PROFILE.length - 1);
  const i0 = Math.floor(t);
  const i1 = Math.min(PROFILE.length - 1, i0 + 1);
  const e = PROFILE[i0] + (PROFILE[i1] - PROFILE[i0]) * (t - i0);
  const alt = Math.round(e / 10) * 10;
  if (alt !== lastAlt) {
    lastAlt = alt;
    if (dhAlt) dhAlt.textContent = alt.toLocaleString('en-US');
  }
  const y = PROFILE_BOTTOM - Math.min(1, e / PROFILE_MAX) * (PROFILE_BOTTOM - PROFILE_TOP);
  const x = t / (PROFILE.length - 1) * W;
  ctx.strokeStyle = 'rgba(255, 240, 220, .3)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + 0.5, 0);
  ctx.lineTo(x + 0.5, H);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, 4.5, 0, Math.PI * 2);
  ctx.fillStyle = '#fff0d8';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 150, 60, .95)';
  ctx.lineWidth = 2;
  ctx.stroke();
}

// 卡片内的定位小图（全国轮廓 + 路线 + 当前站点）
const LOC_W = 240;
const LOC_H = 152;
const locPad = 14;
let locBase = null;
{
  locBase = document.createElement('canvas');
  locBase.width = LOC_W;
  locBase.height = LOC_H;
  const ctx = locBase.getContext('2d');
  const s = Math.min((LOC_W - locPad * 2) / FIT.width, (LOC_H - locPad * 2) / FIT.height);
  const toX = (v) => LOC_W / 2 + v.x * s;
  const toY = (v) => LOC_H / 2 + v.y * s;
  ctx.beginPath();
  for (const f of chinaOutline.features) {
    if (!f.geometry) continue;
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const poly of polys) for (const ring of poly) {
      if (ringMaxLat(ring) < 17) continue;
      ring.forEach(([lon, lat], i) => {
        const v = project(lon, lat);
        if (i) ctx.lineTo(toX(v), toY(v)); else ctx.moveTo(toX(v), toY(v));
      });
      ctx.closePath();
    }
  }
  ctx.fillStyle = 'rgba(36, 78, 108, .55)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(140, 210, 255, .75)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.beginPath();
  ROUTE.forEach((p, i) => {
    const v = project(p.lon, p.lat);
    if (i) ctx.lineTo(toX(v), toY(v)); else ctx.moveTo(toX(v), toY(v));
  });
  ctx.strokeStyle = 'rgba(255, 150, 60, .9)';
  ctx.lineWidth = 1.4;
  ctx.stroke();
}

function drawLocator(i) {
  if (!locBase || !locatorCanvas) return;
  const ctx = locatorCanvas.getContext('2d');
  ctx.clearRect(0, 0, locatorCanvas.width, locatorCanvas.height);
  ctx.drawImage(locBase, 0, 0);
  const ev = EVENTS[i];
  if (!ev) return;
  const s = Math.min((LOC_W - locPad * 2) / FIT.width, (LOC_H - locPad * 2) / FIT.height);
  const rp = ROUTE[ev.routeIndex];
  const v = project(rp.lon, rp.lat);
  const x = LOC_W / 2 + v.x * s;
  const y = LOC_H / 2 + v.y * s;
  ctx.beginPath();
  ctx.arc(x, y, 7, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255, 190, 110, .55)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, 3.5, 0, Math.PI * 2);
  ctx.fillStyle = '#ffd9a8';
  ctx.fill();
  ctx.strokeStyle = 'rgba(60, 20, 0, .8)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

// 比例尺：按当前相机视距换算真实公里数
const KM_PER_UNIT = (() => {
  const a = project(105, 35);
  const b = project(106, 35);
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  return (111.32 * Math.cos(35 * Math.PI / 180)) / d;
})();

function updateScale() {
  if (!scaleBar || !scaleTxt) return;
  const dist = camera.position.distanceTo(controls.target);
  const h = renderer.domElement.clientHeight || innerHeight;
  const worldPerPx = 2 * dist * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / h;
  const kmPerPx = worldPerPx * KM_PER_UNIT;
  const choices = [50, 100, 200, 300, 500, 800, 1000, 1500, 2000, 3000, 5000];
  let chosen = choices[0];
  for (let i = 0; i < choices.length; i++) {
    const px = choices[i] / kmPerPx;
    if (px >= 60 && px <= 140) { chosen = choices[i]; break; }
    if (px < 60) chosen = choices[i];
  }
  const px = Math.max(36, Math.min(138, chosen / kmPerPx));
  scaleBar.style.width = Math.round(px) + 'px';
  scaleTxt.textContent = '约 ' + chosen + ' km';
}
controls.addEventListener('change', updateScale);
addEventListener('resize', updateScale);

// ===== 省名层：显示开关 + 屏幕空间避让 =====
const PROV_PAD_X = 2;
const PROV_PAD_Y = 1;
let provOn = true;
let provLastCheck = -1;

function setProvHidden(item, hidden) {
  if (item.hidden === hidden) return;
  item.hidden = hidden;
  item.el.classList.toggle('is-hidden', hidden);
}

function updateProvinceLabels(now = performance.now(), force = false) {
  if (!provOn) return;
  if (!force && now - provLastCheck < 90) return;
  provLastCheck = now;
  const taken = [];
  const reserve = (el) => {
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width < 1) return;
    taken.push({ x: r.left - 2, y: r.top - 2, w: r.width + 4, h: r.height + 4 });
  };
  labelEls.forEach((l) => { if (l) reserve(l.element.querySelector('.lbl-box')); });
  reserve(yananLabel.element.querySelector('.lbl-box'));

  const W = innerWidth;
  const H = innerHeight;
  for (const item of provItems) {
    const r = item.txt.getBoundingClientRect();
    if (r.width < 1) continue;
    const x = r.left - PROV_PAD_X;
    const y = r.top - PROV_PAD_Y;
    const w = r.width + PROV_PAD_X * 2;
    const h = r.height + PROV_PAD_Y * 2;
    let blocked = r.right < 0 || r.left > W || r.bottom < 0 || r.top > H;
    if (!blocked) {
      for (let i = 0; i < taken.length; i++) {
        const b = taken[i];
        // 亚像素级的“贴边”不算冲突，否则屏幕缩放时会出现无意义的闪烁
        const ox = Math.min(x + w, b.x + b.w) - Math.max(x, b.x);
        const oy = Math.min(y + h, b.y + b.h) - Math.max(y, b.y);
        if (ox > 0.5 && oy > 0.5) { blocked = true; break; }
      }
    }
    setProvHidden(item, blocked);
    if (!blocked) taken.push({ x, y, w, h });
  }
}

function setProvinceVisible(on, persist = true) {
  provOn = on;
  document.body.classList.toggle('provs-off', !on);
  if (provBtn) {
    provBtn.classList.toggle('on', on);
    provBtn.setAttribute('aria-pressed', String(on));
  }
  if (!on) provItems.forEach((item) => setProvHidden(item, true));
  else updateProvinceLabels(performance.now(), true);
  if (persist) {
    try { localStorage.setItem('lz-provs', on ? '1' : '0'); } catch (err) { /* file:// 下可能不可用 */ }
  }
}

if (provBtn) {
  provBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    setProvinceVisible(!provOn);
  });
}

// ===== 薛岳部追击路线：默认显示，图例里可关 =====
let pursuitOn = true;
function setPursuitVisible(on, persist = true) {
  pursuitOn = on;
  pursuitGroup.visible = on;
  pursuitLabel.visible = on;
  if (pursuitBtn) {
    pursuitBtn.classList.toggle('on', on);
    pursuitBtn.setAttribute('aria-pressed', String(on));
  }
  if (persist) {
    try { localStorage.setItem('lz-pursuit-route', on ? '1' : '0'); } catch (err) { /* file:// 下可能不可用 */ }
  }
}
if (pursuitBtn) {
  pursuitBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    setPursuitVisible(!pursuitOn);
  });
}

// ===== 途中次级事件：悬停提示 + 小卡，不占 8 站时间轴 =====
let wayOn = true;
let waySelected = -1;

function showWayTip(i, x, y) {
  if (!wayTip) return;
  const ev = WAY_EVENTS[i];
  if (!ev) return;
  wayTip.textContent = ev.name + ' · ' + ev.date;
  wayTip.style.left = Math.min(window.innerWidth - 210, x + 14) + 'px';
  wayTip.style.top = Math.max(12, y - 30) + 'px';
  wayTip.classList.add('on');
}

function hideWayTip() {
  if (wayTip) wayTip.classList.remove('on');
}

const WAY_OFFSETS = [
  [0, 0], [0, -16], [0, 16], [-16, 0], [16, 0],
  [-14, -14], [14, -14], [-14, 14], [14, 14],
  [0, -28], [0, 28], [-28, 0], [28, 0],
  [-24, -24], [24, -24], [-24, 24], [24, 24],
];
let wayLastCheck = -1;

// 小菱形也做屏幕避让：不压 8 个主站标签、延安、薛岳部标签和已显示的省名
function updateWayDots(now = performance.now(), force = false) {
  if (!wayOn) return;
  if (!force && now - wayLastCheck < 90) return;
  wayLastCheck = now;
  const boxes = [];
  const addBox = (el, pad = 2) => {
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width < 1) return;
    boxes.push({ x: r.left - pad, y: r.top - pad, w: r.width + pad * 2, h: r.height + pad * 2 });
  };
  labelEls.forEach((l) => { if (l) addBox(l.element.querySelector('.lbl-box')); });
  addBox(yananLabel.element.querySelector('.lbl-box'));
  addBox(pursuitLabel.element.querySelector('.lbl-box'));
  provItems.forEach((item) => { if (!item.hidden) addBox(item.txt); });

  const used = [];
  wayDots.forEach((w) => {
    w.dot.style.setProperty('--wx', '0px');
    w.dot.style.setProperty('--wy', '0px');
    const base = w.dot.getBoundingClientRect();
    if (base.width < 1) return;
    let chosen = null;
    for (const [dx, dy] of WAY_OFFSETS) {
      const x = base.left + dx;
      const y = base.top + dy;
      if (x < 2 || y < 2 || x + base.width > innerWidth - 2 || y + base.height > innerHeight - 2) continue;
      let hit = false;
      for (const b of boxes) {
        if (x < b.x + b.w && x + base.width > b.x && y < b.y + b.h && y + base.height > b.y) { hit = true; break; }
      }
      if (!hit) {
        for (const b of used) {
          if (x < b.x + b.w && x + base.width > b.x && y < b.y + b.h && y + base.height > b.y) { hit = true; break; }
        }
      }
      if (!hit) {
        chosen = [dx, dy];
        used.push({ x, y, w: base.width, h: base.height });
        break;
      }
    }
    if (!chosen) chosen = [0, 0];
    w.dot.style.setProperty('--wx', chosen[0] + 'px');
    w.dot.style.setProperty('--wy', chosen[1] + 'px');
  });
}

function openWayEvent(i) {
  const ev = WAY_EVENTS[i];
  if (!ev || !wayCard) return;
  waySelected = i;
  if (wayDate) wayDate.textContent = ev.date;
  if (wayTitle) wayTitle.textContent = ev.name;
  if (wayText) wayText.textContent = ev.text;
  wayCard.classList.add('open');
  wayCard.setAttribute('aria-hidden', 'false');
  document.body.classList.add('way-open');
  wayDots.forEach((w, idx) => w.dot.classList.toggle('active', idx === i));
}

function closeWayCard() {
  waySelected = -1;
  if (!wayCard) return;
  wayCard.classList.remove('open');
  wayCard.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('way-open');
  wayDots.forEach((w) => w.dot.classList.remove('active'));
}

function setWayEventsVisible(on, persist = true) {
  wayOn = on;
  document.body.classList.toggle('waynotes-off', !on);
  if (wayBtn) {
    wayBtn.classList.toggle('on', on);
    wayBtn.setAttribute('aria-pressed', String(on));
  }
  if (!on) {
    closeWayCard();
    hideWayTip();
  } else {
    updateWayDots(performance.now(), true);
  }
  if (persist) {
    try { localStorage.setItem('lz-waynotes', on ? '1' : '0'); } catch (err) { /* file:// 下可能不可用 */ }
  }
}

if (wayBtn) {
  wayBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    setWayEventsVisible(!wayOn);
  });
}
if (wayClose) wayClose.addEventListener('click', () => closeWayCard());

// ===== 主题：同一地形，三种叙事气质 =====
const THEMES = {
  night: {
    bg: 0x03060d, fog: 0.0032,
    hemiSky: 0xa8d4ff, hemiGnd: 0x1e2a36, hemiI: 1.0,
    keyC: 0xbfdcff, keyI: 1.5,
    warmC: 0xff8a5c, warmI: 0.4,
    reliefC: 0xcfe4ff, reliefI: 0.55,
    pointI: 700,
    outline: 0x93c2de, edge: 0xa8bcae, edgeO: 0.26,
    route: 0xff8a3a, halo: 0xff6a1a,
    terrain: 0xffffff, stars: 0.7, ground: 0xffffff,
  },
  dawn: {
    bg: 0x12100e, fog: 0.0030,
    hemiSky: 0xffd9b0, hemiGnd: 0x241408, hemiI: 1.05,
    keyC: 0xffe6c8, keyI: 1.7,
    warmC: 0xff9a4a, warmI: 0.55,
    reliefC: 0xffd2a8, reliefI: 0.6,
    pointI: 650,
    outline: 0xe0c9a6, edge: 0xd8c09a, edgeO: 0.24,
    route: 0xffa04a, halo: 0xff7a2a,
    terrain: 0xfff2e2, stars: 0.12, ground: 0xffe2c4,
  },
  crimson: {
    bg: 0x0d0306, fog: 0.0032,
    hemiSky: 0xffb0a0, hemiGnd: 0x2a060a, hemiI: 1.0,
    keyC: 0xffd8c8, keyI: 1.6,
    warmC: 0xff6a4a, warmI: 0.5,
    reliefC: 0xffb0a0, reliefI: 0.6,
    pointI: 650,
    outline: 0xd8a293, edge: 0xc09090, edgeO: 0.24,
    route: 0xffc24a, halo: 0xff3a1a,
    terrain: 0xffe8e0, stars: 0.3, ground: 0xffd0c0,
  },
};
let currentTheme = 'night';

function applyTheme(name) {
  const t = THEMES[name] ? THEMES[name] : THEMES.night;
  currentTheme = THEMES[name] ? name : 'night';
  document.body.classList.toggle('theme-dawn', currentTheme === 'dawn');
  document.body.classList.toggle('theme-crimson', currentTheme === 'crimson');
  scene.background.setHex(t.bg);
  scene.fog.color.setHex(t.bg);
  scene.fog.density = t.fog;
  hemi.color.setHex(t.hemiSky);
  hemi.groundColor.setHex(t.hemiGnd);
  hemi.intensity = t.hemiI;
  key.color.setHex(t.keyC);
  key.intensity = t.keyI;
  warmKey.color.setHex(t.warmC);
  warmKey.intensity = t.warmI;
  relief.color.setHex(t.reliefC);
  relief.intensity = t.reliefI;
  warm.intensity = t.pointI;
  outlineMat.color.setHex(t.outline);
  edgeMat.color.setHex(t.edge);
  edgeMat.opacity = t.edgeO;
  terrainMat.color.setHex(t.terrain);
  tube.material.color.setHex(t.route);
  halo.material.color.setHex(t.halo);
  stars.material.opacity = t.stars;
  ground.material.color.setHex(t.ground);
  yananLine.material.color.setHex(t.outline);
  comets.forEach((c) => c.sp.material.color.setHex(t.route));
  themeButtons.forEach((b) => b.classList.toggle('on', b.dataset.theme === currentTheme));
  updateScale();
}
themeButtons.forEach((b) => {
  b.addEventListener('click', () => {
    applyTheme(b.dataset.theme);
    try { localStorage.setItem('lz-theme', b.dataset.theme); } catch (err) { /* file:// 下可能不可用 */ }
  });
});

// ===== 自动导览：逐站飞行 + 卡片，可随时打断 =====
const tour = { active: false, index: 0, timer: 0 };

function stopTour() {
  if (!tour.active) return;
  tour.active = false;
  if (tour.timer) clearTimeout(tour.timer);
  tour.timer = 0;
  if (tourBtn) {
    tourBtn.textContent = '导览';
    tourBtn.classList.remove('on');
  }
  document.body.classList.remove('touring');
}

function endTour() {
  stopTour();
  closeCard();
  resetView();
}

function togglePresent(force) {
  const on = typeof force === 'boolean' ? force : !document.body.classList.contains('presenting');
  document.body.classList.toggle('presenting', on);
  if (presentBtn) {
    presentBtn.classList.toggle('on', on);
    presentBtn.textContent = on ? '退出投影' : '投影';
  }
}

if (presentBtn) {
  presentBtn.addEventListener('click', () => togglePresent());
}

function startTour() {
  if (tour.active) stopTour();
  if (playing) pause();
  tour.active = true;
  tour.index = 0;
  if (tourBtn) {
    tourBtn.textContent = '停止';
    tourBtn.classList.add('on');
  }
  document.body.classList.add('touring');
  const step = () => {
    if (!tour.active) return;
    if (tour.index >= EVENTS.length) { endTour(); return; }
    selectEvent(tour.index, { fly: true });
    tour.index += 1;
    tour.timer = setTimeout(step, 6800);
  };
  step();
}

if (tourBtn) {
  tourBtn.addEventListener('click', () => {
    if (tour.active) stopTour();
    else startTour();
  });
}

const statFrames = [];
document.querySelectorAll('.num').forEach((el) => {
  const target = Number(el.dataset.target);
  const start = performance.now();
  function step(now) {
    const t = Math.min(1, (now - start) / 1600);
    el.textContent = Math.round(target * easeOutCubic(t)).toLocaleString('en-US');
    if (t < 1) statFrames.push(requestAnimationFrame(step));
  }
  statFrames.push(requestAnimationFrame(step));
});

const q = new URLSearchParams(location.search);
if (q.has('still')) {
  statFrames.forEach((id) => cancelAnimationFrame(id));
  document.querySelectorAll('.num').forEach((el) => { el.textContent = Number(el.dataset.target).toLocaleString('en-US'); });
  controls.autoRotate = false;
}
if (q.has('t')) {
  intro.active = false;
  setProgress(Number(q.get('t')) || 0);
}
if (q.has('play')) {
  setTimeout(play, 700);
}
if (q.has('node')) {
  setTimeout(() => selectEvent(Number(q.get('node')), { fly: q.get('fly') === '1' }), 900);
}

// —— 信息层初始化 ——
buildStops();
buildStoryRail();
updateProgressInfo();
updateScale();
{
  let savedTheme = 'night';
  try { savedTheme = localStorage.getItem('lz-theme') || 'night'; } catch (err) { savedTheme = 'night'; }
  applyTheme(q.get('theme') || savedTheme);
}
{
  let savedProvs = true;
  try { savedProvs = localStorage.getItem('lz-provs') !== '0'; } catch (err) { savedProvs = true; }
  setProvinceVisible(savedProvs, false);
}
{
  let savedPursuit = true;
  try { savedPursuit = localStorage.getItem('lz-pursuit-route') !== '0'; } catch (err) { savedPursuit = true; }
  if (q.has('pursuit')) savedPursuit = q.get('pursuit') !== '0';
  setPursuitVisible(savedPursuit, false);
}
{
  let savedWay = true;
  try { savedWay = localStorage.getItem('lz-waynotes') !== '0'; } catch (err) { savedWay = true; }
  if (q.has('waynotes')) savedWay = q.get('waynotes') !== '0';
  setWayEventsVisible(savedWay, false);
}
if (q.has('tour')) setTimeout(startTour, 900);

let lastFrame = performance.now();
let elapsed = 0;
let loaderDone = false;

function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  const dt = Math.min((now - lastFrame) / 1000, 0.05);
  lastFrame = now;
  elapsed += dt;

  if (intro.active) {
    const p = easeOutCubic(Math.min(1, (now - intro.start) / 3200));
    setProgress(p);
    if (p >= 1) {
      intro.active = false;
      setProgress(1);
    }
  } else if (playing) {
    const p = playFrom + (now - playStart) / 30000;
    setProgress(p);
    if (p >= 1) {
      setProgress(1);
      pause();
    }
  }

  routeMarkers.forEach((m) => {
    if (!m.glow.visible) return;
    const s = m.base + Math.sin(elapsed * 1.7 + m.phase) * (m.base > 1.2 ? 0.55 : 0.22);
    m.glow.scale.setScalar(s);
  });

  comets.forEach((c, i) => {
    const p = THREE.MathUtils.clamp(progress - c.offset, 0, 1);
    const pos = curve.getPointAt(p);
    c.sp.position.copy(pos);
    c.sp.material.opacity = progress <= 0.001 ? 0 : 0.85 + Math.sin(elapsed * 3 + i) * 0.12;
    c.sp.visible = progress > 0.001;
  });

  if (ring.visible) {
    const s = 1 + Math.sin(elapsed * 3) * 0.08;
    ring.scale.setScalar(s);
    ring.material.opacity = 0.65 + Math.sin(elapsed * 3) * 0.25;
  }

  if (flyState) {
    flyState.t = Math.min(1, flyState.t + dt / flyState.dur);
    const e = easeInOutCubic(flyState.t);
    camera.position.lerpVectors(flyState.fromPos, flyState.toPos, e);
    controls.target.lerpVectors(flyState.fromTarget, flyState.toTarget, e);
    if (flyState.t >= 1) {
      const done = flyState.onDone;
      flyState = null;
      controls.enabled = true;
      controls.update();
      if (done) done();
      controls.autoRotate = !playing && !cardEl.classList.contains('open');
    }
  } else {
    controls.update();
  }

  stars.rotation.y += dt * 0.006;
  composer.render();
  labelRenderer.render(scene, camera);
  updateProvinceLabels(now);
  updateWayDots(now);
  if (!loaderDone) {
    loaderDone = true;
    requestAnimationFrame(() => document.body.classList.add('loaded'));
  }
}

setProgress(q.has('t') ? Number(q.get('t')) || 0 : 0);
animate();

if (q.has('top')) {
  intro.active = false;
  playing = false;
  controls.autoRotate = false;
  camera.up.set(0, 0, -1);
  camera.position.set(0.001, FIT.height * 2.3, 0.5);
  controls.target.set(0, 0, 0.2);
  controls.update();
}
window.__sbx = {
  camera, controls, scene, renderer, setProgress, selectEvent, EVENTS, FIT, CAM_DIR, CAM_DIST, CAM_TARGET,
  applyTheme, startTour, stopTour, tour, PROFILE, KM_PER_UNIT, THEMES, updateProgressInfo, togglePresent,
  heightAt, project, elevationColor, TERRAIN_GRID, PROVINCES, setProvinceVisible,
  pursuitGroup, pursuitLabel, setPursuitVisible,
  WAY_EVENTS, wayDots, openWayEvent, closeWayCard, setWayEventsVisible, updateWayDots,
};

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  labelRenderer.setSize(innerWidth, innerHeight);
  bloom.resolution.set(innerWidth, innerHeight);
});
