# SuixinTodo 测试报告

## 最新：1.1.0 保留数据的更新包（2026-10-23）

新增 `dist/SuixinTodo-Setup-1.1.0-x64.exe` 和 portable 1.1.0，原有 1.0.0 安装包与 portable 文件均保留，构建前后 SHA-256 一致。仅更新 package.json / package-lock.json 版本号；appId、产品名、数据目录、文件名、JSON version、NSIS 卸载保留数据配置及运行时存储代码均未变。

实际执行命令：`npm.cmd run test:nsis -- --upgrade-from dist/SuixinTodo-Setup-1.0.0-x64.exe`。使用本机保留的真实 1.0.0 NSIS 包安装，创建两个项目、三条主任务、两条子任务（完成一条，父任务 1/2 且折叠），退出并重开旧安装版，再执行真实 1.1.0 安装器升级，未手动卸载或重新导入。

| 检查 | 结果 |
| --- | --- |
| 实际运行版本 | 1.0.0、1.0.0、1.1.0、1.1.0，逐次断言通过 |
| 安装目录和实际 userData | 升级前后相同，测试 profile 在唯一隔离目录 |
| 主文件、.bak、before-import.json | 安装器运行前后逐字节一致 |
| 项目与任务完整数组 | 包括子任务、ID、完成、顺序、expanded，升级后完整一致 |
| 最后选择 | 仍为项目 B |
| 升级后退出再启动 | 仍为 1.1.0，完整数据一致 |
| 存储单元回归 | 22/22 通过 |
| Windows 构建与语法检查 | 通过 |

证据：`test-results/upgrade-smoke.json`，最终现场 `test-results/suixin-upgrade-Ypxg64/`；四份检查点 JSON、实际 EXE、profile 和截图均保留。最终检查点北京时间约 11:35:20 至 11:35:30。用户数据没有导入到测试 profile；额外复制了本机预期 APPDATA 中原主文件及 .bak 到已被 Git 忽略的 `test-results/user-data-backup-Qcv3Lr/`，通过 SHA-256 核对，升级测试后原文件未改变。个人存档不提交到 Git。

本次只制作更新包并在隔离目录验收，没有替用户运行真实用户目录上的升级。升级指引：旧程序导出备份后从托盘退出，直接运行 1.1.0 安装包，沿用同一 Windows 账户、安装方式与目录；无需先卸载，也无需重新导入计划。旧存档继续从 `%APPDATA%\SuixinTodo\data.json` 读取。系统注销、重启仍未实测。此前 13/13 E2E 的产品代码未变，本轮重点执行真实跨版本升级和存储回归。

## 补充：移除底部提示语（2026-10-23）

同步已合并的 PR #1 到子任务分支，移除底部文案与残留小窗样式；修复 renderer 仍访问已删除 `.footnote` 导致启动错误的问题，数据文件路径悬浮提示转移到“打开数据目录”菜单项。语法检查、完整 Electron E2E **13/13** 与打包 EXE 持久化检查通过；截图已更新并目视确认底部仅保留输入区域。未修改存储逻辑，本轮不重复单元和 NSIS 安装流程。打包检查现场为 `test-results/suixin-packaged-LdJzjN/`。

## 最新：极简子任务（2026-10-23）

开发分支：`codex/minimal-subtasks`，基于 `98bc7fb`。未新增第三方依赖，不改 appId、数据目录或 JSON version，不重置用户数据。

变更范围：

