import Link from "next/link";
import {
  BadgeCheck,
  Clock,
  CreditCard,
  Headphones,
  Rocket,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Zap,
} from "lucide-react";
import { Category, Service } from "@/db";
import { ensureSeeded } from "@/lib/seed";
import { userRatePer1000 } from "@/lib/pricing";
import { formatINR, formatNumber } from "@/lib/utils";
import { Button, Card } from "@/components/ui";

export const dynamic = "force-dynamic";

const FEATURES = [
  {
    icon: Zap,
    title: "Instant delivery",
    text: "Most services start within 0–30 minutes of placing your order — fully automated.",
  },
  {
    icon: CreditCard,
    title: "Razorpay payments",
    text: "UPI, cards, netbanking and wallets. Funds land in your wallet instantly after verification.",
  },
  {
    icon: ShieldCheck,
    title: "Secure by design",
    text: "bcrypt password hashing, JWT sessions, signature-verified payments and rate limiting.",
  },
  {
    icon: TrendingUp,
    title: "Wholesale pricing",
    text: "Rates starting at ₹3 per 1000 — the cheapest reseller pricing in India.",
  },
  {
    icon: Headphones,
    title: "24×7 ticket support",
    text: "Real humans answering tickets around the clock, right from your dashboard.",
  },
  {
    icon: BadgeCheck,
    title: "Refill guarantee",
    text: "Premium services include drop protection with up to 60-day refill windows.",
  },
];

const FAQS = [
  {
    q: "How do I place my first order?",
    a: "Create a free account, add funds with Razorpay (minimum ₹50), pick a category and service, paste your link, choose a quantity and confirm. Your balance is debited instantly.",
  },
  {
    q: "Is it safe for my account?",
    a: "Yes. We never ask for your password — only the public link of the post or profile you want to grow.",
  },
  {
    q: "How fast is delivery?",
    a: "Views and likes usually start within minutes. Followers and subscribers can take up to 24 hours depending on the service.",
  },
  {
    q: "What if an order fails?",
    a: "Cancelled or failed orders are automatically refunded to your panel wallet by our admin team.",
  },
];

