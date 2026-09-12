import Link from "next/link";
import { Category, Service } from "@/db";
import { ensureSeeded } from "@/lib/seed";
import { userRatePer1000 } from "@/lib/pricing";
import { formatINR, formatNumber } from "@/lib/utils";
import { Button, Card } from "@/components/ui";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Services & Pricing — SMM Panel",
  description: "Full price list for Instagram, YouTube, TikTok, Facebook, X and Telegram services.",
};

export default async function ServicesPage() {
  await ensureSeeded();

  const [cats, rows] = await Promise.all([
    Category.find({ status: "active" }).sort({ sortOrder: 1 }).lean(),
    Service.find({ status: "active" }).sort({ name: 1 }).lean(),
  ]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
      <div className="mb-10 text-center">
        <h1 className="text-4xl font-bold">Services &amp; pricing</h1>
        <p className="mt-3 text-slate-400">
          All prices are per 1000 quantity in INR. Sign in to place an order in seconds.
        </p>
      </div>

      <div className="space-y-8">
        {cats.map((cat) => {
          const catServices = rows.filter((s) => String(s.categoryId) === String(cat._id));
          if (catServices.length === 0) return null;
          return (
            <Card key={String(cat._id)}>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-xl font-semibold text-white">{cat.name}</h2>
                <span className="text-xs text-slate-500">{catServices.length} services</span>
              </div>
              <div className="overflow-x-auto rounded-xl border border-slate-800">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead className="bg-slate-950/60 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Service</th>
                      <th className="px-4 py-3">Rate / 1000</th>
                      <th className="px-4 py-3">Min</th>
                      <th className="px-4 py-3">Max</th>
                      <th className="px-4 py-3">Description</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {catServices.map((service) => (
                      <tr key={String(service._id)} className="hover:bg-slate-900/50">
                        <td className="px-4 py-3 font-medium text-slate-100">{service.name}</td>
                        <td className="px-4 py-3 font-semibold text-emerald-300">
                          {formatINR(userRatePer1000(service))}
                        </td>
                        <td className="px-4 py-3 text-slate-400">
                          {formatNumber(service.minQuantity)}
                        </td>
                        <td className="px-4 py-3 text-slate-400">
                          {formatNumber(service.maxQuantity)}
                        </td>
                        <td className="px-4 py-3 text-slate-400">{service.description ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          );
        })}
      </div>

      <div className="mt-10 flex justify-center">
        <Link href="/new-order">
          <Button size="lg">Place an order now</Button>
        </Link>
      </div>
    </div>
  );
}
