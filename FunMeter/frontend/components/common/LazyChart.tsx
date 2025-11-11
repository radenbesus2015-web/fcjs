// components/common/LazyChart.tsx
// Re-export recharts components (already optimized by Next.js experimental.optimizePackageImports)

"use client";

// Direct re-export dari recharts (sudah di-optimize oleh Next.js config)
export {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
