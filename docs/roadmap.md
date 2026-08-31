# 路线图

## v0.1 — 效果 Demo（当前）

**目标**：在浏览器中跑通「液态玻璃桌面」最小闭环，观感优先。

- [x] 整体设计文档
- [x] 工程脚手架（Vite + TS 7 strict + WebGPU 类型）
- [x] Platform/Web：设备、canvas、resize、输入、帧时钟
- [x] Engine：资源管理、全屏 blit、ping-pong 合成
- [x] 液态玻璃 pass：SDF 圆角、厚度法线、折射、Fresnel、粗糙度模糊、tint
- [x] 色散 + 液态噪声（可调）
- [x] 软阴影
- [x] Shell：壁纸、窗口拖拽、焦点、z-order、极简标题栏
- [x] 离屏 ContentSurface → GPU 纹理
- [x] AppRegistry + Scheduler + 生命周期
- [x] 内置：Glass Lab + Clock/Hello
- [x] 简单启动器
- [x] README 运行说明

**成功标准**：

1. 打开页面即可看到玻璃窗口与可辨识折射/边缘高光。
2. 拖拽窗口时背后内容弯曲关系正确更新。
3. Glass Lab 实时改参立即可见。
4. 第二应用可挂载并独立绘制内容。
5. 无 WebGPU 时有清晰失败提示。

---

## v0.2 — 曲面液态玻璃 + 可用迷你桌面（进行中）

**渲染升级（已完成，2026-08-31）**：

- [x] 曲面双折射模型：穹顶高度场（中心即有曲率）+ 双次折射 + 底面 Newton 求交
- [x] 每通道 IOR 色散（全身可见）+ 背景平面投影采样（放大/位移/局部倒像）
- [x] 光程 Beer-Lambert + 奶白散射（milkiness）+ 内部反射重影
- [x] Studio 解析环境（顶部柔光箱）+ 肩部光泽带 + rim
- [x] 海报风 Canvas2D 壁纸（高对比排版，凸显玻璃质感）+ 颗粒
- [x] Glass Lab 预设（海报/清水/浓磨砂）+ 曲率/背景距离/磨砂/内反射滑条
- [x] glass pass scissor 限位 + 先 blit 再 scissored glass

**待做**：

- 窗口缩放、最小/关闭行为完善
- 启动器视觉完善、多实例策略
- 内容主题与字体渲染改进
- 模糊金字塔缓存等性能结构
- 更多内置应用（记事本、壁纸选择）
- 基础单元测试（math、hit-test、scheduler）

---

## v0.3 — 材质与控件

- 控件级 SDF（按钮、滑条）统一玻璃语言
- 指针波纹、开窗流体感增强
- 可选环境贴图 / 更佳高光
- 无障碍：对比度模式（仍保持玻璃，但提高内容可读）

---

## v1.x — 移植与生态

- Platform 抽象冻结，引入原生后端 POC（如 wgpu/Dawn + 窗口）
- 应用打包约定（manifest + bundle）
- 文档站点与示例廊

---

## 风险与决策记录

| 风险 | 缓解 |
|------|------|
| 玻璃片元较重（双折射 + 多次求值） | scissor 限位；模糊链缓存列入 v0.2 |
| OffscreenCanvas 2D 文字与 GPU 色域不一致 | 统一预乘 alpha、sRGB surface |
| 过度追求路径追踪 | 坚持屏幕空间物理启发，参数校准 |
| 应用直接碰 GPU 导致状态污染 | ContentSurface 隔离、禁止下发 device |

## 已拍板决策（2026-07-22）

1. 视觉：物理参数 + Liquid Glass 美学融合。  
2. 内容：离屏纹理 + GPU 合成。  
3. Shell：精简自定义，非 OS 克隆。  
4. v0.1：效果 Demo 优先。  
5. 无 WebGPU 不回退 WebGL 双管线。  
