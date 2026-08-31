# 液态玻璃：物理模型与渲染

## 1. 视觉目标

融合两类参考：

1. **物理玻璃**：Snell 折射、Fresnel、厚度相关光程、微表面粗糙度、色散。
2. **Liquid Glass / 海报质感**：饱满曲面、整面折射变形、全身可见的 RGB 色散、柔光箱高光滑走、奶白磨砂体感。

**不做的事**：用半透明白 + 固定 blur 冒充玻璃。模糊可以是**粗糙度/散射**的结果，而不是唯一特效。

---

## 2. 物理量（公开材质参数）

```ts
interface GlassMaterial {
  /** 相对折射率，UI 玻璃常用 1.4–1.6，默认 ~1.5 */
  ior: number;
  /** 玻璃体穹顶深度（逻辑像素），驱动折射与光程 */
  thickness: number;
  /** 曲面饱满度：<1 鼓腹，>1 平顶 */
  curvature: number;
  /** 微表面粗糙度 [0,1]，提高则镜面变宽、背后更糊 */
  roughness: number;
  /** 基础透射着色（玻璃本体 tint），线性 RGB */
  tint: RGB;
  /** 透射率/清晰度，与 Beer-Lambert 吸收联动 */
  transmission: number;
  /** 色散强度 = 每通道 IOR 差（R:-d / G:0 / B:+d） */
  dispersion: number;
  /** 反射环境贡献强度 */
  specular: number;
  /** 边缘「透镜」增强：表面梯度放大 */
  edgeBoost: number;
  /** 玻璃中面到背景平面的虚拟距离（逻辑像素），决定放大/位移强度 */
  sceneDistance: number;
  /** 奶白体内散射 [0,1]（磨砂体感） */
  milkiness: number;
  /** 内部反射「重影」强度 [0,1] */
  internalReflect: number;
  /** 液态动态：法线扰动强度与频率（时间动画） */
  liquidity: number;
  liquidSpeed: number;
  /** Beer-Lambert 吸收密度 */
  absorption: number;
}
```

形状（与材质分离）：`RoundedRectShape { cornerRadius, bevel }`，`bevel` 同时是 3D 倒角宽度（穹顶到边缘的跌落带）。

预设：`GLASS_PRESETS`（`material.ts`）— **海报**（默认）/ **清水** / **浓磨砂**，Glass Lab 一键切换。

---

## 3. 曲面双折射模型（v0.2 核心）

完整路径追踪过重；采用**屏幕空间、双界面、物理启发**的近似。与 v0.1「平厚度场 + 单次折射 + UV 平移」的根本区别：玻璃体是**真实的双凸曲面厚板**，内部处处有梯度，折射经入射/出射两个界面。

### 3.1 曲面高度场

对圆角矩形 SDF 构造穹顶（`GLASS_FS::surfaceHeight`）：

```
edge = clamp(-d / bevel, 0, 1)                     // 0 中心 → 1 边界
dome = pow(1 - smoothstep(0, 1, edge), curvature)
h(p) = depth * (minRatio + (1-minRatio) * dome)    // minRatio ~0.14，永不全平
       + liquidity * fbm 噪声                       // 液态扰动进入高度场本身
```

- 顶面 `z = +h(p)`，底面 `z = -h(p)`（双凸对称）。
- 法线由中心差分 `∇h` 得出；`edgeBoost` 作为风格化梯度放大。
- 中心区域也有坡度（凸透镜），不再是 v0.1 的「平场」。

### 3.2 双次折射 + 每通道 IOR

正交视线 `I = (0,0,-1)`：

1. 入射：`d1_c = refract(I, N, 1/ior_c)`，`ior_c = ior + (c-1)·dispersion`。
2. 底面求交：解 `d1.z·t + h(p + d1.xy·t) + h0 = 0`（Newton ×2，`F' ≈ d1.z`）。
3. 出射：`d2_c = refract(d1_c, N2, ior_c)`，`N2` 为底面内法线；TIR 时回退镜像方向并衰减。

### 3.3 背景投影采样（替代 UV 平移）

出射射线投影到虚拟背景平面 `z = -sceneDistance`：

```
hit_c = P2.xy + d2_c.xy · (sceneDistance - hExit) / (-d2_c.z)
bgUV_c = uv + (hit_c - p) / viewport
```

