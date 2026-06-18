import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "../../../core/db.js";
import { runCampaign, setCampaignStatus } from "../../actions.js";

export const dynamic = "force-dynamic";

export default async function CampaignDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const campaign = await prisma.campaign.findUnique({
    where: { id },
    include: {
      leads: { include: { score: true, insights: true, sequence: true } },
    },
  });
  if (!campaign) notFound();

  const p = campaign.params as Record<string, unknown>;
  const leads = [...campaign.leads].sort((a, b) => (b.score?.score ?? -1) - (a.score?.score ?? -1));
  const qualified = leads.filter((l) => l.score && l.score.band !== "EXCLUDE").length;

  return (
    <main>
      <p>
        <Link href="/">← All campaigns</Link>
      </p>
      <h1>{campaign.name}</h1>
      <p className="muted">
        {String(p.businessType)} · {String(p.city)} {String(p.state)} {String(p.country)} · cap{" "}
        {String(p.maxLeads ?? "—")} · <span className={`badge ${campaign.status.toLowerCase()}`}>{campaign.status}</span>
      </p>

      <div className="actions">
        <form action={runCampaign}>
          <input type="hidden" name="id" value={campaign.id} />
          <button type="submit">▶ Run / discover</button>
        </form>
        {campaign.status === "RUNNING" ? (
          <form action={setCampaignStatus}>
            <input type="hidden" name="id" value={campaign.id} />
            <input type="hidden" name="status" value="PAUSED" />
            <button type="submit" className="secondary">Pause</button>
          </form>
        ) : (
          <form action={setCampaignStatus}>
            <input type="hidden" name="id" value={campaign.id} />
            <input type="hidden" name="status" value="RUNNING" />
            <button type="submit" className="secondary">Resume</button>
          </form>
        )}
        <Link className="muted" href={`/campaigns/${campaign.id}`}>↻ Refresh</Link>
      </div>

      <p className="muted">
        {leads.length} leads discovered · {qualified} qualified
      </p>

      {leads.length === 0 ? (
        <p className="muted">No leads yet. Click “Run / discover”, then refresh in a few seconds.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Business</th>
              <th>Site</th>
              <th>Lead</th>
              <th>Band</th>
              <th>Status</th>
              <th>Top issues</th>
            </tr>
          </thead>
          <tbody>
            {leads.map((l) => {
              const web = l.insights.find((i) => i.analyzerKey === "website")?.result as
                | { score?: number; issues?: string[] }
                | undefined;
              return (
                <tr key={l.id}>
                  <td>
                    {l.businessName}
                    {l.website ? (
                      <>
                        {" "}
                        <a className="muted" href={l.website} target="_blank" rel="noreferrer">
                          ↗
                        </a>
                      </>
                    ) : null}
                  </td>
                  <td>{web?.score ?? "—"}</td>
                  <td>{l.score?.score ?? "—"}</td>
                  <td>
                    {l.score ? <span className={`badge band-${l.score.band.toLowerCase()}`}>{l.score.band}</span> : "—"}
                  </td>
                  <td>
                    <span className={`badge ${l.status.toLowerCase()}`}>{l.status}</span>
                  </td>
                  <td className="muted">{(web?.issues ?? []).slice(0, 3).join(", ") || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </main>
  );
}
