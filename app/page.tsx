import Link from "next/link";
import { prisma } from "../core/db.js";
import { listPlaybooks } from "../core/playbooks/index.js";
import { createCampaign } from "./actions.js";

export const dynamic = "force-dynamic"; // reads the DB; never prerender

export default async function Home() {
  const playbooks = listPlaybooks();
  const campaigns = await prisma.campaign.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { leads: true } } },
  });

  return (
    <main>
      <h1>Lead Generator</h1>

      <section className="card">
        <h2>New campaign</h2>
        <form action={createCampaign} className="grid">
          <label>
            Playbook
            <select name="playbookKey" defaultValue="website-sales">
              {playbooks.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Business type
            <input name="businessType" placeholder="Dentists" required />
          </label>
          <label>
            City
            <input name="city" placeholder="Mumbai" required />
          </label>
          <label>
            State
            <input name="state" placeholder="MH" />
          </label>
          <label>
            Country
            <input name="country" placeholder="India" defaultValue="India" />
          </label>
          <label>
            Max leads
            <input name="maxLeads" type="number" min={1} max={200} defaultValue={25} />
          </label>
          <label className="wide">
            Campaign name (optional)
            <input name="name" placeholder="Dentists in Mumbai" />
          </label>
          <div className="wide">
            <button type="submit">Create campaign</button>
          </div>
        </form>
      </section>

      <section className="card">
        <h2>Campaigns</h2>
        {campaigns.length === 0 ? (
          <p className="muted">No campaigns yet. Create one above.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Playbook</th>
                <th>Status</th>
                <th>Leads</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link href={`/campaigns/${c.id}`}>{c.name}</Link>
                  </td>
                  <td>{c.playbookKey}</td>
                  <td>
                    <span className={`badge ${c.status.toLowerCase()}`}>{c.status}</span>
                  </td>
                  <td>{c._count.leads}</td>
                  <td className="muted">{c.createdAt.toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
