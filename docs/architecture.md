# 总体架构

## 1. 目标与约束

### 1.1 目标

1. 在浏览器中渲染一个**精简桌面系统**，其视觉主体为**符合物理规律的液态玻璃**。
2. 桌面 / 窗口 / 控件统一使用同一套玻璃材质与合成规则，而不是 CSS `backdrop-filter` 式近似。
3. 支持以**挂载**方式注册自定义应用窗口。
4. 提供**简单系统调度**（帧循环、更新顺序、输入分发、窗口 z-order）。
5. 初版 TypeScript + 浏览器；架构允许日后移植到原生 GPU 后端。

### 1.2 非目标（v0.1）

- 完整操作系统语义（进程隔离、权限、文件系统、多用户）。
- 高保真文本排版引擎 / 完整 UI 控件库。
- 为移动端极低端 GPU 做激进降级路径（可保留扩展点，但不优先）。
- 与真实 macOS / Windows 交互一一对应。

### 1.3 设计原则

| 原则 | 说明 |
|------|------|
| **玻璃优先** | 任何会挡在场景前方的实体，默认参与玻璃合成；性能优化不得破坏物理观感。 |
| **平台薄、核心厚** | 业务与渲染算法尽量平台无关；WebGPU / DOM / 输入仅在 adapter 层。 |
| **离屏内容 + GPU 合成** | 应用内容 → 纹理；外观（折射/反射/高光/边缘）由引擎统一完成。 |
| **可组合分层** | 壁纸 / 窗口 / 叠加层可按 z 合成；玻璃采样「背后已合成结果」。 |
| **显式生命周期** | 应用与窗口状态机清晰，便于调度与调试。 |

---

## 2. 逻辑分层

```
┌──────────────────────────────────────────────────────────┐
│  Apps（用户/内置应用）                                      │
│  ClockApp / DemoApp / 第三方挂载应用                        │
└────────────────────────────▲─────────────────────────────┘
                             │ App API
┌────────────────────────────┴─────────────────────────────┐
│  Shell（桌面外壳）                                          │
│  Wallpaper · WindowManager · Launcher · Focus · Cursor   │
└────────────────────────────▲─────────────────────────────┘
                             │ Scene / Commands
┌────────────────────────────┴─────────────────────────────┐
│  Runtime（调度与会话）                                       │
│  FrameLoop · Scheduler · InputRouter · EventBus          │
└────────────────────────────▲─────────────────────────────┘
                             │ Render Graph
┌────────────────────────────┴─────────────────────────────┐
│  Engine / Compositor（核心）                               │
│  LayerStack · OffscreenTargets · LiquidGlassPass         │
│  Shadow/Blur · Post · Debug                              │
└────────────────────────────▲─────────────────────────────┘
                             │ GPU / Surface API
┌────────────────────────────┴─────────────────────────────┐
│  Platform（可替换）                                         │
│  Web: WebGPU + Canvas + Pointer/Keyboard                 │
│  Native(future): Dawn/Metal/Vulkan + 原生窗口/输入         │
└──────────────────────────────────────────────────────────┘
```

### 2.1 各层职责

**Platform**

- 创建设备、队列、交换链 / canvas surface。
- 时钟、`requestAnimationFrame` 或原生 vsync。
- 指针、键盘、DPI、resize。
- 纹理上传、只读缓冲等与宿主相关的 IO。

**Engine / Compositor**

- 维护图层树与渲染资源。
- 执行液态玻璃相关 pass（见 [liquid-glass.md](./liquid-glass.md)）。
- 不感知「应用业务」，只感知 Layer / Material / Geometry。

**Runtime**

- 固定帧阶段：`input → update → layout → render-content → compose → present`。
- 简单调度：按优先级 / z-order 调用应用 `tick` 与内容绘制。
- 事件总线（窗口打开/关闭/焦点变化）。

**Shell**

- 壁纸层、窗口装饰（交通灯可后置，v0.1 可用极简标题条）、启动器、焦点环。
- 将用户交互翻译为 WindowManager 命令。

**Apps**

- 通过注册表挂载；获得 `AppContext`（内容画布、窗口控制、主题 tokens）。
- 只负责**内容**绘制与交互逻辑，不直接碰全局 GPU 状态。

---

## 3. 目录结构（计划）

```
glasses/
├── README.md
├── docs/                      # 设计与规范
├── package.json
├── tsconfig.json
├── vite.config.ts
├── index.html
├── src/
│   ├── main.ts                # 浏览器入口
│   ├── platform/
│   │   ├── types.ts           # 平台抽象接口
│   │   └── web/               # WebGPU / 输入 / 时钟实现
│   ├── engine/
│   │   ├── device.ts
│   │   ├── resources.ts
│   │   ├── layers.ts
│   │   ├── compositor.ts
│   │   └── glass/             # 液态玻璃 pass + WGSL
│   ├── runtime/
│   │   ├── frame-loop.ts
│   │   ├── scheduler.ts
│   │   ├── input-router.ts
│   │   └── events.ts
│   ├── shell/
│   │   ├── desktop.ts
│   │   ├── window-manager.ts
│   │   ├── wallpaper.ts
│   │   └── launcher.ts
│   ├── app/
│   │   ├── types.ts
│   │   ├── registry.ts
│   │   ├── context.ts
│   │   └── builtins/          # 示例应用
│   └── math/                  # 向量、矩形、缓动（平台无关）
└── shaders/                   # 可选：独立 .wgsl 文件
```