| 文件 | 内容 |
| --- | --- |
| src/store.js | 可选一层 subtasks 与 expanded；父完成状态统一计算；子任务增删改/勾选和展开命令；拒绝嵌套和重复 ID；Windows rename 临时错误有限重试 |
| src/renderer.js | 复用任务行、编辑和确认组件；悬停 +、行内连续输入、草稿/焦点保护、父任务计数/折叠、右键及键盘菜单 |
| src/index.html、src/styles.css | 小型上下文菜单和父子行样式，无新弹窗、进度条或设置页 |
| tests/store.test.js | 新增 7 组父状态、最后一条删除、旧数据、备份、非法结构、写入失败及重试测试 |
| tests/desktop.e2e.js | 新增 6 组 UI 场景，覆盖要求中的 20 项验收及失败保留草稿 |
| tests/packaged-smoke.js | 正式 EXE 和 NSIS 的退出重开、覆盖安装现在同时检查子任务、部分完成和折叠状态 |
| README.md、截图 | 操作、兼容性和视觉验收证据 |

规则与兼容性：旧任务没有 subtasks 时保持原 ID、内容、完成状态；读取旧主文件不强制重写。父任务仅在非空子任务全部完成时完成，每次保存和导入均由 Store 统一校验计算，UI 不自行伪造父状态。删最后一个子任务保留删除前状态，再恢复手动勾选。有效备份和导出保留完整子任务及 expanded，嵌套和跨层重复 ID 被拒绝。旧程序不理解新增字段，不支持用旧程序编辑含子任务的数据，降级前必须另存独立导出备份。

最新自动化：语法检查通过，单元 **22/22**，Electron E2E **13/13**（包含原有 7 组），Windows NSIS / portable 构建成功。最终 E2E 约 30 秒。证据：`test-results/unit-tests.tap`、`test-results/e2e-results.json`、`screenshots/06-subtasks.png`、`screenshots/07-subtasks-small.png`。

正式 EXE 与真实 NSIS 安装版均通过父子任务验收：两个项目、三条主任务、两条子任务，其中一条完成，父状态为未完成且计数 1/2。父任务折叠后从实际托盘退出回调结束进程，再运行同一安装目录的 EXE，完整 projects 数组（包括子任务 ID、内容、完成和 expanded）及 selectedProjectId 均与退出前一致；展开后逐条确认两个子任务的复选状态。未卸载再运行同版本安装器，安装前后 data.json 字节完全一致，重开后再次检查通过。六个打包源码文件 SHA-256 与当前源码逐一一致。

现场证据：`test-results/packaged-smoke.json`、`test-results/suixin-packaged-wybjxe/`，`test-results/nsis-smoke.json`、`test-results/suixin-nsis-pGWOwu/`。NSIS 三个检查点的 data.json 修改时间分别为北京时间 11:21:13.504、11:21:14.304、11:21:23.004，JSON 副本与截图全部保留。本轮未启动应用写入真实 `%APPDATA%\\SuixinTodo`，原主文件和 .bak 的大小 3152 字节及时间 2026-10-22 10:55:53 保持不变。

UI 已验证：悬停/焦点显示操作且文字不跳动；空白 Enter、Escape、空草稿失焦不创建任务；非空草稿不自动提交，切换项目保留；状态更新保留草稿、焦点和选区；第一条创建后出现 0/1；部分 2/4、全部 4/4、取消完成和新增均正确；父圈点击不改状态；箭头/标题切换不重复触发；编辑保持完成和展开，删除保留确认；两个同名父任务跨项目展开互不混用；重启及 JSON 导入导出保留；320×300 窗口长文本、计数、按钮不重叠，无列表横向溢出，底部输入和纵向滚动可用。

新增子任务始终写入磁盘后确认成功，失败仍显示错误并保留草稿；不是用会话内草稿代替任务存储。当前应用原有排序仅支持项目，未额外实现任务/子任务排序。任务及子任务完成都不移动位置。

本轮正常 Windows 权限下也出现过一次间歇性 EPERM rename，所以此前“仅沙箱权限”的推测不能作为结论。对 Windows EPERM/EACCES/EBUSY 仅重试 3 次，总等待最多 120ms，其他错误立即返回，持续失败保留有效目标文件、内存状态和错误提示。故障注入验证第三次重试成功以及四次均失败的原件保护。未把这一观测认定为此前用户现场丢失的根因。

