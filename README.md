# Glasses

基于 **WebGPU** 的液态玻璃桌面渲染引擎。  
桌面本身是承载「物理可信的液态玻璃」材质与合成的平台；窗口、控件、壁纸层均统一在该材质语言下呈现。

> 初版：浏览器 + **TypeScript 7**。架构上隔离平台层，便于日后移植原生（Metal / Vulkan / Dawn 等）。

## 快速开始

```bash
npm install
npm run dev
```

浏览器打开终端提示的本地地址（默认 `http://localhost:5173`）。  
需要支持 **WebGPU** 的浏览器（较新的 Chrome / Edge 等）。

```bash
npm run typecheck   # TypeScript 检查
npm run build       # 生产构建
```

## 操作

| 操作 | 说明 |
|------|------|
| 拖拽标题栏 | 移动窗口 |
| 点击关闭按钮 | 关闭窗口 |
| 双击桌面空白 | 打开启动器 |
| `` ` `` 或 `Ctrl+Space` | 切换启动器 |
| `Esc` | 关闭启动器 |
| Glass Lab 预设 | 一键切换 海报 / 清水 / 浓磨砂 基调 |
| Glass Lab 滑条 | 实时调节液态玻璃物理/美学参数 |

启动后会自动打开 **Glass Lab** 与 **时钟** 两个示例窗口。

## 设计文档

| 文档 | 内容 |
|------|------|
| [docs/architecture.md](docs/architecture.md) | 总体架构、分层、模块边界、移植策略 |
| [docs/liquid-glass.md](docs/liquid-glass.md) | 液态玻璃物理模型与渲染管线 |
| [docs/desktop-shell.md](docs/desktop-shell.md) | 精简桌面 Shell、窗口、输入、焦点 |
| [docs/app-system.md](docs/app-system.md) | 应用挂载、生命周期、简单调度 |
| [docs/roadmap.md](docs/roadmap.md) | 版本范围与演进路线 |

## 产品定位（v0.1）

- **视觉**：曲面双折射玻璃（穹顶高度场 + 双次折射 + 每通道色散 + studio 环境），物理参数驱动 + Liquid Glass 美学
- **合成**：离屏纹理 + GPU 合成（内容先画到纹理，再由玻璃着色器折射/反射合成）
- **Shell**：精简自定义桌面（壁纸、可拖拽窗口、焦点、启动器）
- **范围**：效果 Demo 优先 — 完整玻璃材质 + 示例窗口 + 应用 API / 调度骨架

## 技术栈

- TypeScript **7.x**（strict）
- WebGPU + WGSL
- Vite 8
- `@webgpu/types`

## 源码结构

```
src/
  platform/web/     # 浏览器适配（设备、表面、输入、时钟）
  engine/           # 合成器、资源、液态玻璃着色器
  runtime/          # 帧循环、调度器、事件总线
  shell/            # 桌面、窗口管理、启动器
  app/              # 应用 API、注册表、内置应用
  math/             # 几何与缓动（平台无关）
```

## 挂载自定义应用

```ts
import type { AppModule } from '@/app/types';

export const myApp: AppModule = {
  manifest: {
    id: 'demo.hello',
    name: 'Hello',
    icon: '✨',
    defaultSize: { width: 360, height: 240 },
  },
  create(ctx) {
    return {
      onMount() {
        ctx.window.setTitle('Hello');
        ctx.content.invalidate();
      },
      onRender(surface) {
        const c = surface.get2D();
        c.clearRect(0, 0, surface.width, surface.height);
        c.fillStyle = ctx.theme.text;
        c.font = `20px ${ctx.theme.fontUi}`;
        c.fillText('Hello, Glass!', 24, 48);
      },
      onDispose() {},
    };
  },
};

// main.ts
desktop.registerApp(myApp);
```

应用只绘制**内容层**；玻璃边框、折射、阴影由引擎统一合成。

## 状态

- [x] 整体设计文档
- [x] 工程脚手架（TS7 + Vite + WebGPU）
- [x] WebGPU 初始化与帧循环
- [x] 液态玻璃合成管线（v0.2：曲面双折射）
- [x] 桌面 Shell 最小闭环
- [x] 应用挂载 API + Glass Lab / Clock
- [x] 海报风壁纸 + 预设基调切换

## 许可证

待定。
