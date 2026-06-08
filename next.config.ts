import type { NextConfig } from "next";

import { NUTRITION_SERVER_ACTION_BODY_SIZE_LIMIT } from "@/features/nutrition/file-upload-limits";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: NUTRITION_SERVER_ACTION_BODY_SIZE_LIMIT,
    },
  },
};

export default nextConfig;
