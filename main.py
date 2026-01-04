import asyncio
import json
import os
import time
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from typing import Optional

import aiomysql
import redis.asyncio as aioredis
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

# 数据库配置 - 从环境变量获取
DB_CONFIG = {
    'host': os.getenv('DB_HOST', 'localhost'),
    'port': int(os.getenv('DB_PORT', 3306)),
    'user': os.getenv('DB_USER', 'root'),
    'password': os.getenv('DB_PASSWORD', '123456'),
    'db': os.getenv('DB_NAME', 'p6sgrep8'),  # aiomysql使用'db'而不是'database'
    'charset': 'utf8mb4',
    'autocommit': True
}

# Redis配置 - 从环境变量获取（可选）
REDIS_ENABLED = os.getenv('REDIS_HOST') is not None
REDIS_CONFIG = {
    'host': os.getenv('REDIS_HOST', '127.0.0.1'),
    'port': int(os.getenv('REDIS_PORT', 6379)),
    'password': os.getenv('REDIS_PASSWORD', ''),
    'db': int(os.getenv('REDIS_DB', 0)),
    'decode_responses': True
} if REDIS_ENABLED else None

# Base62 编码字符集
BASE62_CHARS = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"

# 全局连接池
db_pool = None
redis_client = None

# 缓存配置
CACHE_TTL = 7 * 24 * 3600  # 7天
CACHE_PREFIX = "shorturl:"


async def cache_short_url(short_code: str, original_url: str, expired_at: Optional[datetime]):
    """异步写入Redis缓存，避免阻塞主流程"""
    if not redis_client:
        return
    try:
        cache_data = {
            'original_url': original_url,
            'expired_at': expired_at.isoformat() if expired_at else None
        }
        await redis_client.setex(
            f"{CACHE_PREFIX}{short_code}",
            CACHE_TTL,
            json.dumps(cache_data)
        )
    except Exception as e:
        print(f"Redis缓存写入失败: {e}", flush=True)


def base62_encode(num: int) -> str:
    """将数字转换为Base62编码"""
    if num == 0:
        return BASE62_CHARS[0]

    result = []
    while num > 0:
        result.append(BASE62_CHARS[num % 62])
        num //= 62

    return ''.join(reversed(result))


def base62_decode(code: str) -> int:
    """将Base62编码转换为数字"""
    num = 0
    for char in code:
        num = num * 62 + BASE62_CHARS.index(char)
    return num


async def init_db_pool():
    """初始化数据库连接池"""
    global db_pool
    try:
        db_pool = await aiomysql.create_pool(
            minsize=10,
            maxsize=50,
            pool_recycle=3600,
            **DB_CONFIG
        )
        print(f"Database connection pool initialized (10-50 connections)", flush=True)
    except Exception as e:
        print(f"Failed to initialize database pool: {e}", flush=True)
        raise


async def init_redis():
    """初始化Redis连接"""
    global redis_client
    if not REDIS_ENABLED:
        print("Redis not configured, caching disabled", flush=True)
        redis_client = None
        return

    try:
        redis_client = await aioredis.from_url(
            f"redis://{REDIS_CONFIG['host']}:{REDIS_CONFIG['port']}/{REDIS_CONFIG['db']}",
            # password=REDIS_CONFIG['password'],
            decode_responses=True
        )
        await redis_client.ping()
        print("Redis connected successfully", flush=True)
    except Exception as e:
        print(f"Redis connection failed, caching disabled: {e}", flush=True)
        redis_client = None


async def close_db_pool():
    """关闭数据库连接池"""
    global db_pool
    if db_pool:
        db_pool.close()
        await db_pool.wait_closed()
        print("Database connection pool closed", flush=True)


