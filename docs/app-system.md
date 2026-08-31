# 应用系统与调度

## 1. 目标

- 第三方或内置逻辑可通过 **注册表挂载** 成为可启动应用。
- 每个应用实例对应 0..n 个窗口（v0.1：**一实例一窗口** 即可）。
- 调度器保证每帧更新与内容绘制顺序稳定、可预期。
- 应用**不**直接操作全局 WebGPU 设备状态（内容表面除外的只读信息）。

---

## 2. 注册与清单

```ts
interface AppManifest {
  id: string;              // 唯一，如 'builtin.clock'
  name: string;            // 显示名
  version?: string;
  icon?: IconDesc;         // v0.1 可用 emoji / 色块
  defaultSize: Size;
  singleton?: boolean;     // 是否单例
  preferredMaterial?: Partial<GlassMaterial>;
}

interface AppModule {
  manifest: AppManifest;
  create(ctx: AppContext): AppInstance;
}
```

```ts
registry.register(module);
registry.unregister(id);
registry.list(): AppManifest[];
registry.get(id): AppModule | undefined;
```

入口侧（`main.ts`）显式 `register` 内置应用；日后可动态 `import()`。

---

## 3. AppContext

应用在 `create` 时获得：

```ts
interface AppContext {
  readonly appId: string;
  readonly instanceId: string;
  readonly window: WindowHandle;   // 移动/关闭/设标题（权限受限）
  readonly content: ContentSurface;
  readonly time: TimeApi;          // now, dt 只读
  readonly theme: ThemeTokens;     // 文字色、间距，与玻璃预设协调
  emit(event: string, payload?: unknown): void;
  on(event: string, cb: Handler): Unsub;
}
```

### ContentSurface（关键）

```ts
interface ContentSurface {
  readonly width: number;   // 内容区逻辑尺寸
  readonly height: number;
  readonly dpr: number;

  /** v0.1 Web 适配：2D 绘制 */
  get2D(): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

  /** 标记脏，调度器将在本帧/下帧上传纹理 */
  invalidate(): void;

  /** 可选：直接拿到 ImageBitmap / 像素回读 — 高级 */
}
```

原生移植时 `get2D` 可换成 `getSkia` / `getBitmap`；应用层推荐通过简单命令式 API 绘制（后续可加）。

---

## 4. AppInstance 生命周期

```ts
interface AppInstance {
  onMount?(): void;
  onUpdate?(dt: number): void;
  onRender?(surface: ContentSurface): void;  // 脏时调用
  onPointer?(e: PointerEventLike): void;
  onKey?(e: KeyEventLike): void;
  onFocus?(focused: boolean): void;
  onResize?(size: Size): void;
  onDispose(): void;
}
```

状态机：

```
registered → spawning → mounted → (running) → disposing → disposed
                 ↘ error ↩
```

- `spawning`：创建窗口层、内容表面、调用 `create` + `onMount`。
- `running`：参与调度。
- `disposing`：`onDispose`，释放 GPU 内容纹理与窗口。

错误：`create`/`onRender` 抛错 → 实例进入 error，窗口显示占位，可关闭。

---

## 5. 简单调度器

### 5.1 设计

非抢占、单线程（与浏览器一致）。  
不模拟进程；**协作式**帧调度。

```ts
interface Scheduler {
  /** 注册每帧 update */
  addUpdate(id: string, fn: (dt: number) => void, priority?: number): void;
  removeUpdate(id: string): void;

  /** 内容绘制请求 */
  requestContentPaint(windowId: string): void;

  /** 由 FrameLoop 调用 */
  runUpdate(dt: number): void;
  runContentPaints(): void;
}
```

### 5.2 优先级（v0.1）

| priority | 用途 |
|----------|------|
| 100 | Shell / 动画 |
| 0 | 普通应用（默认） |
| -100 | 背景统计、低优 |

同优先级：按窗口 z-order 或注册序（固定一种并文档化）。**建议**：update 按 priority 降序，同级按 `instanceId` 字典序，保证稳定。

### 5.3 内容绘制策略

- 应用调用 `content.invalidate()` 或系统因 resize/主题变化自动脏。
- `runContentPaints` 仅处理脏窗口。
- 绘制完成后上传/拷贝到 `contentTex`，清除脏标记。
- 若某应用每帧动画：每帧 `invalidate`（可接受）。

### 5.4 时间

- `dt` 钳制（如 max 50ms），避免切后台后巨步。
- 可选 fixed timestep 给物理（v0.1 不需要）。

---

## 6. 系统服务（迷你）

v0.1 仅内置：

| 服务 | 能力 |
|------|------|
| `WindowService` | 创建/关闭/聚焦（经 Shell） |
| `AppService` | 列举/启动/停止实例 |
| `ThemeService` | 玻璃预设与内容主题 tokens |

应用通过 `AppContext` 间接使用，不直接 import 单例（便于测试）。

---

## 7. 内置示例应用（v0.1）

1. **Glass Lab（设置/调参）**  
   - 滑条调节全局或当前窗 `GlassMaterial`。  
   - 展示引擎核心价值。

2. **Clock 或 Hello**  
   - 简单内容绘制 + 定时 `invalidate`。  
   - 验证调度与离屏纹理路径。

应用数量保持少，把复杂度留给玻璃管线。

---

## 8. 挂载示例（概念）

```ts
import { registry } from './app/registry';
import { clockApp } from './app/builtins/clock';
import { glassLabApp } from './app/builtins/glass-lab';

registry.register(clockApp);
registry.register(glassLabApp);

// 用户点击启动器
appService.launch('builtin.glass-lab');
```

```ts
export const clockApp: AppModule = {
  manifest: {
    id: 'builtin.clock',
    name: 'Clock',
    defaultSize: { width: 320, height: 200 },
    singleton: true,
  },
  create(ctx) {
    return {
      onMount() { ctx.window.setTitle('Clock'); },
      onUpdate() { ctx.content.invalidate(); },
      onRender(surface) {
        const c = surface.get2D();
        // draw clock...
      },
      onDispose() {},
    };
  },
};
```

---

## 9. 安全与隔离（诚实范围）

浏览器单页内：

- **无**真正进程隔离；恶意应用可卡死主线程。
- v0.1 不执行不可信第三方脚本沙箱。
- API 设计避免暴露 `GPUDevice` 给应用，减少误用；不是安全边界。

日后原生若需隔离，可在 Platform 层换进程 + 共享纹理。

---

## 10. 与 Runtime 帧循环的衔接

见 [architecture.md](./architecture.md) §5。调度器是 Runtime 的一部分，Shell 与 App 都是其客户端。
