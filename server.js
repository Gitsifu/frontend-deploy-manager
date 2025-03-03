const express = require('express');
const fileUpload = require('express-fileupload');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const moment = require('moment');

// 从环境变量获取配置
const app = express();
const PORT = process.env.PORT || 3911;
const DEPLOY_BASE_DIR = process.env.DEPLOY_BASE_DIR || '/www/wwwroot/192.168.1.127_5911';
const NGINX_HOST = process.env.NGINX_HOST || '192.168.1.127';
const NGINX_PORT = process.env.NGINX_PORT || '5911';

// 中间件
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(fileUpload({
  createParentPath: true,
  limits: { 
    fileSize: 50 * 1024 * 1024 // 限制上传大小为 50MB
  },
}));
app.use(express.static('public'));

// 修改密码验证中间件部分
const PASSWORD = process.env.LOGIN_PASSWORD || 'admin123'; // 使用环境变量中的密码
let isAuthenticated = false;

// 添加权限验证中间件
const requireAuth = (req, res, next) => {
  if (!isAuthenticated) {
    return res.status(401).json({ error: '未登录或登录已过期，请重新登录' });
  }
  next();
};

app.post('/api/login', (req, res) => {
  const { password } = req.body;
  if (password === PASSWORD) {
    isAuthenticated = true;
    res.json({ success: true });
  } else {
    res.status(401).json({ success: false, message: '密码错误' });
  }
});

app.get('/api/auth-status', (req, res) => {
  res.json({ isAuthenticated });
});

app.post('/api/logout', (req, res) => {
  isAuthenticated = false;
  res.json({ success: true });
});

// 构建完整URL的辅助函数
function buildUrl(path) {
  // 如果NGINX_PORT是80或443，则不在URL中显示端口
  const portPart = (NGINX_PORT === '80' || NGINX_PORT === '443') ? '' : `:${NGINX_PORT}`;
  return `http://${NGINX_HOST}${portPart}/${path}`;
}

// 获取所有部署版本
app.get('/api/deployments', (req, res) => {
  try {
    const deployments = [];
    const dirs = fs.readdirSync(DEPLOY_BASE_DIR);
    
    dirs.forEach(dir => {
      const dirPath = path.join(DEPLOY_BASE_DIR, dir);
      const stats = fs.statSync(dirPath);
      
      if (stats.isDirectory() && dir.startsWith('deploy-')) {
        const infoPath = path.join(dirPath, 'deploy-info.json');
        let info = {};
        
        if (fs.existsSync(infoPath)) {
          info = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
        }
        
        // 使用保存在 deploy-info.json 中的路径
        let indexPath = info.indexPath || '';
        
        // 如果没有保存路径，尝试查找
        if (!indexPath) {
          try {
            // 递归查找第一个index.html文件
            const findIndexHtml = (dir, basePath = '') => {
              const items = fs.readdirSync(dir);
              for (const item of items) {
                const itemPath = path.join(dir, item);
                const relativePath = path.join(basePath, item);
                const itemStat = fs.statSync(itemPath);
                
                if (itemStat.isDirectory()) {
                  const found = findIndexHtml(itemPath, relativePath);
                  if (found) return found;
                } else if (item.toLowerCase() === 'index.html') {
                  return relativePath;
                }
              }
              return null;
            };
            
            const relativeIndexPath = findIndexHtml(dirPath);
            if (relativeIndexPath) {
              indexPath = '/' + relativeIndexPath;
            }
          } catch (err) {
            console.error(`查找index.html失败: ${err}`);
          }
        }
        
        deployments.push({
          version: dir,
          deployedAt: info.deployedAt || stats.ctime,
          description: info.description || '',
          path: dirPath,
          url: buildUrl(`${dir}${indexPath}`)
        });
      }
    });
    
    // 按部署时间降序排序
    deployments.sort((a, b) => new Date(b.deployedAt) - new Date(a.deployedAt));
    
    res.json(deployments);
  } catch (error) {
    console.error('获取部署列表失败:', error);
    res.status(500).json({ error: '获取部署列表失败' });
  }
});

