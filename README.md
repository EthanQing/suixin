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
5. 点击清单标题右侧的 `+` 新建项目；顶部 `··· → 管理项目` 可重命名、删除和用箭头调整项目顺序。
6. 删除项目时，确认框会明确显示该项目的任务数量，并说明已完成任务也会一起删除。允许删除最后一个项目，再重新创建。
7. 拖动标题栏移动窗口，拖动窗口边缘调整大小。默认 420 × 380，最小 320 × 300。长任务自动换行，列表独立滚动，底部输入框固定保留。
8. `··· → 始终置顶`，或托盘右键菜单中的“始终置顶”，可设置常驻角落小窗。
9. 右上角 `−` 最小化到任务栏，`×` 和 Alt+F4 隐藏到系统托盘，保持后台运行。点击托盘黑色圆形勾图标重新显示；托盘右键可显示、隐藏或退出。
10. `··· → 退出程序` 或托盘右键“退出程序”才会主动结束进程。再次启动恢复项目、任务、完成状态、项目排序、最后选择、窗口位置、大小及置顶状态。
11. 重复启动会显示已运行的窗口，避免多个实例同时写数据。

默认提供参考图中的四个示例项目与任务。示例只在首次创建数据文件时生成，不会在重启时追加或清理任务。

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

数据保存在用户目录，移动免安装 EXE 或更新安装包不会删除数据。免安装版也采用此固定位置，不会将数据写入临时解压目录。卸载程序默认保留本地数据。

- 每次添加、编辑、勾选、手动删除和项目选择后，同步完成本地保存，再向界面确认成功。
- 先写 `.tmp`，执行文件刷新，再替换 `data.json`；失败时保留原内存状态并显示错误。
- `data.json.bak` 保留上一版有效文件。窗口移动和缩放合并保存，隐藏、关闭和退出时再次保存位置。
- 主文件损坏时自动尝试 `.bak`，保留带 `.damaged-` 后缀的原件，并在界面告知恢复情况。
- 如果主文件和副本都无效，应用提示文件路径并停止启动，不会用默认示例覆盖用户数据。此时先复制整个数据目录，退出应用后将有效导出备份复制为 `data.json`，再启动。

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
node tests\packaged-smoke.js
```

Electron 测试直接驱动本机桌面进程，不需要另装浏览器。测试数据使用独立临时目录，与正式数据分离；打包检查只读取任务并验证隐藏窗口，不修改任务。完整覆盖内容和实际运行结果见 `TEST-REPORT.md`。

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