export default async function HomePage() {
  await ensureSeeded();

  const [cats, allServices] = await Promise.all([
    Category.find({ status: "active" }).sort({ sortOrder: 1 }).lean(),
    Service.find({ status: "active" }).sort({ pricePer1000: 1 }).lean(),
  ]);

  const cheapest = allServices.slice(0, 6);

  return (
    <div>
      {/* Hero */}
      <section className="grid-bg relative overflow-hidden border-b border-slate-800">
        <div className="mx-auto grid max-w-7xl items-center gap-10 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:py-24">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-xs font-medium text-blue-300">
              <Sparkles className="h-3.5 w-3.5" />
              {formatNumber(allServices.length)}+ services live · Instant automated delivery
            </span>
            <h1 className="mt-5 text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl lg:text-6xl">
              Grow every social account with the{" "}
              <span className="gradient-text">cheapest SMM panel</span> in India
            </h1>
            <p className="mt-5 max-w-xl text-base text-slate-400 sm:text-lg">
              Instagram followers, YouTube views, TikTok likes, Telegram members and more — bought
              at wholesale prices, delivered automatically, paid securely through Razorpay.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/register">
                <Button size="lg">
                  <Rocket className="h-4 w-4" />
                  Create free account
                </Button>
              </Link>
              <Link href="/services">
                <Button size="lg" variant="outline">
                  View pricing
                </Button>
              </Link>
            </div>
            <dl className="mt-10 grid grid-cols-3 gap-4 border-t border-slate-800 pt-6">
              {[
                { label: "Orders delivered", value: "1.2M+" },
                { label: "Average start time", value: "< 15 min" },
                { label: "Uptime", value: "99.9%" },
              ].map((stat) => (
                <div key={stat.label}>
                  <dt className="text-xs uppercase tracking-wide text-slate-500">{stat.label}</dt>
                  <dd className="mt-1 text-lg font-bold text-white">{stat.value}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="relative">
            <div className="animate-floaty rounded-3xl border border-slate-800 bg-slate-900/70 p-6 shadow-2xl shadow-blue-500/10 backdrop-blur">
              <div className="mb-4 flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-200">Live cheapest rates</p>
                <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-300">
                  Updated now
                </span>
              </div>
              <ul className="space-y-3">
                {cheapest.map((service) => (
                  <li
                    key={String(service._id)}
                    className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3"
                  >
                    <div>
                      <p className="text-sm font-medium text-slate-100">{service.name}</p>
                      <p className="text-xs text-slate-500">
                        Min {formatNumber(service.minQuantity)} · Max{" "}
                        {formatNumber(service.maxQuantity)}
                      </p>
                    </div>
                    <span className="whitespace-nowrap text-sm font-bold text-emerald-300">
                      {formatINR(userRatePer1000(service))}
                      <span className="text-xs font-normal text-slate-500">/1k</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Categories */}
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
        <div className="mb-8 text-center">
          <h2 className="text-3xl font-bold">All the platforms you care about</h2>
          <p className="mt-2 text-slate-400">
            One wallet, one dashboard, every major social network covered.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cats.map((cat) => {
            const count = allServices.filter((s) => String(s.categoryId) === String(cat._id)).length;
            const from = allServices
              .filter((s) => String(s.categoryId) === String(cat._id))
              .reduce((min, s) => Math.min(min, userRatePer1000(s)), Number.POSITIVE_INFINITY);
            return (
              <Card key={String(cat._id)} className="transition hover:border-blue-500/40">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-white">{cat.name}</h3>
                    <p className="mt-1 text-sm text-slate-400">{count} active services</p>
                  </div>
                  <span className="rounded-xl bg-gradient-to-br from-blue-500/20 to-violet-500/20 px-3 py-2 text-xs font-semibold text-blue-200">
                    from {Number.isFinite(from) ? formatINR(from) : "—"}
                  </span>
                </div>
                <Link
                  href="/services"
                  className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-blue-400 hover:text-blue-300"
                >
                  Browse {cat.name} services →
                </Link>
              </Card>
            );
          })}
        </div>
      </section>

      {/* Features */}
      <section className="border-y border-slate-800 bg-slate-950/50 py-16">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="mb-10 text-center">
            <h2 className="text-3xl font-bold">Why resellers choose our panel</h2>
            <p className="mt-2 text-slate-400">Built for speed, security and razor-thin margins.</p>
          </div>
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature) => (
              <Card key={feature.title}>
                <span className="inline-flex rounded-xl bg-gradient-to-br from-blue-500/20 to-violet-500/20 p-2.5 text-blue-300">
                  <feature.icon className="h-5 w-5" />
                </span>
                <h3 className="mt-4 text-base font-semibold text-white">{feature.title}</h3>
                <p className="mt-1.5 text-sm text-slate-400">{feature.text}</p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
        <div className="mb-10 text-center">
          <h2 className="text-3xl font-bold">Start in 4 simple steps</h2>
        </div>
        <ol className="grid gap-5 md:grid-cols-4">
          {[
            { title: "Register", text: "Email + password or Google sign-in. Takes 20 seconds." },
            { title: "Add funds", text: "Pay via Razorpay UPI/card. Minimum ₹50 top-up." },
            { title: "Place order", text: "Pick a service, paste your link, choose quantity." },
            { title: "Watch it grow", text: "Track live status and remains from your dashboard." },
          ].map((step, index) => (
            <li key={step.title} className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-violet-500 text-sm font-bold text-white">
                {index + 1}
              </span>
              <h3 className="mt-4 font-semibold text-white">{step.title}</h3>
              <p className="mt-1 text-sm text-slate-400">{step.text}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* FAQ */}
      <section id="faq" className="border-t border-slate-800 bg-slate-950/50 py-16">
        <div className="mx-auto max-w-4xl px-4 sm:px-6">
          <h2 className="mb-8 text-center text-3xl font-bold">Frequently asked questions</h2>
          <div className="space-y-3">
            {FAQS.map((faq) => (
              <details
                key={faq.q}
                className="group rounded-2xl border border-slate-800 bg-slate-900/60 p-5"
              >
                <summary className="cursor-pointer list-none text-base font-semibold text-slate-100 marker:hidden">
                  <span className="flex items-center justify-between gap-4">
                    {faq.q}
                    <Clock className="h-4 w-4 shrink-0 text-slate-500 transition group-open:rotate-90" />
                  </span>
                </summary>
                <p className="mt-3 text-sm text-slate-400">{faq.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
        <div className="rounded-3xl border border-blue-500/20 bg-gradient-to-r from-blue-600/20 via-violet-600/20 to-fuchsia-600/10 p-10 text-center">
          <h2 className="text-3xl font-bold">Ready to scale your socials?</h2>
          <p className="mx-auto mt-3 max-w-xl text-slate-300">
            Join thousands of resellers, agencies and creators using our panel every single day.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link href="/register">
              <Button size="lg">Create free account</Button>
            </Link>
            <Link href="/login">
              <Button size="lg" variant="secondary">
                I already have an account
              </Button>
            </Link>
          </div>
          <p className="mt-4 text-xs text-slate-400">
            Demo login — user: demo@smmpanel.com / Demo@123456 · admin: admin@smmpanel.com /
            Admin@123456
          </p>
        </div>
      </section>
    </div>
  );
}
