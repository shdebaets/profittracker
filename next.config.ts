import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  // Let phones on the local network use the dev server (e.g. http://192.168.x.x:3000).
  // Without this, Next.js blocks its dev runtime for non-localhost hosts and the page never hydrates.
  allowedDevOrigins: ["127.0.0.1", "192.168.*.*", "10.*.*.*", "*.local"],
};

// Workflow SDK: compiles "use workflow" / "use step" (research runs).
export default withWorkflow(nextConfig);