// 上传并部署新版本
app.post('/api/deploy', requireAuth, async (req, res) => {
  try {
    if (!req.files || !req.files.zipFile) {
      return res.status(400).json({ error: '没有上传文件' });
    }
    
    const description = req.body.description || '';
    const zipFile = req.files.zipFile;
    const timestamp = moment().format('YYYYMMDD-HHmmss');
    const deployDir = `deploy-${timestamp}`;
    const deployPath = path.join(DEPLOY_BASE_DIR, deployDir);
    
    // 创建部署目录
    fs.mkdirSync(deployPath, { recursive: true });
    
    // 保存上传的 zip 文件
    const zipPath = path.join(deployPath, 'upload.zip');
    await zipFile.mv(zipPath);
    
    // 解压文件
    await new Promise((resolve, reject) => {
      exec(`unzip -o "${zipPath}" -d "${deployPath}"`, (error, stdout, stderr) => {
        if (error) {
          console.error(`解压失败: ${error}`);
          return reject(error);
        }
        resolve();
      });
    });
    
    // 删除 zip 文件
    fs.unlinkSync(zipPath);
    
    // 查找解压后的index.html文件，记录完整的相对路径
    let indexPath = '';
    try {
      const findIndexHtml = (dir, basePath = '') => {
        const items = fs.readdirSync(dir);
        for (const item of items) {
          const itemPath = path.join(dir, item);
          const relativePath = path.join(basePath, item);
          const itemStat = fs.statSync(itemPath);
          
          if (itemStat.isDirectory()) {
            const found = findIndexHtml(itemPath, relativePath);
            if (found) return found;
          } else if (item.toLowerCase() === 'index.html') {
            return relativePath;
          }
        }
        return null;
      };
      
      const relativeIndexPath = findIndexHtml(deployPath);
      if (relativeIndexPath) {
        indexPath = '/' + relativeIndexPath;
      }
    } catch (err) {
      console.error(`查找index.html失败: ${err}`);
    }
    
    // 保存部署信息
    const deployInfo = {
      deployedAt: new Date().toISOString(),
      description: description,
      indexPath: indexPath
    };
    
    fs.writeFileSync(
      path.join(deployPath, 'deploy-info.json'),
      JSON.stringify(deployInfo, null, 2)
    );
    
    res.json({
      success: true,
      version: deployDir,
      url: buildUrl(`${deployDir}${indexPath}`),
      deployedAt: deployInfo.deployedAt,
      description: description
    });
  } catch (error) {
    console.error('部署失败:', error);
    res.status(500).json({ error: '部署失败: ' + error.message });
  }
});

// 设置当前版本（创建或更新符号链接）
app.post('/api/set-current', requireAuth, (req, res) => {
  try {
    const { version } = req.body;
    if (!version) {
      return res.status(400).json({ error: '未指定版本' });
    }
    
    const versionPath = path.join(DEPLOY_BASE_DIR, version);
    const currentLink = path.join(DEPLOY_BASE_DIR, 'current');
    
    // 检查版本目录是否存在
    if (!fs.existsSync(versionPath)) {
      return res.status(404).json({ error: '指定的版本不存在' });
    }
    
    // 删除现有的符号链接（如果存在）
    if (fs.existsSync(currentLink)) {
      fs.unlinkSync(currentLink);
    }
    
    // 创建新的符号链接
    fs.symlinkSync(versionPath, currentLink, 'dir');
    
    res.json({ success: true, currentVersion: version });
  } catch (error) {
    console.error('设置当前版本失败:', error);
    res.status(500).json({ error: '设置当前版本失败: ' + error.message });
  }
});

// 删除部署版本
app.delete('/api/deployments/:version', requireAuth, (req, res) => {
  try {
    const { version } = req.params;
    const { password } = req.body; // 从请求体中获取密码
    const correctPassword = process.env.DELETE_PASSWORD || "admin123"; // 使用环境变量或默认密码
    
    const deployPath = path.join(DEPLOY_BASE_DIR, version);
    
    // 检查版本目录是否存在
    if (!fs.existsSync(deployPath)) {
      return res.status(404).json({ error: '指定的版本不存在' });
    }
    
    // 检查是否为当前版本
    const currentLink = path.join(DEPLOY_BASE_DIR, 'current');
    if (fs.existsSync(currentLink)) {
      const currentTarget = fs.readlinkSync(currentLink);
      if (currentTarget === deployPath) {
        return res.status(400).json({ error: '不能删除当前使用的版本' });
      }
    }
    
    // 验证密码
    if (!password || password !== correctPassword) {
      return res.status(401).json({ error: '密码错误，无法删除版本' });
    }
    
    // 删除目录
    fs.rmSync(deployPath, { recursive: true, force: true });
    
    res.json({ success: true, message: `版本 ${version} 已删除` });
  } catch (error) {
    console.error('删除版本失败:', error);
    res.status(500).json({ error: '删除版本失败: ' + error.message });
  }
});

// 获取当前版本信息
app.get('/api/current-version', (req, res) => {
  try {
    const currentLink = path.join(DEPLOY_BASE_DIR, 'current');
    
    if (!fs.existsSync(currentLink)) {
      return res.json({ success: false, message: '当前没有设置活跃版本' });
    }
    
    // 读取符号链接指向的目录
    const targetPath = fs.readlinkSync(currentLink);
    const version = path.basename(targetPath);
    
    // 读取部署信息
    const infoPath = path.join(targetPath, 'deploy-info.json');
    let info = {};
    
    if (fs.existsSync(infoPath)) {
      info = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
    }
    
    // 构建URL
    const indexPath = info.indexPath || '';
    const url = buildUrl(`current${indexPath}`);
    
    res.json({
      success: true,
      version: version,
      url: url,
      deployedAt: info.deployedAt,
      description: info.description || ''
    });
  } catch (error) {
    console.error('获取当前版本失败:', error);
    res.status(500).json({ error: '获取当前版本失败: ' + error.message });
  }
});

app.listen(PORT, () => {
  console.log(`服务器运行在 http://localhost:${PORT}`);
  console.log(`部署目录: ${DEPLOY_BASE_DIR}`);
  console.log(`Nginx访问地址: http://${NGINX_HOST}:${NGINX_PORT}`);
}); 