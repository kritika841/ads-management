module.exports = {
  apps: [
    {
      name: "satmi-ads",
      script: "./node_modules/next/dist/bin/next",
      args: "start -p 3000",
      cwd: "/home/deployer/apps/satmi-ads",
      node_args: "--max-old-space-size=640",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
      },
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "750M",
      kill_timeout: 5000,
      out_file: "/home/deployer/logs/satmi-ads-out.log",
      error_file: "/home/deployer/logs/satmi-ads-error.log",
      time: true,
    },
    {
      name: "satmi-ads-cron",
      script: "scripts/cron.cjs",
      cwd: "/home/deployer/apps/satmi-ads",
      node_args: "--max-old-space-size=192",
      env: { NODE_ENV: "production" },
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "250M",
      out_file: "/home/deployer/logs/satmi-ads-cron-out.log",
      error_file: "/home/deployer/logs/satmi-ads-cron-error.log",
      time: true,
    }
  ],
};
