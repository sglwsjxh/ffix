# ffix ? fuck fix !!

在 powershell 里敲错命令了？  **fuck !!**

```powershell
PS C:\Users\mark3> got branch  
got: 我不认识这个命令  
PS C:\Users\mark3> fuck  
→ 建议执行：git branch
```

按 Enter 就执行了，就是这么简单

## 它干了什么

你敲错命令 → fuck 拿到报错 → 丢给 AI → 返回修复命令 → 你确认后执行

## 安装方法

```powershell
npm i -g @sglwsjxh/ffix@latest
fuck install
pwsh
```

首次运行会自动创建 `~/.ffix/config.json`，需要填写 API 信息：

```json
{
    "baseUrl": "https://api.openai.com/v1",
    "apiKey": "sk-...",
    "model": "gpt-4o"
}
```

支持任何 OpenAI 兼容的 API

## 使用方法

```powershell
# 敲错命令了
git brnch

# 让 AI 修一下
fuck
# → 建议执行：git branch
# 按 Enter 执行，Ctrl+C 取消
```

如果不想走交互式确认，可以在脚本中加 `--confirm` 参数走静默执行模式。

## 运行环境

- PowerShell 7
- Node.js 18+
- OpenAI 兼容的 api

## 从源码开发

```powershell
npm install           # 安装依赖
npm run build         # 编译
npm test              # 测试
npm run typecheck     # 类型检查
npx tsx src/main.ts   # 直接运行源码
```
