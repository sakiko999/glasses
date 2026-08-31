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

**渲染升级（重构完成，2026-08-31）**：

- [x] 构造性单调折射偏移场：主体透镜 + 边带弯折，C2 smootherstep 交接、结构性防折叠上限（取代双折射 Newton 求交——钟形坡度映射非单调，必然镜像折叠）
- [x] smoothed SDF 距离场（smax 平滑核心 max）：消除 45° 角平分线四条棱线；q³ 超椭圆方向场消除 medial axis 棱面
- [x] authored 径向亮晕 + 抛光轮廓发丝线：Fresnel (1−cosθ)⁵ 在浅坡 UI 玻璃上恒为 f0，物理项无法塑造亮度过渡
- [x] 宽偏移过渡带（2.2× bevel、内径封顶）；轮廓跳位由抛光亮线密封
- [x] 清水/海报/浓磨砂三预设（清水默认）+ Glass Lab 13 滑条实时调校
- [x] 海报风 Canvas2D 壁纸 + 颗粒；glass pass scissor 限位 + 先 blit 再 scissored glass

**待做**：

- 窗口缩放、最小/关闭行为完善
- 启动器视觉完善、多实例策略
- 内容主题与字体渲染改进
- 模糊金字塔缓存等性能结构
- 更多内置应用（记事本、壁纸选择）
- 基础单元测试（math、hit-test、scheduler）

---

## v0.3 — 全系统液态玻璃（对齐 Apple Liquid Glass）

**目标**：玻璃从「窗口材质」升级为贯穿整个 UI 的统一材质语言——窗口、控件、弹层由同一套 SDF + 折射管线渲染，如 Apple 液态玻璃是一整套方案而非单一样式。

- [ ] 控件级玻璃 SDF：按钮、滑条、开关、滚动条复用 glass pass（各自 rect / bevel / 材质参数，小半径窄边带）
- [ ] 玻璃层级（material tiers）：窗口级（厚、弯折强）/ 控件级（薄、克制）/ 弹层级（launcher、菜单）参数化分级，共享管线
- [ ] 交互态：hover / press 边缘高光呼吸、按压时厚度与折射微变、focus 光晕——流动感来自状态过渡而非持续动画
- [ ] 指针波纹、开窗/关窗流体感
- [ ] 内容/材质分离架构不变：控件内容仍走 Canvas2D 贴膜，玻璃只管材质
- [ ] 性能：模糊金字塔缓存、静态控件纹理缓存、控件玻璃 draw 合批
- [ ] 无障碍：对比度模式（保持玻璃，提高内容贴膜可读性）
- [ ] 内置应用控件化改造：Glass Lab 滑条/按钮、时钟、启动器图标全部玻璃化

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