右键菜单测试曾因顶部菜单遮住了测试点击点而超时，调整为用户可点击的未遮挡位置后完整通过；未用强制点击绕过实际遮挡。打包测试曾在空草稿因勾选子任务失焦关闭后继续查找输入框，修正为先 Escape 再勾选的顺序后通过。截图已目视检查，延续原黑白灰小窗风格。所有测试使用唯一隔离 profile，不触碰真实 APPDATA。物理托盘鼠标点击、系统注销/重启、跨版本升级和 portable 实际运行仍未验证。

---

# 此前：首次空白、项目加号与存储恢复修复记录

日期：2026-10-23，Asia/Shanghai。Windows x64 10.0.26300，Node 22.20.0，Electron 45.0.0，Playwright 1.64.1，electron-builder 26.15.3。

## 诊断结论

**已确认**：标题行的项目加号位置错误；defaults 硬编码演示项目。任务操作本来就经过 renderer 串行队列、主进程 Store 同步写入、fsync 临时文件、rename 替换，再返回成功；并非“没有保存代码”。主进程在 ready 前固定 userData，单实例锁避免同路径多实例写入。关闭隐藏到托盘，托盘退出才结束进程，任务保存不依赖退出。NSIS appId 为 local.suixin.todo，asInvoker、per-user，卸载保留数据，没有安装时清理数据的配置。

**已确认的恢复缺口**：旧版仅检查 data.json 和 .bak；二者不存在而 before-import.json 或临时存档存在时仍会创建演示数据；旧路径也不会被检查。此缺口可以用隔离目录中只保留 before-import.json 的方式复现。它是否就是用户现场的丢失原因，**尚无法确认**。

**尚无法确认**：原安装二进制是否与当前源码一致、是否曾用另一 Windows 账户运行、是否有旧路径存档或读取/写入错误、是否仅发生于系统注销/重启。本次实际 NSIS 安装、进程退出重开、同版本覆盖安装均未复现丢失；不能据此宣称已根治原用户反馈。

只读检查发现本机 `%APPDATA%\SuixinTodo` 有 data.json 和 .bak（均 3152 字节、修改时间 2026-10-22 10:55:53），在测试结束后仍保持该大小和时间。未修改、导入、清理该目录。未在 `随心待办`、`suixin-todo`、`Electron` 候选目录发现 data.json 存档。未扫描其他账户或任意磁盘目录。

## 最终修复

| 文件 | 改动 |
| --- | --- |
| src/index.html | 项目加号移到顶部标签行的独立兄弟节点；底部任务控件初始禁用；新增打开数据目录菜单 |
| src/styles.css | 标签容器可收缩并横向滚动，加号固定占位，维持原窗口风格 |
| src/renderer.js | 空状态文案、首次焦点、打开目录事件；底部加号保持任务添加逻辑 |
| src/preload.js | 增加受控打开目录接口 |
| src/main.js | Shell 打开实际 userData（页面及托盘菜单）；旧目录恢复确认；打包测试也可显式隔离 profile；setPath 前创建目录 |
| src/store.js | 空 defaults；有效旧主文件直接读取；扩展存档检查，恢复前保留原件；非 .bak 恢复须确认；恢复不覆盖有效 .bak；临时路径被目录占用时保留原始写入错误 |
| tests/store.test.js | 显式测试夹具，增加空白、升级不写主文件、恢复/取消、损坏保护测试 |
| tests/desktop.e2e.js | 显式 UI 创建夹具，验证顶部加号键盘/滚动布局、空白重启、任务写入失败、打开目录 |
| tests/packaged-smoke.js | 唯一隔离目录；真实 NSIS 安装/重装、安装后 EXE、实际托盘退出回调、JSON/时间/界面对照 |
| package.json | 增加 test:packaged、test:nsis；没有改版本、appId、NSIS 保留数据配置 |
| README.md、screenshots | 更新恢复、构建、安装验收步骤及界面证据 |

