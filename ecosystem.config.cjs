module.exports = {
  apps: [
    {
      name: "satmi-ads",
      script: "./node_modules/next/dist/bin/next",
      args: "start -p 3000",
      cwd: "/home/deployer/apps/satmi-ads",
      node_args: "--max-old-space-size=512",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
        SUPABASE_INTERNAL_URL: "http://127.0.0.1:8000",
      },
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "900M",
      kill_timeout: 5000,
      out_file: "/home/deployer/logs/satmi-ads-out.log",
      error_file: "/home/deployer/logs/satmi-ads-error.log",
      time: true,
    },
    {
      name: "satmi-ads-cron",
      script: "scripts/cron.cjs",
      cwd: "/home/deployer/apps/satmi-ads",
      node_args: "--max-old-space-size=128",
      env: {
        NODE_ENV: "production",
        SUPABASE_INTERNAL_URL: "http://127.0.0.1:8000",
      },
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "220M",
      out_file: "/home/deployer/logs/satmi-ads-cron-out.log",
      error_file: "/home/deployer/logs/satmi-ads-cron-error.log",
      time: true,
    }
  ],
};