- 位移随曲面坡度连续变化 → **放大镜/变形感**；坡向不同处产生局部倒像。
- R/G/B 三个 `ior` → 三条射线 → 三个采样点 → **色散遍布全身**（不再与偏移量成正比地消失）。

### 3.4 光程着色

- 路径长度 `path ≈ t`（入射点到出射点）：
  - Beer-Lambert：`exp(-absorption · path)`；
  - 奶白散射：`mix(body, milkColor, milkiness · f(path/depth))`。
- 内部反射重影：`F·internalReflect` 权重混入一个反向弱偏移采样（厚玻璃的「饱满」二次影像）。

### 3.5 反射与 Studio 环境

- Schlick Fresnel（`F0` 由 ior 推导）。
- 解析 **studio 环境**（作用在 `reflect(I, N)` 上）：顶部两块柔光箱（白色强）+ 基础环境 + 底部暗反弹。曲面法线连续 → 高光在穹顶上**游走**，这是「液态感」的主要来源。
- 主光 Blinn-Phong spec + 圆角「肩部」光泽带 + 掠射角 rim。

### 3.6 内容层与阴影（沿用）

- 内容 = 内侧贴膜：先算玻璃体折射，再以轻微视差叠内容（文字保持可读）。
- 接触软阴影：SDF 足迹 + 指数衰减，作用于玻璃外区域。

---

## 4. Pass 图（v0.2）

```
Resources:
  - swapchain
  - sceneBufferA / sceneBufferB (ping-pong)
  - blurA/blurB（半分辨率高斯链，供粗糙度）
  - contentTex[windowId]
  - wallpaperTex（Canvas2D 海报 → 上传纹理）

Per frame:
  1. WallpaperPass: 采样 wallpaperTex（亮色高对比排版海报）
  2. For layer in z-order ascending:
       a. Blit read → write（整屏，保证 scissor 外内容正确）
       b. GlassPass（scissor = bounds 外扩 72px）:
            双折射 + 投影采样 + 环境反射 → 写 write
       c. swap(read, write)
  3. Present blit → swapchain
```

**性能**：玻璃片元较重（~10 次高度场求值 + 6-8 次纹理采样），但每个 glass pass 通过 scissor 只在窗口足迹附近执行；模糊金字塔每层重建（v0.3 可缓存）。

---

## 5. WGSL 模块划分

当前实现集中在 `src/engine/glass/shaders.ts`（字符串常量）：

```
FULLSCREEN_VS   全屏三角形
WALLPAPER_FS    壁纸纹理采样 + 颗粒
BLIT_FS         拷贝 / present
BLUR_FS         可分离高斯
GLASS_FS        主片元：曲面高度场 + 双折射 + 投影采样 + studio 环境
```

后续拆分 `shaders/glass/*.wgsl` 时按上述边界切。Uniform 块显式 float 对齐（8 × vec4 / 128B），便于跨 API。

---

## 6. 校准与「像不像玻璃」

验收主观标准（对照 `tmp/test.jpg` 右图）：

1. **中心区域**背景即有放大/变形（凸透镜），非仅边缘弯曲。
2. 拖动窗口时背景连续变形，坡向变化处出现局部倒像。
3. 色散全身可见，坡度大处（边缘/肩部）更强。
4. 高光在曲面上游走（柔光箱感），正面透、掠射角亮。
5. 磨砂滑条拉高 → 奶白体感；文字内容仍可读（贴膜策略）。
6. 亮色高对比壁纸上折射/色散/阴影层次清晰。

Glass Lab（预设按钮 + 全参数滑条）是核心校准工具。

---

## 7. 与 CSS 玻璃的差异（刻意）

| CSS 常见做法 | 本引擎 |
|--------------|--------|
| `backdrop-filter: blur` | 粗糙度驱动的模糊链采样 |
| 半透明白叠加 | tint + absorption + milkiness + Fresnel |
| 固定 border 高光 | 曲面法线 + studio 环境/主光 |
| 每元素独立滤镜 | 全局分层物理合成 |

---

## 8. 后续扩展（非本期必做）

- 3D 定向玻璃体（倾斜/旋转，海报立方体的万花筒棱面）。
- 环境 Cubemap / 屏幕空间反射 SSR。
- 模糊金字塔缓存与脏区（性能结构）。
- 控件级更细 SDF（滑块、胶囊按钮独立厚度）。
- 指针驱动的流体耦合增强。
- 光谱渲染（波长积分）——通常过重，仅研究用。
