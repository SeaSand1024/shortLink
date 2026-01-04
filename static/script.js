// 全局变量
let currentPage = 1;
let currentShortCode = '';

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', function() {
    // 加载统计数据
    loadDashboardStats();
    
    // 加载热门短链
    loadTopUrls();
    
    // 加载短链列表
    loadUrlList();
    
    // 绑定表单提交事件
    document.getElementById('createForm').addEventListener('submit', handleCreateShortUrl);
    
    // 定时刷新统计数据
    setInterval(loadDashboardStats, 30000); // 每30秒刷新一次
});

// 创建短链
async function handleCreateShortUrl(e) {
    e.preventDefault();
    
    const originalUrl = document.getElementById('originalUrl').value.trim();
    const customCode = document.getElementById('customCode').value.trim();
    const expiredDays = document.getElementById('expiredDays').value;
    const creator = document.getElementById('creator').value.trim();
    
    // 验证URL格式
    if (!isValidUrl(originalUrl)) {
        showNotification('请输入有效的URL地址', 'error');
        return;
    }
    
    // 构建请求数据
    const requestData = {
        original_url: originalUrl
    };
    
    if (customCode) {
        requestData.custom_code = customCode;
    }
    
    if (expiredDays) {
        requestData.expired_days = parseInt(expiredDays);
    }
    
    if (creator) {
        requestData.creator = creator;
    }
    
    try {
        const response = await fetch('/api/shorten', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestData)
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || '创建失败');
        }
        
        const data = await response.json();
        
        // 显示结果
        displayResult(data);
        
        // 刷新列表和统计
        loadDashboardStats();
        loadTopUrls();
        loadUrlList();
        
        showNotification('短链创建成功！', 'success');
        
    } catch (error) {
        showNotification(error.message, 'error');
    }
}

