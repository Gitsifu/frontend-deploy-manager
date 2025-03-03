document.addEventListener('DOMContentLoaded', function() {
  // 获取DOM元素
  const deployForm = document.getElementById('deployForm');
  const deployStatus = document.getElementById('deployStatus');
  const deploymentsList = document.getElementById('deploymentsList');
  const refreshBtn = document.getElementById('refreshBtn');
  const currentVersionInfo = document.getElementById('currentVersionInfo');
  
  // 加载当前版本和部署列表
  loadCurrentVersion();
  loadDeployments();
  
  // 部署表单提交
  deployForm.addEventListener('submit', function(e) {
    e.preventDefault();
    
    const formData = new FormData(deployForm);
    const zipFile = document.getElementById('zipFile').files[0];
    
    if (!zipFile) {
      showStatus('请选择ZIP文件', 'error');
      return;
    }
    
    if (!zipFile.name.endsWith('.zip')) {
      showStatus('请上传ZIP格式的文件', 'error');
      return;
    }
    
    // 显示上传状态
    showStatus('正在上传并部署，请稍候...', '');
    document.getElementById('deployBtn').disabled = true;
    
    fetch('/api/deploy', {
      method: 'POST',
      body: formData
    })
    .then(response => response.json())
    .then(data => {
      if (data.success) {
        showStatus(`部署成功! 版本: ${data.version}`, 'success');
        deployForm.reset();
        loadDeployments();
      } else {
        showStatus(`部署失败: ${data.error}`, 'error');
      }
    })
    .catch(error => {
      showStatus(`部署出错: ${error.message}`, 'error');
    })
    .finally(() => {
      document.getElementById('deployBtn').disabled = false;
    });
  });
  
  // 刷新按钮点击事件
  refreshBtn.addEventListener('click', function() {
    loadCurrentVersion();
    loadDeployments();
  });
  
  // 加载当前版本信息
  function loadCurrentVersion() {
    currentVersionInfo.innerHTML = '<div class="loading">加载中...</div>';
    
    fetch('/api/current-version')
      .then(response => response.json())
      .then(data => {
        if (data.success) {
          const deployDate = new Date(data.deployedAt);
          const formattedDate = deployDate.toLocaleString('zh-CN');
          
          currentVersionInfo.innerHTML = `
            <div class="current-version-info">
              <div class="current-version-header">
                <div class="current-version-name">${data.version}</div>
                <button class="btn-view" id="viewCurrentBtn">查看当前版本</button>
              </div>
              <div class="current-version-date">部署时间: ${formattedDate}</div>
              <div class="current-version-description">描述: ${data.description || '无'}</div>
            </div>
          `;
          
          // 添加查看当前版本按钮事件
          document.getElementById('viewCurrentBtn').addEventListener('click', () => {
            window.open(data.url, '_blank');
          });
        } else {
          currentVersionInfo.innerHTML = `
            <div class="no-current-version">
              ${data.message || '当前没有设置活跃版本'}
            </div>
          `;
        }
      })
      .catch(error => {
        currentVersionInfo.innerHTML = `
          <div class="status-message error">
            获取当前版本失败: ${error.message}
          </div>
        `;
      });
  }
  
  // 加载部署列表
  function loadDeployments() {
    deploymentsList.innerHTML = '<div class="loading">加载中...</div>';
    
    fetch('/api/deployments')
      .then(response => response.json())
      .then(deployments => {
        if (deployments.length === 0) {
          deploymentsList.innerHTML = '<div class="loading">暂无部署记录</div>';
          return;
        }
        
        // 获取当前版本
        fetch('/api/current-version')
          .then(response => response.json())
          .then(data => {
            const currentVersion = data.success ? data.version : null;
            renderDeployments(deployments, currentVersion);
          })
          .catch(() => {
            renderDeployments(deployments, null);
          });
      })
      .catch(error => {
        deploymentsList.innerHTML = `<div class="status-message error">加载失败: ${error.message}</div>`;
      });
  }
  
  // 渲染部署列表
  function renderDeployments(deployments, currentVersion) {
    deploymentsList.innerHTML = '';
    
    deployments.forEach(deployment => {
      const deploymentItem = document.createElement('div');
      deploymentItem.className = 'deployment-item';
      
      if (deployment.version === currentVersion) {
        deploymentItem.classList.add('current-version');
      }
      
      const deployDate = new Date(deployment.deployedAt);
      const formattedDate = deployDate.toLocaleString('zh-CN');
      
      deploymentItem.innerHTML = `
        <div class="deployment-info">
          <div class="deployment-version">${deployment.version}</div>
          <div class="deployment-date">部署时间: ${formattedDate}</div>
          <div class="deployment-description">描述: ${deployment.description || '无'}</div>
          <div class="deployment-actions">
            <button class="btn-view" data-url="${deployment.url}">查看</button>
            <button class="btn-set-current" data-version="${deployment.version}">设为当前版本</button>
            <button class="btn-delete" data-version="${deployment.version}">删除</button>
          </div>
        </div>
      `;
      
      // 添加按钮事件
      const viewBtn = deploymentItem.querySelector('.btn-view');
      viewBtn.addEventListener('click', () => {
        window.open(viewBtn.dataset.url, '_blank');
      });
      
      const setCurrentBtn = deploymentItem.querySelector('.btn-set-current');
      setCurrentBtn.addEventListener('click', () => {
        setCurrentVersion(setCurrentBtn.dataset.version);
      });
      
      const deleteBtn = deploymentItem.querySelector('.btn-delete');
      deleteBtn.addEventListener('click', () => {
        deleteDeployment(deleteBtn.dataset.version);
      });
      
      deploymentsList.appendChild(deploymentItem);
    });
  }
  
  // 设置当前版本
  function setCurrentVersion(version) {
    if (!confirm(`确定要将 ${version} 设置为当前版本吗？`)) {
      return;
    }
    
    fetch('/api/set-current', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ version })
    })
    .then(response => response.json())
    .then(data => {
      if (data.success) {
        showStatus(`已将 ${version} 设置为当前版本`, 'success');
        loadCurrentVersion();
        loadDeployments();
      } else {
        showStatus(`设置失败: ${data.error}`, 'error');
      }
    })
    .catch(error => {
      showStatus(`设置出错: ${error.message}`, 'error');
    });
  }
  
  // 删除部署
  function deleteDeployment(version) {
    if (!confirm(`确定要删除 ${version} 吗？此操作不可恢复！`)) {
      return;
    }
    
    // 提示用户输入密码
    const password = prompt("请输入管理员密码以删除此版本：");
    
    // 如果用户取消了密码输入，则中止删除操作
    if (password === null) {
      return;
    }
    
    fetch(`/api/deployments/${version}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ password })
    })
    .then(response => response.json())
    .then(data => {
      if (data.success) {
        showStatus(`已删除 ${version}`, 'success');
        loadCurrentVersion();
        loadDeployments();
      } else {
        showStatus(`删除失败: ${data.error}`, 'error');
      }
    })
    .catch(error => {
      showStatus(`删除出错: ${error.message}`, 'error');
    });
  }
  
  // 显示状态消息
  function showStatus(message, type) {
    deployStatus.textContent = message;
    deployStatus.className = 'status-message';
    
    if (type) {
      deployStatus.classList.add(type);
    }
  }
}); 