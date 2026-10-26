// 生成地形素材：
//  - assets/terrain.jpg        阴影烘焙版（2D 预览/备份，带山影）
//  - assets/terrain-color.jpg  纯分层设色（给 3D 地形做贴图，光照由真实法线提供）
//  - assets/terrain-height.png 高程灰度图（3D 地形顶点位移用，640×553）
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import jpeg from 'jpeg-js';

const ROOT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const CACHE = path.join(ROOT, 'terrain-tiles');
const OUT_SHADED = path.join(ROOT, 'assets', 'terrain.jpg');
const OUT_COLOR = path.join(ROOT, 'assets', 'terrain-color.jpg');
const OUT_HEIGHT = path.join(ROOT, 'assets', 'terrain-height.png');
const DEBUG = path.join(ROOT, 'terrain-preview.png');
const Z = 6;
const NT = 2 ** Z;
const D2R = Math.PI / 180;
const HEIGHT_W = 640;
const MIN_ELEV = 0;
const MAX_ELEV = 9000;

// —— 与 main.js 一致的阿尔伯斯投影与取景 ——
const p1 = 25 * D2R, p2 = 47 * D2R, lon0 = 105, lat0 = 35;
const n = (Math.sin(p1) + Math.sin(p2)) / 2;
const C = Math.cos(p1) ** 2 + 2 * n * Math.sin(p1);
const rho0 = Math.sqrt(C - 2 * n * Math.sin(lat0 * D2R)) / n;
const albers = (lon, lat) => {
  const rho = Math.sqrt(C - 2 * n * Math.sin(lat * D2R)) / n;
  const th = n * (lon - lon0) * D2R;
  return [rho * Math.sin(th), rho0 - rho * Math.cos(th)];
};
const invAlbers = (X, Y) => {
  const dx = X, dy = rho0 - Y;
  const rho = Math.hypot(dx, dy);
  const th = Math.atan2(dx, dy);
  const sinPhi = Math.max(-1, Math.min(1, (C - (rho * n) ** 2) / (2 * n)));
  return [lon0 + th / n / D2R, Math.asin(sinPhi) / D2R];
};

