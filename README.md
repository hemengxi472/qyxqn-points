# 减脂日志 · 上线说明

纯静态单文件应用，无后端、无构建步骤。所有数据存在浏览器的 localStorage 里。

## 文件

| 文件 | 作用 |
|---|---|
| `index.html` | 应用本体（全部 HTML/CSS/JS 内联） |
| `icon.svg` | 图标 |
| `manifest.webmanifest` | 添加到手机主屏幕时使用 |
| `vercel.json` | Vercel 配置 |
| `netlify.toml` | Netlify 配置 |

## 本地预览

直接双击 `index.html`，或：

```bash
cd diet-checkin
npx serve .
```

## 方式一：Vercel

```bash
cd diet-checkin
npx vercel login      # 浏览器里完成授权
npx vercel --prod     # 首次会问项目名，一路回车即可
```

部署完成后会得到一个 `https://<项目名>.vercel.app` 地址，手机可直接访问。

## 方式二：Netlify Drop（最省事）

1. 打开 https://app.netlify.com/drop
2. 把整个 `diet-checkin` 文件夹拖进去
3. 立刻得到 `https://<随机名>.netlify.app`

想固定域名，登录后改名即可。

## 方式三：部署到现有项目

把 `index.html`、`icon.svg`、`manifest.webmanifest` 复制到：

```
web-version/client/public/fitness/
```

Vite 构建时会把 `public/` 原样复制到 `dist/`，线上访问：

```
https://<现有域名>/fitness/
```

注意：现有项目的 SPA 回退会把未知路径交给 Vue 路由，静态目录里的文件会优先命中，不受影响。

## 数据说明

- 数据按域名隔离。**换域名 = 从零开始**，上线后先在「设置」里填好开始日期和起始体重。
- 清理浏览器数据会丢失记录，建议每周「导出备份」一次。
- 同一个备份 JSON 可以在任何域名下「导入备份」，所以换平台不会丢数据。
