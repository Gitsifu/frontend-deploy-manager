module.exports = {
  apps: [{
    name: "deploy-manager",
    script: "server.js",
    env: {
      NODE_ENV: "production",
      PORT: 3911,
      DEPLOY_BASE_DIR: "/www/wwwroot/192.168.1.127_5911",
      NGINX_HOST: "192.168.1.127",
      NGINX_PORT: "5911",
      DELETE_PASSWORD: "admin123"
    },
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: "200M",
    log_date_format: "YYYY-MM-DD HH:mm:ss"
  }]
}; 