// 显示生成结果
function displayResult(data) {
    const resultDiv = document.getElementById('result');
    const shortUrlInput = document.getElementById('shortUrl');
    const shortCodeSpan = document.getElementById('shortCode');
    const visitLink = document.getElementById('visitLink');
    
    // 构建完整的短链URL
    const fullShortUrl = window.location.origin + data.short_url;
    
    shortUrlInput.value = fullShortUrl;
    shortCodeSpan.textContent = data.short_code;
    
    // 设置访问链接
    visitLink.href = fullShortUrl;
    
    currentShortCode = data.short_code;
    
    resultDiv.classList.remove('hidden');
    
    // 滚动到结果区域
    resultDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// 复制到剪贴板
function copyToClipboard(elementId) {
    const element = document.getElementById(elementId);
    element.select();
    document.execCommand('copy');
    showNotification('已复制到剪贴板', 'success');
}

// 查看统计
function viewStats() {
    if (!currentShortCode) return;
    
    loadShortUrlStats(currentShortCode);
}

// 加载仪表盘统计
async function loadDashboardStats() {
    try {
        // 加载短链列表获取统计数据
        const response = await fetch('/api/urls?page=1&page_size=1000');
        const data = await response.json();
        
        // 计算统计数据
        const totalUrls = data.total;
        let totalVisits = 0;
        let todayNew = 0;
        
        const today = new Date().toDateString();
        
        data.items.forEach(item => {
            totalVisits += item.total_visits;
            const createdDate = new Date(item.created_at).toDateString();
            if (createdDate === today) {
                todayNew++;
            }
        });
        
        // 更新显示
        document.getElementById('totalUrls').textContent = totalUrls.toLocaleString();
        document.getElementById('totalVisits').textContent = totalVisits.toLocaleString();
        document.getElementById('todayNew').textContent = todayNew.toLocaleString();
        
        // 检查系统状态
        checkSystemHealth();
        
    } catch (error) {
        console.error('加载统计数据失败:', error);
    }
}

// 检查系统健康状态
async function checkSystemHealth() {
    try {
        const response = await fetch('/api/health');
        const data = await response.json();
        
        const statusElement = document.getElementById('systemStatus');
        if (data.status === 'healthy') {
            statusElement.innerHTML = '<i class="fas fa-check-circle"></i> 运行中';
        } else {
            statusElement.innerHTML = '<i class="fas fa-exclamation-triangle"></i> 异常';
        }
    } catch (error) {
        const statusElement = document.getElementById('systemStatus');
        statusElement.innerHTML = '<i class="fas fa-times-circle"></i> 离线';
    }
}

// 加载热门短链
async function loadTopUrls() {
    try {
        const response = await fetch('/api/top?limit=10');
        const data = await response.json();
        
        const container = document.getElementById('topUrls');
        
        if (data.items.length === 0) {
            container.innerHTML = '<p class="text-gray-500 text-center py-8">暂无数据</p>';
            return;
        }
        
        container.innerHTML = data.items.map((item, index) => `
            <div class="flex items-center justify-between p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition">
                <div class="flex items-center space-x-4 flex-1">
                    <div class="flex-shrink-0 w-8 h-8 rounded-full ${getRankColor(index)} flex items-center justify-center text-white font-bold">
                        ${index + 1}
                    </div>
                    <div class="flex-1 min-w-0">
                        <p class="font-mono font-semibold text-purple-600">${item.short_code}</p>
                        <p class="text-sm text-gray-500 truncate">${item.original_url}</p>
                    </div>
                </div>
                <div class="flex items-center space-x-6">
                    <div class="text-right">
                        <p class="text-2xl font-bold text-blue-600">${item.total_visits.toLocaleString()}</p>
                        <p class="text-xs text-gray-500">访问量</p>
                    </div>
                    <button 
                        onclick="copyShortUrl('${item.short_code}')"
                        class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm"
                    >
                        <i class="fas fa-copy"></i>
                    </button>
                </div>
            </div>
        `).join('');
        
    } catch (error) {
        console.error('加载热门短链失败:', error);
    }
}

// 获取排名颜色
function getRankColor(index) {
    const colors = [
        'bg-gradient-to-r from-yellow-400 to-yellow-600',
        'bg-gradient-to-r from-gray-400 to-gray-600',
        'bg-gradient-to-r from-orange-400 to-orange-600',
        'bg-gradient-to-r from-blue-400 to-blue-600'
    ];
    return colors[index] || 'bg-gradient-to-r from-purple-400 to-purple-600';
}

// 加载短链列表
async function loadUrlList(page = 1) {
    currentPage = page;
    
    try {
        const response = await fetch(`/api/urls?page=${page}&page_size=20`);
        const data = await response.json();
        
        const tbody = document.getElementById('urlList');
        const totalCount = document.getElementById('totalCount');
        
        totalCount.textContent = data.total;
        
        if (data.items.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="px-6 py-8 text-center text-gray-500">暂无数据</td></tr>';
            return;
        }
        
        tbody.innerHTML = data.items.map(item => `
            <tr class="hover:bg-gray-50 transition">
                <td class="px-6 py-4 whitespace-nowrap">
                    <span class="font-mono font-semibold text-purple-600">${item.short_code}</span>
                </td>
                <td class="px-6 py-4">
                    <div class="max-w-md truncate text-sm text-gray-900" title="${item.original_url}">
                        ${item.original_url}
                    </div>
                </td>
                <td class="px-6 py-4 whitespace-nowrap">
                    <span class="px-3 py-1 inline-flex text-sm leading-5 font-semibold rounded-full bg-blue-100 text-blue-800">
                        ${item.total_visits.toLocaleString()}
                    </span>
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    ${formatDateTime(item.created_at)}
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    ${item.creator || '-'}
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-sm font-medium space-x-2">
                    <button 
                        onclick="copyShortUrl('${item.short_code}')"
                        class="text-blue-600 hover:text-blue-900"
                        title="复制短链"
                    >
                        <i class="fas fa-copy"></i>
                    </button>
                    <button 
                        onclick="loadShortUrlStats('${item.short_code}')"
                        class="text-green-600 hover:text-green-900"
                        title="查看统计"
                    >
                        <i class="fas fa-chart-line"></i>
                    </button>
                    <button 
                        onclick="deleteShortUrl('${item.short_code}')"
                        class="text-red-600 hover:text-red-900"
                        title="删除"
                    >
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            </tr>
        `).join('');
        
        // 渲染分页
        renderPagination(data.total, data.page, data.page_size);
        
    } catch (error) {
        console.error('加载短链列表失败:', error);
    }
}

// 渲染分页
function renderPagination(total, currentPage, pageSize) {
    const totalPages = Math.ceil(total / pageSize);
    const pagination = document.getElementById('pagination');
    
    if (totalPages <= 1) {
        pagination.innerHTML = '';
        return;
    }
    
    let html = '';
    
    // 上一页
    if (currentPage > 1) {
        html += `<button onclick="loadUrlList(${currentPage - 1})" class="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition">上一页</button>`;
    }
    
    // 页码
    for (let i = 1; i <= Math.min(totalPages, 5); i++) {
        const active = i === currentPage ? 'bg-purple-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50';
        html += `<button onclick="loadUrlList(${i})" class="px-4 py-2 border border-gray-300 rounded-lg ${active} transition">${i}</button>`;
    }
    
    if (totalPages > 5) {
        html += `<span class="px-4 py-2">...</span>`;
        html += `<button onclick="loadUrlList(${totalPages})" class="px-4 py-2 border border-gray-300 rounded-lg bg-white text-gray-700 hover:bg-gray-50 transition">${totalPages}</button>`;
    }
    
    // 下一页
    if (currentPage < totalPages) {
        html += `<button onclick="loadUrlList(${currentPage + 1})" class="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition">下一页</button>`;
    }
    
    pagination.innerHTML = html;
}

// 复制短链
function copyShortUrl(shortCode) {
    const shortUrl = window.location.origin + '/s/' + shortCode;
    
    // 创建临时输入框
    const tempInput = document.createElement('input');
    tempInput.value = shortUrl;
    document.body.appendChild(tempInput);
    tempInput.select();
    document.execCommand('copy');
    document.body.removeChild(tempInput);
    
    showNotification('短链已复制到剪贴板', 'success');
}

// 加载短链统计
async function loadShortUrlStats(shortCode) {
    try {
        const response = await fetch(`/api/stats/${shortCode}`);
        const data = await response.json();
        
        const message = `
            短码: ${data.short_code}
            原始链接: ${data.original_url}
            总访问量: ${data.total_visits.toLocaleString()}
            最后访问: ${data.last_visit_time ? formatDateTime(data.last_visit_time) : '暂无访问'}
            创建时间: ${formatDateTime(data.created_at)}
        `;
        
        alert(message);
        
    } catch (error) {
        showNotification('获取统计信息失败', 'error');
    }
}

// 删除短链
async function deleteShortUrl(shortCode) {
    if (!confirm(`确定要删除短链 ${shortCode} 吗？此操作不可恢复！`)) {
        return;
    }
    
    try {
        const response = await fetch(`/api/urls/${shortCode}`, {
            method: 'DELETE'
        });
        
        if (!response.ok) {
            throw new Error('删除失败');
        }
        
        showNotification('删除成功', 'success');
        
        // 刷新列表和统计
        loadDashboardStats();
        loadTopUrls();
        loadUrlList(currentPage);
        
    } catch (error) {
        showNotification(error.message, 'error');
    }
}

// 工具函数：验证URL
function isValidUrl(string) {
    try {
        new URL(string);
        return true;
    } catch (_) {
        return false;
    }
}

// 工具函数：格式化日期时间
function formatDateTime(dateString) {
    const date = new Date(dateString);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}`;
}

// 工具函数：显示通知
function showNotification(message, type = 'info') {
    const colors = {
        success: 'bg-green-500',
        error: 'bg-red-500',
        info: 'bg-blue-500'
    };
    
    const notification = document.createElement('div');
    notification.className = `fixed top-4 right-4 ${colors[type]} text-white px-6 py-3 rounded-lg shadow-lg z-50 transition-all transform`;
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    // 动画显示
    setTimeout(() => {
        notification.style.transform = 'translateX(0)';
    }, 10);
    
    // 3秒后自动消失
    setTimeout(() => {
        notification.style.transform = 'translateX(400px)';
        setTimeout(() => {
            document.body.removeChild(notification);
        }, 300);
    }, 3000);
}