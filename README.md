# 随心待办

极简、完全本地的 Windows 多项目桌面待办小窗，按提供的 UI 参考图实现。没有日期、优先级、提醒或计时器。

**完成只改变勾选状态和文字样式。任务不会被自动删除、隐藏、归档或重新排序。**

## 直接使用

- `dist/SuixinTodo-Portable-1.0.0-x64.exe`：免安装，双击启动。
- `dist/SuixinTodo-Setup-1.0.0-x64.exe`：安装版，可选择安装位置，创建桌面和开始菜单快捷方式。
- `dist/win-unpacked/随心待办.exe`：已解包的程序，必须与同目录其他文件一起保留。

目标平台：Windows 10 / Windows 11，x64。运行已打包程序不需要 Node.js，也不需要联网。安装依赖和首次打包时需要联网下载开发工具。

发行文件没有商业代码签名。项目包含完整源码和锁定依赖，可自行构建。

## 操作

1. 点击顶部胶囊切换项目。项目较多时，可在标签栏用鼠标滚轮或横向滚动查看。
2. 在底部输入内容，按 Enter 或点黑色 `+` 添加。空白内容不会添加，成功后清空输入，可连续记录。
3. 点击圆形复选框完成任务：显示白色对勾、浅灰文字和删除线，保留原位置。再次点击恢复。
4. 鼠标移到任务上，显示编辑和删除按钮；键盘 Tab 聚焦到任务时也会显示。编辑不会改变完成状态；删除必须确认。
5. 点击顶部项目胶囊行最右侧固定的 `+` 新建项目（支持 Tab、Enter 和空格）；标签可横向滚动。顶部 `··· → 管理项目` 可重命名、删除和用箭头调整项目顺序。
6. 删除项目时，确认框会明确显示该项目的任务数量，并说明已完成任务也会一起删除。允许删除最后一个项目，再重新创建。
7. 拖动标题栏移动窗口，拖动窗口边缘调整大小。默认 420 × 380，最小 320 × 300。长任务自动换行，列表独立滚动，底部输入框固定保留。
8. `··· → 始终置顶`，或托盘右键菜单中的“始终置顶”，可设置常驻角落小窗。
9. 右上角 `−` 最小化到任务栏，`×` 和 Alt+F4 隐藏到系统托盘，保持后台运行。点击托盘黑色圆形勾图标重新显示；托盘右键可显示、隐藏或退出。
10. `··· → 退出程序` 或托盘右键“退出程序”才会主动结束进程。再次启动恢复项目、任务、完成状态、项目排序、最后选择、窗口位置、大小及置顶状态。
11. 重复启动会显示已运行的窗口，避免多个实例同时写数据。

首次启动没有任何示例项目，显示“还没有项目，点击顶部 + 创建第一个项目”；创建项目之前底部输入框禁用。升级不会清空已有存档；主动删除全部项目后重启仍保持空白。

## 极简子任务

- 鼠标移到任务上或用键盘聚焦，右侧显示小型 `+`，点击后在原任务下方输入子任务；也可右键选择“添加子任务”，或用 Shift+F10 打开任务菜单。
- Enter 保存并继续输入；空白 Enter 不创建任务。Escape 或取消按钮退出。空草稿失焦后关闭；有文字的草稿不会自动提交，切换项目后返回仍可继续输入。未提交草稿只在本次会话保留。
- 第一条子任务保存成功后才出现展开箭头和 `0/1`。点击箭头或父任务标题展开/收起；新增时自动展开，其他操作和重启保留用户的展开状态。
- 父任务的圆圈只显示自动计算的结果，不能手动勾选。全部子任务完成才完成父任务；部分完成显示如 `2/4`，取消任意一条或新增未完成子任务，父任务恢复未完成。
- 子任务复用现有复选框、悬停编辑/删除按钮及删除确认。完成不会隐藏、删除或重排任务；删除父任务会明确提示子任务数量，并一并删除。
- 删除最后一条子任务后恢复普通任务，保留删除前完成状态，随后可以手动勾选。当前原有排序能力仅针对项目，任务和子任务继续按添加顺序显示。

没有新增依赖、进度条、设置页面或子任务专用弹窗。子任务仅支持一层，普通任务不显示箭头或 `0/0`。

数据仍为 version 1，以可选 `subtasks` 数组保存子任务，以父任务的 `expanded` 布尔值保存展开状态；普通旧任务没有这些字段也能直接读取，原 ID、文字、完成状态不变。每个子任务有独立 ID，校验拒绝重复 ID、非法类型及再次嵌套，父任务 completed 在 Store 中统一计算后保存。导入、导出、.bak 和恢复副本均保留完整结构。旧版程序的校验器不认识子任务字段，**使用子任务后不要用旧程序保存同一份数据；降级前先导出独立备份**。

## 本地开发

建议 Node.js 22.20 或更新的受支持版本，Windows PowerShell：

```powershell
cd "你的项目路径\suixin-todo"
npm.cmd ci
npm.cmd start
```

