# fuck

在 powershell 里敲错命令了？**fuck!!**

```powershell
PS C:\Users\mark3> got branch
got: 我不认识这个命令
PS C:\Users\mark3> fuck
→ 建议执行：git branch
```

按 Enter 就执行了，就是这么简单

## 安装方法

```powershell
npm i -g @sglwsjxh/fuck@latest
fuck install
pwsh
```

## 使用方法

```powershell
# 敲错命令了
git brnch

# 让 AI 修一下
fuck
# → 建议执行：git branch
# 按 Enter 执行，Ctrl+C 取消
```

## 它干了什么

你敲错命令 → fuck 拿到报错 → 丢给 AI → 返回修复命令 → 你确认后执行

## 前提

- PowerShell 7
- Node.js 18+
- OpenAI 兼容的 api

## 开发

```powershell
npm run build        # 编译
npx tsx src/main.ts  # 直接跑源码
```

## 小字

- 只支持 PowerShell 7，不做 5.1 兼容
- 不存日志，不追踪你
- 每次只修一条命令，不多候选
- 必须你按 Enter 才执行，不会偷偷跑
