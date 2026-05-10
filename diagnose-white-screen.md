# 白屏问题诊断指南

## 快速诊断步骤

### 1. 检查终端输出

运行 `npm run dev` 后，查看终端是否显示：

```
✓ Vite server started at http://localhost:5173
✓ Electron main process started
```

**如果看到错误**：记下错误信息并告诉我。

---

### 2. 打开开发者工具

在白屏的 Electron 窗口中：
- 按 `Ctrl+Shift+I`（或 `F12`）
- 或右键点击窗口 → "检查元素"

查看 **Console** 标签页，是否有红色错误信息。

**常见错误类型**：
- `Failed to load module` - 模块加载失败
- `Uncaught Error` - JavaScript 运行时错误
- `Cannot read property of undefined` - 数据访问错误
- 网络请求失败（红色的 HTTP 请求）

---

### 3. 检查 Network 标签页

在开发者工具中切换到 **Network** 标签页：
- 刷新页面（`Ctrl+R`）
- 查看是否有失败的请求（红色）
- 特别注意 `main.tsx`、`App.tsx` 等文件是否加载成功

---

### 4. 常见问题快速修复

#### 问题 A：端口被占用
**症状**：终端显示 `Port 5173 is already in use`

**解决**：
```bash
# 杀死占用端口的进程
netstat -ano | findstr :5173
taskkill /PID <进程ID> /F

# 或者修改端口
# 编辑 electron.vite.config.ts，添加 server: { port: 5174 }
```

#### 问题 B：缓存问题
**症状**：之前能运行，突然白屏

**解决**：
```bash
# 清理缓存和重新安装
rm -rf node_modules/.vite
rm -rf out
npm run build
npm run dev
```

#### 问题 C：依赖问题
**症状**：终端显示模块找不到

**解决**：
```bash
# 重新安装依赖
rm -rf node_modules
npm install
npm run dev
```

---

## 请告诉我

1. **终端输出**：是否有错误？完整的错误信息是什么？
2. **Console 错误**：开发者工具中有什么红色错误？
3. **Network 状态**：是否有失败的请求？

把这些信息告诉我，我会帮你精准定位问题。