没有改变 JSON version、目录名、文件名；没有重写应用或增加时间/优先级功能。有效空主文件优先，升级或主动删光后不会补回演示数据，也不会从旧备份复活已删除项目。

## 已执行结果

| 检查 | 结果 |
| --- | --- |
| npm run check | 通过 |
| 数据层单元测试 | 15/15 通过，正常 Windows 权限、工作区隔离目录 |
| 真实 Electron E2E | 7/7 通过 |
| npm run build:win | NSIS 与 portable 构建成功 |
| win-unpacked 实际运行 | 空白启动、添加/完成、两项目、退出重开及 JSON 比对通过 |
| 真实 NSIS 静默安装 | 通过，运行的是 installed/随心待办.exe，app.isPackaged=true |
| 安装版托盘退出重开 | 两项目、三条任务、完成状态、顺序、ID、选择均保持，通过 |
| 不卸载同版本覆盖安装 | 通过；安装前后 data.json 字节完全一致，启动后项目和选择一致 |
| 注销/重新登录 | **未验证** |
| 系统重启 | **未验证** |
| 跨版本安装升级、另一 Windows 用户、portable 实际运行 | **未验证**（portable 仅构建） |

NSIS 证据：`test-results/nsis-smoke.json`，现场目录 `test-results/suixin-nsis-w9z0ME/`。实际 EXE 是该目录 `installed/随心待办.exe`，实际测试 profile 是同目录 `profile/`，没有写入安装目录或 app.asar。隔离是显式测试配置，正常启动仍使用当前账户 `%APPDATA%\SuixinTodo`；没有启动正常配置去写真实用户目录。

该次 data.json 检查点（北京时间）：

| 检查点 | 文件修改时间 | 数据 |
| --- | --- | --- |
| before-exit.json | 09:35:12.446 | A 两条（首条“安装版持久化测试-123”已完成），B 一条，B 选中 |
| after-relaunch.json | 09:35:13.289 | 项目/任务/完成/选择与退出前一致 |
| after-overwrite-install.json | 09:35:22.390 | 项目/任务/完成/选择与安装前一致 |

时间变化包含正常的窗口位置保存；比较项目完整数组和 selectedProjectId，并逐项比对当前界面任务文本与 checkbox。NSIS 安装执行两次，未做卸载。应用数据与安装目录分离，所有现场、备份和截图均保留。

其他证据：`test-results/unit-tests.tap`、`test-results/e2e-results.json`、`test-results/packaged-smoke.json`、`test-results/suixin-packaged-FgTVz0/`；界面截图 `screenshots/05-project-plus.png` 已目视检查。

## 复现与边界

运行命令及完整手工步骤见 README 的“验证”。自动化设置 SUIXIN_E2E=1 和唯一 SUIXIN_TEST_DATA；项目/任务由测试自身创建，无演示数据成功前提，不触碰真实用户 profile。

Electron 启动需要正常桌面进程权限；沙箱内启动失败。沙箱文件权限下单元测试曾出现 EPERM rename，正常 Windows 权限下最终 15/15 通过。未将该现象当作用户数据丢失根因，未添加未经证实的重试或删除数据逻辑。首次 E2E 的旧窗口引用问题已修正后全量通过。

托盘使用真实 Tray 和真实菜单的“退出程序”注册回调；通过 Playwright 调用回调验证进程退出，并非人工物理点击。打开数据目录 E2E 拦截 shell.openPath 以断言参数和错误提示，未声称人工操作文件管理器。备份测试替换原生文件选择器返回路径，真实验证确认 UI 和磁盘 I/O。NSIS 使用真实安装器的 /S /CURRENTUSER /D 参数，未操作可见安装向导；真实注册和快捷方式由安装器产生。

没有执行注销、系统重启、断电、硬件故障、跨用户或 Windows 10 实机验证。自动化完成不等于原用户机器已复现及修复；若现场仍丢失，应先保全整个实际 userData 目录及安装版本/EXE 路径，再对照两个启动时的账户、路径、存档内容与时间调查。
