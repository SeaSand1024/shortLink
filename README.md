# 短链生成系统

一个支持10万QPS的高性能短链生成服务系统。

## 系统特性

- ⚡ **高性能**: 支持10万QPS并发访问
- 🔗 **Base62编码**: 短链长度短，美观易记
- 📊 **实时统计**: 访问量统计和热门排行
- 🎨 **现代UI**: 美观的管理界面
- 🔒 **安全可靠**: 支持自定义短码、有效期设置
- 🚀 **易于部署**: Docker一键部署

## 技术架构

- **后端**: Python FastAPI (高性能异步框架)
- **数据库**: MySQL (持久化存储)
- **前端**: HTML + CSS + JavaScript (轻量级)
- **部署**: Docker

## 核心功能

### 1. 短链生成
- 自动生成短链（Base62编码）
- 支持自定义短码
- 支持设置有效期
- 记录创建者信息

### 2. 短链跳转
- 高速跳转到原始URL
- 自动记录访问日志
- 实时更新访问统计

### 3. 数据统计
- 总短链数统计
- 总访问量统计
- 今日新增统计
- 热门短链TOP10

### 4. 管理功能
- 短链列表查看
- 短链删除
- 统计信息查看
- 一键复制短链

## 快速开始

### 环境要求
- Python 3.11+
- MySQL 5.7+
- Docker (可选)

### 本地运行

1. 安装依赖
```bash
pip install -r requirements.txt
```

2. 配置环境变量
```bash
# 数据库配置（必需）
export DB_HOST=
export DB_PORT=3306
export DB_USER=
export DB_PASSWORD=
export DB_NAME=p6sgrep8

# Redis配置（可选，不配置则不使用缓存）
export REDIS_HOST=localhost
export REDIS_PORT=6379
export REDIS_PASSWORD=your_redis_password  # 如果有密码
export REDIS_DB=0
```

3. 启动服务
```bash
uvicorn main:app --host 0.0.0.0 --port 8000
```

4. 访问系统
```
http://localhost:8000
```

### 5. 性能测试
系统提供了两种压测方式：

1. **浏览器端可视化压测**
   访问 `http://localhost:8000/static/stress-test.html`

2. **命令行高性能压测**
   ```bash
   python benchmark.py -c 1000 -n 100000 --type redirect
   ```

### Docker部署

1. 构建镜像
```bash
docker build -t short-url-system .
```

2. 运行容器
```bash
docker run -d -p 8000:8000 \
  -e DB_HOST=11.142.154.110 \
  -e DB_PORT=3306 \
  -e DB_USER=with_givkdopomavmizll \
  -e DB_PASSWORD=akzM%6i2uQc)QK \
  -e DB_NAME=p6sgrep8 \
  -e REDIS_HOST=your_redis_host \
  -e REDIS_PORT=6379 \
  short-url-system
```

**注意**: Redis配置是可选的，如果不配置Redis环境变量，系统将不使用缓存功能，但仍可正常运行。

## API接口

### 创建短链
```
POST /api/shorten
Content-Type: application/json

{
  "original_url": "https://example.com/very/long/url",
  "custom_code": "my-link",  // 可选
  "expired_days": 30,        // 可选
  "creator": "张三"          // 可选
}
```

### 短链跳转
```
GET /s/{short_code}
```

### 获取统计
```
GET /api/stats/{short_code}
```

### 获取短链列表
```
GET /api/urls?page=1&page_size=20
```

### 删除短链
```
DELETE /api/urls/{short_code}
```

### 获取热门短链
```
GET /api/top?limit=10
```

## 性能优化

### 1. 数据库优化
- 短链码建立唯一索引
- 访问时间建立索引
- 使用aiomysql异步连接池（5-20连接）
- 读写分离（可扩展）
- 分库分表（可扩展）

### 2. 缓存策略（已实现）
- ✅ Redis缓存短链映射（TTL=7天）
- ✅ 缓存未命中时自动回源数据库
- ✅ 删除短链时自动清理缓存
- 布隆过滤器快速判断（可扩展）
- 热门短链预加载（可扩展）

### 3. 应用层优化（已实现）
- ✅ FastAPI异步处理（async/await）
- ✅ aiomysql异步数据库连接池
- ✅ Redis异步客户端
- ✅ 访问日志异步写入（不阻塞跳转）
- ✅ asyncio.create_task后台任务

### 4. 架构扩展
- 应用服务器水平扩展
- 负载均衡
- CDN加速

## 数据库设计

### url_mapping (短链映射表)
- id: 自增主键
- short_code: 短链码（唯一索引）
- original_url: 原始URL
- created_at: 创建时间
- expired_at: 过期时间
- creator: 创建者

### access_log (访问日志表)
- id: 自增主键
- short_code: 短链码
- access_time: 访问时间
- ip_address: IP地址
- user_agent: 用户代理
- referer: 来源

### url_stats (统计汇总表)
- short_code: 短链码（主键）
- total_visits: 总访问量
- last_visit_time: 最后访问时间

## 系统监控

- 健康检查: `GET /api/health`
- QPS监控（可扩展）
- 错误率监控（可扩展）
- 资源使用监控（可扩展）

## 安全特性

- URL格式验证
- 自定义短码格式限制
- SQL注入防护
- XSS防护

## 扩展功能

未来可扩展的功能：
- 访问密码保护
- 二维码生成
- 访问地域分析
- 访问设备分析
- 数据分析报表
- API限流
- 用户认证

## 项目结构

```
.
├── main.py              # FastAPI主程序
├── requirements.txt     # Python依赖
├── Dockerfile          # Docker配置
├── ARCHITECTURE.md     # 架构设计文档
├── README.md           # 项目说明
└── static/             # 前端文件
    ├── index.html      # 主页面
    └── script.js       # JavaScript脚本
```

## 许可证

MIT License