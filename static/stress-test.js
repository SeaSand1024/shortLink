// 压测状态
let testState = {
    isRunning: false,
    startTime: null,
    endTime: null,
    totalRequests: 0,
    completedRequests: 0,
    successRequests: 0,
    failedRequests: 0,
    responseTimes: [],
    qpsData: [],
    errors: []
};

// 图表实例
let qpsChart = null;
let responseTimeChart = null;

// 测试用短链池
let testShortCodes = [];

// 初始化图表
function initCharts() {
    // QPS曲线图
    qpsChart = echarts.init(document.getElementById('qpsChart'));
    const qpsOption = {
        title: {
            text: 'QPS实时监控',
            left: 'center',
            textStyle: { fontSize: 14 }
        },
        tooltip: {
            trigger: 'axis',
            formatter: '{b}<br/>QPS: {c}'
        },
        xAxis: {
            type: 'category',
            data: [],
            boundaryGap: false
        },
        yAxis: {
            type: 'value',
            name: 'QPS'
        },
        series: [{
            data: [],
            type: 'line',
            smooth: true,
            areaStyle: {
                color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                    { offset: 0, color: 'rgba(102, 126, 234, 0.5)' },
                    { offset: 1, color: 'rgba(102, 126, 234, 0.1)' }
                ])
            },
            lineStyle: {
                color: '#667eea',
                width: 2
            }
        }]
    };
    qpsChart.setOption(qpsOption);

    // 响应时间分布图
    responseTimeChart = echarts.init(document.getElementById('responseTimeChart'));
    const responseTimeOption = {
        title: {
            text: '响应时间分布',
            left: 'center',
            textStyle: { fontSize: 14 }
        },
        tooltip: {
            trigger: 'axis',
            formatter: '{b}<br/>数量: {c}'
        },
        xAxis: {
            type: 'category',
            data: ['0-50ms', '50-100ms', '100-200ms', '200-500ms', '500ms+'],
            axisLabel: { rotate: 30 }
        },
        yAxis: {
            type: 'value',
            name: '请求数'
        },
        series: [{
            data: [0, 0, 0, 0, 0],
            type: 'bar',
            itemStyle: {
                color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                    { offset: 0, color: '#43e97b' },
                    { offset: 1, color: '#38f9d7' }
                ])
            }
        }]
    };
    responseTimeChart.setOption(responseTimeOption);
}

// 预热：创建测试短链
async function warmUp() {
    console.log('正在预热：创建测试短链...');
    const warmUpCount = 100;
    const promises = [];
    
    for (let i = 0; i < warmUpCount; i++) {
        promises.push(
            fetch('/api/shorten', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    original_url: 'https://www.baidu.com',
                    creator: 'stress-test-warmup'
                })
            })
            .then(res => res.json())
            .then(data => {
                if (data.short_code) {
                    testShortCodes.push(data.short_code);
                }
            })
            .catch(err => console.error('预热失败:', err))
        );
    }
    
    await Promise.all(promises);
    console.log(`预热完成，创建了 ${testShortCodes.length} 个测试短链`);
}

// 开始压测
async function startTest() {
    const testTarget = document.getElementById('testTarget').value;
    const concurrency = parseInt(document.getElementById('concurrency').value);
    const totalRequests = parseInt(document.getElementById('totalRequests').value);
    const duration = parseInt(document.getElementById('duration').value);

    // 验证参数
    if (concurrency < 1 || totalRequests < 1 || duration < 1) {
        alert('请输入有效的测试参数！');
        return;
    }

    // 如果是跳转测试或混合测试，先预热
    if ((testTarget === 'redirect' || testTarget === 'mixed') && testShortCodes.length < 10) {
        document.getElementById('startBtn').textContent = '预热中...';
        document.getElementById('startBtn').disabled = true;
        await warmUp();
        document.getElementById('startBtn').textContent = '开始压测';
    }

    // 重置状态
    resetTestState();
    testState.isRunning = true;
    testState.startTime = Date.now();
    testState.totalRequests = totalRequests;

    // 更新UI
    document.getElementById('startBtn').disabled = true;
    document.getElementById('stopBtn').disabled = false;
    document.getElementById('startBtn').classList.add('testing');

    // 开始压测
    console.log(`开始压测: 目标=${testTarget}, 并发=${concurrency}, 总请求=${totalRequests}, 持续时间=${duration}秒`);

    // 启动实时更新
    const updateInterval = setInterval(() => {
        if (!testState.isRunning) {
            clearInterval(updateInterval);
            return;
        }
        updateUI();
    }, 500); // 更频繁的更新

    // 使用真正的并发执行
    await runConcurrentTest(testTarget, concurrency, totalRequests, duration);

    // 停止测试
    clearInterval(updateInterval);
    stopTest();
}

