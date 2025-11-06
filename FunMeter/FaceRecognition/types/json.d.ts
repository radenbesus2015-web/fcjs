// Type definitions for JSON imports
declare module "*.json" {
  const value: Record<string, unknown>;
  export default value;
}