async def close_redis():
    """关闭Redis连接"""
    global redis_client
    if redis_client:
        await redis_client.close()
        print("Redis connection closed", flush=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理"""
    # 启动时初始化
    print("System starting up...", flush=True)
    await init_db_pool()
    await init_redis()
    print("System startup complete", flush=True)
    yield
    # 关闭时清理
    print("System shutting down...", flush=True)
    await close_db_pool()
    await close_redis()
    print("System shutdown complete", flush=True)


app = FastAPI(
    title="短链生成系统",
    description="支持10万QPS的高性能短链生成服务",
    version="1.0.0",
    lifespan=lifespan
)

# CORS中间件
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# 请求模型
class CreateShortUrlRequest(BaseModel):
    original_url: str
    custom_code: Optional[str] = None
    expired_days: Optional[int] = None
    creator: Optional[str] = None


class ShortUrlResponse(BaseModel):
    short_code: str
    short_url: str
    original_url: str
    created_at: str
    expired_at: Optional[str] = None


class StatsResponse(BaseModel):
    short_code: str
    original_url: str
    total_visits: int
    last_visit_time: Optional[str] = None
    created_at: str


# 根路径重定向
@app.get("/")
async def root():
    return RedirectResponse(url="/static/index.html")


# 健康检查
@app.get("/api/health")
async def health_check():
    """健康检查接口"""
    try:
        # 检查数据库
        async with db_pool.acquire() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute("SELECT 1")

        # 检查Redis
        redis_status = "connected" if redis_client else "disabled"
        if redis_client:
            try:
                await redis_client.ping()
            except:
                redis_status = "error"

        return {
            "status": "healthy",
            "timestamp": datetime.now().isoformat(),
            "database": "connected",
            "redis": redis_status
        }
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"健康检查失败: {str(e)}")


# 创建短链
@app.post("/api/shorten", response_model=ShortUrlResponse)
async def create_short_url(request: CreateShortUrlRequest):
    """创建短链接"""
    try:
        # 确保原始URL包含协议头
        original_url = request.original_url.strip()
        if not original_url.startswith(('http://', 'https://')):
            original_url = 'http://' + original_url
        created_at = datetime.now()

        async with db_pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cursor:
                # 计算过期时间
                expired_at = None
                if request.expired_days:
                    expired_at = datetime.now() + timedelta(days=request.expired_days)

                # 如果指定了自定义短码
                if request.custom_code:
                    short_code = request.custom_code.strip()
                    try:
                        await cursor.execute(
                            "INSERT INTO url_mapping (short_code, original_url, expired_at, creator, created_at) VALUES (%s, %s, %s, %s, %s)",
                            (short_code, original_url, expired_at, request.creator, created_at)
                        )
                    except aiomysql.IntegrityError:
                        raise HTTPException(status_code=400, detail="自定义短码已存在")
                else:
                    # 直接生成最终短码，避免额外UPDATE
                    max_retries = 5
                    short_code = None
                    for retry in range(max_retries):
                        candidate_code = base62_encode(time.time_ns())[-8:]  # 取后8位，减小长度
                        try:
                            await cursor.execute(
                                "INSERT INTO url_mapping (short_code, original_url, expired_at, creator, created_at) VALUES (%s, %s, %s, %s, %s)",
                                (candidate_code, original_url, expired_at, request.creator, created_at)
                            )
                            short_code = candidate_code
                            break
                        except aiomysql.IntegrityError as e:
                            if retry < max_retries - 1:
                                await asyncio.sleep(0.001)  # 短暂延迟1毫秒后重试
                                continue
                            raise HTTPException(status_code=500, detail=f"生成短链失败，请重试: {str(e)}")

                    if not short_code:
                        raise HTTPException(status_code=500, detail="短链生成失败，请稍后重试")

                # 初始化统计记录
                await cursor.execute(
                    "INSERT INTO url_stats (short_code, total_visits) VALUES (%s, 0) ON DUPLICATE KEY UPDATE short_code=short_code",
                    (short_code,)
                )

                await conn.commit()
                # 异步写入Redis缓存，不阻塞主流程
                if redis_client:
                    asyncio.create_task(cache_short_url(short_code, original_url, expired_at))

                # 构造短链URL
                short_url = f"/s/{short_code}"

                return ShortUrlResponse(
                    short_code=short_code,
                    short_url=short_url,
                    original_url=original_url,
                    created_at=created_at.isoformat(),
                    expired_at=expired_at.isoformat() if expired_at else None
                )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"创建短链失败: {str(e)}")


# 短链跳转
@app.get("/s/{short_code}")
async def redirect_short_url(short_code: str, request: Request):
    """短链跳转"""
    try:
        original_url = None
        expired_at = None

        # 先从Redis缓存读取
        if redis_client:
            try:
                cache_data = await redis_client.get(f"{CACHE_PREFIX}{short_code}")
                if cache_data:
                    data = json.loads(cache_data)
                    original_url = data['original_url']
                    expired_at = datetime.fromisoformat(data['expired_at']) if data['expired_at'] else None
            except Exception as e:
                print(f"Redis读取失败: {e}")

        # 缓存未命中，从数据库读取
        if not original_url:
            async with db_pool.acquire() as conn:
                async with conn.cursor(aiomysql.DictCursor) as cursor:
                    await cursor.execute(
                        "SELECT original_url, expired_at FROM url_mapping WHERE short_code = %s",
                        (short_code,)
                    )
                    result = await cursor.fetchone()

                    if not result:
                        raise HTTPException(status_code=404, detail="短链不存在")

                    original_url = result['original_url']
                    expired_at = result['expired_at']

                    # 写入缓存
                    if redis_client:
                        try:
                            cache_data = {
                                'original_url': original_url,
                                'expired_at': expired_at.isoformat() if expired_at else None
                            }
                            await redis_client.setex(
                                f"{CACHE_PREFIX}{short_code}",
                                CACHE_TTL,
                                json.dumps(cache_data)
                            )
                        except Exception as e:
                            print(f"Redis缓存写入失败: {e}")

        # 检查是否过期
        if expired_at and expired_at < datetime.now():
            raise HTTPException(status_code=410, detail="短链已过期")

        # 异步记录访问日志（不阻塞跳转）
        asyncio.create_task(log_access(short_code, request))

        # 立即跳转到原始URL
        return RedirectResponse(url=original_url, status_code=302)

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"跳转失败: {str(e)}")


async def log_access(short_code: str, request: Request):
    """异步记录访问日志"""
    try:
        client_ip = request.client.host if request.client else "unknown"
        user_agent = request.headers.get("user-agent", "")
        referer = request.headers.get("referer", "")

        async with db_pool.acquire() as conn:
            async with conn.cursor() as cursor:
                # 记录访问日志
                await cursor.execute(
                    "INSERT INTO access_log (short_code, ip_address, user_agent, referer) VALUES (%s, %s, %s, %s)",
                    (short_code, client_ip, user_agent, referer)
                )

                # 更新统计
                await cursor.execute(
                    "UPDATE url_stats SET total_visits = total_visits + 1, last_visit_time = NOW() WHERE short_code = %s",
                    (short_code,)
                )

                await conn.commit()
    except Exception as e:
        print(f"记录访问日志失败: {e}")


# 获取短链统计
@app.get("/api/stats/{short_code}", response_model=StatsResponse)
async def get_short_url_stats(short_code: str):
    """获取短链统计信息"""
    try:
        async with db_pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cursor:
                # 查询短链信息和统计
                await cursor.execute(
                    """
                    SELECT 
                        m.short_code, 
                        m.original_url, 
                        m.created_at,
                        COALESCE(s.total_visits, 0) as total_visits,
                        s.last_visit_time
                    FROM url_mapping m
                    LEFT JOIN url_stats s ON m.short_code = s.short_code
                    WHERE m.short_code = %s
                    """,
                    (short_code,)
                )
                result = await cursor.fetchone()

                if not result:
                    raise HTTPException(status_code=404, detail="短链不存在")

                return StatsResponse(
                    short_code=result['short_code'],
                    original_url=result['original_url'],
                    total_visits=result['total_visits'],
                    last_visit_time=result['last_visit_time'].isoformat() if result['last_visit_time'] else None,
                    created_at=result['created_at'].isoformat()
                )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取统计失败: {str(e)}")


# 获取短链列表
@app.get("/api/urls")
async def get_url_list(page: int = 1, page_size: int = 20, creator: Optional[str] = None):
    """获取短链列表"""
    try:
        async with db_pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cursor:
                offset = (page - 1) * page_size

                # 构建查询条件
                where_clause = ""
                params = []
                if creator:
                    where_clause = "WHERE m.creator = %s"
                    params.append(creator)

                # 查询总数
                await cursor.execute(f"SELECT COUNT(*) as total FROM url_mapping m {where_clause}", params)
                result = await cursor.fetchone()
                total = result['total']

                # 查询列表
                query = f"""
                    SELECT 
                        m.short_code,
                        m.original_url,
                        m.created_at,
                        m.expired_at,
                        m.creator,
                        COALESCE(s.total_visits, 0) as total_visits
                    FROM url_mapping m
                    LEFT JOIN url_stats s ON m.short_code = s.short_code
                    {where_clause}
                    ORDER BY m.created_at DESC
                    LIMIT %s OFFSET %s
                """
                params.extend([page_size, offset])

                await cursor.execute(query, params)
                results = await cursor.fetchall()

                # 格式化结果
                items = []
                for row in results:
                    items.append({
                        'short_code': row['short_code'],
                        'short_url': f"/s/{row['short_code']}",
                        'original_url': row['original_url'],
                        'created_at': row['created_at'].isoformat(),
                        'expired_at': row['expired_at'].isoformat() if row['expired_at'] else None,
                        'creator': row['creator'],
                        'total_visits': row['total_visits']
                    })

                return {
                    'total': total,
                    'page': page,
                    'page_size': page_size,
                    'items': items
                }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取列表失败: {str(e)}")


# 删除短链
@app.delete("/api/urls/{short_code}")
async def delete_short_url(short_code: str):
    """删除短链"""
    try:
        async with db_pool.acquire() as conn:
            async with conn.cursor() as cursor:
                # 删除短链
                await cursor.execute("DELETE FROM url_mapping WHERE short_code = %s", (short_code,))

                if cursor.rowcount == 0:
                    raise HTTPException(status_code=404, detail="短链不存在")

                # 删除统计
                await cursor.execute("DELETE FROM url_stats WHERE short_code = %s", (short_code,))

                await conn.commit()

                # 删除Redis缓存
                if redis_client:
                    try:
                        await redis_client.delete(f"{CACHE_PREFIX}{short_code}")
                    except Exception as e:
                        print(f"Redis缓存删除失败: {e}")

                return {"message": "删除成功"}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"删除失败: {str(e)}")


# 获取热门短链TOP10
@app.get("/api/top")
async def get_top_urls(limit: int = 10):
    """获取访问量最高的短链"""
    try:
        async with db_pool.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cursor:
                await cursor.execute(
                    """
                    SELECT 
                        m.short_code,
                        m.original_url,
                        s.total_visits,
                        s.last_visit_time
                    FROM url_stats s
                    JOIN url_mapping m ON s.short_code = m.short_code
                    ORDER BY s.total_visits DESC
                    LIMIT %s
                    """,
                    (limit,)
                )
                results = await cursor.fetchall()

                items = []
                for row in results:
                    items.append({
                        'short_code': row['short_code'],
                        'short_url': f"/s/{row['short_code']}",
                        'original_url': row['original_url'],
                        'total_visits': row['total_visits'],
                        'last_visit_time': row['last_visit_time'].isoformat() if row['last_visit_time'] else None
                    })

                return {'items': items}

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取热门短链失败: {str(e)}")


# 挂载静态文件（必须在最后）
app.mount("/static", StaticFiles(directory="static", html=True), name="static")