// 真正的并发测试
async function runConcurrentTest(testTarget, concurrency, totalRequests, maxDuration) {
    const startTime = Date.now();
    let requestCount = 0;
    
    // 限制单批次最大并发数，避免服务器过载
    const maxBatchSize = Math.min(concurrency, 50);
    
    // 持续发送请求直到达到总数或超时
    while (testState.isRunning && requestCount < totalRequests) {
        const elapsed = (Date.now() - startTime) / 1000;
        if (elapsed >= maxDuration) {
            console.log('达到最大持续时间，停止测试');
            break;
        }
        
        // 计算本批次要发送的请求数
        const remaining = totalRequests - requestCount;
        const batchSize = Math.min(maxBatchSize, remaining);
        
        // 并发发送一批请求
        const promises = [];
        for (let i = 0; i < batchSize; i++) {
            promises.push(executeRequest(testTarget));
        }
        
        // 等待这批请求完成
        await Promise.all(promises);
        requestCount += batchSize;
        
        // 批次间延迟，避免服务器过载
        if (batchSize >= 20) {
            await new Promise(resolve => setTimeout(resolve, 50));
        } else if (batchSize >= 10) {
            await new Promise(resolve => setTimeout(resolve, 20));
        }
    }
}

// 运行测试批次（保留用于兼容）
async function runTestBatch(testTarget, batchSize, maxDuration) {
    const startTime = Date.now();
    
    for (let i = 0; i < batchSize; i++) {
        if (!testState.isRunning) break;
        
        // 检查是否超时
        const elapsed = (Date.now() - startTime) / 1000;
        if (elapsed >= maxDuration) break;

        // 执行单个请求
        await executeRequest(testTarget);

        // 检查是否达到总请求数
        if (testState.completedRequests >= testState.totalRequests) {
            testState.isRunning = false;
            break;
        }
    }
}

// 执行单个请求
async function executeRequest(testTarget) {
    const requestStart = Date.now();
    
    try {
        let response;
        let requestType = '';
        
        // 设置请求超时
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10秒超时
        
        try {
            if (testTarget === 'create') {
                // 测试短链生成
                requestType = 'create';
                response = await fetch('/api/shorten', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        original_url: 'https://www.baidu.com',
                        creator: 'stress-test'
                    }),
                    signal: controller.signal
                });
            } else if (testTarget === 'redirect') {
                // 测试短链跳转（使用预热创建的短链）
                if (testShortCodes.length > 0) {
                    requestType = 'redirect';
                    const randomCode = testShortCodes[Math.floor(Math.random() * testShortCodes.length)];
                    // 使用HEAD请求测试跳转，避免实际下载内容
                    response = await fetch(`/s/${randomCode}`, { 
                        method: 'HEAD',
                        redirect: 'manual',
                        signal: controller.signal
                    });
                } else {
                    // 如果没有测试短链，创建一个
                    requestType = 'create';
                    response = await fetch('/api/shorten', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            original_url: 'https://www.baidu.com',
                            creator: 'stress-test'
                        }),
                        signal: controller.signal
                    });
                }
            } else {
                // 混合测试
                const rand = Math.random();
                if (rand < 0.3) {
                    // 30% 创建短链
                    requestType = 'create';
                    response = await fetch('/api/shorten', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            original_url: 'https://www.baidu.com',
                            creator: 'stress-test'
                        }),
                        signal: controller.signal
                    });
                } else if (rand < 0.7 && testShortCodes.length > 0) {
                    // 40% 短链跳转
                    requestType = 'redirect';
                    const randomCode = testShortCodes[Math.floor(Math.random() * testShortCodes.length)];
                    // 使用HEAD请求测试跳转，避免实际下载内容
                    response = await fetch(`/s/${randomCode}`, { 
                        method: 'HEAD',
                        redirect: 'manual',
                        signal: controller.signal
                    });
                } else {
                    // 30% 查询列表
                    requestType = 'list';
                    response = await fetch('/api/urls?page=1&page_size=20', {
                        signal: controller.signal
                    });
                }
            }
            
            clearTimeout(timeoutId);
        } catch (fetchError) {
            clearTimeout(timeoutId);
            throw fetchError;
        }

        const responseTime = Date.now() - requestStart;
        testState.responseTimes.push(responseTime);

        if (response.ok || response.status === 302 ||response.status === 405|| response.type === 'opaqueredirect') {
            testState.successRequests++;
            
            // 如果是创建短链成功，保存短码供后续使用
            if ((requestType === 'create') && (response.ok)) {
                try {
                    const data = await response.json();
                    if (data.short_code && testShortCodes.length < 1000) {
                        testShortCodes.push(data.short_code);
                    }
                } catch (e) {
                    // 忽略JSON解析错误
                }
            }
        } else {
            testState.failedRequests++;
            let errorDetail = `${response.status} ${response.statusText}`;
            try {
                const errorData = await response.json();
                if (errorData.detail) {
                    errorDetail += ` - ${errorData.detail}`;
                }
            } catch (e) {
                // 忽略JSON解析错误
            }
            testState.errors.push({
                type: requestType,
                status: response.status,
                statusText: response.statusText,
                detail: errorDetail,
                time: new Date().toISOString()
            });
            console.error(`请求失败 [${requestType}]:`, errorDetail);
        }
    } catch (error) {
        const responseTime = Date.now() - requestStart;
        testState.responseTimes.push(responseTime);
        testState.failedRequests++;
        const errorMsg = error.name === 'AbortError' ? '请求超时' : error.message;
        testState.errors.push({
            type: 'network',
            error: errorMsg,
            time: new Date().toISOString()
        });
        console.error('网络错误:', errorMsg);
    }

    testState.completedRequests++;
}

