# 第三方素材与数据说明

本仓库的**代码**以 [MIT](LICENSE) 授权。以下素材/数据由第三方提供，**不在 MIT 授权范围内**；再分发或商用前请自行确认相应条款。

## 1. 信息页照片

`app/assets/01.jpg`–`08.jpg`，以及根目录 `index.html` 内联的 base64 副本，来自公开网络与新闻媒体，页面内已标注拍摄地/图源：

| 站点 | 照片内容 / 来源 |
| --- | --- |
| 01 瑞金 | 瑞金叶坪革命旧址（青海新闻网） |
| 02 湘江 | 湘江战役纪念馆 |
| 03 遵义 | 遵义会议会址（遵义日报） |
| 04 赤水 | 赤水丙安古镇 |
| 05 泸定 | 泸定桥 |
| 06 雪山 | 夹金山（新华社，保留 XINHUA NEWS 水印） |
| 07 草地 | 松潘草地 |
| 08 吴起 | 吴起中央红军长征胜利纪念园 |

这些照片**仅用于非商业的教学演示**，版权归原摄影师/出版机构所有。仓库不声称拥有这些照片的版权，也不将其纳入 MIT 授权。如果你是权利人并希望移除某张图片，请在本仓库开 Issue，我们会尽快处理。

## 2. GeoJSON

- `app/china.json`：中国省级边界，来自阿里云 DataV GeoAtlas 公开数据。
- `app/china-outline.json`：中国国界/海岸线，来自同一数据源。

使用/再分发请遵守数据提供方的条款；本仓库仅作教学演示。

## 3. 地形数据

`app/assets/terrain-height.png`、`terrain-color.jpg`、`terrain.jpg` 由 `app/bake-terrain.mjs` 基于 AWS Open Data **Terrain Tiles**（Terrarium 编码）烘焙；底层高程来自 SRTM、GMTED、ETOPO1、NED 等公开数据集。地形瓦片本身遵循其原始开放数据许可；本仓库只保留重投影后的教学用图。

## 4. 代码依赖

主要依赖及其许可证：

- Three.js — MIT
- Vite — MIT
- vite-plugin-singlefile — MIT
- playwright-core — Apache-2.0
- jpeg-js、pngjs — MIT / 各自许可证

具体版本与完整依赖树见 `app/package.json` / `app/package-lock.json`。

## 5. 史实与地图表达

本项目是教学可视化，不是测绘产品，也不是严格军事史地图。路线为关键节点连线，里程为按路线长度换算的示意值；薛岳部追击路线按主要节点复原，川南各纵队的多次分进做了合并。行政边界、南海诸岛小图按中国地图惯常表达处理；如用于正式出版、商用或政策场景，请以权威地图与史料为准。
