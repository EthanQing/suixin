# SuixinTodo 定向修复与验收记录

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
