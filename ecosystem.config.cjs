module.exports = {
  apps: [
    {
      name: "satmi-ads",
      script: "npm",
      args: "start",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
      },
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "500M",
      out_file: "/home/deployer/logs/satmi-ads-out.log",
      error_file: "/home/deployer/logs/satmi-ads-error.log",
      time: true,
    },
    {
      name: "satmi-ads-cron",
      script: "scripts/cron.cjs",
      env: {
        NODE_ENV: "production",
      },
      instances: 1,
      autorestart: true,
      out_file: "/home/deployer/logs/satmi-ads-cron-out.log",
      error_file: "/home/deployer/logs/satmi-ads-cron-error.log",
      time: true,
    }
  ],
};