const china = JSON.parse(fs.readFileSync(path.join(ROOT, 'china.json'), 'utf8').replace(/^\uFEFF/, ''));
let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
for (const f of china.features) {
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
const cx = (minX + maxX) / 2;
const cy = (minY + maxY) / 2;
const MAP_W = TARGET_W;
const MAP_H = (maxY - minY) * scale;
console.log('map world size', MAP_W.toFixed(2), 'x', MAP_H.toFixed(2));

// —— 下载/解码 Terrarium 瓦片 ——
const lonMin = 70, lonMax = 140, latMin = 0, latMax = 56;
const tileX0 = Math.floor((lonMin + 180) / 360 * NT);
const tileX1 = Math.floor((lonMax + 180) / 360 * NT);
const mercY = (lat) => (1 - Math.log(Math.tan(lat * D2R) + 1 / Math.cos(lat * D2R)) / Math.PI) / 2 * NT;
const tileY0 = Math.floor(mercY(latMax));
const tileY1 = Math.floor(mercY(latMin));
const tiles = new Map();
async function getTile(tx, ty) {
  const key = `${tx}_${ty}`;
  if (tiles.has(key)) return tiles.get(key);
  const dir = path.join(CACHE, String(Z), String(tx));
  const file = path.join(dir, `${ty}.png`);
  let buf;
  if (fs.existsSync(file)) buf = fs.readFileSync(file);
  else {
    const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${Z}/${tx}/${ty}.png`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`tile ${url} ${res.status}`);
    buf = Buffer.from(await res.arrayBuffer());
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, buf);
  }
  const png = PNG.sync.read(buf);
  const arr = new Int16Array(256 * 256);
  for (let i = 0; i < 256 * 256; i++) {
    const r = png.data[i * 4], g = png.data[i * 4 + 1], b = png.data[i * 4 + 2];
    arr[i] = Math.round((r * 256 + g + b / 256) - 32768);
  }
  tiles.set(key, arr);
  return arr;
}
async function loadAll() {
  const jobs = [];
  for (let ty = tileY0; ty <= tileY1; ty++) for (let tx = tileX0; tx <= tileX1; tx++) jobs.push([tx, ty]);
  const workers = Array.from({ length: 8 }, async () => {
    while (jobs.length) {
      const [tx, ty] = jobs.pop();
      await getTile(tx, ty);
    }
  });
  await Promise.all(workers);
  console.log('tiles ready', tiles.size);
}
const gxOf = (lon) => (lon + 180) / 360 * NT * 256;
const gyOf = (lat) => mercY(lat) * 256;
function pixelElev(gx, gy) {
  const tx = Math.floor(gx / 256), ty = Math.floor(gy / 256);
  const arr = tiles.get(`${tx}_${ty}`);
  if (!arr) return 0;
  const lx = Math.floor(gx - tx * 256), ly = Math.floor(gy - ty * 256);
  return arr[ly * 256 + lx];
}
function elevAt(lon, lat) {
  const gx = gxOf(lon), gy = gyOf(lat);
  const x0 = Math.floor(gx), y0 = Math.floor(gy);
  const fx = gx - x0, fy = gy - y0;
  const e00 = pixelElev(x0, y0), e10 = pixelElev(x0 + 1, y0);
  const e01 = pixelElev(x0, y0 + 1), e11 = pixelElev(x0 + 1, y0 + 1);
  return e00 * (1 - fx) * (1 - fy) + e10 * fx * (1 - fy) + e01 * (1 - fx) * fy + e11 * fx * fy;
}

// —— 分层设色 ——
const stops = [
  [-300, [56, 92, 66]],
  [0, [72, 112, 66]],
  [200, [104, 128, 64]],
  [500, [140, 138, 70]],
  [1000, [168, 146, 86]],
  [2000, [176, 128, 84]],
  [3000, [158, 108, 82]],
  [4000, [142, 108, 94]],
  [5000, [150, 126, 116]],
  [5600, [206, 202, 196]],
  [6400, [236, 238, 236]],
];
function colorAt(e) {
  let i = 0;
  while (i < stops.length - 1 && e > stops[i + 1][0]) i++;
  const [e0, c0] = stops[i];
  const [e1, c1] = stops[Math.min(i + 1, stops.length - 1)];
  const t = e1 === e0 ? 0 : Math.max(0, Math.min(1, (e - e0) / (e1 - e0)));
  return [
    c0[0] + (c1[0] - c0[0]) * t,
    c0[1] + (c1[1] - c0[1]) * t,
    c0[2] + (c1[2] - c0[2]) * t,
  ];
}
function snowMix(e, R, G, B) {
  const snow = Math.max(0, Math.min(1, (e - 5400) / 900));
  return [
    R * (1 - snow) + 224 * snow,
    G * (1 - snow) + 228 * snow,
    B * (1 - snow) + 230 * snow,
  ];
}

function bake() {
  const W = 1600;
  const H = Math.round(W * MAP_H / MAP_W);
  const elev = new Float32Array(W * H);
  for (let py = 0; py < H; py++) {
    const vTex = 1 - (py + 0.5) / H;
    const shapeY = (vTex - 0.5) * MAP_H;
    const Y = shapeY / scale + cy;
    for (let px = 0; px < W; px++) {
      const uTex = (px + 0.5) / W;
      const xWorld = (uTex - 0.5) * MAP_W;
      const X = xWorld / scale + cx;
      const [lon, lat] = invAlbers(X, Y);
      elev[py * W + px] = elevAt(lon, lat);
    }
  }
  console.log('elevation grid done', W, 'x', H);

  const rgbaShaded = Buffer.alloc(W * H * 4);
  const rgbaFlat = Buffer.alloc(W * H * 4);
  const cell = 3500;
  const lx = -0.52, ly = 0.52, lz = 0.68;
  const lnorm = Math.hypot(lx, ly, lz);
  const Lx = lx / lnorm, Ly = ly / lnorm, Lz = lz / lnorm;
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const i = py * W + px;
      const e = elev[i];
      const eW = elev[py * W + Math.max(0, px - 1)];
      const eE = elev[py * W + Math.min(W - 1, px + 1)];
      const eN = elev[Math.max(0, py - 1) * W + px];
      const eS = elev[Math.min(H - 1, py + 1) * W + px];
      const dzdx = (eE - eW) / (2 * cell);
      const dzdy = (eN - eS) / (2 * cell);
      let nx = -dzdx * 1.6, ny = -dzdy * 1.6, nz = 1;
      const nl = Math.hypot(nx, ny, nz); nx /= nl; ny /= nl; nz /= nl;
      let shade = Math.max(0, nx * Lx + ny * Ly + nz * Lz);
      shade = 0.5 + 0.62 * shade;
      if (e > 5600) shade = Math.max(shade, 0.9);

      const [r, g, b] = colorAt(e);
      const o = i * 4;

      // 阴影版（2D/备份）
      const [sR, sG, sB] = snowMix(e, r * 0.92 * shade, g * 0.92 * shade, b * 0.92 * shade);
      rgbaShaded[o] = Math.max(0, Math.min(255, sR));
      rgbaShaded[o + 1] = Math.max(0, Math.min(255, sG));
      rgbaShaded[o + 2] = Math.max(0, Math.min(255, sB));
      rgbaShaded[o + 3] = 255;

      // 纯色版（3D 贴图；真实光照由几何法线提供）
      const [fR, fG, fB] = snowMix(e, r * 1.02, g * 1.02, b * 1.02);
      rgbaFlat[o] = Math.max(0, Math.min(255, fR));
      rgbaFlat[o + 1] = Math.max(0, Math.min(255, fG));
      rgbaFlat[o + 2] = Math.max(0, Math.min(255, fB));
      rgbaFlat[o + 3] = 255;
    }
  }

  const shaded = jpeg.encode({ data: rgbaShaded, width: W, height: H }, 88);
  fs.writeFileSync(OUT_SHADED, shaded.data);
  const flat = jpeg.encode({ data: rgbaFlat, width: W, height: H }, 90);
  fs.writeFileSync(OUT_COLOR, flat.data);
  console.log('terrain.jpg', (shaded.data.length / 1024).toFixed(1), 'KB',
    '| terrain-color.jpg', (flat.data.length / 1024).toFixed(1), 'KB', W, 'x', H);

  // 高程灰度图（3D 位移用）
  const hw = HEIGHT_W;
  const hh = Math.round(hw * MAP_H / MAP_W);
  const hp = new PNG({ width: hw, height: hh });
  for (let py = 0; py < hh; py++) {
    for (let px = 0; px < hw; px++) {
      const sx = Math.min(W - 1, Math.round((px + 0.5) / hw * W));
      const sy = Math.min(H - 1, Math.round((py + 0.5) / hh * H));
      const e = elev[sy * W + sx];
      const v = Math.max(0, Math.min(255, Math.round((Math.max(MIN_ELEV, Math.min(MAX_ELEV, e)) / MAX_ELEV) * 255)));
      const o = (py * hw + px) * 4;
      hp.data[o] = v; hp.data[o + 1] = v; hp.data[o + 2] = v; hp.data[o + 3] = 255;
    }
  }
  fs.writeFileSync(OUT_HEIGHT, PNG.sync.write(hp));
  console.log('terrain-height.png', (fs.statSync(OUT_HEIGHT).size / 1024).toFixed(1), 'KB', hw, 'x', hh);

  const preview = new PNG({ width: W, height: H });
  rgbaShaded.copy(preview.data);
  fs.writeFileSync(DEBUG, PNG.sync.write(preview));
  console.log('preview', DEBUG);
}

await loadAll();
bake();
