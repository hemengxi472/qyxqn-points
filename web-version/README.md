# 青年员工能力积分系统 — Web版部署说明

## 技术栈

| 层 | 技术 |
|---|------|
| 前端 | Vue 3 + Element Plus + Vite |
| 后端 | Express.js (Node.js) |
| 数据库 | SQLite (better-sqlite3) |
| 认证 | 用户名密码 + JWT |

## 部署方式

### 方式一：Docker Compose（推荐）

适合阿里云 ECS 等服务器快速部署。

```bash
# 1. 安装 Docker 和 Docker Compose
yum install -y docker docker-compose   # CentOS
# 或
apt install -y docker.io docker-compose # Ubuntu

# 2. 启动服务
cd web-version
docker-compose up -d

# 3. 查看日志
docker-compose logs -f
```

### 方式二：直接部署（Node.js）

```bash
# 1. 安装 Node.js 20+
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs   # Ubuntu
# 或 yum install -y nodejs  # CentOS (需要先配置源)

# 2. 安装依赖
cd web-version/server
npm install

# 3. 初始化数据库（创建种子数据）
node seed.js

# 4. 构建前端
cd ../client
npm install
npm run build

# 5. 启动服务
cd ../server
node index.js
# 或使用 PM2: pm2 start index.js --name points-system
```

## 默认管理员

| 字段 | 值 |
|------|-----|
| 用户名 | admin |
| 密码 | admin123 |

请在首次登录后立即修改密码。

## 阿里云 ECS 部署步骤

### 1. 购买 ECS 实例

- 配置：2核4G 即可（100人以下使用）
- 系统：Ubuntu 22.04 或 CentOS 7.9
- 安全组：开放 22（SSH）和 3000（应用端口）

### 2. 连接服务器

```bash
ssh root@<ECS公网IP>
```

### 3. 上传代码

```bash
# 在本地执行，将代码上传到服务器
scp -r web-version/ root@<ECS公网IP>:/opt/points-system/
```

### 4. 使用 Docker Compose 启动

```bash
cd /opt/points-system/web-version
docker-compose up -d
```

### 5. 访问

打开浏览器访问 `http://<ECS公网IP>:3000`

### 6. 配置 Nginx 反向代理（可选，支持域名和 HTTPS）

```nginx
server {
    listen 80;
    server_name points.your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    # 上传文件大小限制
    client_max_body_size 10m;
}
```

## 目录结构

```
web-version/
├── client/                     # Vue 3 前端源码
│   ├── src/
│   │   ├── api/                # 请求封装
│   │   ├── components/         # 共用组件
│   │   ├── layouts/            # 布局
│   │   ├── router/             # 路由 + 导航守卫
│   │   ├── stores/             # Pinia 状态管理
│   │   └── views/              # 页面
│   │       └── admin/          # 管理端页面
│   ├── package.json
│   └── vite.config.js
├── server/                     # Express 后端
│   ├── routes/                 # API 路由
│   ├── middleware/              # JWT 认证中间件
│   ├── uploads/                # 上传文件存储目录
│   ├── db.js                   # 数据库初始化
│   ├── seed.js                 # 种子数据脚本
│   ├── index.js                # 服务入口
│   └── package.json
├── docker-compose.yml
├── Dockerfile
└── README.md
```
