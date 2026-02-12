import type { NextConfig } from "next";

import packagejson from './package.json' with { type: 'json' };

function getInternalPackages() {
  // Extract all dependencies and devDependencies that start with "@repo/"
  const allDependencies = {
    ...packagejson.dependencies,
    ...packagejson.devDependencies,
  };

  return Object.keys(allDependencies).filter((pkg) => pkg.startsWith('@repo/'));
}

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    ignoreBuildErrors: true,
  },
  transpilePackages: getInternalPackages(),
};

export default nextConfig;
