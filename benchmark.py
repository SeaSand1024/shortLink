import argparse
import asyncio
import random
import statistics
import sys
import time

import aiohttp

# 默认配置
DEFAULT_CONCURRENCY = 10000
DEFAULT_REQUESTS = 1000000
DEFAULT_URL = "http://localhost:8000"


class Benchmark:
    def __init__(self, base_url, concurrency, total_requests, test_type="mixed"):
        self.base_url = base_url.rstrip('/')
        self.concurrency = concurrency
        self.total_requests = total_requests
        self.test_type = test_type
        self.short_codes = []
        self.stats = {
            "success": 0,
            "failed": 0,
            "latencies": [],
            "start_time": 0,
            "end_time": 0
        }

    async def warm_up(self, session):
        """预热：创建一些短链用于测试"""
        print("正在预热...")
        warm_up_count = min(100, self.total_requests // 10)
        for _ in range(warm_up_count):
            try:
                async with session.post(
                        f"{self.base_url}/api/shorten",
                        json={"original_url": "https://www.baidu.com", "creator": "benchmark"}
                ) as response:
                    if response.status == 200:
                        data = await response.json()
                        self.short_codes.append(data["short_code"])
            except Exception:
                pass
        print(f"预热完成，创建了 {len(self.short_codes)} 个测试短链")

    async def request_worker(self, session, queue):
        """工作协程：从队列获取任务并执行"""
        while True:
            try:
                _ = queue.get_nowait()
            except asyncio.QueueEmpty:
                break

            start_time = time.time()
            try:
                if self.test_type == "create":
                    await self.test_create(session)
                elif self.test_type == "redirect":
                    await self.test_redirect(session)
                else:  # mixed
                    if random.random() < 0.2:  # 20% 写
                        await self.test_create(session)
                    else:  # 80% 读
                        await self.test_redirect(session)

                self.stats["success"] += 1
            except Exception as e:
                self.stats["failed"] += 1
                # print(f"Request failed: {e}")
            finally:
                latency = (time.time() - start_time) * 1000  # ms
                self.stats["latencies"].append(latency)
                queue.task_done()

    async def test_create(self, session):
        async with session.post(
                f"{self.base_url}/api/shorten",
                json={"original_url": f"https://www.example.com/{uuid.uuid4()}", "creator": "benchmark"}
        ) as response:
            if response.status != 200:
                raise Exception(f"Status {response.status}")
            if self.test_type == "mixed" and random.random() < 0.1:
                data = await response.json()
                self.short_codes.append(data["short_code"])

    async def test_redirect(self, session):
        if not self.short_codes:
            await self.test_create(session)
            return

        short_code = random.choice(self.short_codes)
        async with session.get(
                f"{self.base_url}/s/{short_code}",
                allow_redirects=False
        ) as response:
            if response.status not in (301, 302):
                raise Exception(f"Status {response.status}")

    async def run(self):
        print(f"\n开始压测:")
        print(f"  目标地址: {self.base_url}")
        print(f"  并发数:   {self.concurrency}")
        print(f"  总请求数: {self.total_requests}")
        print(f"  测试类型: {self.test_type}")
        print("-" * 50)

        # 创建任务队列
        queue = asyncio.Queue()
        for _ in range(self.total_requests):
            queue.put_nowait(None)

        connector = aiohttp.TCPConnector(limit=self.concurrency, ttl_dns_cache=300)
        async with aiohttp.ClientSession(connector=connector) as session:
            # 预热
            if self.test_type in ("redirect", "mixed"):
                await self.warm_up(session)

            self.stats["start_time"] = time.time()

            # 创建工作协程
            workers = []
            for _ in range(self.concurrency):
                worker = asyncio.create_task(self.request_worker(session, queue))
                workers.append(worker)

            # 显示进度
            while not queue.empty():
                done = self.total_requests - queue.qsize()
                percent = (done / self.total_requests) * 100
                elapsed = time.time() - self.stats["start_time"]
                qps = done / elapsed if elapsed > 0 else 0
                sys.stdout.write(
                    f"\r进度: {percent:.1f}% | QPS: {qps:.0f} | 成功: {self.stats['success']} | 失败: {self.stats['failed']}")
                sys.stdout.flush()
                await asyncio.sleep(0.5)

            await asyncio.gather(*workers)
            self.stats["end_time"] = time.time()

        self.print_report()

    def print_report(self):
        duration = self.stats["end_time"] - self.stats["start_time"]
        total = self.stats["success"] + self.stats["failed"]
        qps = total / duration if duration > 0 else 0
        latencies = sorted(self.stats["latencies"])

        print("\n" + "=" * 50)
        print("测试报告")
        print("=" * 50)
        print(f"总耗时:     {duration:.2f} 秒")
        print(f"总请求数:   {total}")
        print(f"成功请求:   {self.stats['success']}")
        print(f"失败请求:   {self.stats['failed']}")
        print(f"平均QPS:    {qps:.2f}")
        print("-" * 50)
        print("响应时间统计 (ms):")
        if latencies:
            print(f"  平均:     {statistics.mean(latencies):.2f}")
            print(f"  中位数:   {statistics.median(latencies):.2f}")
            print(f"  P95:      {latencies[int(len(latencies) * 0.95)]:.2f}")
            print(f"  P99:      {latencies[int(len(latencies) * 0.99)]:.2f}")
            print(f"  最小:     {min(latencies):.2f}")
            print(f"  最大:     {max(latencies):.2f}")
        print("=" * 50)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="短链系统压测工具")
    parser.add_argument("--url", default=DEFAULT_URL, help="目标URL")
    parser.add_argument("-c", "--concurrency", type=int, default=DEFAULT_CONCURRENCY, help="并发数")
    parser.add_argument("-n", "--requests", type=int, default=DEFAULT_REQUESTS, help="总请求数")
    parser.add_argument("--type", choices=["create", "redirect", "mixed"], default="mixed", help="测试类型")

    args = parser.parse_args()

    benchmark = Benchmark(args.url, args.concurrency, args.requests, args.type)
    asyncio.run(benchmark.run())
