# 青年员工能力积分系统

中国移动 · 青年员工能力积分微信小程序（基于微信云开发）

## 项目结构

```
points-system/
├── miniprogram/                  # 小程序前端
│   ├── app.js/json/wxss          # 入口文件
│   ├── custom-tab-bar/           # 自定义底部导航（员工/管理双角色切换）
│   ├── utils/                    # 工具模块
│   │   ├── cloud.js              # 云函数调用封装
│   │   ├── auth.js               # 登录/鉴权
│   │   ├── image.js              # 图片选择/压缩/上传
│   │   └── constants.js          # 常量/种子数据
│   ├── components/               # 可复用组件
│   │   ├── photo-uploader/       # 9宫格图片上传
│   │   ├── photo-preview/        # 全屏图片预览
│   │   ├── points-card/          # 模块积分卡片
│   │   ├── submission-item/      # 申请记录行
│   │   ├── status-badge/         # 审核状态标签
│   │   ├── empty-state/          # 空列表占位
│   │   ├── review-action-bar/    # 审核操作栏
│   │   └── navbar/               # 自定义导航栏
│   └── pages/                    # 页面
│       ├── login/                # 登录/注册
│       ├── dashboard/            # 积分仪表盘（首页）
│       ├── modules/              # 模块列表
│       ├── subcategories/        # 子项列表
│       ├── submit/               # 提交申请
│       ├── submission-detail/    # 申请详情
│       ├── history/              # 积分流水
│       ├── profile/              # 个人中心
│       └── admin/                # 管理后台
│           ├── review/           # 审核队列
│           ├── review-detail/    # 审核详情
│           ├── stats/            # 数据统计
│           └── employees/        # 员工管理
├── cloudfunctions/               # 云函数
│   ├── auth/                     # 登录/注册
│   ├── modules/                  # 模块查询
│   ├── submissions/              # 申请提交/查询
│   ├── points/                   # 积分查询
│   ├── admin/                    # 管理员功能
│   └── init/                     # 数据库初始化
└── README.md
```

## 快速开始

### 1. 前置准备

- 注册微信小程序并获取 AppID
- 开通云开发环境（在微信开发者工具中操作）
- 将 `project.config.json` 中的 `appid` 替换为你的 AppID

### 2. 初始化数据库

在微信开发者工具中，上传并部署 `init` 云函数，然后在云函数控制台调用：

```js
// 一键初始化（模块+超级管理员）
await init({ action: 'initAll', name: '管理员姓名', employeeId: 'admin001' })
```

### 3. 部署云函数

将所有云函数上传部署到云开发环境。

### 4. 运行

在微信开发者工具中编译运行，或上传体验版/正式版。

## 核心业务流程

1. **员工注册** → 微信登录 → 填写姓名/工号/部门
2. **提交积分** → 选择模块→子项 → 上传证明材料照片 → 提交
3. **管理员审核** → 审核队列 → 查看照片 → 通过/拒绝 → 积分自动入账
4. **积分查看** → 首页仪表盘（总分+各模块分+最近流水）

## 积分模块种子数据

| 模块 | 子项 | 分值 |
|------|------|------|
| 能力 | 技术认证/项目获奖/论文发表/专利发明/技能竞赛 | 5-15分 |
| 担当 | 攻坚克难/导师带徒/临时任务/跨部门协作 | 5-10分 |
| 道德 | 献血/志愿者服务/见义勇为/爱心捐助 | 2-10分 |