// 停止压测
function stopTest() {
    testState.isRunning = false;
    testState.endTime = Date.now();

    // 更新UI
    document.getElementById('startBtn').disabled = false;
    document.getElementById('stopBtn').disabled = true;
    document.getElementById('startBtn').classList.remove('testing');

    // 最后更新一次UI
    updateUI();

    console.log('压测结束');
    console.log('测试结果:', {
        总请求数: testState.completedRequests,
        成功: testState.successRequests,
        失败: testState.failedRequests,
        成功率: ((testState.successRequests / testState.completedRequests) * 100).toFixed(2) + '%',
        平均响应时间: calculateAvgResponseTime() + 'ms'
    });
}

// 更新UI
function updateUI() {
    const elapsed = (Date.now() - testState.startTime) / 1000;
    const currentQPS = Math.round(testState.completedRequests / elapsed);
    const avgResponseTime = calculateAvgResponseTime();
    const successRate = testState.completedRequests > 0 
        ? ((testState.successRequests / testState.completedRequests) * 100).toFixed(2)
        : 0;
    const progress = Math.min((testState.completedRequests / testState.totalRequests) * 100, 100);

    // 更新统计卡片
    document.getElementById('currentQPS').textContent = currentQPS.toLocaleString();
    document.getElementById('avgResponseTime').textContent = avgResponseTime + 'ms';
    document.getElementById('successRate').textContent = successRate + '%';
    document.getElementById('completedRequests').textContent = testState.completedRequests.toLocaleString();

    // 更新进度条
    document.getElementById('progressBar').style.width = progress + '%';
    document.getElementById('progressText').textContent = progress.toFixed(1) + '%';

    // 更新详细结果
    document.getElementById('totalRequestsResult').textContent = testState.completedRequests.toLocaleString();
    document.getElementById('successRequests').textContent = testState.successRequests.toLocaleString();
    document.getElementById('failedRequests').textContent = testState.failedRequests.toLocaleString();
    
    if (testState.responseTimes.length > 0) {
        const sortedTimes = [...testState.responseTimes].sort((a, b) => a - b);
        document.getElementById('minResponseTime').textContent = sortedTimes[0] + 'ms';
        document.getElementById('maxResponseTime').textContent = sortedTimes[sortedTimes.length - 1] + 'ms';
        document.getElementById('p95ResponseTime').textContent = calculatePercentile(sortedTimes, 95) + 'ms';
    }

    // 更新QPS图表
    updateQPSChart(currentQPS);

    // 更新响应时间分布图表
    updateResponseTimeChart();
}

