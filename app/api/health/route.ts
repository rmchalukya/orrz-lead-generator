export function GET() {
  return Response.json({ ok: true, service: "lead-generator", ts: new Date().toISOString() });
}
