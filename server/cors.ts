export const corsHeaders = (methods: string): Readonly<Record<string, string>> => Object.freeze({
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": methods,
  "Access-Control-Allow-Headers": "Content-Type",
});