// 更新QPS图表
function updateQPSChart(currentQPS) {
    const now = new Date();
    const timeLabel = now.getHours() + ':' + String(now.getMinutes()).padStart(2, '0') + ':' + String(now.getSeconds()).padStart(2, '0');
    
    testState.qpsData.push({ time: timeLabel, qps: currentQPS });
    
    // 只保留最近60个数据点
    if (testState.qpsData.length > 60) {
        testState.qpsData.shift();
    }

    const times = testState.qpsData.map(d => d.time);
    const qpsValues = testState.qpsData.map(d => d.qps);

    qpsChart.setOption({
        xAxis: { data: times },
        series: [{ data: qpsValues }]
    });
}

// 更新响应时间分布图表
function updateResponseTimeChart() {
    const distribution = [0, 0, 0, 0, 0];
    
    testState.responseTimes.forEach(time => {
        if (time < 50) distribution[0]++;
        else if (time < 100) distribution[1]++;
        else if (time < 200) distribution[2]++;
        else if (time < 500) distribution[3]++;
        else distribution[4]++;
    });

    responseTimeChart.setOption({
        series: [{ data: distribution }]
    });
}

// 计算平均响应时间
function calculateAvgResponseTime() {
    if (testState.responseTimes.length === 0) return 0;
    const sum = testState.responseTimes.reduce((a, b) => a + b, 0);
    return Math.round(sum / testState.responseTimes.length);
}

// 计算百分位数
function calculatePercentile(sortedArray, percentile) {
    if (sortedArray.length === 0) return 0;
    const index = Math.ceil((percentile / 100) * sortedArray.length) - 1;
    return sortedArray[index];
}

// 重置测试状态
function resetTestState() {
    testState = {
        isRunning: false,
        startTime: null,
        endTime: null,
        totalRequests: 0,
        completedRequests: 0,
        successRequests: 0,
        failedRequests: 0,
        responseTimes: [],
        qpsData: [],
        errors: []
    };
    
    // 不清空测试短链池，可以复用
    // testShortCodes = [];
}

// 导出结果
function exportResults() {
    if (testState.completedRequests === 0) {
        alert('暂无测试结果可导出！');
        return;
    }

    const elapsed = (testState.endTime - testState.startTime) / 1000;
    const avgQPS = Math.round(testState.completedRequests / elapsed);
    const sortedTimes = [...testState.responseTimes].sort((a, b) => a - b);

    const results = {
        测试配置: {
            测试目标: document.getElementById('testTarget').value,
            并发用户数: document.getElementById('concurrency').value,
            总请求数: testState.totalRequests,
            持续时间: document.getElementById('duration').value + '秒'
        },
        测试结果: {
            实际完成请求数: testState.completedRequests,
            成功请求数: testState.successRequests,
            失败请求数: testState.failedRequests,
            成功率: ((testState.successRequests / testState.completedRequests) * 100).toFixed(2) + '%',
            平均QPS: avgQPS,
            测试时长: elapsed.toFixed(2) + '秒'
        },
        响应时间统计: {
            最小响应时间: sortedTimes[0] + 'ms',
            最大响应时间: sortedTimes[sortedTimes.length - 1] + 'ms',
            平均响应时间: calculateAvgResponseTime() + 'ms',
            P50响应时间: calculatePercentile(sortedTimes, 50) + 'ms',
            P95响应时间: calculatePercentile(sortedTimes, 95) + 'ms',
            P99响应时间: calculatePercentile(sortedTimes, 99) + 'ms'
        },
        错误信息: testState.errors.slice(0, 10) // 只导出前10个错误
    };

    const dataStr = JSON.stringify(results, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `stress-test-result-${new Date().getTime()}.json`;
    link.click();
    URL.revokeObjectURL(url);

    alert('测试结果已导出！');
}

// 清空结果
function clearResults() {
    if (testState.isRunning) {
        alert('测试正在进行中，无法清空结果！');
        return;
    }

    if (confirm('确定要清空所有测试结果吗？')) {
        resetTestState();
        updateUI();
        
        // 重置图表
        qpsChart.setOption({
            xAxis: { data: [] },
            series: [{ data: [] }]
        });
        
        responseTimeChart.setOption({
            series: [{ data: [0, 0, 0, 0, 0] }]
        });

        alert('测试结果已清空！');
    }
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', function() {
    initCharts();
    console.log('压测工具已就绪');
});

// 窗口大小改变时重绘图表
window.addEventListener('resize', function() {
    if (qpsChart) qpsChart.resize();
    if (responseTimeChart) responseTimeChart.resize();
});