项目使用原生 HTML、CSS、JavaScript，没有 React、数据库服务或前端构建步骤。只有 Electron、electron-builder、Playwright 三个直接开发依赖，没有额外运行时 npm 依赖。

如果终端设置了 `ELECTRON_RUN_AS_NODE`，启动 Electron 前清除这个环境变量：

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
npm.cmd start
```

## Windows 打包

```powershell
npm.cmd ci
npm.cmd run build:win
```

生成 x64 NSIS 安装包及免安装 EXE，输出到 `dist/`。普通用户权限即可使用和安装，不会配置开机启动。无证书时构建仍可完成；发布者可另行配置自己的签名证书。

仅生成解包目录：

```powershell
npm.cmd run build:dir
```

图标已随源码提供。如需从矢量绘制指令重新生成 ICO：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\make-icons.ps1
```

## 数据和备份

正式版和开发版都使用当前 Windows 用户的：

```text
%APPDATA%\SuixinTodo\data.json
```

`··· → 打开数据目录` 或托盘同名菜单通过 Electron Shell 打开实际运行时目录；底部说明的悬浮提示也显示数据文件路径。数据不写入安装目录、app.asar 或 portable 解压目录，NSIS 配置为卸载保留数据。本次已验证同版本覆盖安装；注销、系统重启和跨版本升级尚未实测。

开发版、win-unpacked、NSIS 与 portable 默认共用当前 Windows 用户的上述目录。同一用户重复启动由单实例锁处理；切换 Windows 用户或用另一账户运行时会使用那个账户的 APPDATA，不会自动跨用户复制。没有变更 appId、目录名、文件名或 JSON version。

- 每次添加、编辑、勾选、手动删除和项目选择后，同步完成本地保存，再向界面确认成功。
- 先写 `.tmp`，执行文件刷新，再替换 `data.json`；失败时保留原内存状态并显示错误。
- `data.json.bak` 保留上一版有效文件。窗口移动和缩放合并保存，隐藏、关闭和退出时再次保存位置。
- 有效主文件（包括空项目列表）优先，不被旧备份覆盖。缺失或损坏时自动恢复有效 `.bak`，恢复前另存 `recovery-<UUID>.json`，损坏主文件另存 `.damaged-<UUID>`，保留原备份。
- 若没有有效主文件或 `.bak`，检查 `before-import.json`、其备份、遗留 `data.json.tmp`、损坏副本及恢复副本，并检查同一 APPDATA 下 `随心待办`、`suixin-todo`、`Electron` 目录中的同格式存档。这些只是已知名称候选，不代表已确认过去使用过这些路径。按修改时间提出候选，须用户确认后先备份再恢复；取消则退出，不创建空文件。
- 检测到存档但均无法读取时，提示路径和错误后停止，不静默初始化。只有所有候选均不存在才创建新空文件。未知位置或其他 Windows 用户的数据需手动恢复。

恢复旧数据：先从托盘彻底退出，复制整个数据目录到安全位置，保留 `data.json.bak`、`before-import.json`、`.damaged-*` 和 `recovery-*.json`。能启动时通过“导入 JSON 备份”选择已确认的有效副本；无法启动时，先把当前 `data.json` 另存为唯一名称，再把有效副本**复制**为 `data.json` 后启动。不要删除原件、不要把空文件覆盖到旧存档。自动恢复不合并多个存档；候选不是所需版本时应取消并人工选择。

`··· → 导出 JSON 备份`：通过 Windows 文件对话框保存全部项目、任务、完成状态、数组顺序、窗口设置和最后选择。

`··· → 导入 JSON 备份`：选择文件后先验证格式和 ID，再显示项目数、任务数和覆盖说明；只有点击“确认导入”才替换数据。取消或无效备份不会改变现有清单。导入前另存完整的 `before-import.json`，下一次导入时更新此副本。

为避免错误文件消耗过多资源，JSON 数据和备份上限为 20 MB，项目名称最多 80 字符，任务内容最多 2000 字符。不限制列表中任务数量（总文件大小上限内）。如需手动恢复 `before-import.json`，可通过应用的导入功能选择它。

数据格式（数组位置就是排列顺序，无日期字段）：

```json
{
  "version": 1,
  "projects": [
    {
      "id": "c34d31c1-61aa-4a89-8bb2-799c3e66b380",
      "name": "光疗舱",
      "tasks": [
        { "id": "d6b73f6c-34b8-4a40-bf99-884e06ef42a0", "text": "整理所需数据", "completed": true }
      ]
    }
  ],
  "selectedProjectId": "c34d31c1-61aa-4a89-8bb2-799c3e66b380",
  "window": { "x": 80, "y": 90, "width": 420, "height": 380, "alwaysOnTop": false }
}
```

实际 ID 由 `crypto.randomUUID()` 生成。更换显示器后，启动时会将窗口位置限制在当前可用屏幕内。

## 目录结构

