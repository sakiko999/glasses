# 桌面 Shell

## 1. 定位

精简自定义 Shell：**不**模仿完整 Windows / macOS。  
职责是提供「可放置液态玻璃窗口」的舞台，并处理最基本的桌面交互。

组成（v0.1）：

1. **壁纸层** — 全屏背景（图片 / 程序化渐变 / 简单着色器场景）。
2. **窗口管理** — 创建、关闭、移动、z-order、焦点。
3. **启动器** — 列出已注册应用并打开实例。
4. **光标与命中** — 指针命中最上层窗口 / 标题拖拽区 / 桌面空白。

可延后：Dock、菜单栏、虚拟桌面、最大化吸附、Mission Control。

---

## 2. 坐标系与布局

- 原点：画布左上。
- 单位：逻辑像素。
- 窗口 `bounds: { x, y, width, height }`。
- 默认开窗：居中或级联偏移，避免完全重叠时无法感知层级。

**装饰（v0.1 极简）**：

```
┌─────────────────────────────────────┐
│ [●] Title                     [–][×]│  ← 拖拽区 / 可选交通灯（可极简为仅关闭）
├─────────────────────────────────────┤
│                                     │
│           ContentSurface            │
│                                     │
└─────────────────────────────────────┘
```

- 标题栏高度固定（如 36–40px 逻辑像素）。
- 整窗外轮廓 = 玻璃形状（大圆角）。
- 标题栏与内容同属一块玻璃材质；内容纹理在标题栏区域绘制文字/按钮。

---

## 3. WindowManager

### 3.1 状态

```ts
interface WindowManager {
  windows: Map<WindowId, WindowState>;
  focusedId: WindowId | null;
  create(opts: CreateWindowOptions): WindowId;
  close(id: WindowId): void;
  focus(id: WindowId): void;
  move(id: WindowId, pos: Vec2): void;
  resize(id: WindowId, size: Size): void; // v0.1 可后置，Demo 固定尺寸
  bringToFront(id: WindowId): void;
}
```

### 3.2 z-order

- 整数 zIndex，新建 = max+1。
- 点击窗口非穿透区域 → `bringToFront` + `focus`。
- 合成严格按 z 升序。

### 3.3 拖拽

1. pointerdown 在标题栏 → 记录 grabOffset。
2. pointermove → `bounds.x/y = pointer - grabOffset`，可夹紧使标题栏仍可点到。
3. pointerup / cancel → 结束。

### 3.4 焦点

- 同时仅一个 focused 窗口。
- 焦点变化发事件：`focus-changed`。
- 聚焦窗口可有轻微材质差异（edgeBoost / specular 略高）或细焦点描边 overlay。

---

## 4. 壁纸

实现选项（v0.1 选一主路径 + 可切换）：

| 类型 | 说明 |
|------|------|
| 程序化 HDR 渐变 + 噪点 | 无外部资源，利于折射演示 |
| 静态图片 | 用户/内置资产 |
| 轻量着色器场景 | 缓慢运动的色块，展示时间向折射 |

壁纸也是 Layer，材质可为「无玻璃」不透明 blit，或极弱玻璃（一般不透明）。

---

## 5. 启动器

v0.1 形态建议：

- 桌面空白处双击 / 或快捷键 / 或固定角上玻璃胶囊按钮 → 打开启动器面板（也是玻璃窗口或 overlay 层）。
- 列出 `AppRegistry` 中应用：图标（可先用字形）、名称、一点即 `spawn`。

不必做开始菜单动画体系。

---

## 6. 输入路由

```
Platform pointer/key
    → InputRouter（标准化）
        → 若拖拽会话进行中：只发给 WM
        → 否则 hit-test 顶层窗口
            → 标题栏：WM
            → 内容区：对应 App 的 onPointer*
            → 未命中：Shell（启动器、桌面菜单 stub）
```

键盘：

- 全局快捷键先由 Shell 消费（如 `Alt+Tab` stub、`` ` `` 打开启动器）。
- 其余派发到 focused app。

---

## 7. 动画（克制）

v0.1：

- 开窗：scale 0.96→1 + opacity 短缓动（内容与玻璃同步）。
- 关窗：反向后销毁资源。
- 焦点：材质参数插值。

动画在 `layout` 阶段更新，驱动 bounds/opacity/material。

---

## 8. 与合成器的接口

Shell 每帧输出：

```ts
interface FrameScene {
  wallpaper: WallpaperDesc;
  layers: Layer[];      // 已按 z 排序的窗口层
  overlays: Overlay[];  // 启动器、debug、光标自定义（可选）
}
```

Engine 只消费 `FrameScene`，不回调 Shell 业务。