原则：

- `engine/`、`math/`、`app/types` **不** import `platform/web`。
- 仅 `main.ts` 与 `platform/web` 绑定浏览器 API。
- 着色器字符串可内嵌或从 `shaders/` 以 raw 导入；原生侧可改为文件加载。

---

## 4. 平台抽象（移植关键）

```ts
// 概念接口（非最终签名）
interface PlatformClock {
  now(): number;
  requestFrame(cb: (t: number) => void): void;
}

interface PlatformSurface {
  readonly width: number;
  readonly height: number;
  readonly devicePixelRatio: number;
  configure(device: GPUDeviceLike): void;
  getCurrentTexture(): GPUTextureLike;
  onResize(cb: () => void): void;
}

interface PlatformInput {
  onPointer(cb: (e: PointerEventLike) => void): void;
  onKey(cb: (e: KeyEventLike) => void): void;
}

interface PlatformHost {
  clock: PlatformClock;
  surface: PlatformSurface;
  input: PlatformInput;
  createDevice(): Promise<GPUDeviceLike>;
}
```

v0.1 中 `GPUDeviceLike` 可直接对齐 WebGPU 类型；日后用更薄的封装或 Dawn 绑定替换。

**内容离屏**：

- Web：`OffscreenCanvas` + 2D / 或 WebGPU 渲染到纹理。
- 原生：CPU 位图上传或独立 GPU 目标。
- App API 暴露「内容表面」抽象 `ContentSurface`，应用不直接依赖 Canvas 2D 全局对象（推荐适配器模式）。

---

## 5. 帧管线

每个显示帧：

```
1. Pump input          → InputRouter 更新指针/按键状态，生成语义事件
2. Shell handle        → 拖拽、焦点、启动器
3. Scheduler.update    → 按 app 优先级调用 onUpdate(dt)
4. Layout              → 窗口几何、动画插值、损坏区域（v0.1 可全量）
5. Content render      → 脏窗口：应用绘制到 ContentSurface → 上传/拷贝为 GPU 纹理
6. Compose             → 自底向上：
                         wallpaper → for each window (glass pass) → overlays
7. Present             → 交换链提交
```

v0.1 默认**每帧全量合成**（分辨率随 canvas），优先正确与观感；损坏区域与分层缓存作为后续优化。

---

## 6. 核心数据模型

### 6.1 Layer

```ts
type LayerId = string;

interface Layer {
  id: LayerId;
  zIndex: number;
  bounds: Rect;           // 屏幕空间 CSS 像素或逻辑像素
  opacity: number;
  visible: boolean;
  content?: TextureRef;   // 应用内容
  material: GlassMaterial;
  shape: ShapeDesc;       // 圆角矩形 / 自定义 SDF 参数
  transform?: Mat3;       // 可选：倾斜、缩放动画
}
```

### 6.2 GlassMaterial（参数见 liquid-glass.md）

物理量 + 美学调制，可按窗口类型覆盖默认值。

### 6.3 Window（Shell 级）

```ts
interface WindowState {
  id: string;
  appId: string;
  title: string;
  bounds: Rect;
  zIndex: number;
  focused: boolean;
  minimized: boolean;     // v0.1 可 stub
  layerId: LayerId;
}
```

---

## 7. 坐标与 DPI

- **逻辑坐标**：Shell / 应用布局使用 CSS 逻辑像素（与 `getBoundingClientRect` 一致）。
- **设备坐标**：渲染目标 = 逻辑尺寸 × `devicePixelRatio`。
- 所有输入事件在进入 Router 前归一到逻辑坐标；上传内容纹理时按 DPR 放大。

---

## 8. 错误与降级

| 情况 | 行为 |
|------|------|
| 无 WebGPU | 明确错误页，不静默回退 WebGL（避免维护双管线稀释目标） |
| 设备丢失 | 监听 `uncapturederror` / lost，尝试重建或提示刷新 |
| 应用绘制异常 | 捕获并显示错误占位纹理，不拖垮合成器 |

---

## 9. 可测试性

- `math/`、`scheduler` 策略、几何命中测试：纯函数单测。
- 渲染：黄金图可选（后续）；v0.1 以人工目视 + 参数面板为主。
- 平台接口可 mock，便于无浏览器跑调度逻辑。

---

## 10. 与「玻璃平台」哲学的对齐

本项目**不是**「先做桌面再贴毛玻璃滤镜」，而是：

> 合成器的主路径 = 液态玻璃材质评估。  
> 桌面与应用是向该合成器提供**形状、厚度意图、内容纹理、层级**的客户端。

因此 API 设计优先暴露材质与层级，而不是传统 UI toolkit 的控件树。
