# 短链生成系统架构设计

## 系统概述
本系统是一个高性能短链生成服务，支持10万QPS的并发访问，提供短链生成、跳转、统计等核心功能。

## 技术架构

### 1. 整体架构
```
┌─────────────┐
│   用户端    │
└──────┬──────┘
       │
┌──────▼──────────────────────────────┐
│         Nginx/负载均衡              │
└──────┬──────────────────────────────┘
       │
┌──────▼──────────────────────────────┐
│    应用服务器集群 (FastAPI)         │
│  - 短链生成服务                     │
│  - 短链跳转服务                     │
│  - 统计分析服务                     │
└──────┬──────────────────────────────┘
       │
┌──────▼──────────────────────────────┐
│         Redis 缓存层                │
│  - 短链映射缓存                     │
│  - 访问计数缓存                     │
│  - 布隆过滤器                       │
└──────┬──────────────────────────────┘
       │
┌──────▼──────────────────────────────┐
│         MySQL 数据库                │
│  - 短链映射表                       │
│  - 访问统计表                       │
└─────────────────────────────────────┘
```

### 2. 核心技术选型
- **后端框架**: Python FastAPI (高性能异步框架)
- **数据库**: MySQL (持久化存储)
- **缓存**: Redis (内存缓存，提升读性能)
- **前端**: 原生HTML+CSS+JavaScript (轻量级)

## 核心功能设计

### 1. 短链生成算法
采用 **Base62编码 + 自增ID** 方案：
- 使用数据库自增ID作为唯一标识
- 将ID转换为Base62编码(0-9, a-z, A-Z)
- 6位Base62可支持 62^6 = 568亿+ 短链

**优势**:
- 生成速度快，无需查重
- 短链长度固定，美观
- 支持分布式扩展(号段模式)

### 2. 高性能优化策略

#### 2.1 缓存策略
- **读缓存**: 短链映射存入Redis，TTL=7天
- **写缓存**: 异步写入数据库，先返回结果
- **缓存预热**: 热门短链提前加载到缓存
- **布隆过滤器**: 快速判断短链是否存在

#### 2.2 数据库优化
- **索引优化**: 短链码建立唯一索引
- **读写分离**: 主库写入，从库读取
- **分库分表**: 按短链首字符哈希分表

#### 2.3 应用层优化
- **异步处理**: 使用FastAPI异步特性
- **连接池**: 数据库和Redis连接池
- **限流降级**: 令牌桶算法限流

### 3. 数据库设计

#### 短链映射表 (url_mapping)
```sql
CREATE TABLE url_mapping (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    short_code VARCHAR(10) UNIQUE NOT NULL,
    original_url TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expired_at TIMESTAMP NULL,
    creator VARCHAR(50),
    INDEX idx_short_code (short_code),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

#### 访问统计表 (access_log)
```sql
CREATE TABLE access_log (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    short_code VARCHAR(10) NOT NULL,
    access_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ip_address VARCHAR(50),
    user_agent TEXT,
    referer TEXT,
    INDEX idx_short_code (short_code),
    INDEX idx_access_time (access_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

#### 统计汇总表 (url_stats)
```sql
CREATE TABLE url_stats (
    short_code VARCHAR(10) PRIMARY KEY,
    total_visits BIGINT DEFAULT 0,
    last_visit_time TIMESTAMP NULL,
    INDEX idx_total_visits (total_visits)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

## 性能指标

### 目标QPS: 100,000
- **短链生成**: 20,000 QPS
- **短链跳转**: 80,000 QPS (读多写少)

### 优化措施
1. **应用服务器**: 10台 (每台1万QPS)
2. **Redis集群**: 主从+哨兵模式
3. **MySQL**: 主从复制 + 读写分离
4. **CDN加速**: 静态资源CDN分发

## 安全设计

### 1. 防刷机制
- IP限流: 单IP每分钟最多100次请求
- 用户限流: 单用户每天最多1000个短链
- 验证码: 高频操作需要验证码

### 2. 恶意链接防护
- URL黑名单检测
- 病毒链接扫描
- 钓鱼网站识别

### 3. 数据安全
- 敏感信息加密存储
- HTTPS传输加密
- SQL注入防护

## 监控告警

### 1. 性能监控
- QPS实时监控
- 响应时间监控
- 错误率监控

### 2. 资源监控
- CPU/内存使用率
- 数据库连接数
- Redis命中率

### 3. 业务监控
- 短链生成成功率
- 跳转成功率
- 热门链接TOP100

## 扩展性设计

### 1. 水平扩展
- 应用服务器无状态，可随时扩容
- 数据库分库分表支持
- Redis集群模式

### 2. 功能扩展
- 自定义短链
- 短链有效期设置
- 访问密码保护
- 二维码生成
- 数据分析报表

## 总结
本系统通过合理的架构设计、缓存策略、数据库优化等手段，能够支持10万QPS的高并发访问，同时保证系统的稳定性、安全性和可扩展性。