```text
suixin-todo/
├── package.json                 开发、测试、Windows 打包配置
├── package-lock.json            锁定开发依赖
├── README.md                    使用与开发说明
├── TEST-REPORT.md               实际测试结果及测试边界
├── LICENSE
├── .gitignore
├── playwright.config.js
├── src/
│   ├── main.js                  窗口、托盘、IPC、导入导出、单实例
│   ├── preload.js               contextBridge 白名单 API
│   ├── store.js                 数据校验、业务操作、原子保存与恢复
│   ├── index.html               页面与确认/编辑对话框
│   ├── styles.css               白色圆角小窗、胶囊、勾选划线样式
│   └── renderer.js              项目切换、任务交互、串行保存队列
├── assets/
│   ├── icon.ico
│   └── tray.ico
├── scripts/
│   └── make-icons.ps1           多尺寸 ICO 生成脚本
├── tests/
│   ├── store.test.js            Node 数据层测试
│   ├── desktop.e2e.js           真实 Electron 桌面端到端测试
│   └── packaged-smoke.js        打包程序启动与关闭检查
├── screenshots/                 实际 Electron 截图
├── test-results/                自动化测试结果
└── dist/                        Windows 可执行程序（构建后）
```

## 验证

```powershell
npm.cmd run check
npm.cmd test
npm.cmd run test:e2e
npm.cmd run build:win
npm.cmd run test:packaged
npm.cmd run test:nsis
```

Electron 测试直接驱动本机桌面进程，不需要另装浏览器。测试自身创建项目和任务。打包/安装测试用 `SUIXIN_E2E=1` 和唯一的 `SUIXIN_TEST_DATA` 目录双重显式开启隔离，发布包中仍不暴露主进程测试钩子。日常启动不要设置这两个测试变量。完整结果和边界见 `TEST-REPORT.md`。

`test:nsis` 会真实静默安装（注册应用并创建快捷方式）到 `test-results/suixin-nsis-*/installed`，重开安装后的 EXE，再执行同版本覆盖安装。建议在专用测试机或 VM 运行；不要与正在运行的正式版同时操作。测试 profile、各检查点 JSON、时间和截图全部保留在对应目录，失败也不清理，汇总为 `test-results/nsis-smoke.json`。测试不会卸载或删除任何用户数据。

手工完整安装验收：

1. 在专用 Windows 测试账户或 VM 中安装 `dist/SuixinTodo-Setup-1.0.0-x64.exe`，运行安装目录的 EXE。用“打开数据目录”记录实际路径，应该是该账户 `%APPDATA%\SuixinTodo`；初次为空白。
2. 顶部 `+` 创建项目 A，底部 `+` 添加“安装版持久化测试-123”和第二条任务，勾选第一条；创建项目 B 并添加任务，保持 B 选中。
3. 打开 `data.json`（只读），记录更新时间，确认项目、文本、completed、selectedProjectId 与界面一致，复制整个目录留证。
4. 托盘右键“退出程序”，在任务管理器确认进程结束。重开安装后的 EXE，检查 A、B、全部任务、完成和选择状态。
5. 不卸载，再次运行安装包覆盖安装。确认数据目录不变，逐项复查；跨版本测试需另备上一正式版本安装包。
6. 保存其他工作后，在测试账户中注销并重新登录，再检查；在 VM 或测试机重启系统后再次检查目录和全部数据。**本次未执行这两项，不能视为通过。**
7. 若异常，停止继续写入，复制整个目录、安装包版本、运行 EXE 路径、Windows 用户身份和出现时间；不要通过删除目录“修复”。

受限制的执行环境可将临时测试文件放到工作区：

```powershell
$env:SUIXIN_TEST_ROOT = Join-Path (Get-Location) 'test-results\temp'
npm.cmd test
npm.cmd run test:e2e
```

## 安全和架构

业务数据只在主进程读写。渲染进程启用 `contextIsolation` 和 `sandbox`，关闭 `nodeIntegration`，通过 preload 暴露明确的操作接口，不暴露通用 IPC、文件系统或 Node.js。所有 IPC 验证请求来自当前窗口的顶层页面。

应用只加载内置 `suixin://app/` 页面和白名单静态文件，配置严格 CSP，阻止外部导航、新窗口、权限申请和渲染进程网络请求。用户输入使用 `textContent`，不会作为 HTML 执行。正式打包不包含测试用的主进程访问钩子。

实现参考：[Electron 安全指南](https://www.electronjs.org/docs/latest/tutorial/security)、[安全 IPC 模式](https://www.electronjs.org/docs/latest/tutorial/ipc)、[Tray API](https://www.electronjs.org/docs/latest/api/tray)、[electron-builder Windows 打包](https://www.electron.build/win/)。

## 功能范围

任务始终按添加顺序显示；项目支持手动调整顺序。没有实现可选的任务拖拽排序。没有日期、提醒、工时、优先级、看板、账户、云同步或任务自动清理。Electron 自带 Chromium，因此程序体积主要来自桌面运行时。
