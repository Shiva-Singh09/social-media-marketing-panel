import Link from "next/link";
import { Globe2, HeartHandshake, Server, ShieldCheck } from "lucide-react";
import { Button, Card } from "@/components/ui";

export const metadata = {
  title: "About — SMM Panel",
  description: "Who we are and how our social media marketing panel works.",
};

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6">
      <h1 className="text-4xl font-bold">About SMM Panel</h1>
      <p className="mt-4 text-lg text-slate-400">
        We are a wholesale social media marketing platform built for Indian resellers, agencies and
        creators. Our automated infrastructure processes thousands of orders every day across
        Instagram, YouTube, TikTok, Facebook, X and Telegram.
      </p>

      <div className="mt-10 grid gap-5 sm:grid-cols-2">
        {[
          {
            icon: Server,
            title: "Automated fulfilment",
            text: "Orders are queued the moment your wallet is debited — no manual steps, no waiting on emails.",
          },
          {
            icon: ShieldCheck,
            title: "Payment integrity",
            text: "Every Razorpay payment is verified server-side with an HMAC SHA-256 signature check plus a webhook fallback.",
          },
          {
            icon: Globe2,
            title: "Global supply",
            text: "Multiple upstream providers per service so you always get the best available rate and drop protection.",
          },
          {
            icon: HeartHandshake,
            title: "Real support",
            text: "Ticket-based support with typical first response under 30 minutes, 24×7.",
          },
        ].map((item) => (
          <Card key={item.title}>
            <span className="inline-flex rounded-xl bg-gradient-to-br from-blue-500/20 to-violet-500/20 p-2.5 text-blue-300">
              <item.icon className="h-5 w-5" />
            </span>
            <h2 className="mt-4 text-lg font-semibold text-white">{item.title}</h2>
            <p className="mt-1.5 text-sm text-slate-400">{item.text}</p>
          </Card>
        ))}
      </div>

      <Card className="mt-10">
        <h2 className="text-xl font-semibold text-white">Our promise</h2>
        <ul className="mt-3 space-y-2 text-sm text-slate-400">
          <li>• Transparent per-1000 pricing with no hidden fees.</li>
          <li>• Automatic wallet refunds for cancelled or failed orders.</li>
          <li>• Your credentials are never required — only public links.</li>
          <li>• Data secured with bcrypt hashing, JWT sessions and strict rate limits.</li>
        </ul>
        <div className="mt-6">
          <Link href="/register">
            <Button>Create your free account</Button>
          </Link>
        </div>
      </Card>
    </div>
  );
}
